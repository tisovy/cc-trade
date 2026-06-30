import { VolumeProfilePrimitive } from './chart-plugins/VolumeProfilePrimitive';
import { DrawingPrimitive } from './chart-plugins/DrawingPrimitive';
import { RSI_CONFIG } from './chart-plugins/RSIIndicator';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import './ChartWrapper.css';
import { createChart, ColorType, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import RSIPane from './RSIPane';
import { SMA } from 'technicalindicators';
import { precisionTruncate, formatVolumeShort } from '../../../utils/operations';
import { DEFAULT_PRECISION, getMinMove } from '../../../utils/precision';
import { useDataContext } from '../../../context/DataContext';
import { useDrawingContext } from '../../../hooks/useDrawingContext';
import { DRAWING_TOOLS } from '../../../constants/drawing';
import { useAlertContext } from '../../../hooks/useAlertContext';
import { getGroupedOrdersForChart } from '../../../utils/orderGroups';
import { MeasurementOverlay } from '../../common/MeasurementOverlay';

const MEASUREMENT_BAR_WIDTH_RATIO = 0.08;
import { buildTimeScaleFormatters } from '../../../utils/chart-utils';

// Sub-component for rendering Order Overlays (redesigned)
const OrderOverlay = ({ order, y, label, color: _color, onMouseDown, onCancel, onEdit }) => {
    if (y === null) return null;

    const handleCancel = (e) => {
        e.stopPropagation();
        onCancel(order);
    };

    const handleDoubleClick = (e) => {
        e.stopPropagation();
        if (onEdit) onEdit(order);
    };

    const isBuy = order.side === 'BUY';

    return (
        <div
            className={`chart-order-line ${isBuy ? 'buy' : 'sell'}`}
            style={{ top: y }}
            onMouseDown={(e) => onMouseDown(e, order)}
            onDoubleClick={handleDoubleClick}
        >
            <div className="chart-order-tag">
                <span className="chart-order-side">{isBuy ? 'B' : 'S'}</span>
                <span className="chart-order-amount">{label}</span>
                <span className="chart-order-close" onClick={handleCancel}>×</span>
            </div>
        </div>
    );
};

const GhostOrderOverlay = ({ y, label, color }) => {
    if (y === null) return null;
    return (
        <div className="chart-order-line ghost" style={{ top: y, '--order-color': color }}>
            <div className="chart-order-tag">
                <span className="chart-order-amount">{label}</span>
            </div>
        </div>
    );
};

// Alert line overlay on chart
const AlertOverlay = ({ alert, y, priceFormatted, onDelete, onDragStart }) => {
    if (y === null) return null;

    const handleMouseDown = (event) => {
        if (onDragStart) {
            onDragStart(event, alert);
        }
    };

    return (
        <div className="chart-alert-line" style={{ top: y }} onMouseDown={handleMouseDown}>
            <div className="chart-alert-tag">
                <span className="chart-alert-icon">🔔</span>
                <span className="chart-alert-price">{priceFormatted}</span>
                {onDelete && (
                    <span className="chart-alert-close" onClick={() => onDelete(alert.id)}>
                        ×
                    </span>
                )}
            </div>
        </div>
    );
};

// CompletedOrderOverlay - handles 3 states: VISIBLE, LINES_ONLY, HIDDEN
const CompletedOrderOverlay = ({ order, showOrderHistory = 'VISIBLE' }) => {
    if (order.y === null || order.x === null || showOrderHistory === 'HIDDEN') return null;

    const isBuy = order.side === 'BUY';
    const showValue = showOrderHistory === 'VISIBLE';
    // When hidden value (LINES_ONLY), use 6 non-breaking spaces to preserve underline width
    const displayText = showValue ? order.displayValue : '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0';

    return (
        <div
            className={`chart-completed-marker ${isBuy ? 'buy' : 'sell'} ${showValue ? '' : 'line-only'}`}
            style={{ top: order.y, left: order.x }}
            title={showValue ? `${isBuy ? 'Bought' : 'Sold'} @ ${order.priceFormatted}` : ''}
        >
            <span className="chart-completed-value-text">{displayText}</span>
        </div>
    );
};

export const ChartWrapper = (props) => {
    const {
        colors: {
            backgroundColor = 'black',
            lineColor = '#2962FF',
            textColor = 'white',
            areaTopColor = '#2962FF',
            areaBottomColor = 'rgba(41, 98, 255, 0.28)',
        } = {},
        onOrderCreate,
        onOrderCancel,
        onOrderPlace,
        onOrderEdit,
        onAlertCreate, // Ctrl+click alert shortcut
        onViewSwitch, // ALT+click to switch views
        showOrderHistory = 'VISIBLE', // Toggle for completed order overlays
    } = props;
    const { chart: data, orders, history, selectedPrecision, panel, enabledMarketBalance, isChartLoading, ticker } = useDataContext();
    const { alerts, deleteAlert, updateAlertPrice } = useAlertContext();
    const {
        drawings,
        activeTool,
        activeDrawing,
        selectedDrawingId,
        isDragging,
        updateCurrentKey,
        addHorizontalLine,
        addTextAnnotation,
        startDrawing,
        updateActiveDrawing,
        finalizeDrawing,
        cancelDrawing,
        selectDrawing,
        deselectAll,
        deleteSelectedDrawing,
        startDrag,
        updateDrag,
        endDrag,
    } = useDrawingContext();
    const precision = selectedPrecision ?? DEFAULT_PRECISION;
    const activeInterval = panel?.interval ?? '1h';
    const timeFormatting = useMemo(() => buildTimeScaleFormatters(activeInterval), [activeInterval]);

    const chartContainerRef = useRef();
    const chartRef = useRef();
    const candleSeriesRef = useRef();
    const volumeSeriesRef = useRef();
    const smaSeriesRef = useRef();
    const volumeProfileRef = useRef();
    const drawingPrimitiveRef = useRef();
    const currentPriceLineRef = useRef();
    const resizeAnimationFrameRef = useRef(null);
    const isDisposedRef = useRef(false);  // Prevent async operations after chart disposal
    const measurementStateRef = useRef({ active: false, start: null });
    const [measurement, setMeasurement] = useState(null);
    const [measurementProjection, setMeasurementProjection] = useState(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    // Track crosshair time for displaying when mouse is outside candle area
    const [crosshairTimeLabel, setCrosshairTimeLabel] = useState(null);

    // RSI Pane state - persisted height
    const [rsiHeightPercent, setRsiHeightPercent] = useState(() => {
        const stored = localStorage.getItem('depthViewRsiHeight');
        return stored ? parseFloat(stored) : RSI_CONFIG.defaultHeightPercent;
    });
    const [outerContainerHeight, setOuterContainerHeight] = useState(0);
    const outerContainerRef = useRef(null);
    // State to hold chart instance for RSI sync (avoids ref access during render)
    const [chartInstance, setChartInstance] = useState(null);

    // Persist RSI height
    useEffect(() => {
        localStorage.setItem('depthViewRsiHeight', rsiHeightPercent.toString());
    }, [rsiHeightPercent]);

    // Track outer container height for RSI sizing
    useEffect(() => {
        if (!outerContainerRef.current) return;

        const updateOuterHeight = () => {
            if (outerContainerRef.current) {
                setOuterContainerHeight(outerContainerRef.current.clientHeight);
            }
        };

        updateOuterHeight();

        const resizeObserver = new ResizeObserver(updateOuterHeight);
        resizeObserver.observe(outerContainerRef.current);

        return () => resizeObserver.disconnect();
    }, []);

    // State for order overlays (Y positions)
    const [visibleOrders, setVisibleOrders] = useState([]);
    // Signatures of the last committed overlays so the per-frame rAF loops below
    // only call setState when positions/labels actually change (otherwise they
    // committed a fresh array ~60x/sec, churning React + GC continuously).
    const lastOrderSigRef = useRef(null);
    const lastAlertSigRef = useRef(null);
    // State for alert overlays
    const [visibleAlerts, setVisibleAlerts] = useState([]);
    // State for completed order overlays
    const [visibleCompletedOrders, setVisibleCompletedOrders] = useState([]);
    const alertDragStateRef = useRef({ active: false, alert: null });
    const [alertDragPreview, setAlertDragPreview] = useState(null);
    // Track last click time for double-click detection
    const lastCtrlClickRef = useRef(0);
    // Track ALT click for distinguishing single (view switch) vs double (order modal) click
    const altClickTimerRef = useRef(null);
    const lastAltClickRef = useRef(0);
    // Text input state for text annotation tool
    const [textInputState, setTextInputState] = useState(null); // { x, y, point }

    // Compute dynamic precision from actual data if filter precision seems insufficient
    const derivedPriceDecimals = useMemo(() => {
        const filterDecimals = precision?.price ?? DEFAULT_PRECISION.price;

        // Check if data has values that need more precision
        if (Array.isArray(data) && data.length > 0) {
            let maxDecimals = filterDecimals;
            for (let i = Math.max(0, data.length - 20); i < data.length; i++) {
                const candle = data[i];
                if (!candle) continue;
                for (const field of ['open', 'high', 'low', 'close']) {
                    const value = candle[field];
                    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
                    // Count decimals needed for this value
                    const str = value.toString();
                    if (str.includes('e-')) {
                        const exp = parseInt(str.split('e-')[1], 10);
                        if (Number.isFinite(exp)) maxDecimals = Math.max(maxDecimals, exp);
                    } else if (str.includes('.')) {
                        const decPart = str.split('.')[1]?.replace(/0+$/, '') || '';
                        maxDecimals = Math.max(maxDecimals, decPart.length);
                    }
                }
            }
            return Math.min(12, maxDecimals);
        }
        return filterDecimals;
    }, [precision, data]);

    const priceDecimals = derivedPriceDecimals;
    const minMove = useMemo(() => {
        // If we derived more precision, compute a smaller minMove
        if (precision && derivedPriceDecimals > (precision.price ?? DEFAULT_PRECISION.price)) {
            return Math.pow(10, -derivedPriceDecimals);
        }
        return getMinMove(precision);
    }, [precision, derivedPriceDecimals]);
    const initialPriceDecimalsRef = useRef(priceDecimals);
    const initialMinMoveRef = useRef(minMove);

    // Dragging state
    const draggingStateRef = useRef({ active: false, order: null, totalNotional: 0, currentY: null });
    const [draggingGhost, setDraggingGhost] = useState(null); // { y, label, color }

    useEffect(() => {
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: backgroundColor },
                textColor,
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            grid: {
                vertLines: { color: '#333' },
                horzLines: { color: '#333' },
            },
            rightPriceScale: {
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.25,
                },
                minimumWidth: 60,
                autoScale: true,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
            },
        });
        chart.timeScale().fitContent();

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
            priceLineVisible: false,
            lastValueVisible: false,
        });
        candleSeries.applyOptions({
            priceFormat: {
                type: 'price',
                precision: initialPriceDecimalsRef.current,
                minMove: initialMinMoveRef.current,
            },
        });
        candleSeriesRef.current = candleSeries;

        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '',
            priceLineVisible: false,
            lastValueVisible: false,
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: {
                top: 0.7,
                bottom: 0,
            },
        });
        volumeSeriesRef.current = volumeSeries;

        const smaSeries = chart.addSeries(LineSeries, {
            color: lineColor,
            lineWidth: 1,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        smaSeriesRef.current = smaSeries;

        setContainerSize({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
        });

        // Reset disposed flag on mount
        isDisposedRef.current = false;

        const resizeObserver = new ResizeObserver(entries => {
            // Check disposed flag to prevent "Object is disposed" errors
            if (isDisposedRef.current || !entries.length || entries[0].target !== chartContainerRef.current) {
                return;
            }
            const { width, height } = entries[0].contentRect;
            if (resizeAnimationFrameRef.current) {
                cancelAnimationFrame(resizeAnimationFrameRef.current);
            }
            resizeAnimationFrameRef.current = requestAnimationFrame(() => {
                // Double-check disposed flag in async callback
                if (isDisposedRef.current || width <= 0 || height <= 0) {
                    resizeAnimationFrameRef.current = null;
                    return;
                }
                chart.applyOptions({ width, height });
                setContainerSize((prev) => {
                    if (prev.width === width && prev.height === height) {
                        return prev;
                    }
                    return { width, height };
                });
                resizeAnimationFrameRef.current = null;
            });
        });
        resizeObserver.observe(chartContainerRef.current);

        chartRef.current = chart;
        setChartInstance(chart);

        const volumeProfile = new VolumeProfilePrimitive({
            upColor: 'rgba(38, 166, 154, 0.3)',
            downColor: 'rgba(239, 83, 80, 0.3)',
            widthPercent: 30,
            align: 'right',
        });

        candleSeries.attachPrimitive(volumeProfile);
        volumeProfileRef.current = volumeProfile;

        const drawingPrimitive = new DrawingPrimitive();
        candleSeries.attachPrimitive(drawingPrimitive);
        drawingPrimitiveRef.current = drawingPrimitive;

        return () => {
            // Set disposed flag BEFORE any cleanup to prevent async operations
            isDisposedRef.current = true;
            setChartInstance(null);
            resizeObserver.disconnect();
            if (resizeAnimationFrameRef.current) {
                cancelAnimationFrame(resizeAnimationFrameRef.current);
                resizeAnimationFrameRef.current = null;
            }
            // Clear ALT click timer if pending
            if (altClickTimerRef.current) {
                clearTimeout(altClickTimerRef.current);
                altClickTimerRef.current = null;
            }
            // Delay chart removal by one frame to let lightweight-charts internal
            // animation loops complete before disposal. This prevents "Object is disposed"
            // errors from the library's internal draw operations.
            requestAnimationFrame(() => {
                try {
                    chart.remove();
                } catch {
                    // Silently ignore disposal errors - chart may already be gone
                }
            });
        };
    }, [backgroundColor, lineColor, textColor, areaTopColor, areaBottomColor]);

    // Sync drawing context with panel changes
    useEffect(() => {
        if (panel?.selected && panel?.interval) {
            updateCurrentKey(panel.selected, panel.interval);
        }
    }, [panel?.selected, panel?.interval, updateCurrentKey]);

    // Update drawing primitive with current drawings
    useEffect(() => {
        if (drawingPrimitiveRef.current) {
            drawingPrimitiveRef.current.setDrawings(drawings);
        }
    }, [drawings]);

    // Update drawing primitive with active drawing
    useEffect(() => {
        if (drawingPrimitiveRef.current) {
            drawingPrimitiveRef.current.setActiveDrawing(activeDrawing);
        }
    }, [activeDrawing]);

    // Update drawing primitive with selected drawing
    useEffect(() => {
        if (drawingPrimitiveRef.current) {
            drawingPrimitiveRef.current.setSelectedId(selectedDrawingId);
        }
    }, [selectedDrawingId]);

    // Disable chart interactions when any drawing tool is active (not just cursor)
    useEffect(() => {
        if (isDisposedRef.current || !chartRef.current) return;

        const isDrawingMode = activeTool !== DRAWING_TOOLS.CURSOR;
        const shouldDisableInteractions = isDrawingMode || isDragging;

        chartRef.current.applyOptions({
            handleScroll: !shouldDisableInteractions,
            handleScale: !shouldDisableInteractions,
        });

        return () => {
            if (!isDisposedRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    handleScroll: true,
                    handleScale: true,
                });
            }
        };
    }, [activeTool, isDragging]);

    useEffect(() => {
        if (isDisposedRef.current || !chartRef.current || !timeFormatting) return;
        chartRef.current.applyOptions({
            timeScale: {
                timeVisible: timeFormatting.timeVisible,
                secondsVisible: timeFormatting.secondsVisible,
                tickMarkFormatter: (time) => timeFormatting.tickFormatter(time),
            },
            localization: {
                timeFormatter: (time) => timeFormatting.tooltipFormatter(time),
            },
        });
    }, [timeFormatting]);

    useEffect(() => {
        if (!candleSeriesRef.current) return;
        candleSeriesRef.current.applyOptions({
            priceFormat: {
                type: 'price',
                precision: priceDecimals,
                minMove,
            },
        });
    }, [priceDecimals, minMove]);

    useEffect(() => {
        if (candleSeriesRef.current && volumeSeriesRef.current && data && data.length > 0) {
            candleSeriesRef.current.setData(data);

            const volumeData = data.map(d => ({
                time: d.time,
                value: d.volume,
                color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
            }));
            volumeSeriesRef.current.setData(volumeData);

            const closePrices = data.map(d => d.close);
            const period = 80;
            const smaValues = SMA.calculate({ period, values: closePrices });
            const smaData = smaValues.map((value, index) => ({
                time: data[index + (period - 1)].time,
                value,
            }));
            if (smaSeriesRef.current) {
                smaSeriesRef.current.setData(smaData);
            }

            // VPVR Logic
            const calculateVolumeProfile = (visibleData) => {
                if (!visibleData || visibleData.length === 0) {
                    if (volumeProfileRef.current) volumeProfileRef.current.setData([]);
                    return;
                }

                const minPrice = Math.min(...visibleData.map(d => d.low));
                const maxPrice = Math.max(...visibleData.map(d => d.high));
                const binsCount = 35;
                const step = (maxPrice - minPrice) / binsCount;

                if (step === 0) return;

                const profile = new Array(binsCount).fill(0).map((_, i) => ({
                    price: maxPrice - (i * step),
                    step: step,
                    vol: 0,
                    type: 'up'
                }));

                const binVolumes = new Array(binsCount).fill(0).map(() => ({ up: 0, down: 0 }));

                visibleData.forEach(d => {
                    const binIndex = Math.floor((maxPrice - d.close) / step);
                    if (binIndex >= 0 && binIndex < binsCount) {
                        if (d.close >= d.open) {
                            binVolumes[binIndex].up += d.volume;
                        } else {
                            binVolumes[binIndex].down += d.volume;
                        }
                    }
                });

                const finalProfile = profile.map((bin, i) => ({
                    ...bin,
                    vol: binVolumes[i].up + binVolumes[i].down,
                    type: binVolumes[i].up >= binVolumes[i].down ? 'up' : 'down'
                })).filter(b => b.vol > 0);

                if (volumeProfileRef.current) {
                    volumeProfileRef.current.setData(finalProfile);
                }
            };

            const debounce = (func, wait) => {
                let timeout;
                const debounced = (...args) => {
                    const later = () => {
                        clearTimeout(timeout);
                        func(...args);
                    };
                    clearTimeout(timeout);
                    timeout = setTimeout(later, wait);
                };
                debounced.cancel = () => {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = null;
                    }
                };
                return debounced;
            };

            const handleVisibleRangeChange = debounce((newVisibleLogicalRange) => {
                if (!newVisibleLogicalRange) return;
                const from = Math.max(0, Math.floor(newVisibleLogicalRange.from));
                const to = Math.min(data.length - 1, Math.ceil(newVisibleLogicalRange.to));

                if (from > to) return;

                const visibleData = data.slice(from, to + 1);
                calculateVolumeProfile(visibleData);
            }, 50);

            let unsubscribeVisibleRange;
            if (!isDisposedRef.current && chartRef.current) {
                const timeScale = chartRef.current.timeScale();
                timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
                unsubscribeVisibleRange = () => {
                    timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
                };

                const currentRange = timeScale.getVisibleLogicalRange();
                if (currentRange) {
                    handleVisibleRangeChange(currentRange);
                }
            }
            return () => {
                if (unsubscribeVisibleRange) {
                    unsubscribeVisibleRange();
                }
                handleVisibleRangeChange.cancel?.();
            };
        }
    }, [data]);

    useEffect(() => {
        if (!candleSeriesRef.current || !data || data.length === 0) return;
        const latestPrice = data[data.length - 1].close;
        if (!currentPriceLineRef.current) {
            currentPriceLineRef.current = candleSeriesRef.current.createPriceLine({
                price: latestPrice,
                color: '#53b987',
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
            });
        } else {
            currentPriceLineRef.current.applyOptions({ price: latestPrice });
        }
    }, [data]);

    useEffect(() => {
        return () => {
            if (candleSeriesRef.current && currentPriceLineRef.current) {
                candleSeriesRef.current.removePriceLine(currentPriceLineRef.current);
                currentPriceLineRef.current = null;
            }
        };
    }, []);

    // Sync Order Overlay positions with chart
    useEffect(() => {
        let rafId;
        const updateOrders = () => {
            if (!candleSeriesRef.current || !chartRef.current || !orders) {
                if (lastOrderSigRef.current !== '') {
                    lastOrderSigRef.current = '';
                    setVisibleOrders([]);
                }
                return;
            }

            const currentSymbolOrders = orders.filter(o => o.symbol === panel?.selected);
            const market = panel?.market;
            const marketValueDecimals = market === 'USDT' ? 0 : 6;

            const nextVisibleOrders = currentSymbolOrders.map(order => {
                const price = parseFloat(order.price);
                if (!Number.isFinite(price)) return null;

                const y = candleSeriesRef.current.priceToCoordinate(price);
                // If y is null, it's off-screen or series not ready
                // However, coordinate can be negative or > height if offscreen but calculated
                // priceToCoordinate returns null if price scale is empty or series invalid?

                const quantity = parseFloat(order.origQty);
                const isBuy = order.side === 'BUY';
                const color = isBuy ? '#26a69a' : '#ef5350';

                let labelText = '';
                const targetPrecision = enabledMarketBalance ? marketValueDecimals : precision?.quantity ?? 3;
                const valueToDisplay = enabledMarketBalance ? (price * quantity) : quantity;
                const truncated = precisionTruncate(valueToDisplay, targetPrecision);

                if (enabledMarketBalance && market === 'USDT') {
                    labelText = Math.floor(truncated).toString();
                } else {
                    labelText = truncated.toFixed(targetPrecision);
                }

                // Add price to label
                const priceFormatted = precisionTruncate(price, priceDecimals).toFixed(priceDecimals);
                labelText = `${labelText} @ ${priceFormatted}`;

                return {
                    ...order,
                    y,
                    color,
                    label: labelText,
                };
            }).filter(o => o && o.y !== null); // Filter nulls if any

            // Only commit when the rendered overlays actually changed (id + y
            // rounded to 0.5px + label), so idle frames don't trigger re-renders.
            const sig = nextVisibleOrders
                .map(o => `${o.orderId}:${Math.round(o.y * 2) / 2}:${o.label}`)
                .join('|');
            if (sig !== lastOrderSigRef.current) {
                lastOrderSigRef.current = sig;
                setVisibleOrders(nextVisibleOrders);
            }
            rafId = requestAnimationFrame(updateOrders);
        };

        updateOrders();
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [orders, panel?.selected, enabledMarketBalance, panel?.market, precision, containerSize.height, priceDecimals]); // Dependency on containerSize.height ensures re-calc on resize

    // Sync Alert Overlay positions with chart
    useEffect(() => {
        let rafId;
        const updateAlerts = () => {
            if (!candleSeriesRef.current || !chartRef.current || !alerts) {
                if (lastAlertSigRef.current !== '') {
                    lastAlertSigRef.current = '';
                    setVisibleAlerts([]);
                }
                return;
            }

            const currentSymbolAlerts = alerts.filter(a => a.symbol === panel?.selected && a.active);

            const nextVisibleAlerts = currentSymbolAlerts.map(alert => {
                const price = parseFloat(alert.price);
                if (!Number.isFinite(price)) return null;

                const y = candleSeriesRef.current.priceToCoordinate(price);
                const priceFormatted = precisionTruncate(price, priceDecimals).toFixed(priceDecimals);

                return {
                    ...alert,
                    y,
                    priceFormatted,
                };
            }).filter(a => a && a.y !== null);

            // Only commit when overlays actually changed (idle frames are skipped).
            const sig = nextVisibleAlerts
                .map(a => `${a.id}:${Math.round(a.y * 2) / 2}:${a.priceFormatted}`)
                .join('|');
            if (sig !== lastAlertSigRef.current) {
                lastAlertSigRef.current = sig;
                setVisibleAlerts(nextVisibleAlerts);
            }
            rafId = requestAnimationFrame(updateAlerts);
        };

        updateAlerts();
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [alerts, panel?.selected, priceDecimals, containerSize.height]);

    // Precompute grouped orders when history changes (expensive, do once)
    const groupedOrdersRef = useRef([]);
    useEffect(() => {
        if (!history || !panel?.selected) {
            groupedOrdersRef.current = [];
            return;
        }
        groupedOrdersRef.current = getGroupedOrdersForChart(history, panel.selected);
    }, [history, panel?.selected]);

    // Fast coordinate calculation function (called on scroll/zoom)
    const calculateCompletedOrderPositions = useCallback(() => {
        if (isDisposedRef.current || !candleSeriesRef.current || !chartRef.current || !data || data.length === 0) {
            return [];
        }

        const groups = groupedOrdersRef.current;
        if (groups.length === 0) return [];

        // Get chart data time bounds
        const chartStartTime = data[0].time;
        const chartEndTime = data[data.length - 1].time;

        // Calculate the chart's time span to determine relevance threshold
        const chartTimeSpan = chartEndTime - chartStartTime;

        const result = [];
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const price = group.avgPrice;
            if (!Number.isFinite(price)) continue;

            const timeInSeconds = Math.floor(group.endTime / 1000);

            // Only show trades that are within the chart's time range
            // (with a small tolerance of 10% of the chart span for edge cases)
            const tolerance = chartTimeSpan * 0.1;
            if (timeInSeconds < chartStartTime - tolerance || timeInSeconds > chartEndTime + tolerance) {
                // Trade is outside the chart's time range - skip it
                continue;
            }

            // Find the candle at or before the trade time
            let candleIndex = data.length - 1;

            // Binary search to find the candle
            let left = 0;
            let right = data.length - 1;
            while (left < right) {
                const mid = Math.floor((left + right + 1) / 2);
                if (data[mid].time <= timeInSeconds) {
                    left = mid;
                } else {
                    right = mid - 1;
                }
            }
            candleIndex = left;

            const candle = data[candleIndex];
            if (!candle) continue;

            const x = chartRef.current.timeScale().timeToCoordinate(candle.time);
            if (x === null) continue;

            const y = candleSeriesRef.current.priceToCoordinate(price);
            if (y === null) continue;

            result.push({
                id: group.id,
                side: group.side,
                y,
                x,
                displayValue: Math.round(group.totalValue),
                priceFormatted: precisionTruncate(price, priceDecimals).toFixed(priceDecimals),
            });
        }
        return result;
    }, [data, priceDecimals]);

    // Update on data/history change
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVisibleCompletedOrders(calculateCompletedOrderPositions());
    }, [calculateCompletedOrderPositions, history, panel?.selected]);

    // Subscribe to chart crosshair move for real-time position updates
    useEffect(() => {
        if (!chartRef.current) return;

        const chart = chartRef.current;

        // Update positions when chart view changes
        const handleCrosshairMove = () => {
            const positions = calculateCompletedOrderPositions();
            setVisibleCompletedOrders(positions);
        };

        // Subscribe to crosshair move (fires on any chart interaction)
        chart.subscribeCrosshairMove(handleCrosshairMove);

        return () => {
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
        };
    }, [calculateCompletedOrderPositions]);

    // Track mouse position for custom crosshair time label (works even outside candle area, including future)
    useEffect(() => {
        if (!chartRef.current || !chartContainerRef.current) return;
        const chart = chartRef.current;
        const container = chartContainerRef.current;

        const handleMouseMoveForTime = (event) => {
            if (isDisposedRef.current) return;

            const rect = container.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const timeScale = chart.timeScale();

            // Get the time axis height
            const priceScaleWidth = chart.priceScale('right').width();
            const chartWidth = rect.width - priceScaleWidth;

            // Check if mouse is within the chart's X range (not on price scale)
            if (x < 0 || x > chartWidth) {
                setCrosshairTimeLabel(null);
                return;
            }

            // Get time at current X position
            const time = timeScale.coordinateToTime(x);
            if (time !== null && time !== undefined) {
                const formattedTime = timeFormatting.tooltipFormatter(time);
                setCrosshairTimeLabel({ x, time, label: formattedTime });
                return;
            }

            // No exact time - use logical position to extrapolate (including future)
            const logical = timeScale.coordinateToLogical(x);
            if (logical === null || logical === undefined || !data || data.length < 2) {
                setCrosshairTimeLabel(null);
                return;
            }

            // Calculate candle interval from data
            const candleInterval = data[1].time - data[0].time;
            const lastCandleTime = data[data.length - 1].time;
            const lastCandleLogical = data.length - 1;

            // Calculate estimated time based on logical position
            // This works for both past (before first candle) and future (after last candle)
            const deltaLogical = logical - lastCandleLogical;
            const estimatedTime = lastCandleTime + Math.round(deltaLogical * candleInterval);

            const formattedTime = timeFormatting.tooltipFormatter(estimatedTime);
            setCrosshairTimeLabel({ x, time: estimatedTime, label: formattedTime });
        };

        const handleMouseLeave = () => {
            setCrosshairTimeLabel(null);
        };

        container.addEventListener('mousemove', handleMouseMoveForTime);
        container.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            container.removeEventListener('mousemove', handleMouseMoveForTime);
            container.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [data, timeFormatting]);

    const lastRightClickRef = useRef(0);

    const cancelMeasurement = useCallback(() => {
        if (!measurementStateRef.current.active) return;
        measurementStateRef.current = { active: false, start: null };
        setMeasurement(null);
    }, []);

    const handleDoubleClick = (e) => {
        // ALT+double-click to open order modal (BUY)
        // Cancel any pending view switch since this is a double-click
        if (altClickTimerRef.current) {
            clearTimeout(altClickTimerRef.current);
            altClickTimerRef.current = null;
        }

        if (e.altKey && onOrderCreate && chartRef.current) {
            e.preventDefault();
            const rect = chartContainerRef.current.getBoundingClientRect();
            const y = e.clientY - rect.top;

            const price = candleSeriesRef.current.coordinateToPrice(y);

            if (price !== null) {
                onOrderCreate({
                    price: price,
                    side: 'BUY',
                    amount: 0
                });
            }
        }
    };

    const handleContextMenu = (e) => {
        if (measurementStateRef.current.active) {
            e.preventDefault();
            cancelMeasurement();
            return;
        }
        // ALT+double-right-click to open order modal (SELL)
        if (e.altKey) {
            e.preventDefault();
        }
        if (e.altKey && onOrderCreate && chartRef.current) {
            const now = Date.now();
            if (now - lastRightClickRef.current < 300) {
                const rect = chartContainerRef.current.getBoundingClientRect();
                const y = e.clientY - rect.top;

                const price = candleSeriesRef.current.coordinateToPrice(y);

                if (price !== null) {
                    onOrderCreate({
                        price: price,
                        side: 'SELL',
                        amount: 0
                    });
                }
            }
            lastRightClickRef.current = now;
        }
    };

    const getMousePoint = useCallback((event) => {
        if (isDisposedRef.current || !chartRef.current || !candleSeriesRef.current || !chartContainerRef.current) return null;
        const rect = chartContainerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Get chart canvas bounds (excluding price scale and time axis)
        const priceScaleWidth = chartRef.current.priceScale('right').width();
        const timeAxisHeight = chartRef.current.timeScale().height();
        const chartWidth = rect.width - priceScaleWidth;
        const chartHeight = rect.height - timeAxisHeight;

        // Must be within the main chart canvas (not on price scale or time axis)
        if (x < 0 || y < 0 || x > chartWidth || y > chartHeight) return null;

        const price = candleSeriesRef.current.coordinateToPrice(y);
        if (price === undefined || price === null) return null;
        const time = chartRef.current.timeScale().coordinateToTime(x);
        // Also get logical index - works even outside data range
        const logical = chartRef.current.timeScale().coordinateToLogical(x);
        return { x, y, price, time: time ?? null, logical: logical ?? null };
    }, []);

    const handleMouseDown = useCallback((event) => {
        if (event.button !== 0) return;

        // View switch shortcut (Alt + single Click)
        // We delay the view switch to allow double-click detection for order modal
        if (event.altKey && !event.ctrlKey && !event.shiftKey && onViewSwitch) {
            event.preventDefault();

            const now = Date.now();
            // If this is a second click within 300ms, it's a double-click - don't switch view
            if (now - lastAltClickRef.current < 300) {
                // Double-click will be handled by handleDoubleClick
                lastAltClickRef.current = 0;
                return;
            }

            lastAltClickRef.current = now;

            // Cancel any existing timer
            if (altClickTimerRef.current) {
                clearTimeout(altClickTimerRef.current);
            }

            // Delay view switch to see if a double-click follows
            altClickTimerRef.current = setTimeout(() => {
                altClickTimerRef.current = null;
                // Check if component is still mounted before switching
                if (!isDisposedRef.current) {
                    onViewSwitch();
                }
            }, 250);
            return;
        }

        // Alert creation shortcut (Ctrl + Double Click)
        if (event.ctrlKey && !event.shiftKey && !event.altKey && onAlertCreate) {
            const now = Date.now();
            if (now - lastCtrlClickRef.current < 400) {
                // Double click detected
                const point = getMousePoint(event);
                if (!point) return;
                event.preventDefault();
                onAlertCreate(point.price);
                lastCtrlClickRef.current = 0;
                return;
            }
            lastCtrlClickRef.current = now;
            return;
        }

        // Measurement Logic (Shift + Click)
        if (event.shiftKey && !measurementStateRef.current.active) {
            const point = getMousePoint(event);
            if (!point) return;
            event.preventDefault();
            measurementStateRef.current = { active: true, start: point };
            setMeasurement({ start: point, current: point });
            return;
        }

        if (measurementStateRef.current.active) {
            event.preventDefault();
            cancelMeasurement();
            return;
        }

        // Drawing tools logic
        if (activeTool !== DRAWING_TOOLS.CURSOR) {
            const point = getMousePoint(event);
            if (!point) return;
            event.preventDefault();
            event.stopPropagation();

            if (activeTool === DRAWING_TOOLS.HORIZONTAL_LINE) {
                // Horizontal line is placed with a single click - use direct add
                addHorizontalLine(point);
                return;
            } else if (activeTool === DRAWING_TOOLS.TEXT) {
                // Text annotation - show input at click location
                setTextInputState({ x: point.x, y: point.y, point });
                return;
            } else if (activeTool === DRAWING_TOOLS.TREND_LINE || activeTool === DRAWING_TOOLS.RECTANGLE || activeTool === DRAWING_TOOLS.FIBONACCI) {
                // Two-click tools: first click = first point, second click = finalize
                if (!activeDrawing) {
                    // First click - require valid time (must be within data range)
                    if (point.time == null) {
                        return;
                    }
                    startDrawing(point, activeTool);
                } else {
                    // Second click - allow anywhere (logical index works outside data)
                    finalizeDrawing(point);
                }
            }
            return;
        }

        // Cursor mode - check for drawing selection and start drag
        if (activeTool === DRAWING_TOOLS.CURSOR && drawingPrimitiveRef.current) {
            const point = getMousePoint(event);
            if (!point) return;

            const hitResult = drawingPrimitiveRef.current.hitTest(point.x, point.y);
            if (hitResult) {
                const { drawing, hitType } = hitResult;
                selectDrawing(drawing.id);
                // Start dragging the selected drawing, passing hitType
                startDrag(drawing.id, point, hitType);
                event.preventDefault();
                event.stopPropagation();
            } else {
                deselectAll();
            }
        }
    }, [getMousePoint, cancelMeasurement, activeTool, activeDrawing, addHorizontalLine, startDrawing, finalizeDrawing, selectDrawing, deselectAll, startDrag, onAlertCreate, onViewSwitch]);

    // Handler triggered by OrderOverlay
    const handleOrderDragStart = useCallback((event, order) => {
        if (event.button !== 0) return;
        if (event.altKey) {
            event.preventDefault();
            event.stopPropagation();

            // Calculate values based on side
            const price = parseFloat(order.price);
            const quantity = parseFloat(order.origQty);
            const totalNotional = price * quantity;

            // Cancel original order
            if (onOrderCancel) {
                onOrderCancel({ symbol: order.symbol, id: order.orderId });
            }

            // Initialize dragging state
            const rect = chartContainerRef.current.getBoundingClientRect();
            const y = event.clientY - rect.top;

            draggingStateRef.current = {
                active: true,
                order: order,
                totalNotional: totalNotional,
                startQuantity: quantity, // Store original quantity
                side: order.side,        // Store side explicitly
                currentY: y
            };

            // Set initial ghost state
            const isBuy = order.side === 'BUY';
            const color = isBuy ? '#26a69a' : '#ef5350';

            setDraggingGhost({
                y: y,
                color: color,
                label: "Drag to move...",
                side: order.side,
            });
        }
    }, [onOrderCancel]);

    const handleAlertDragStart = useCallback((event, alert) => {
        if (event.button !== 0 || !event.ctrlKey) return;
        if (!candleSeriesRef.current) return;

        const price = parseFloat(alert.price);
        if (!Number.isFinite(price)) return;

        event.preventDefault();
        event.stopPropagation();

        alertDragStateRef.current = { active: true, alert };
        const y = candleSeriesRef.current.priceToCoordinate(price);
        const priceFormatted = precisionTruncate(price, priceDecimals).toFixed(priceDecimals);
        setAlertDragPreview({ id: alert.id, y, price, priceFormatted });
    }, [priceDecimals]);

    const handleMouseMove = useCallback((event) => {
        // Handle drawing object drag
        if (isDragging) {
            const point = getMousePoint(event);
            if (point) {
                updateDrag(point);
            }
            return;
        }

        // Handle Order Dragging
        if (draggingStateRef.current.active) {
            const point = getMousePoint(event);
            if (!point) return;

            const newY = point.y;
            const newPrice = point.price;

            // Calculate new values based on strategy
            // BUY: Constant Notional (spend same amount)
            // SELL: Constant Quantity (sell same amount)
            const side = draggingStateRef.current.side;
            const totalNotional = draggingStateRef.current.totalNotional;
            const startQuantity = draggingStateRef.current.startQuantity;

            let displayQty = 0;

            if (side === 'BUY') {
                // Keep Notional Constant
                if (newPrice > 0) {
                    displayQty = totalNotional / newPrice;
                }
            } else {
                // Keep Quantity Constant (SELL)
                displayQty = startQuantity;
            }

            // Format label for ghost
            const market = panel?.market;
            const marketValueDecimals = market === 'USDT' ? 0 : 6;
            const targetPrecision = enabledMarketBalance ? marketValueDecimals : precision?.quantity ?? 3;

            // What value to display? 
            // If enabledMarketBalance, we usually show Total Value.
            // If disabled, we show Quantity.
            const valueToDisplay = enabledMarketBalance
                ? (side === 'BUY' ? totalNotional : displayQty * newPrice)
                : displayQty;

            const truncated = precisionTruncate(valueToDisplay, targetPrecision);
            let labelText = '';
            if (enabledMarketBalance && market === 'USDT') {
                labelText = Math.floor(truncated).toString();
            } else {
                labelText = truncated.toFixed(targetPrecision);
            }

            setDraggingGhost(prev => ({
                ...prev,
                y: newY,
                label: labelText
            }));

            draggingStateRef.current.currentY = newY;
            return;
        }

        if (alertDragStateRef.current.active) {
            const point = getMousePoint(event);
            if (!point || !candleSeriesRef.current) return;

            const price = point.price;
            const y = candleSeriesRef.current.priceToCoordinate(price);
            if (y === null || y === undefined) return;

            const priceFormatted = precisionTruncate(price, priceDecimals).toFixed(priceDecimals);
            setAlertDragPreview({
                id: alertDragStateRef.current.alert.id,
                y,
                price,
                priceFormatted,
            });
            return;
        }

        // Handle active drawing preview (trend line, rectangle, fibonacci)
        if (activeDrawing && (activeTool === DRAWING_TOOLS.TREND_LINE || activeTool === DRAWING_TOOLS.RECTANGLE || activeTool === DRAWING_TOOLS.FIBONACCI)) {
            const point = getMousePoint(event);
            if (point) {
                updateActiveDrawing(point);
            }
            return;
        }

        // Handle Measurement
        if (!measurementStateRef.current.active) return;
        const point = getMousePoint(event);
        if (!point) return;
        setMeasurement(prev => (prev ? { ...prev, current: point } : prev));
    }, [getMousePoint, enabledMarketBalance, panel?.market, precision, activeDrawing, activeTool, updateActiveDrawing, isDragging, updateDrag, priceDecimals]);

    const handleMouseUp = useCallback((event) => {
        // Handle drawing drag end
        if (isDragging) {
            endDrag();
            return;
        }

        // Handle order dragging
        if (draggingStateRef.current.active) {
            const point = getMousePoint(event);
            if (point && onOrderPlace && draggingStateRef.current.order) {
                const newPrice = point.price;
                const originalOrder = draggingStateRef.current.order;
                const totalNotional = draggingStateRef.current.totalNotional;

                const pricePrecision = precision?.price ?? DEFAULT_PRECISION.price;
                const formattedPrice = precisionTruncate(newPrice, pricePrecision).toFixed(pricePrecision);

                // Recalculate Quantity based on strategy
                const numericPrice = parseFloat(formattedPrice);
                let newQty = 0;

                if (draggingStateRef.current.side === 'BUY') {
                    // BUY: Constant Notional
                    if (numericPrice > 0) {
                        newQty = totalNotional / numericPrice;
                    }
                } else {
                    // SELL: Constant Quantity
                    newQty = draggingStateRef.current.startQuantity;
                }

                // Format quantity to precision
                const quantityPrecision = precision?.quantity ?? DEFAULT_PRECISION.quantity;
                const formattedQty = precisionTruncate(newQty, quantityPrecision).toFixed(quantityPrecision);

                // Place new order
                onOrderPlace({
                    symbol: originalOrder.symbol,
                    side: originalOrder.side,
                    quantity: formattedQty,
                    price: formattedPrice,
                    type: originalOrder.type,
                });
            }
            draggingStateRef.current = { active: false, order: null, totalNotional: 0, currentY: null };
            setDraggingGhost(null);
            return;
        }

        if (alertDragStateRef.current.active) {
            const point = getMousePoint(event);
            const newPrice =
                point && Number.isFinite(point.price)
                    ? point.price
                    : parseFloat(alertDragStateRef.current.alert?.price);

            if (updateAlertPrice && Number.isFinite(newPrice)) {
                updateAlertPrice(alertDragStateRef.current.alert.id, newPrice);
            }

            alertDragStateRef.current = { active: false, alert: null };
            setAlertDragPreview(null);
            return;
        }

        // Trend lines now use click-click, not click-drag, so no mouseUp handling needed
    }, [getMousePoint, onOrderPlace, precision, isDragging, endDrag, updateAlertPrice]);

    const handleMeasurementMouseLeave = useCallback(() => {
        if (!measurementStateRef.current.active) return;
        setMeasurement(prev => prev);
        if (alertDragStateRef.current.active) {
            alertDragStateRef.current = { active: false, alert: null };
            setAlertDragPreview(null);
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            // Check if we're in an input field
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            if (event.key === 'Escape') {
                cancelMeasurement();
                cancelDrawing();
                deselectAll();
            }

            // Delete selected drawing with Delete or Backspace key
            if (event.key === 'Delete' || event.key === 'Backspace') {
                if (selectedDrawingId) {
                    event.preventDefault();
                    deleteSelectedDrawing();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [cancelMeasurement, cancelDrawing, deselectAll, selectedDrawingId, deleteSelectedDrawing]);

    useEffect(() => {
        let rafId;
        if (!measurement || !measurement.start || !measurement.current) {
            rafId = requestAnimationFrame(() => setMeasurementProjection(null));
            return () => {
                if (rafId) cancelAnimationFrame(rafId);
            };
        }

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

        const updateProjection = () => {
            if (isDisposedRef.current || !candleSeriesRef.current || !chartRef.current || !containerSize.width || !containerSize.height) {
                setMeasurementProjection(null);
            } else {
                const startY = candleSeriesRef.current.priceToCoordinate(measurement.start.price);
                const currentY = candleSeriesRef.current.priceToCoordinate(measurement.current.price);
                if (startY === null || startY === undefined || currentY === null || currentY === undefined) {
                    setMeasurementProjection(null);
                } else {
                    const timeScale = chartRef.current.timeScale();

                    // Calculate start X position
                    const axisSourceX = measurement.start.time !== null && measurement.start.time !== undefined
                        ? timeScale.timeToCoordinate(measurement.start.time)
                        : null;
                    const startX = clamp(
                        axisSourceX ?? measurement.start.x,
                        0,
                        containerSize.width
                    );

                    // Calculate current X position for horizontal measurement
                    const currentSourceX = measurement.current.time !== null && measurement.current.time !== undefined
                        ? timeScale.timeToCoordinate(measurement.current.time)
                        : null;
                    const currentX = clamp(
                        currentSourceX ?? measurement.current.x,
                        0,
                        containerSize.width
                    );

                    // Calculate time delta (in seconds)
                    let deltaTime = 0;
                    if (measurement.start.time !== null && measurement.current.time !== null) {
                        deltaTime = measurement.current.time - measurement.start.time;
                    } else if (measurement.start.logical !== null && measurement.current.logical !== null && data && data.length > 1) {
                        // Estimate time from logical positions and candle interval
                        const candleInterval = data[1].time - data[0].time;
                        const deltaLogical = measurement.current.logical - measurement.start.logical;
                        deltaTime = deltaLogical * candleInterval;
                    }

                    const deltaPrice = measurement.current.price - measurement.start.price;
                    const deltaPercent = measurement.start.price
                        ? (deltaPrice / measurement.start.price) * 100
                        : 0;
                    const nextProjection = {
                        startX,
                        currentX,
                        startY,
                        currentY,
                        deltaPrice,
                        deltaPercent,
                        deltaTime,
                    };
                    setMeasurementProjection((prev) => {
                        if (
                            prev &&
                            prev.startX === nextProjection.startX &&
                            prev.currentX === nextProjection.currentX &&
                            prev.startY === nextProjection.startY &&
                            prev.currentY === nextProjection.currentY &&
                            prev.deltaPrice === nextProjection.deltaPrice &&
                            prev.deltaPercent === nextProjection.deltaPercent &&
                            prev.deltaTime === nextProjection.deltaTime
                        ) {
                            return prev;
                        }
                        return nextProjection;
                    });
                }
            }
            rafId = requestAnimationFrame(updateProjection);
        };

        updateProjection();
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [measurement, containerSize.width, containerSize.height, data]);

    const chartCursor = useMemo(() => {
        if (activeTool === DRAWING_TOOLS.HORIZONTAL_LINE) return 'crosshair';
        if (activeTool === DRAWING_TOOLS.TREND_LINE) return 'crosshair';
        if (activeTool === DRAWING_TOOLS.RECTANGLE) return 'crosshair';
        if (activeTool === DRAWING_TOOLS.FIBONACCI) return 'crosshair';
        if (activeTool === DRAWING_TOOLS.TEXT) return 'text';
        return 'default';
    }, [activeTool]);

    // Handle text input submission
    const handleTextSubmit = useCallback((text) => {
        if (textInputState && text && text.trim()) {
            addTextAnnotation(textInputState.point, text);
        }
        setTextInputState(null);
    }, [textInputState, addTextAnnotation]);

    const handleTextCancel = useCallback(() => {
        setTextInputState(null);
    }, []);

    return (
        <div
            ref={outerContainerRef}
            className="chart-with-rsi-container"
            style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}
        >
            {/* Main Chart Area */}
            <div
                ref={chartContainerRef}
                style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0, cursor: chartCursor, overflow: 'hidden' }}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMeasurementMouseLeave}
                onMouseUp={handleMouseUp}
            >
                <MeasurementOverlay
                    projection={measurementProjection}
                    containerSize={containerSize}
                    precision={{ price: priceDecimals, quantity: precision?.quantity ?? 3 }}
                />
                <div className="chart-overlay-container">
                    {/* Symbol + Volume + Interval overlay (TradingView style) */}
                    <div className="chart-symbol-overlay">
                        <span className="chart-symbol-name">{panel?.selected || ''}</span>
                        {(() => {
                            const tickerData = Array.isArray(ticker) ? ticker.find(t => t.symbol === panel?.selected) : null;
                            const volume = tickerData ? parseFloat(tickerData.quoteVolume) : 0;
                            return volume > 0 ? (
                                <span className="chart-symbol-volume"> • {formatVolumeShort(volume)}</span>
                            ) : null;
                        })()}
                        <span className="chart-symbol-interval"> • {panel?.interval || ''}</span>
                    </div>
                    {/* Completed order markers (historical) */}
                    {visibleCompletedOrders.map(order => (
                        <CompletedOrderOverlay
                            key={order.id}
                            order={order}
                            showOrderHistory={showOrderHistory}
                        />
                    ))}
                    {/* Alert lines */}
                    {visibleAlerts.map(alert => (
                        <AlertOverlay
                            key={alert.id}
                            alert={alert}
                            y={alert.y}
                            priceFormatted={alert.priceFormatted}
                            onDelete={deleteAlert}
                            onDragStart={handleAlertDragStart}
                        />
                    ))}
                    {alertDragPreview && (
                        <AlertOverlay
                            key={`drag-${alertDragPreview.id}`}
                            alert={alertDragPreview}
                            y={alertDragPreview.y}
                            priceFormatted={alertDragPreview.priceFormatted}
                        />
                    )}
                    {/* Active order lines */}
                    {visibleOrders.map(order => (
                        <OrderOverlay
                            key={order.orderId}
                            order={order}
                            y={order.y}
                            label={order.label}
                            color={order.color}
                            onMouseDown={handleOrderDragStart}
                            onCancel={onOrderCancel}
                            onEdit={onOrderEdit}
                        />
                    ))}
                    {draggingGhost && (
                        <GhostOrderOverlay
                            y={draggingGhost.y}
                            label={draggingGhost.label}
                            color={draggingGhost.color}
                        />
                    )}
                    {/* Text input for text annotation tool */}
                    {textInputState && (
                        <div
                            className="chart-text-input-container"
                            style={{ left: textInputState.x, top: textInputState.y }}
                        >
                            <input
                                type="text"
                                className="chart-text-input"
                                autoFocus
                                placeholder="Enter text..."
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleTextSubmit(e.target.value);
                                    } else if (e.key === 'Escape') {
                                        handleTextCancel();
                                    }
                                }}
                                onBlur={(e) => {
                                    if (e.target.value.trim()) {
                                        handleTextSubmit(e.target.value);
                                    } else {
                                        handleTextCancel();
                                    }
                                }}
                            />
                        </div>
                    )}
                    {/* Custom crosshair time label - shows time on time axis even outside candle area */}
                    {crosshairTimeLabel && (
                        <div
                            className="chart-crosshair-time-label"
                            style={{
                                left: crosshairTimeLabel.x,
                                bottom: 4,
                            }}
                        >
                            {crosshairTimeLabel.label}
                        </div>
                    )}
                    {/* Chart-specific loading overlay */}
                    {isChartLoading && (
                        <div className="chart-loading-overlay" style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(19, 23, 34, 0.6)',
                            zIndex: 20,
                            pointerEvents: 'none'
                        }}>
                            <div className="spinner" style={{
                                width: '40px',
                                height: '40px',
                                border: '3px solid rgba(255, 255, 255, 0.1)',
                                borderTopColor: '#2962ff',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }}></div>
                            <style>{`
                                @keyframes spin {
                                    to { transform: rotate(360deg); }
                                }
                            `}</style>
                        </div>
                    )}
                </div>
            </div>

            {/* RSI Indicator Pane */}
            <RSIPane
                data={data}
                parentChart={chartInstance}
                containerHeight={outerContainerHeight}
                heightPercent={rsiHeightPercent}
                onHeightChange={setRsiHeightPercent}
                minHeightPercent={RSI_CONFIG.minHeightPercent}
                maxHeightPercent={RSI_CONFIG.maxHeightPercent}
            />
        </div>
    );
}
