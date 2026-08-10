import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { parseData, balanceUpdate } from '../utils/utils';
import { DEFAULT_PANEL } from '../constants';
import { calculatePrecision, DEFAULT_PRECISION } from '../utils/precision';
import { readStorage, writeStorage } from '../utils/storage';
import {
  initCache,
  getCachedCandles,
  setCachedCandles,
  getCacheStats,
} from '../utils/cache';
import {
  SPOT_CHART_HISTORY_PAGE_ROWS,
  SPOT_CHART_INTERVAL_MS,
  mergeSpotChartSeries,
  spotChartHistoryEndTime,
  spotChartIntervalSeconds,
} from '../utils/spotChartHistory';
import { incrementTradeCount } from '../utils/pnl';
import {
  CHANNEL_TYPES,
  isChannelMessage,
  isGlobalMessage,
} from '../utils/channels';
import {
  requestAnalyticsCombined,
  requestActivityMetrics,
} from '../utils/analytics';
import { useGatewayContext } from './GatewayContext.jsx';

// One table of interval lengths for the whole Spot chart. Two of them is how a
// gap check ends up comparing one interval's idea of a bar against another's.
const INTERVAL_TO_MS = SPOT_CHART_INTERVAL_MS;

const DEFAULT_TRADE_PAIRS = ['PAXUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT'];
const MIN_TRADE_NOTIONAL_BTC = 0.01;
const DEFAULT_TRADE_NOTIONAL_USDT = 150;
const DEFAULT_ACTIVITY_VOLUME_FILTER = 10000000; // 10M USDT 24h volume
const DEFAULT_ANALYTICS_VOLUME_FILTER = 10000000;

const ANALYTICS_AVAILABLE = true;
const ANALYTICS_POLL_INTERVAL = 45000;
const ANALYTICS_LIMIT = 40;

const STORAGE_KEYS = {
  PANEL: 'panel',
  MARKET_HISTORY: 'market_history',
  ORDER_HISTORY: 'orders_history',
  ENABLED_MARKET_BALANCE: 'enabled_market_balance',
  TRADE_NOTIONAL_FILTER: 'trade_notional_filter',
  ACTIVITY_VOLUME_FILTER: 'activity_volume_filter',
  ANALYTICS_VOLUME_FILTER: 'analytics_volume_filter',
};
const MARKET_HISTORY_LIMIT = 20;
const DEFAULT_PANEL_STATE = { ...DEFAULT_PANEL, selected: 'PAXUSDT', market: 'USDT', interval: '1h' };
const DEFAULT_MARKET_HISTORY = ['ETHUSDT', 'BNBUSDT'];

const normalizeSymbolKey = (symbol) => (symbol || '').toString().toUpperCase();

const buildHistoryCacheFromStorage = (raw, fallbackSymbol) => {
  const normalizedFallback = normalizeSymbolKey(fallbackSymbol ?? DEFAULT_PANEL_STATE.selected);
  const cache = {};

  if (Array.isArray(raw)) {
    cache[normalizedFallback] = raw;
    return cache;
  }

  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([symbol, entries]) => {
      const normalized = normalizeSymbolKey(symbol);
      if (!normalized) return;
      cache[normalized] = Array.isArray(entries) ? entries : [];
    });
  }

  if (!cache[normalizedFallback]) {
    cache[normalizedFallback] = [];
  }

  return cache;
};

const resolveHistorySymbolFromEntries = (entries, fallbackSymbol) => {
  if (Array.isArray(entries) && entries.length) {
    for (const entry of entries) {
      const symbol = entry?.symbol || entry?.s;
      if (symbol) {
        return normalizeSymbolKey(symbol);
      }
    }
  }
  return normalizeSymbolKey(fallbackSymbol ?? DEFAULT_PANEL_STATE.selected);
};

const normalizeCandleTime = (value) => {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
};

const normalizeCandle = (candle) => {
  if (!candle || typeof candle !== 'object') return null;
  const normalizedTime = normalizeCandleTime(candle.time ?? candle.t ?? candle.T);
  if (normalizedTime === null) return null;
  return { ...candle, time: normalizedTime };
};

const sanitizeCandles = (candles = []) => {
  if (!Array.isArray(candles)) return [];
  const normalized = candles
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);

  if (normalized.length <= 1) {
    return normalized;
  }

  return normalized.reduce((acc, candle) => {
    if (!acc.length) {
      acc.push(candle);
      return acc;
    }
    const lastIndex = acc.length - 1;
    if (candle.time > acc[lastIndex].time) {
      acc.push(candle);
    } else {
      acc[lastIndex] = candle;
    }
    return acc;
  }, []);
};

const upsertCandle = (series, candle, { allowAppend = true } = {}) => {
  if (!candle) {
    return { series, appended: false, changed: false };
  }

  const candleTime = Number(candle.time);
  if (!Number.isFinite(candleTime)) {
    return { series, appended: false, changed: false };
  }

  const currentSeries = Array.isArray(series) ? series : [];
  if (!currentSeries.length) {
    if (!allowAppend) {
      return { series: currentSeries, appended: false, changed: false };
    }
    return { series: [candle], appended: true, changed: true };
  }

  const lastIndex = currentSeries.length - 1;
  const lastTime = Number(currentSeries[lastIndex]?.time);

  if (allowAppend && candleTime > lastTime) {
    return { series: [...currentSeries, candle], appended: true, changed: true };
  }

  for (let idx = lastIndex; idx >= 0; idx--) {
    const existingTime = Number(currentSeries[idx]?.time);
    if (existingTime === candleTime) {
      const next = [...currentSeries];
      next[idx] = candle;
      return { series: next, appended: false, changed: true };
    }
    if (existingTime < candleTime) {
      break;
    }
  }

  return { series: currentSeries, appended: false, changed: false };
};

const DataContext = createContext(null);

export const DataProvider = ({
  children,
  spotEnabled = true,
}) => {
  const [throttle, setThrottle] = useState({ state: false, timeout: 500 });

  const {
    addMessageListener,
    notifications,
    sendMessage: sendWsMessage,
    setSpotDetailSubscription,
    startupStatus,
    subscribe: subscribeChannel,
    unsubscribe: unsubscribeChannel,
    wsConnection,
  } = useGatewayContext();

  const initialPanelState = (() => {
    const storedPanel = readStorage(STORAGE_KEYS.PANEL, null);
    const basePanel = { ...DEFAULT_PANEL_STATE };
    if (storedPanel && typeof storedPanel === 'object') {
      return { ...basePanel, ...storedPanel };
    }
    return basePanel;
  })();
  const [panel, setPanel] = useState(initialPanelState);
  const [enabledMarketBalance, setEnabledMarketBalance] = useState(() => {
    return readStorage(STORAGE_KEYS.ENABLED_MARKET_BALANCE, false);
  });
  const [chart, setChart] = useState([]);
  // Mini charts data: Map of "symbol-interval" -> { data: [], lastTick: null }
  const [miniCharts, setMiniCharts] = useState({});
  const [balances, setBalances] = useState({});
  const [orders, setOrders] = useState([]);
  // The last Spot command outcome the exchange or the transport reported.
  // Stays until the operator dismisses it: a refusal that scrolls away
  // unnoticed is the same as no refusal at all.
  const [commandOutcome, setCommandOutcome] = useState(null);
  const dismissCommandOutcome = useCallback(() => setCommandOutcome(null), []);
  const [filters, setFilters] = useState({});
  const [depth, setDepth] = useState({ bids: {}, asks: {} });
  const [trades, setTrades] = useState([]);
  const [tradeNotionalFilter, setTradeNotionalFilter] = useState(() => {
    const stored = readStorage(STORAGE_KEYS.TRADE_NOTIONAL_FILTER, DEFAULT_TRADE_NOTIONAL_USDT);
    const numeric = Number(stored);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_TRADE_NOTIONAL_USDT;
  });
  const [activityVolumeFilter, setActivityVolumeFilter] = useState(() => {
    const stored = readStorage(STORAGE_KEYS.ACTIVITY_VOLUME_FILTER, DEFAULT_ACTIVITY_VOLUME_FILTER);
    const numeric = Number(stored);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_ACTIVITY_VOLUME_FILTER;
  });
  const [analyticsVolumeFilter, setAnalyticsVolumeFilter] = useState(() => {
    const stored = readStorage(STORAGE_KEYS.ANALYTICS_VOLUME_FILTER, DEFAULT_ANALYTICS_VOLUME_FILTER);
    const numeric = Number(stored);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_ANALYTICS_VOLUME_FILTER;
  });
  const historyCacheFromStorage = buildHistoryCacheFromStorage(
    readStorage(STORAGE_KEYS.ORDER_HISTORY, []),
    initialPanelState.selected
  );
  const historyBySymbolRef = useRef(historyCacheFromStorage);
  const [history, setHistory] = useState(() => {
    const key = normalizeSymbolKey(initialPanelState.selected);
    return historyBySymbolRef.current[key] ?? [];
  });
  // Refs mirroring orders/history so the websocket handler reconciles execution
  // reports against the freshest data. Without this, back-to-back fills arriving
  // faster than a React commit reconcile against a stale closure, and an
  // already-removed order can reappear ("hang") on the chart, desyncing from the
  // exchange. The refs are also updated synchronously where execution reports are
  // applied (see handleChannelData), so even same-tick bursts stay consistent.
  const ordersRef = useRef(orders);
  const historyRef = useRef(history);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  useEffect(() => { historyRef.current = history; }, [history]);
  const [analyticsState, setAnalyticsState] = useState(() => ({
    enabled: ANALYTICS_AVAILABLE,
    strength: [],
    endurance: [],
    generatedAt: null,
    lastUpdated: null,
    loading: ANALYTICS_AVAILABLE,
    error: null,
  }));
  const analyticsAbortControllerRef = useRef(null);
  const [activityFeedState, setActivityFeedState] = useState(() => ({
    enabled: ANALYTICS_AVAILABLE,
    intervals: {},
    generatedAt: null,
    lastUpdated: null,
    loading: ANALYTICS_AVAILABLE,
    error: null,
  }));
  const activityAbortControllerRef = useRef(null);

  const updateHistoryCache = useCallback(
    (entries, symbolHint) => {
      if (!Array.isArray(entries)) return;
      const normalizedSymbol = resolveHistorySymbolFromEntries(entries, symbolHint ?? panel.selected);
      historyBySymbolRef.current[normalizedSymbol] = entries;
      writeStorage(STORAGE_KEYS.ORDER_HISTORY, historyBySymbolRef.current);
      if (normalizedSymbol === normalizeSymbolKey(panel.selected)) {
        setHistory(entries);
      }
    },
    [panel.selected]
  );

  // Get all history across all symbols (for P&L calculation)
  const getAllHistory = useCallback(() => {
    const allHistory = [];
    Object.values(historyBySymbolRef.current).forEach(symbolHistory => {
      if (Array.isArray(symbolHistory)) {
        allHistory.push(...symbolHistory);
      }
    });
    return allHistory;
  }, []);

  const refreshAnalytics = useCallback(async () => {
    if (analyticsAbortControllerRef.current) {
      analyticsAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    analyticsAbortControllerRef.current = controller;

    setAnalyticsState(prev => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const snapshot = await requestAnalyticsCombined({
        limit: ANALYTICS_LIMIT,
        signal: controller.signal,
      });

      if (!snapshot) {
        setAnalyticsState(prev => ({
          ...prev,
          enabled: false,
          loading: false,
          error: null,
        }));
        return null;
      }

      const nextState = {
        enabled: true,
        strength: snapshot?.strength?.metrics || [],
        endurance: snapshot?.endurance?.metrics || [],
        generatedAt:
          snapshot?.generatedAt ||
          snapshot?.strength?.generatedAt ||
          snapshot?.endurance?.generatedAt ||
          Date.now(),
        lastUpdated: Date.now(),
        loading: false,
        error: null,
      };

      setAnalyticsState(nextState);
      return nextState;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return null;
      }
      setAnalyticsState(prev => ({
        ...prev,
        enabled: false,
        loading: false,
        error: error?.message || 'Failed to load analytics',
      }));
      return null;
    }
  }, []);
  const refreshActivityMetrics = useCallback(async () => {
    if (activityAbortControllerRef.current) {
      activityAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    activityAbortControllerRef.current = controller;

    setActivityFeedState(prev => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const snapshot = await requestActivityMetrics({
        limit: 40,
        signal: controller.signal,
      });

      if (!snapshot) {
        setActivityFeedState(prev => ({
          ...prev,
          enabled: false,
          loading: false,
          error: null,
        }));
        return null;
      }

      const nextState = {
        enabled: true,
        intervals: snapshot?.intervals || {},
        generatedAt: snapshot?.generatedAt || Date.now(),
        lastUpdated: Date.now(),
        loading: false,
        error: null,
      };

      setActivityFeedState(nextState);
      return nextState;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return null;
      }
      setActivityFeedState(prev => ({
        ...prev,
        enabled: false,
        loading: false,
        error: error?.message || 'Failed to load activity metrics',
      }));
      return null;
    }
  }, []);
  const [ticker, setTicker] = useState([]);
  const tradePairs = DEFAULT_TRADE_PAIRS;
  const [marketHistory, setMarketHistory] = useState(() => {
    const storedMarketHistory = readStorage(STORAGE_KEYS.MARKET_HISTORY, DEFAULT_MARKET_HISTORY);
    return Array.isArray(storedMarketHistory) && storedMarketHistory.length
      ? storedMarketHistory
      : DEFAULT_MARKET_HISTORY;
  });
  const [updateChart, setUpdateChart] = useState(true);
  const [isFinal, setIsFinal] = useState(false);

  // Loading states for user feedback
  const [isLoading, setIsLoading] = useState(spotEnabled);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Connecting...');
  const loadingTimeoutRef = useRef(null);

  // Loading timeout - auto-dismiss after 15 seconds to prevent stuck loading
  useEffect(() => {
    if (!spotEnabled || !startupStatus.ready) {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      return undefined;
    }

    if (isLoading) {
      loadingTimeoutRef.current = setTimeout(() => {
        console.warn('Loading timeout - dismissing loading overlay');
        setIsLoading(false);
        setLoadingMessage('');
        notifications?.notifyWarning('Loading timed out. Data may be incomplete or connection issues detected.');
      }, 15000);
    } else {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [isLoading, notifications, spotEnabled, startupStatus.ready]);

  // Offline/cache mode
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [cacheStats, setCacheStats] = useState({ candles: 0, trades: 0, alerts: 0, exchangeInfo: false });
  const cacheInitialized = useRef(false);

  // Initialize cache on mount
  useEffect(() => {
    if (!spotEnabled || !startupStatus.ready) return undefined;

    if (!cacheInitialized.current) {
      cacheInitialized.current = true;
      initCache().then(() => {
        console.log('Cache initialized');
        getCacheStats().then(setCacheStats);
      }).catch(err => {
        console.error('Cache init failed:', err);
      });
    }

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOffline(false);
      setLoadingMessage('Reconnecting...');
      notifications?.notifySuccess('Connection restored. Reconnecting to live data...');
    };
    const handleOffline = () => {
      setIsOffline(true);
      setLoadingMessage('Offline - using cached data');
      notifications?.notifyWarning('Network offline. Using cached data until connection is restored.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [notifications, spotEnabled, startupStatus.ready]);

  useEffect(() => {
    if (!spotEnabled || !startupStatus.ready) return undefined;

    refreshAnalytics();
    refreshActivityMetrics();
    const intervalId = setInterval(() => {
      refreshAnalytics();
      refreshActivityMetrics();
    }, ANALYTICS_POLL_INTERVAL);

    return () => {
      clearInterval(intervalId);
      if (analyticsAbortControllerRef.current) {
        analyticsAbortControllerRef.current.abort();
        analyticsAbortControllerRef.current = null;
      }
      if (activityAbortControllerRef.current) {
        activityAbortControllerRef.current.abort();
        activityAbortControllerRef.current = null;
      }
    };
  }, [refreshAnalytics, refreshActivityMetrics, spotEnabled, startupStatus.ready]);

  const [detailSubscription, setDetailSubscription] = useState(() => ({
    symbol: panel.selected,
    interval: panel.interval,
    requestId: `init-${Date.now()}`,
    panelState: panel,
  }));

  useEffect(() => {
    if (!spotEnabled || !startupStatus.ready) {
      setSpotDetailSubscription(null);
      return undefined;
    }
    setSpotDetailSubscription(detailSubscription);
    return () => setSpotDetailSubscription(null);
  }, [
    detailSubscription,
    setSpotDetailSubscription,
    spotEnabled,
    startupStatus.ready,
  ]);

  // Channel registry for multi-chart support
  // Maps channelId -> { type, symbol, interval, data }
  const _channelRegistryRef = useRef(new Map());
  const [activeDetailChannelId, setActiveDetailChannelId] = useState(null);

  const [, setChannelHealth] = useState({
    chart: { lastUpdate: null, stalled: false },
    depth: { lastUpdate: null, stalled: false },
    trades: { lastUpdate: null, stalled: false },
    orders: { lastUpdate: null, stalled: false },
    ticker: { lastUpdate: null, stalled: false },
  });

  const chartQueueRef = useRef([]);
  const chartFlushTimerRef = useRef(null);
  const isFinalRef = useRef(isFinal);
  const throttleRef = useRef(throttle);
  const pendingPairRef = useRef(null);
  // Which pair and interval the rows in `chart` belong to. Depth is only ever
  // joined to rows read for the same selection: a page merged in front of the
  // previous pair's tail is how one market's candles end up drawn under
  // another's, and that defect has already been found once on live data.
  const chartSelectionRef = useRef(null);
  // The one history read allowed to be outstanding. The left edge fires
  // continuously while the operator scrolls.
  const chartHistoryRequestRef = useRef(null);
  const chartSeriesRef = useRef([]);
  const [chartHistoryExhausted, setChartHistoryExhausted] = useState(false);

  useEffect(() => {
    chartSeriesRef.current = chart;
  }, [chart]);

  useEffect(() => {
    isFinalRef.current = isFinal;
  }, [isFinal]);

  useEffect(() => {
    throttleRef.current = throttle;
  }, [throttle]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.PANEL, panel);
  }, [panel]);

  useEffect(() => {
    if (!Array.isArray(marketHistory)) return;
    writeStorage(
      STORAGE_KEYS.MARKET_HISTORY,
      marketHistory.slice(0, MARKET_HISTORY_LIMIT)
    );
  }, [marketHistory]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.ENABLED_MARKET_BALANCE, enabledMarketBalance);
  }, [enabledMarketBalance]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.TRADE_NOTIONAL_FILTER, tradeNotionalFilter);
  }, [tradeNotionalFilter]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.ACTIVITY_VOLUME_FILTER, activityVolumeFilter);
  }, [activityVolumeFilter]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.ANALYTICS_VOLUME_FILTER, analyticsVolumeFilter);
  }, [analyticsVolumeFilter]);

  useEffect(() => {
    return () => {
      if (chartFlushTimerRef.current) {
        clearTimeout(chartFlushTimerRef.current);
      }
    };
  }, []);

  const flushChartQueue = useCallback(() => {
    if (chartFlushTimerRef.current) {
      clearTimeout(chartFlushTimerRef.current);
      chartFlushTimerRef.current = null;
    }
    if (!chartQueueRef.current.length) return;
    const queuedCandles = chartQueueRef.current.splice(0);
    queuedCandles.forEach((queuedCandle) => {
      const candle = normalizeCandle(queuedCandle);
      if (!candle) return;
      setChart((prev) => {
        if (!prev.length) return prev;
        const allowAppend = isFinalRef.current;
        const { series: nextChart, appended, changed } = upsertCandle(prev, candle, { allowAppend });
        if (!changed) return prev;
        if (allowAppend) {
          if (appended) {
            isFinalRef.current = false;
            setIsFinal(false);
          }
        } else if (candle.isFinal) {
          isFinalRef.current = true;
          setIsFinal(true);
        }
        return nextChart;
      });
    });
  }, []);

  const scheduleChartQueueFlush = useCallback(() => {
    if (!throttleRef.current.state) {
      flushChartQueue();
      return;
    }
    if (chartFlushTimerRef.current) return;
    chartFlushTimerRef.current = setTimeout(() => {
      chartFlushTimerRef.current = null;
      flushChartQueue();
    }, throttleRef.current.timeout);
  }, [flushChartQueue]);

  useEffect(() => {
    if (!throttle.state) {
      flushChartQueue();
    } else if (chartQueueRef.current.length) {
      scheduleChartQueueFlush();
    }
  }, [throttle.state, throttle.timeout, flushChartQueue, scheduleChartQueueFlush]);

  const applyIncrementalCandle = useCallback((rawCandle) => {
    const candle = normalizeCandle(rawCandle);
    if (!candle) return;
    setChart(prev => {
      if (!prev.length) {
        return prev;
      }
      const allowAppend = isFinalRef.current;
      const { series: nextChart, appended, changed } = upsertCandle(prev, candle, { allowAppend });
      if (!changed) return prev;
      if (allowAppend) {
        if (appended) {
          isFinalRef.current = false;
          setIsFinal(false);
        }
      } else if (candle.isFinal) {
        isFinalRef.current = true;
        setIsFinal(true);
      }
      return nextChart;
    });
  }, []);

  const applyTradeToChart = useCallback(
    (trade) => {
      if (!trade) return;
      setChart((prev) => {
        if (!prev.length) return prev;
        const intervalMs = INTERVAL_TO_MS[detailSubscription.interval];
        if (!intervalMs) return prev;
        const tradePrice = parseFloat(trade.p ?? trade.price ?? trade.lastPrice);
        if (!Number.isFinite(tradePrice)) return prev;
        const tradeTime = trade.T ?? trade.time ?? trade.E ?? Date.now();
        const lastIndex = prev.length - 1;
        const lastCandle = prev[lastIndex];
        if (!lastCandle) return prev;
        const candleStart =
          typeof lastCandle.time === 'number' && lastCandle.time > 1e12
            ? lastCandle.time
            : lastCandle.time * 1000;
        const candleEnd = candleStart + intervalMs;

        if (tradeTime >= candleEnd) {
          const intervalsAhead = Math.floor((tradeTime - candleStart) / intervalMs);
          const newStart = candleStart + intervalsAhead * intervalMs;
          const newCandle = {
            time: Math.floor(newStart / 1000),
            open: tradePrice,
            high: tradePrice,
            low: tradePrice,
            close: tradePrice,
            volume: 0,
            isFinal: false,
          };
          return [...prev, newCandle];
        }

        if (tradeTime < candleStart) {
          return prev;
        }

        const next = [...prev];
        const updated = { ...lastCandle };
        updated.close = tradePrice;
        if (tradePrice > updated.high) {
          updated.high = tradePrice;
        }
        if (tradePrice < updated.low) {
          updated.low = tradePrice;
        }
        next[lastIndex] = updated;
        return next;
      });
    },
    [detailSubscription.interval]
  );

  const tradePassesNotionalFilter = useCallback(
    (trade) => {
      if (!trade) return false;
      const price = parseFloat(trade.p ?? trade.price ?? trade.lastPrice);
      const quantity = parseFloat(trade.q ?? trade.qty ?? trade.quantity);
      if (!Number.isFinite(price) || !Number.isFinite(quantity)) {
        return true;
      }
      const notional = price * quantity;
      const threshold = panel.market === 'BTC' ? MIN_TRADE_NOTIONAL_BTC : tradeNotionalFilter;
      return notional >= threshold;
    },
    [panel.market, tradeNotionalFilter]
  );

  const touchChannel = useCallback((channel) => {
    setChannelHealth((prev) => ({
      ...prev,
      [channel]: { lastUpdate: Date.now(), stalled: false },
    }));
  }, []);



  const handleThrottleSwitch = useCallback((event) => {
    const state = event?.target ? event.target.checked : !throttle.state;
    setThrottle((prev) => ({ ...prev, state }));
  }, [throttle.state]);

  const handleThrottleTimeout = useCallback((event) => {
    const timeout = parseInt(event?.target?.value ?? throttle.timeout, 10);
    if (Number.isNaN(timeout) || timeout === throttle.timeout) return;
    setThrottle((prev) => ({ ...prev, timeout }));
  }, [throttle.timeout]);

  const handleEnabledMarketBalance = useCallback(() => {
    setEnabledMarketBalance((prev) => !prev);
  }, []);

  const handleTradeNotionalFilterChange = useCallback((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setTradeNotionalFilter(numeric);
  }, []);

  const handleActivityVolumeFilterChange = useCallback((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setActivityVolumeFilter(numeric);
  }, []);
  const handleAnalyticsVolumeFilterChange = useCallback((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setAnalyticsVolumeFilter(numeric);
  }, []);

  const handlePanelUpdate = useCallback((newPanel, shouldUpdateChart = false) => {
    if (shouldUpdateChart) {
      const nextSelected = newPanel?.selected ?? panel.selected;
      const nextInterval = newPanel?.interval ?? panel.interval;
      const resolvedPanel = {
        ...newPanel,
        selected: nextSelected,
        interval: nextInterval,
      };
      const symbolChanged = nextSelected !== panel.selected;
      const requestId = `${nextSelected}-${nextInterval}-${Date.now()}`;

      if (symbolChanged) {
        if (nextSelected.indexOf(panel.market) === -1) {
          resolvedPanel.market = panel.market === 'USDT' ? 'BTC' : 'USDT';
        } else if (nextSelected === 'BTCUSDT') {
          resolvedPanel.market = 'USDT';
        }

        setMarketHistory((prevHistory) => {
          if (prevHistory[0] === nextSelected) {
            return prevHistory;
          }
          const nextHistory = [...prevHistory];
          nextHistory.unshift(nextSelected);
          if (nextHistory.length > MARKET_HISTORY_LIMIT) nextHistory.pop();
          return Array.from(new Set(nextHistory));
        });
      }

      // Depth belongs to one pair and one interval. Nothing loaded under the
      // previous selection may survive into this one, and whether the previous
      // selection had reached the start of its history says nothing about this
      // one's.
      chartHistoryRequestRef.current = null;
      chartSelectionRef.current = `${nextSelected}:${nextInterval}`;
      setChartHistoryExhausted(false);

      // Try to load cached data first for instant display
      const loadCachedFirst = async () => {
        const cached = await getCachedCandles(nextSelected, nextInterval);
        if (cached && cached.candles.length > 0) {
          // The stored run is the depth an earlier session already pulled in,
          // not just the last live window: it is presented whole, and the
          // bootstrap that follows merges into it rather than replacing it.
          setChart(cached.candles);
          // If we have cached data, clear loading immediately - data is visible
          // The chart will update seamlessly when fresh data arrives
          setIsLoading(false);
          setIsChartLoading(false);
          setLoadingMessage('');
          return true; // indicate we have cached data
        } else {
          setChart([]);
          if (symbolChanged) {
            setLoadingMessage(`Loading ${nextSelected}...`);
          }
          return false;
        }
      };

      if (symbolChanged) {
        setTrades([]);
        const symbolKey = normalizeSymbolKey(nextSelected);
        const cachedHistory = historyBySymbolRef.current[symbolKey] ?? [];
        historyBySymbolRef.current[symbolKey] = cachedHistory;
        setHistory(cachedHistory);
        setDepth({ bids: {}, asks: {} });
        setIsLoading(true);
        setLoadingMessage(`Loading ${nextSelected}...`);
      } else {
        // Interval change - only show chart loader
        setIsChartLoading(true);
      }

      pendingPairRef.current = `${nextSelected}:${nextInterval}`;

      // Load cache first, then subscribe to live data
      loadCachedFirst().then(() => {
        setDetailSubscription({
          symbol: nextSelected,
          interval: nextInterval,
          requestId,
          panelState: { ...panel, ...resolvedPanel },
        });
        // If no cached data, loading overlay stays until fresh data arrives
      });

      setPanel(prev => ({ ...prev, ...resolvedPanel }));
      setUpdateChart(true);
    } else {
      const nextPanel = { ...panel, ...newPanel };
      setPanel(nextPanel);
      setDetailSubscription(prev => ({
        ...prev,
        panelState: nextPanel
      }));
    }
  }, [panel]);

  /**
   * Ask for the page of closed candles behind the oldest one loaded.
   *
   * Nothing is asked for twice: the page is bounded, one read is outstanding at
   * a time, and once the exchange answers short the pair's history is treated as
   * having a start.
   */
  const loadChartHistory = useCallback(() => {
    if (chartHistoryExhausted) return false;
    if (chartHistoryRequestRef.current !== null) return false;
    const symbol = panel.selected;
    const interval = panel.interval;
    if (chartSelectionRef.current !== `${symbol}:${interval}`) return false;
    const endTime = spotChartHistoryEndTime(chartSeriesRef.current);
    if (endTime === null) return false;

    const request = { symbol, interval, endTime, limit: SPOT_CHART_HISTORY_PAGE_ROWS };
    chartHistoryRequestRef.current = request;
    const sent = sendWsMessage({ action: 'load_chart_history', ...request });
    if (sent === false) chartHistoryRequestRef.current = null;
    return sent !== false;
  }, [chartHistoryExhausted, panel.selected, panel.interval, sendWsMessage]);

  /**
   * Handle global messages (ticker, filters, balances, orders)
   * These are not tied to a specific channel
   */
  const handleGlobalMessage = useCallback((type, payload, extra) => {
    switch (type) {
      case 'ticker':
        setTicker(payload);
        break;
      case 'ticker_update':
        // parseTickerUpdate / the legacy handler use payload = index, extra = update.
        // Match that convention here (was swapped, which silently dropped every tick).
        setTicker(prev => {
          const newTicker = [...prev];
          const index = payload;
          if (typeof index === 'number' && extra) {
            newTicker[index] = { ...newTicker[index], ...extra };
          }
          return newTicker;
        });
        break;
      case 'ticker_batch':
        // payload is an array of { index, entry } — apply all in one render.
        setTicker(prev => {
          const newTicker = [...prev];
          const updates = Array.isArray(payload) ? payload : [];
          for (const u of updates) {
            if (u && typeof u.index === 'number') {
              newTicker[u.index] = { ...newTicker[u.index], ...u.entry };
            }
          }
          return newTicker;
        });
        break;
      case 'filters':
        setFilters(prev => {
          if (!payload || typeof payload !== 'object') return prev;
          return { ...prev, ...payload };
        });
        break;
      case 'balances':
        // Full REST snapshot - replace entirely to remove coins that went to zero
        setBalances(payload);
        break;
      case 'orders':
        setOrders(payload);
        break;
      default:
        break;
    }
  }, []);

  /**
   * Handle channel-specific data updates
   * Routes data to the appropriate state based on message type
   */
  const handleChannelData = useCallback((type, payload, extra) => {
    touchChannel(type === 'chart' ? 'chart' : type);

    switch (type) {
      case 'chart': {
        const fullDataArray = Array.isArray(payload) ? payload : [];
        const sanitizedChartData = sanitizeCandles(fullDataArray);
        const latestCandle = normalizeCandle(extra);

        // Determine if this is a full data load or incremental update
        // Full loads have many candles (e.g., 100+), incremental updates have 1-2
        const isFullDataLoad = sanitizedChartData.length > 10;
        const isIncrementalUpdate = sanitizedChartData.length <= 2 && latestCandle;

        // If we're expecting a full update but received only incremental data, skip it
        // This prevents race conditions when WebSocket stream updates arrive before REST data
        if (updateChart && isIncrementalUpdate) {
          // Queue the candle for when full data arrives
          if (latestCandle) {
            chartQueueRef.current.push(latestCandle);
          }
          break;
        }

        if (chart.length && !updateChart && latestCandle) {
          if (throttle.state) {
            chartQueueRef.current.push(latestCandle);
            scheduleChartQueueFlush();
          } else {
            flushChartQueue();
            applyIncrementalCandle(latestCandle);

            // Sync incremental update to miniCharts
            const miniKey = `${panel.selected}-${panel.interval}`;
            setMiniCharts(prev => {
              const existing = prev[miniKey];
              if (existing?.data?.length) {
                const { series: updatedSeries } = upsertCandle(existing.data, latestCandle);
                return {
                  ...prev,
                  [miniKey]: { data: updatedSeries, lastTick: latestCandle }
                };
              }
              return prev;
            });
          }
        } else if (isFullDataLoad || !updateChart) {
          chartQueueRef.current = [];
          if (chartFlushTimerRef.current) {
            clearTimeout(chartFlushTimerRef.current);
            chartFlushTimerRef.current = null;
          }
          // The bootstrap window is the fresher read, so it wins the overlap —
          // but it is only the last 500 candles, and replacing with it threw
          // away every older candle the operator had scrolled to and everything
          // the local store had preserved across the restart. It is merged in
          // front of that depth instead, and only when the depth was read for
          // this same pair and interval.
          const pair = `${panel.selected}:${panel.interval}`;
          const intervalSeconds = spotChartIntervalSeconds(panel.interval);
          const mergeWithHeldDepth = chartSelectionRef.current === pair;
          chartSelectionRef.current = pair;
          setChart(prev => (mergeWithHeldDepth
            ? mergeSpotChartSeries(prev, sanitizedChartData, { intervalSeconds })
            : sanitizedChartData));
          setUpdateChart(false);
          setIsFinal(false);
          isFinalRef.current = false;
          if (pendingPairRef.current === `${panel.selected}:${panel.interval}`) {
            pendingPairRef.current = null;
          }
          setIsLoading(false);
          setIsChartLoading(false);

          // Cache the chart data
          if (sanitizedChartData.length > 0) {
            const storedSeries = mergeWithHeldDepth
              ? mergeSpotChartSeries(chartSeriesRef.current, sanitizedChartData, { intervalSeconds })
              : sanitizedChartData;
            setCachedCandles(panel.selected, panel.interval, storedSeries)
              .then(() => getCacheStats().then(setCacheStats))
              .catch(err => console.error('Cache write error:', err));

            // Also update miniCharts state for this symbol/interval
            // This ensures that if we switch to MainView, the data is already there
            const miniKey = `${panel.selected}-${panel.interval}`;
            setMiniCharts(prev => ({
              ...prev,
              [miniKey]: {
                data: sanitizedChartData,
                lastTick: sanitizedChartData[sanitizedChartData.length - 1]
              }
            }));
          }
        }
        break;
      }

      // The depth behind the live window. It arrives once per request, is joined
      // under the rows already drawn, and is stored so the next run of the app
      // starts where this one left off rather than reading it again.
      case 'chart_history': {
        const request = chartHistoryRequestRef.current;
        const answer = extra && typeof extra === 'object' ? extra : {};
        // Only the answer to the request being held is applied. A page for a
        // pair, interval or read-point the chart has moved on from is history of
        // something the operator is no longer looking at.
        if (!request
          || answer.symbol !== request.symbol
          || answer.interval !== request.interval
          || answer.endTime !== request.endTime) break;
        chartHistoryRequestRef.current = null;
        if (chartSelectionRef.current !== `${request.symbol}:${request.interval}`) break;

        const rows = sanitizeCandles(Array.isArray(payload) ? payload : []);
        // Fewer candles than were asked for is the exchange saying there is
        // nothing older. Without this the chart would ask for the same short
        // answer on every scroll for the rest of the session.
        if (rows.length < request.limit) setChartHistoryExhausted(true);
        if (rows.length === 0) break;

        const intervalSeconds = spotChartIntervalSeconds(request.interval);
        const merged = mergeSpotChartSeries(rows, chartSeriesRef.current, { intervalSeconds });
        // The series is bounded, and a live tick never touches its front row, so
        // this comparison is exact. A page the chart cannot hold — because it is
        // already full to its ceiling, or because the page did not touch the run
        // it has — must not be asked for again: the same read would otherwise
        // repeat for as long as the operator sits at the left edge.
        const oldestHeld = chartSeriesRef.current[0]?.time;
        if (Number.isFinite(oldestHeld) && !(merged[0]?.time < oldestHeld)) {
          setChartHistoryExhausted(true);
        }
        setChart(prev => mergeSpotChartSeries(rows, prev, { intervalSeconds }));
        setCachedCandles(request.symbol, request.interval, merged)
          .catch(err => console.error('Cache write error:', err));
        break;
      }

      case 'depth':
        setDepth(payload);
        break;

      case 'trades':
        if (Array.isArray(payload)) {
          const filteredTrades = payload.filter(tradePassesNotionalFilter);
          const sortedTrades = filteredTrades.sort((a, b) => b.time - a.time);
          setTrades(sortedTrades);
        } else {
          if (tradePassesNotionalFilter(payload)) {
            setTrades(prev => [payload, ...prev].slice(0, 100));
          }
          applyTradeToChart(payload);
        }
        break;

      case 'orders':
      case 'execution_update':
        // Keep the ref in lockstep so a burst of fills reconciles against the
        // just-updated orders rather than a stale render closure.
        ordersRef.current = payload;
        setOrders(payload);
        if (Array.isArray(extra)) {
          historyRef.current = extra;
          updateHistoryCache(extra, extra[0]?.symbol ?? panel.selected);
          incrementTradeCount();
        }
        break;

      case 'history':
        updateHistoryCache(payload, payload?.[0]?.symbol ?? panel.selected);
        break;

      case 'balances':
        // Full REST snapshot - replace entirely to remove coins that went to zero
        setBalances(payload);
        break;
      case 'balance_update':
        // Incremental update from outboundAccountPosition - merge changed coins
        setBalances(prev => balanceUpdate(payload, prev));
        break;

      case 'filters':
        setFilters(prev => {
          if (!payload || typeof payload !== 'object') return prev;
          return { ...prev, ...payload };
        });
        break;

      default:
        break;
    }
  }, [
    chart.length,
    updateChart,
    throttle.state,
    panel.selected,
    panel.interval,
    applyIncrementalCandle,
    flushChartQueue,
    scheduleChartQueueFlush,
    tradePassesNotionalFilter,
    applyTradeToChart,
    touchChannel,
    updateHistoryCache
  ]);

  const handleSocketUpdate = useCallback((event, _connection) => {
    if (!event || !event.data) return;

    // Try to parse the raw message
    let rawMessage;
    try {
      rawMessage = JSON.parse(event.data);
    } catch {
      return;
    }

    // A refused or unconfirmed Spot command used to reach only the main-process
    // log, so a failed order was invisible at the desk. Futures owns its own
    // presentation, so its outcomes are left alone here.
    const outcome = rawMessage.command_rejected ?? rawMessage.command_unresolved;
    if (outcome) {
      if (outcome.details?.marketType !== 'futures') {
        setCommandOutcome({
          kind: rawMessage.command_unresolved ? 'unresolved' : 'rejected',
          request: outcome.request ?? null,
          code: outcome.code ?? null,
          message: outcome.message ?? 'The trading command failed.',
          binanceCode: outcome.details?.binanceCode ?? null,
          timestamp: outcome.timestamp ?? null,
        });
      }
      return;
    }

    // Check if this is a channel-format message
    if (isChannelMessage(rawMessage)) {
      const { channelId, type, symbol, interval, payload, extra } = rawMessage;

      // Global messages (ticker, filters) - always process
      if (isGlobalMessage(rawMessage) || channelId === 'global') {
        // Handle global messages the same as legacy
        handleGlobalMessage(type, payload, extra);
        return;
      }

      // Channel-specific messages - verify it matches our expected channel
      const isDetailChannel = channelId?.startsWith('detail-');
      const isMiniChannel = channelId?.startsWith('mini-');

      if (isDetailChannel) {
        // Verify symbol/interval match current subscription
        if (symbol !== detailSubscription.symbol || interval !== detailSubscription.interval) {
          // Stale message from old subscription, drop it
          return;
        }
        // Update the active detail channel ID
        if (channelId !== activeDetailChannelId) {
          setActiveDetailChannelId(channelId);
        }
        // Process channel data using the type
        handleChannelData(type, payload, extra, rawMessage);
        return;
      }

      if (isMiniChannel && type === 'chart') {
        // Handle mini chart data
        const miniKey = `${symbol}-${interval}`;
        const fullDataArray = Array.isArray(payload) ? payload : [];
        const sanitizedData = sanitizeCandles(fullDataArray);
        const latestCandle = normalizeCandle(extra);

        setMiniCharts(prev => {
          const existing = prev[miniKey];
          // If we have existing data and this is an incremental update
          if (existing?.data?.length && latestCandle && sanitizedData.length <= 1) {
            const { series: updatedSeries } = upsertCandle(existing.data, latestCandle);
            return {
              ...prev,
              [miniKey]: { data: updatedSeries, lastTick: latestCandle }
            };
          }
          // Full data update
          return {
            ...prev,
            [miniKey]: { data: sanitizedData, lastTick: latestCandle }
          };
        });
        return;
      }

      // Other channel types - process normally
      handleChannelData(type, payload, extra, rawMessage);
      return;
    }

    // Legacy message format - parse using existing logic
    const parsed = parseData(
      event.data,
      ordersRef.current,
      historyRef.current,
      panel
    );

    if (!parsed) return;

    const { type, payload, extra, meta } = parsed;

    const requestSymbol = meta?.symbol || detailSubscription.symbol;
    const requestInterval = meta?.interval || detailSubscription.interval;

    // Filter by symbol (and interval for chart)
    if (type === 'chart') {
      if (requestSymbol !== detailSubscription.symbol || requestInterval !== detailSubscription.interval) {
        return;
      }
    } else if (['trades', 'depth'].includes(type)) {
      if (requestSymbol && requestSymbol !== detailSubscription.symbol) {
        return;
      }
    }

    // Global message types (ticker) - handle specially
    if (type === 'ticker' || type === 'ticker_update' || type === 'ticker_batch') {
      if (type === 'ticker') {
        setTicker(payload);
      } else if (type === 'ticker_batch') {
        // Apply the whole coalesced push in ONE state update (one array copy,
        // one render) instead of one setTicker per symbol — this is the fix for
        // the periodic UI freeze under the miniTicker fan-out.
        setTicker(prev => {
          const newTicker = [...prev];
          for (const u of payload) {
            if (u && typeof u.index === 'number') {
              newTicker[u.index] = { ...newTicker[u.index], ...u.entry };
            }
          }
          return newTicker;
        });
      } else {
        setTicker(prev => {
          const newTicker = [...prev];
          newTicker[payload] = { ...newTicker[payload], ...extra };
          return newTicker;
        });
      }
      touchChannel('ticker');
      return;
    }

    // Use the unified channel data handler for consistency
    handleChannelData(type, payload, extra);
  }, [
    panel,
    detailSubscription,
    handleChannelData,
    touchChannel,
    activeDetailChannelId,
    handleGlobalMessage,
  ]);

  useEffect(() => addMessageListener(handleSocketUpdate), [
    addMessageListener,
    handleSocketUpdate,
  ]);

  const resubscribeDetail = useCallback(() => {
    setDetailSubscription((prev) => ({
      ...prev,
      requestId: `${prev.symbol}-${prev.interval}-${Date.now()}`,
      panelState: panel,
    }));
  }, [panel]);

  useEffect(() => {
    if (spotEnabled && startupStatus.ready) {
      setIsLoading(true);
      setLoadingMessage('Connecting...');
      return;
    }

    setIsLoading(false);
    setIsChartLoading(false);
    setLoadingMessage('');
    chartQueueRef.current = [];
    if (chartFlushTimerRef.current) {
      clearTimeout(chartFlushTimerRef.current);
      chartFlushTimerRef.current = null;
    }
  }, [spotEnabled, startupStatus.ready]);

  useEffect(() => {
    if (!spotEnabled || !startupStatus.ready) return undefined;

    const WATCHDOG_INTERVAL = 5000;
    const STALL_THRESHOLD = 10000;
    const intervalId = setInterval(() => {
      const now = Date.now();
      setChannelHealth((prev) => {
        const next = { ...prev };
        Object.entries(prev).forEach(([channel, { lastUpdate }]) => {
          if (lastUpdate && now - lastUpdate > STALL_THRESHOLD) {
            next[channel] = { ...next[channel], stalled: true };
            if (channel === 'chart') {
              resubscribeDetail();
            }
          }
        });
        return next;
      });
    }, WATCHDOG_INTERVAL);
    return () => clearInterval(intervalId);
  }, [resubscribeDetail, spotEnabled, startupStatus.ready]);

  const selectedPrecision = calculatePrecision(filters?.[panel.selected]) ?? DEFAULT_PRECISION;

  const value = {
    panel,
    throttle,
    chart,
    balances,
    orders,
    commandOutcome,
    dismissCommandOutcome,
    filters,
    depth,
    trades,
    history,
    getAllHistory,
    ticker,
    marketHistory,
    tradePairs,
    selectedPrecision,
    wsConnection,
    startupStatus,
    spotEnabled,
    handlePanelUpdate,
    // Chart depth: the loader the chart calls when the operator scrolls into the
    // oldest bar, and whether the pair's history has a start behind it.
    loadChartHistory,
    chartHistoryExhausted,
    handleThrottleSwitch,
    handleThrottleTimeout,
    enabledMarketBalance,
    handleEnabledMarketBalance,
    tradeNotionalFilter,
    minBtcTradeNotional: MIN_TRADE_NOTIONAL_BTC,
    handleTradeNotionalFilterChange,
    activityVolumeFilter,
    handleActivityVolumeFilterChange,
    analyticsVolumeFilter,
    handleAnalyticsVolumeFilterChange,
    setChart,
    setTrades,
    setHistory,
    setDepth,
    setOrders,
    setBalances,
    // Channel API for multi-chart support
    subscribeChannel,
    unsubscribeChannel,
    sendWsMessage,
    sendMessage: sendWsMessage,  // Alias for convenience
    activeDetailChannelId,
    // Mini charts data for MainView
    miniCharts,
    // Loading states
    isLoading,
    isChartLoading,
    loadingMessage,
    // Offline/cache
    isOffline,
    cacheStats,
    // Notification helpers (for components to use)
    notify: notifications?.addNotification,
    notifyInfo: notifications?.notifyInfo,
    notifySuccess: notifications?.notifySuccess,
    notifyWarning: notifications?.notifyWarning,
    notifyError: notifications?.notifyError,
    analytics: {
      ...analyticsState,
      refresh: refreshAnalytics,
    },
    activityFeed: {
      ...activityFeedState,
      refresh: refreshActivityMetrics,
    },
  };

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useDataContext = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useDataContext must be used within a DataProvider');
  }
  return context;
};
