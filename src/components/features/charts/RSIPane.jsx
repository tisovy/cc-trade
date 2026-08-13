import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import { createChart, ColorType, LineSeries, CrosshairMode } from 'lightweight-charts';
import { advanceRSI, calculateRSISeries, RSI_CONFIG } from './chart-plugins/RSIIndicator';
import { planSpotSeriesDraw } from '../../../utils/spotChartHistory';
import './RSIPane.css';

/**
 * RSIPane - A resizable RSI indicator pane that syncs with a parent chart
 * 
 * Features:
 * - Displays RSI line with overbought/oversold level lines
 * - Syncs time scale with parent chart
 * - Resizable via drag handle (1% to 50% of container)
 * - Double-click on price axis to reset zoom
 * - Zoomable and scrollable (synced with parent)
 */
const RSIPane = memo(({
    data = [],
    period = RSI_CONFIG.defaultPeriod,
    parentChart = null,
    containerHeight = 0,
    heightPercent = RSI_CONFIG.defaultHeightPercent,
    onHeightChange,
    minHeightPercent = RSI_CONFIG.minHeightPercent,
    maxHeightPercent = RSI_CONFIG.maxHeightPercent,
    isCompact = false, // For MiniChart - uses simplified styling
}) => {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);
    const rsiSeriesRef = useRef(null);
    const levelLinesRef = useRef([]);
    const isDisposedRef = useRef(false);
    const resizeObserverRef = useRef(null);
    
    // State for resize dragging
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ y: 0, height: 0 });

    // The bars this line is drawn from, and the state it ends on. Held rather
    // than derived, because the whole point is not to walk the bars again: a
    // print moves the last one and the line answers it with its last point.
    const drawnRef = useRef({ rows: null, period: null, tail: null });

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;
        
        isDisposedRef.current = false;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: isCompact ? '#0a0a0a' : '#0f0f0f' },
                textColor: '#64748b',
                fontSize: isCompact ? 9 : 10,
            },
            grid: {
                vertLines: { color: RSI_CONFIG.colors.gridLine, style: 1 },
                horzLines: { color: RSI_CONFIG.colors.gridLine, style: 1 },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            rightPriceScale: {
                scaleMargins: RSI_CONFIG.priceScale.scaleMargins,
                borderColor: '#1e293b',
                minimumWidth: isCompact ? 35 : 50,
                autoScale: true,
            },
            timeScale: {
                borderColor: '#1e293b',
                visible: false, // Hide time scale - synced with parent
                timeVisible: false,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: '#444', width: 1, style: 2, labelVisible: false },
                horzLine: { color: '#444', width: 1, style: 2, labelVisible: true },
            },
            handleScale: {
                mouseWheel: true,
                pinch: true,
                axisPressedMouseMove: {
                    time: false, // Disable individual time axis dragging
                    price: true,
                },
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
            },
        });

        chartRef.current = chart;

        // Add RSI line series
        const rsiSeries = chart.addSeries(LineSeries, {
            color: RSI_CONFIG.colors.line,
            lineWidth: isCompact ? 1 : 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 3,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat: {
                type: 'price',
                precision: 2,
                minMove: 0.01,
            },
        });
        rsiSeriesRef.current = rsiSeries;
        // This series has drawn nothing yet, whatever the last one drew. React
        // mounts, tears down and mounts again in development, and a record of
        // what was drawn that outlived its series would have the next print
        // written onto an empty line.
        drawnRef.current = { rows: null, period: null, tail: null };

        // Add level lines
        const levels = [
            { price: RSI_CONFIG.levels.overbought, color: RSI_CONFIG.colors.overbought, lineStyle: 2 },
            { price: RSI_CONFIG.levels.middle, color: RSI_CONFIG.colors.middleLine, lineStyle: 2 },
            { price: RSI_CONFIG.levels.oversold, color: RSI_CONFIG.colors.oversold, lineStyle: 2 },
        ];

        levelLinesRef.current = levels.map(level => {
            return rsiSeries.createPriceLine({
                price: level.price,
                color: level.color,
                lineWidth: 1,
                lineStyle: level.lineStyle,
                axisLabelVisible: true,
                title: '',
            });
        });

        // Resize observer
        resizeObserverRef.current = new ResizeObserver(entries => {
            if (isDisposedRef.current || entries.length === 0 || !chartRef.current) return;
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) {
                chart.applyOptions({ width, height });
            }
        });
        resizeObserverRef.current.observe(chartContainerRef.current);

        return () => {
            isDisposedRef.current = true;
            if (resizeObserverRef.current) {
                resizeObserverRef.current.disconnect();
            }
            // Remove price lines before disposing
            levelLinesRef.current.forEach(line => {
                try {
                    rsiSeries.removePriceLine(line);
                } catch { /* ignore */ }
            });
            levelLinesRef.current = [];
            requestAnimationFrame(() => {
                try {
                    chart.remove();
                } catch { /* ignore */ }
            });
        };
    }, [isCompact]);

    // Update RSI data
    useEffect(() => {
        if (!rsiSeriesRef.current) return;
        const drawn = drawnRef.current;
        const plan = drawn.period === period
            ? planSpotSeriesDraw(drawn.rows, data)
            : 'full';
        if (plan === 'none') return;

        if (plan !== 'full') {
            // Wilder's smoothing is recursive from the first bar, so the line's
            // last point is a step from the state behind it rather than a
            // function of the bars in view. Carried, that step is the same
            // arithmetic the whole calculation does — and it is the whole
            // calculation this saves, on every print.
            const advanced = advanceRSI(drawn.tail, data, period, {
                appended: plan === 'append',
            });
            if (advanced) {
                rsiSeriesRef.current.update(advanced.point);
                drawnRef.current = { rows: data, period, tail: advanced.tail };
                return;
            }
            // No tail to step from — the line is short enough that its last
            // point is its first. Falls through and is drawn whole.
        }

        const { points, tail } = calculateRSISeries(data, period);
        if (points.length === 0) return;
        rsiSeriesRef.current.setData(points);
        drawnRef.current = { rows: data, period, tail };
    }, [data, period]);

    // Sync time scale with parent chart
    useEffect(() => {
        if (!parentChart || !chartRef.current || isDisposedRef.current) return;

        const parentTimeScale = parentChart.timeScale();
        const rsiTimeScale = chartRef.current.timeScale();

        // Sync visible range when parent changes
        const handleParentRangeChange = (newRange) => {
            if (isDisposedRef.current || !newRange) return;
            try {
                rsiTimeScale.setVisibleLogicalRange(newRange);
            } catch { /* ignore */ }
        };

        // Subscribe to parent time scale changes
        parentTimeScale.subscribeVisibleLogicalRangeChange(handleParentRangeChange);

        // Initial sync
        const initialRange = parentTimeScale.getVisibleLogicalRange();
        if (initialRange) {
            handleParentRangeChange(initialRange);
        }

        // Also sync from RSI to parent (bidirectional)
        const handleRsiRangeChange = (newRange) => {
            if (isDisposedRef.current || !newRange) return;
            try {
                const parentRange = parentTimeScale.getVisibleLogicalRange();
                // Only update if significantly different to prevent loops
                if (parentRange && (
                    Math.abs(parentRange.from - newRange.from) > 0.5 ||
                    Math.abs(parentRange.to - newRange.to) > 0.5
                )) {
                    parentTimeScale.setVisibleLogicalRange(newRange);
                }
            } catch { /* ignore */ }
        };

        rsiTimeScale.subscribeVisibleLogicalRangeChange(handleRsiRangeChange);

        return () => {
            try {
                parentTimeScale.unsubscribeVisibleLogicalRangeChange(handleParentRangeChange);
                rsiTimeScale.unsubscribeVisibleLogicalRangeChange(handleRsiRangeChange);
            } catch { /* ignore */ }
        };
    }, [parentChart]);

    // Handle double-click on price scale to reset zoom
    const handleDoubleClick = useCallback((event) => {
        if (!chartRef.current || isDisposedRef.current) return;
        
        const rect = chartContainerRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const chartWidth = rect.width;
        const priceScaleWidth = chartRef.current.priceScale('right').width();
        
        // Check if click is on the price scale (right side)
        if (x > chartWidth - priceScaleWidth) {
            // Reset price scale zoom (auto-scale)
            chartRef.current.priceScale('right').applyOptions({
                autoScale: true,
            });
        }
    }, []);

    // Resize handle drag start
    const handleResizeStart = useCallback((event) => {
        if (!containerHeight) return;
        
        event.preventDefault();
        event.stopPropagation();
        
        setIsDragging(true);
        dragStartRef.current = {
            y: event.clientY,
            heightPercent: heightPercent,
        };
    }, [containerHeight, heightPercent]);

    // Resize handle drag move
    const handleResizeMove = useCallback((event) => {
        if (!isDragging || !containerHeight) return;
        
        const deltaY = dragStartRef.current.y - event.clientY;
        const deltaPercent = (deltaY / containerHeight) * 100;
        const newHeightPercent = Math.max(
            minHeightPercent,
            Math.min(maxHeightPercent, dragStartRef.current.heightPercent + deltaPercent)
        );
        
        if (onHeightChange) {
            onHeightChange(newHeightPercent);
        }
    }, [isDragging, containerHeight, onHeightChange, minHeightPercent, maxHeightPercent]);

    // Resize handle drag end
    const handleResizeEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Global mouse event listeners for resize
    useEffect(() => {
        if (!isDragging) return;
        
        const handleMove = (e) => handleResizeMove(e);
        const handleUp = () => handleResizeEnd();
        
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [isDragging, handleResizeMove, handleResizeEnd]);

    const calculatedHeight = (containerHeight * heightPercent) / 100;

    return (
        <div 
            className={`rsi-pane ${isCompact ? 'compact' : ''} ${isDragging ? 'resizing' : ''}`}
            style={{ height: calculatedHeight }}
        >
            {/* Resize handle */}
            <div 
                className="rsi-resize-handle"
                onMouseDown={handleResizeStart}
                title="Drag to resize RSI pane"
            >
                <div className="rsi-resize-handle-line" />
            </div>
            
            {/* RSI label */}
            <div className="rsi-label">
                RSI({period})
            </div>
            
            {/* Chart container */}
            <div 
                className="rsi-chart-container"
                ref={chartContainerRef}
                onDoubleClick={handleDoubleClick}
            />
        </div>
    );
});

RSIPane.displayName = 'RSIPane';

export default RSIPane;
