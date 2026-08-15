import { useEffect, useRef, useCallback, useState, memo, useMemo } from 'react';
import './MiniChart.css';
import { createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';
import { MeasurementOverlay } from '../../common/MeasurementOverlay';
import { buildTimeScaleFormatters } from '../../../utils/chart-utils';
import { formatVolumeShort } from '../../../utils/operations';
import { buildVolumeHistogramPresentation } from '../../../utils/chartVolume';
import RSIPane from './RSIPane';
import { RSI_CONFIG } from './chart-plugins/RSIIndicator';

// Simple SMA calculation for mini charts
const calculateSMA = (data, period) => {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        result.push({
            time: data[i].time,
            value: sum / period
        });
    }
    return result;
};



// Compute required decimal places from candle data
const computePriceDecimals = (data) => {
    if (!Array.isArray(data) || data.length === 0) return 2;
    let maxDecimals = 2;
    for (let i = Math.max(0, data.length - 20); i < data.length; i++) {
        const candle = data[i];
        if (!candle) continue;
        for (const field of ['open', 'high', 'low', 'close']) {
            const value = candle[field];
            if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
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
    return Math.min(10, maxDecimals);
};



const MiniChart = memo(({
    symbol,
    interval,
    data = [],
    volume,
    isSelected = false,
    isLoading = false,
    onClick,
    onIntervalChange,
    onAltClick, // ALT+Click to open depth view
    onDragStart, // CTRL+Click to start drag
    isDragging = false, // Whether this chart is being dragged
    isDropTarget = false, // Whether this chart is a drop target
    justSwapped = false // Whether this chart was just swapped (for animation)
}) => {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const volumeSeriesRef = useRef(null);
    const smaSeriesRef = useRef(null);
    const hasInitializedRef = useRef(false);  // Track if we've done initial fitContent
    const lastDataLengthRef = useRef(0);  // Track data length for detecting full data loads
    const isDisposedRef = useRef(false);  // Prevent async operations after chart disposal

    // Measurement state
    const measurementStateRef = useRef({ active: false, start: null });
    const [measurement, setMeasurement] = useState(null);
    const [measurementProjection, setMeasurementProjection] = useState(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [crosshairTimeLabel, setCrosshairTimeLabel] = useState(null);

    // RSI Pane state - shared across all mini charts for consistency
    const [rsiHeightPercent, setRsiHeightPercent] = useState(() => {
        const stored = localStorage.getItem('miniChartRsiHeight');
        return stored ? parseFloat(stored) : 15; // Default 15% for compact mini charts
    });
    const [miniChartOuterHeight, setMiniChartOuterHeight] = useState(0);
    const miniChartOuterRef = useRef(null);
    // State to hold chart instance for RSI sync (avoids ref access during render)
    const [chartInstanceForRsi, setChartInstanceForRsi] = useState(null);

    // Persist RSI height (shared across all mini charts)
    useEffect(() => {
        localStorage.setItem('miniChartRsiHeight', rsiHeightPercent.toString());
    }, [rsiHeightPercent]);

    // Track outer container height for RSI sizing
    useEffect(() => {
        if (!miniChartOuterRef.current) return;
        
        const updateOuterHeight = () => {
            if (miniChartOuterRef.current) {
                setMiniChartOuterHeight(miniChartOuterRef.current.clientHeight);
            }
        };
        
        updateOuterHeight();
        
        const resizeObserver = new ResizeObserver(updateOuterHeight);
        resizeObserver.observe(miniChartOuterRef.current);
        
        return () => resizeObserver.disconnect();
    }, []);



    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0a0a0a' },
                textColor: '#666',
                fontSize: 10,
            },
            grid: {
                vertLines: { color: '#1a1a1a' },
                horzLines: { color: '#1a1a1a' },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            rightPriceScale: {
                borderColor: '#222',
                scaleMargins: { top: 0.1, bottom: 0.2 }, // Adjusted for volume
            },
            timeScale: {
                borderColor: '#222',
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: '#444', width: 1, style: 2, labelVisible: false }, // Hide native time label
                horzLine: { color: '#444', width: 1, style: 2, labelVisible: true },
            },
            handleScale: {
                mouseWheel: true,
                pinch: true,
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
            },
        });

        chartRef.current = chart;
        setChartInstanceForRsi(chart);

        // Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '', // Overlay on same scale
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
            priceLineVisible: false,
            lastValueVisible: false,
        });
        volumeSeriesRef.current = volumeSeries;

        // Candlestick series
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderUpColor: '#26a69a',
            borderDownColor: '#ef5350',
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });
        candleSeriesRef.current = candleSeries;

        // SMA line
        const smaSeries = chart.addSeries(LineSeries, {
            color: 'rgba(33, 150, 243, 0.5)',
            lineWidth: 1,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        smaSeriesRef.current = smaSeries;

        // Reset disposed flag on mount
        isDisposedRef.current = false;

        // We will move the listener attachment to a separate useEffect that depends on 'timeFormatting'

        // Resize observer
        const resizeObserver = new ResizeObserver(entries => {
            if (isDisposedRef.current || entries.length === 0 || !chartRef.current) return;
            const { width, height } = entries[0].contentRect;
            chartRef.current.applyOptions({ width, height });
            setContainerSize({ width, height });
        });
        resizeObserver.observe(chartContainerRef.current);

        // Initial container size
        setContainerSize({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight
        });

        return () => {
            // Set disposed flag BEFORE any cleanup
            isDisposedRef.current = true;
            setChartInstanceForRsi(null);
            resizeObserver.disconnect();

            requestAnimationFrame(() => {
                try {
                    chart.remove();
                } catch {
                    // Silently ignore disposal errors
                }
            });
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            smaSeriesRef.current = null;
        };
    }, []);

    // Compute dynamic precision from data
    const priceDecimals = useMemo(() => computePriceDecimals(data), [data]);
    const minMove = useMemo(() => Math.pow(10, -priceDecimals), [priceDecimals]);

    // Update data
    useEffect(() => {
        if (!candleSeriesRef.current || !volumeSeriesRef.current || !smaSeriesRef.current) return;
        if (!data || data.length === 0) return;

        // Apply price format to candle series
        candleSeriesRef.current.applyOptions({
            priceFormat: {
                type: 'price',
                precision: priceDecimals,
                minMove: minMove,
            }
        });

        candleSeriesRef.current.setData(data);

        const volumePresentation = buildVolumeHistogramPresentation(data, {
            // Use semi-transparent colors to avoid blocking candles
            upColor: 'rgba(38, 166, 154, 0.3)',
            downColor: 'rgba(239, 83, 80, 0.3)',
        });
        volumeSeriesRef.current.applyOptions({
            priceFormat: volumePresentation.priceFormat,
        });
        volumeSeriesRef.current.setData(volumePresentation.data);

        // Calculate and set SMA
        const smaData = calculateSMA(data, 20);
        smaSeriesRef.current.setData(smaData);

        // Only fit content on initial data load or when data significantly changes
        const isInitialLoad = !hasInitializedRef.current;
        const isFullDataLoad = data.length > 10 && Math.abs(data.length - lastDataLengthRef.current) > 10;

        if (chartRef.current && (isInitialLoad || isFullDataLoad)) {
            chartRef.current.timeScale().fitContent();
            hasInitializedRef.current = true;
        }

        lastDataLengthRef.current = data.length;
    }, [data, priceDecimals, minMove]);

    // Reset initialization flag when symbol or interval changes
    useEffect(() => {
        hasInitializedRef.current = false;
        lastDataLengthRef.current = 0;
    }, [symbol, interval]);

    // Apply time formatting options
    useEffect(() => {
        if (!chartRef.current || !interval) return;

        const timeFormatting = buildTimeScaleFormatters(interval);

        chartRef.current.applyOptions({
            timeScale: {
                timeVisible: timeFormatting.timeVisible,
                secondsVisible: timeFormatting.secondsVisible,
                tickMarkFormatter: timeFormatting.tickFormatter,
            },
            localization: {
                timeFormatter: timeFormatting.tooltipFormatter,
            },
        });
    }, [interval]);

    // Track mouse position for custom crosshair time label
    useEffect(() => {
        if (!chartContainerRef.current) return;

        let rafId;
        // We use a ref for formatters to avoid re-binding the event listener on every interval change
        // but we need to update the ref when interval changes.
        // Or we can just re-bind. Re-binding is safer for correctness.
        const formatters = buildTimeScaleFormatters(interval);

        const handleMouseMoveForTime = (event) => {
            if (isDisposedRef.current || !chartRef.current || !chartContainerRef.current) return;

            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (isDisposedRef.current || !chartRef.current || !chartContainerRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;

                const rect = chartContainerRef.current.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const chart = chartRef.current;
                const timeScale = chart.timeScale();
                const priceScaleWidth = chart.priceScale('right').width();
                const chartWidth = rect.width - priceScaleWidth;

                // Check if mouse is within the chart's X range
                if (x < 0 || x > chartWidth) {
                    setCrosshairTimeLabel(null);
                    return;
                }

                // Get time at current X position
                const time = timeScale.coordinateToTime(x);
                if (time !== null && time !== undefined) {
                    const formattedTime = formatters.tooltipFormatter(time);
                    setCrosshairTimeLabel({ x, time, label: formattedTime });
                    return;
                }

                // No exact time - use logical position to extrapolate
                const logical = timeScale.coordinateToLogical(x);
                // We can use candleSeries data or just the `data` prop. 
                // Accessing `data` prop inside effect dependency is fine.
                if (logical === null || logical === undefined || !data || data.length < 2) {
                    setCrosshairTimeLabel(null);
                    return;
                }

                const candleInterval = data[1].time - data[0].time;
                const lastCandleTime = data[data.length - 1].time;
                const lastCandleLogical = data.length - 1;

                const deltaLogical = logical - lastCandleLogical;
                const estimatedTime = lastCandleTime + Math.round(deltaLogical * candleInterval);

                const formattedTime = formatters.tooltipFormatter(estimatedTime);
                setCrosshairTimeLabel({ x, time: estimatedTime, label: formattedTime });
            });
        };

        const handleMouseLeave = () => {
            if (rafId) cancelAnimationFrame(rafId);
            setCrosshairTimeLabel(null);
        };

        const container = chartContainerRef.current;
        container.addEventListener('mousemove', handleMouseMoveForTime);
        container.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            if (container) {
                container.removeEventListener('mousemove', handleMouseMoveForTime);
                container.removeEventListener('mouseleave', handleMouseLeave);
            }
        };
    }, [interval, data]);

    // Get mouse point with price from chart
    const getMousePoint = useCallback((event) => {
        if (!chartRef.current || !candleSeriesRef.current || !chartContainerRef.current) return null;
        const rect = chartContainerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Check bounds
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

        const price = candleSeriesRef.current.coordinateToPrice(y);
        if (price === undefined || price === null) return null;

        // Also get time information for measurement
        const timeScale = chartRef.current.timeScale();
        const time = timeScale.coordinateToTime(x);
        const logical = timeScale.coordinateToLogical(x);

        return { x, y, price, time, logical };
    }, []);

    // Measurement Projection Logic (similar to ChartWrapper)
    useEffect(() => {
        let rafId;
        if (!measurement || !measurement.start || !measurement.current) {
            rafId = requestAnimationFrame(() => setMeasurementProjection(null));
            return () => {
                if (rafId) cancelAnimationFrame(rafId);
            };
        }

        const updateProjection = () => {
            if (isDisposedRef.current || !candleSeriesRef.current || !chartRef.current || !containerSize.width) {
                setMeasurementProjection(null);
            } else {
                const startY = candleSeriesRef.current.priceToCoordinate(measurement.start.price);
                const currentY = candleSeriesRef.current.priceToCoordinate(measurement.current.price);

                if (startY === null || currentY === null) {
                    setMeasurementProjection(null);
                } else {
                    const timeScale = chartRef.current.timeScale();
                    const axisSourceX = measurement.start.time !== null ? timeScale.timeToCoordinate(measurement.start.time) : null;
                    const startX = axisSourceX ?? measurement.start.x;

                    const currentSourceX = measurement.current.time !== null ? timeScale.timeToCoordinate(measurement.current.time) : null;
                    const currentX = currentSourceX ?? measurement.current.x;

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

                    setMeasurementProjection({
                        startX,
                        currentX,
                        startY,
                        currentY,
                        deltaPrice,
                        deltaPercent,
                        deltaTime
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

    // Cancel measurement
    const cancelMeasurement = useCallback(() => {
        if (!measurementStateRef.current.active) return;
        measurementStateRef.current = { active: false, start: null };
        setMeasurement(null);
    }, []);

    // Handle mouse down - Shift+Click starts measurement
    const handleMouseDown = useCallback((event) => {
        // Shift+Click to start measurement
        if (event.shiftKey && !measurementStateRef.current.active) {
            const point = getMousePoint(event);
            if (!point) return;
            event.preventDefault();
            event.stopPropagation();
            measurementStateRef.current = { active: true, start: point };
            setMeasurement({ start: point, current: point });
            return;
        }

        // Click to cancel measurement if active
        if (measurementStateRef.current.active) {
            event.preventDefault();
            event.stopPropagation();
            cancelMeasurement();
            return;
        }
    }, [getMousePoint, cancelMeasurement]);

    // Handle mouse move - update measurement
    const handleMouseMove = useCallback((event) => {
        if (!measurementStateRef.current.active) return;
        const point = getMousePoint(event);
        if (!point) return;
        setMeasurement(prev => (prev ? { ...prev, current: point } : prev));
    }, [getMousePoint]);

    // Handle context menu - cancel measurement
    const handleContextMenu = useCallback((event) => {
        if (measurementStateRef.current.active) {
            event.preventDefault();
            cancelMeasurement();
            return;
        }
    }, [cancelMeasurement]);

    // Handle click - ALT+Click opens depth view
    const handleClick = useCallback((event) => {
        // If measurement is active, don't propagate click
        if (measurementStateRef.current.active) {
            return;
        }

        // CTRL+Click is handled by mousedown for drag, ignore here
        if (event.ctrlKey) {
            return;
        }

        if (event.altKey && onAltClick) {
            event.preventDefault();
            onAltClick(symbol, interval);
            return;
        }
        if (onClick) {
            onClick(symbol, interval);
        }
    }, [onClick, onAltClick, symbol, interval]);

    // Handle CTRL+mousedown for drag initiation (on the container, not just chart area)
    const handleContainerMouseDown = useCallback((event) => {
        // CTRL+Click starts drag
        if (event.ctrlKey && onDragStart) {
            onDragStart(event);
            return;
        }
    }, [onDragStart]);

    // Handle keydown for Escape to cancel measurement
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && measurementStateRef.current.active) {
                cancelMeasurement();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [cancelMeasurement]);

    // Quick interval buttons - base options
    const baseIntervalOptions = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
    // Show current interval as extra button if not in base list
    const showSelectedInterval = interval && !baseIntervalOptions.includes(interval);

    // Build class names for drag states
    const chartClasses = useMemo(() => {
        const classes = ['mini-chart'];
        if (isSelected) classes.push('selected');
        if (isDragging) classes.push('dragging');
        if (isDropTarget) classes.push('drop-target');
        if (justSwapped) classes.push('just-swapped');
        return classes.join(' ');
    }, [isSelected, isDragging, isDropTarget, justSwapped]);

    return (
        <div
            className={chartClasses}
            onClick={handleClick}
            onMouseDown={handleContainerMouseDown}
        >
            <div className="mini-chart-header">
                <div className="mini-chart-intervals">
                    {baseIntervalOptions.map(int => (
                        <button
                            key={int}
                            className={`mini-interval-btn ${interval === int ? 'active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onIntervalChange) {
                                    onIntervalChange(symbol, int);
                                }
                            }}
                        >
                            {int}
                        </button>
                    ))}
                    {showSelectedInterval && (
                        <button
                            className="mini-interval-btn active selected-extra"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {interval}
                        </button>
                    )}
                </div>
            </div>
            {/* Outer container for chart + RSI */}
            <div className="mini-chart-with-rsi" ref={miniChartOuterRef}>
                <div
                    className="mini-chart-container"
                    ref={chartContainerRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onContextMenu={handleContextMenu}
                >
                    {isLoading && (
                        <div className="mini-chart-loading">
                            <div className="mini-chart-spinner" />
                        </div>
                    )}

                    <MeasurementOverlay
                        projection={measurementProjection}
                        containerSize={containerSize}
                        precision={{ price: priceDecimals, quantity: 3 }}
                    />

                    <div className="chart-symbol-overlay">
                        <span className="chart-symbol-name">{symbol}</span>
                        {volume > 0 && <span className="chart-symbol-volume"> • {formatVolumeShort(volume)}</span>}
                        <span className="chart-symbol-interval"> • {interval}</span>
                    </div>

                    {/* Custom Time Label for Crosshair (in future/empty space) */}
                    {crosshairTimeLabel && (
                        <div
                            className="mini-chart-crosshair-time-label"
                            style={{
                                left: crosshairTimeLabel.x,
                                bottom: 0,
                            }}
                        >
                            {crosshairTimeLabel.label}
                        </div>
                    )}
                </div>

                {/* RSI Indicator Pane */}
                <RSIPane
                    data={data}
                    parentChart={chartInstanceForRsi}
                    containerHeight={miniChartOuterHeight}
                    heightPercent={rsiHeightPercent}
                    onHeightChange={setRsiHeightPercent}
                    minHeightPercent={RSI_CONFIG.minHeightPercent}
                    maxHeightPercent={RSI_CONFIG.maxHeightPercent}
                    isCompact={true}
                />
            </div>
        </div>
    );
});

MiniChart.displayName = 'MiniChart';

export default MiniChart;
