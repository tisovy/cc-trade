
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './styles/app-layout.css'
import { ChartWrapper } from './components/features/charts/ChartWrapper'
import OrderFormModal from './components/features/trading/OrderFormModal'
import OrderBook from './components/features/trading/OrderBook'
import TradesPanel from './components/features/trading/TradesPanel'
import UpperPanel from './components/layout/UpperPanel'
import InfoPanel from './components/layout/InfoPanel'
import AnalyticsPanel from './components/layout/AnalyticsPanel'
import QuickSwitchModal from './components/features/tools/QuickSwitchModal'
import DrawingToolbar from './components/features/tools/DrawingToolbar'
import AlertPanel from './components/features/tools/AlertPanel'
import MainView from './components/layout/MainView'
import NotificationToast from './components/common/NotificationToast'
import FuturesProductionWorkstation from './components/features/futures/FuturesProductionWorkstation'
import { INTERVALS } from './constants'
import { DataProvider, useDataContext } from './context/DataContext'
import { DrawingProvider } from './context/DrawingProvider';
import { AlertProvider } from './context/AlertProvider';
import { useAlertContext } from './hooks/useAlertContext';
import { NotificationProvider } from './context/NotificationProvider'
import { calculatePrecision } from './utils/precision';
import {
  createSpotCancelOrderCommand,
  createSpotPlaceOrderCommand,
} from './utils/tradingCommands';
import useFuturesProductionExecution from './hooks/useFuturesProductionExecution';

// View types
const VIEWS = {
  DEPTH: 'depth',
  MAIN: 'main'
};

const MARKET_MODES = Object.freeze({
  SPOT: 'spot',
  FUTURES_LIVE: 'futures-live',
});

const MARKET_MODE_OPTIONS = Object.freeze([
  Object.freeze({
    mode: MARKET_MODES.SPOT,
    label: 'Spot',
    testId: 'market-mode-spot',
    tone: 'spot',
  }),
  Object.freeze({
    mode: MARKET_MODES.FUTURES_LIVE,
    label: 'Futures',
    testId: 'market-mode-futures-live',
    tone: 'production',
  }),
]);

const MarketModeSwitch = ({ mode, onChange }) => (
  <div className="market-mode-switch" role="group" aria-label="Market mode">
    {MARKET_MODE_OPTIONS.map((option) => (
      <button
        type="button"
        className={`market-mode-option is-${option.tone}${mode === option.mode ? ' active' : ''}`}
        data-testid={option.testId}
        aria-pressed={mode === option.mode}
        onClick={() => onChange(option.mode)}
        key={option.mode}
      >
        <span className="market-mode-indicator" aria-hidden="true" />
        {option.label}
      </button>
    ))}
  </div>
);

const FuturesModeBanner = () => (
  <header
    className="futures-mode-banner is-production"
    data-testid="futures-live-banner"
  >
    <strong>USDⓈ-M FUTURES</strong>
    <span>REAL MONEY · PRODUCTION</span>
  </header>
);

function AppShell() {
  const {
    panel,
    ticker,
    tradePairs,
    handlePanelUpdate,
    wsConnection,
    filters,
    isOffline,
    sendMessage,
  } = useDataContext();
  const { alerts, checkPriceAlerts, triggeredAlerts: _triggeredAlerts } = useAlertContext();
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderModalData, setOrderModalData] = useState(null);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [alertInitialPrice, setAlertInitialPrice] = useState(null);
  const [quickSwitch, setQuickSwitch] = useState({ visible: false, mode: 'pair', query: '', selectedIndex: 0 });
  const [marketMode, setMarketMode] = useState(MARKET_MODES.SPOT);
  const isFuturesLiveMode = marketMode === MARKET_MODES.FUTURES_LIVE;
  const futuresProductionExecution = useFuturesProductionExecution({
    enabled: isFuturesLiveMode,
    wsConnection,
  });

  const handleMarketModeChange = useCallback((nextMode) => {
    if (!Object.values(MARKET_MODES).includes(nextMode)) return;
    setShowOrderModal(false);
    setOrderModalData(null);
    setShowAlertPanel(false);
    setQuickSwitch(prev => ({ ...prev, visible: false, query: '', selectedIndex: 0 }));
    setMarketMode(nextMode);
  }, []);

  // Store reference to MainView's slot updater for AnalyticsPanel clicks
  const mainViewSlotUpdaterRef = useRef(null);
  // Store reference to MainView's selected slot updater for QuickSwitch
  const mainViewSelectedSlotUpdaterRef = useRef(null);
  // Store reference to MainView's getGridState function for duplicate checking
  const mainViewGridStateRef = useRef(null);

  // Analytics panel visibility for MainView (persisted)
  const [showAnalyticsPanelInMainView, setShowAnalyticsPanelInMainView] = useState(() => {
    const stored = localStorage.getItem('mainViewShowActivity');
    return stored !== null ? JSON.parse(stored) : true;
  });

  useEffect(() => {
    localStorage.setItem('mainViewShowActivity', JSON.stringify(showAnalyticsPanelInMainView));
  }, [showAnalyticsPanelInMainView]);

  // Order history overlay visibility (persisted)
  // States: 'VISIBLE', 'LINES_ONLY', 'HIDDEN'
  const [showOrderHistory, setShowOrderHistory] = useState(() => {
    const stored = localStorage.getItem('showOrderHistory');
    // Handle legacy boolean values
    if (stored === 'true') return 'VISIBLE';
    if (stored === 'false') return 'HIDDEN';
    // Handle new string values
    if (stored && ['VISIBLE', 'LINES_ONLY', 'HIDDEN'].includes(JSON.parse(stored))) {
      return JSON.parse(stored);
    }
    return 'VISIBLE';
  });

  useEffect(() => {
    localStorage.setItem('showOrderHistory', JSON.stringify(showOrderHistory));
  }, [showOrderHistory]);

  const cycleOrderHistoryState = useCallback(() => {
    setShowOrderHistory(prev => {
      if (prev === 'VISIBLE') return 'LINES_ONLY';
      if (prev === 'LINES_ONLY') return 'HIDDEN';
      return 'VISIBLE';
    });
  }, []);

  // Current view (depth or main)
  const [currentView, setCurrentView] = useState(() => {
    const stored = localStorage.getItem('currentView');
    return stored && Object.values(VIEWS).includes(stored) ? stored : VIEWS.DEPTH;
  });

  useEffect(() => {
    localStorage.setItem('currentView', currentView);
  }, [currentView]);

  // Enable/disable depth view streams based on current view
  // Spot trade + depth streams exist only while the Spot DepthView is visible.
  // Entering either Futures workspace explicitly releases the prior Spot stream.
  useEffect(() => {
    if (!sendMessage || !wsConnection) return;
    
    if (marketMode === MARKET_MODES.SPOT
      && currentView === VIEWS.DEPTH
      && panel?.selected) {
      // Enable trade + depth streams for DepthView
      sendMessage({ action: 'enable_depth_view', symbol: panel.selected });
    } else {
      // Disable when on MainView, no symbol is selected, or a Futures workspace owns the screen.
      sendMessage({ action: 'disable_depth_view' });
    }
  }, [marketMode, currentView, panel?.selected, sendMessage, wsConnection]);

  // Switch to depth view with specific symbol/interval (from MainView or AnalyticsPanel)
  // NOTE: When coming from MainView, the slot updater handles keeping the grid in sync
  const handleSwitchToDepth = useCallback((symbol, interval) => {
    if (symbol && interval) {
      handlePanelUpdate({ ...panel, selected: symbol, interval }, true);
      // Update MainView's slot - the updater handles duplicate checking internally
      if (mainViewSlotUpdaterRef.current) {
        mainViewSlotUpdaterRef.current(symbol, interval);
      }
    }
    setCurrentView(VIEWS.DEPTH);
  }, [panel, handlePanelUpdate]);

  // Callback from MainView to register its slot updater (for AnalyticsPanel)
  const handleMainViewPairChange = useCallback((updaterFn) => {
    mainViewSlotUpdaterRef.current = updaterFn;
  }, []);

  // Callback from MainView to register its selected slot updater and grid state getter (for QuickSwitch)
  const handleMainViewSelectedSlotChange = useCallback((updaterFn, gridStateGetterFn) => {
    mainViewSelectedSlotUpdaterRef.current = updaterFn;
    mainViewGridStateRef.current = gridStateGetterFn;
  }, []);

  // Handle AnalyticsPanel pair click - switch to DepthView and update MainView slot
  // KEY: Check if pair exists in grid - if so, the updater will focus that cell instead of creating duplicate
  const handleAnalyticsPairClick = useCallback((symbol) => {
    // Update panel for DepthView
    handlePanelUpdate({ ...panel, selected: symbol }, true);
    // Update MainView's slot - the updater handles duplicate checking internally
    if (mainViewSlotUpdaterRef.current) {
      mainViewSlotUpdaterRef.current(symbol, panel.interval);
    }
    // Switch to DepthView
    setCurrentView(VIEWS.DEPTH);
  }, [panel, handlePanelUpdate, setCurrentView]);

  // Check price alerts when ticker updates
  useEffect(() => {
    if (!panel?.selected || !ticker || ticker.length === 0) return;

    const currentTicker = ticker.find(t => t.symbol === panel.selected);
    if (currentTicker && currentTicker.lastPrice) {
      const price = parseFloat(currentTicker.lastPrice);
      if (price > 0) {
        checkPriceAlerts(panel.selected, price);
      }
    }
  }, [ticker, panel?.selected, checkPriceAlerts]);

  // Count active alerts for current symbol
  const activeAlertsCount = useMemo(() => {
    return alerts.filter(a => a.symbol === panel?.selected && a.active).length;
  }, [alerts, panel?.selected]);

  const availablePairs = useMemo(() => {
    const set = new Set(tradePairs);
    ticker.forEach((item) => {
      if (item?.symbol) set.add(item.symbol);
    });
    return Array.from(set).sort();
  }, [tradePairs, ticker]);

  const quickSwitchResults = useMemo(() => {
    if (!quickSwitch.visible) return [];
    const prioritizePairs = (items) => {
      const SUFFIX_PRIORITY = ['USDT', 'BNB', 'BTC'];
      const getPriority = (symbol) => {
        const match = SUFFIX_PRIORITY.find((suffix) => symbol.endsWith(suffix));
        return match ? SUFFIX_PRIORITY.indexOf(match) : SUFFIX_PRIORITY.length;
      };
      return [...items].sort((a, b) => {
        const priorityDiff = getPriority(a) - getPriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        return a.localeCompare(b);
      });
    };

    const sortIntervals = (items) => {
      const unitMultipliers = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 };
      const parseIntervalValue = (interval) => {
        const match = /^(\d+)([mhdwM])$/.exec(interval);
        if (!match) return Number.MAX_SAFE_INTEGER;
        const [, value, unit] = match;
        return parseInt(value, 10) * (unitMultipliers[unit] ?? Number.MAX_SAFE_INTEGER);
      };
      return [...items].sort((a, b) => {
        const diff = parseIntervalValue(a) - parseIntervalValue(b);
        if (diff !== 0) return diff;
        return a.localeCompare(b);
      });
    };

    const source = quickSwitch.mode === 'pair' ? availablePairs : INTERVALS;
    const query = quickSwitch.query.trim().toUpperCase();
    let filtered = source;

    if (query) {
      const matches = source.filter((item) => item.toUpperCase().includes(query));
      if (quickSwitch.mode === 'pair') {
        const startsWith = matches.filter((item) => item.toUpperCase().startsWith(query));
        const contains = matches.filter((item) => !item.toUpperCase().startsWith(query));
        filtered = [...prioritizePairs(startsWith), ...prioritizePairs(contains)];
      } else {
        filtered = sortIntervals(matches);
      }
    } else if (quickSwitch.mode === 'pair') {
      filtered = prioritizePairs(source);
    } else {
      filtered = sortIntervals(source);
    }

    return filtered.slice(0, 30);
  }, [quickSwitch, availablePairs]);

  const quickSwitchResultsCount = quickSwitchResults.length;

  useEffect(() => {
    const handleGlobalQuickSwitch = (event) => {
      if (marketMode !== MARKET_MODES.SPOT) return;
      console.log('Global Keydown:', event.key, event.target.tagName);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (quickSwitch.visible || showOrderModal) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        setQuickSwitch({ visible: true, mode: 'pair', query: event.key.toUpperCase(), selectedIndex: 0 });
      } else if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        setQuickSwitch({ visible: true, mode: 'interval', query: event.key, selectedIndex: 0 });
      }
    };

    document.addEventListener('keydown', handleGlobalQuickSwitch);
    return () => document.removeEventListener('keydown', handleGlobalQuickSwitch);
  }, [marketMode, quickSwitch.visible, showOrderModal]);

  const handleRequest = useCallback((data, type) => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket connection is not ready');
      return;
    }

    if (type === 'cancel') {
      const command = createSpotCancelOrderCommand({
        symbol: data.symbol,
        orderId: data.id || data.orderId,
      });
      wsConnection.send(JSON.stringify(command));
      return;
    }

    if (type === 'order') {
      const quantity = data.amount ?? data.quantity;
      if (!quantity || !data.price || !data.symbol) {
        console.warn('Missing order fields', data);
        return;
      }

      // Apply 99.9% reduction to avoid insufficient funds
      const rawQuantity = parseFloat(quantity);
      const reducedQuantity = rawQuantity * 0.999;

      const precision = calculatePrecision(filters?.[data.symbol]);
      const quantityDecimals = precision.quantity;

      // Use floor logic to ensure we don't round up
      const factor = Math.pow(10, quantityDecimals);
      const finalQuantity = Math.floor(reducedQuantity * factor) / factor;

      const command = createSpotPlaceOrderCommand({
        symbol: data.symbol,
        side: data.side,
        price: Number(data.price).toString(),
        quantity: finalQuantity.toString(),
      });
      wsConnection.send(JSON.stringify(command));
      return;
    }
  }, [wsConnection, filters]);

  const handleOrderModalOpen = (data) => {
    setOrderModalData(data);
    setShowOrderModal(true);
  };

  const handleOrderModalSave = (order) => {
    if (order.id) {
      // Logic for "Edit" -> Cancel old order, then place new one
      handleRequest({ symbol: order.symbol, id: order.id }, 'cancel');
    }
    handleRequest(order, 'order');
  };

  const closeQuickSwitch = useCallback(() => {
    setQuickSwitch(prev => ({ ...prev, visible: false, query: '', selectedIndex: 0 }));
  }, []);

  const handleQuickSwitchQueryChange = useCallback((value) => {
    setQuickSwitch(prev => ({
      ...prev,
      query: value.toUpperCase(),
      selectedIndex: 0
    }));
  }, []);

  const moveQuickSwitchSelection = useCallback((delta) => {
    if (!quickSwitchResultsCount) return;
    setQuickSwitch(prev => {
      const nextIndex = (prev.selectedIndex + delta + quickSwitchResultsCount) % quickSwitchResultsCount;
      return { ...prev, selectedIndex: nextIndex };
    });
  }, [quickSwitchResultsCount]);

  const handleQuickSwitchSelect = useCallback((value) => {
    if (!value) return;

    // Determine the new panel state
    const newPanel = quickSwitch.mode === 'pair'
      ? { ...panel, selected: value }
      : { ...panel, interval: value };

    // Update panel (this triggers DepthView chart update)
    handlePanelUpdate(newPanel, true);

    // If in MainView, also update the selected slot directly
    // (the panel sync will update it, but this ensures immediate response)
    if (currentView === VIEWS.MAIN && mainViewSelectedSlotUpdaterRef.current) {
      if (quickSwitch.mode === 'pair') {
        mainViewSelectedSlotUpdaterRef.current(value, panel.interval);
      } else {
        mainViewSelectedSlotUpdaterRef.current(panel.selected, value);
      }
    }

    closeQuickSwitch();
  }, [quickSwitch.mode, panel, handlePanelUpdate, closeQuickSwitch, currentView]);

  // Render DepthView (current trading UI)
  const renderDepthView = () => (
    <>
      <div className="root-container">
        {/* Analytics Panel - inline in depth view */}
        <div className="analytics-panel-container">
          <AnalyticsPanel onPairNavigate={handleAnalyticsPairClick} />
        </div>
        <DrawingToolbar />
        <div className="chart">
          <div className="upper-panel-row">
            <UpperPanel />
            <div className="upper-panel-actions">
              {isOffline && (
                <div className="offline-indicator">Offline Mode</div>
              )}
              <button
                className={`order-history-toggle-btn ${showOrderHistory !== 'HIDDEN' ? 'active' : ''} ${showOrderHistory === 'LINES_ONLY' ? 'lines-only' : ''}`}
                onClick={cycleOrderHistoryState}
                title={`Orders: ${showOrderHistory === 'VISIBLE' ? 'Visible' : showOrderHistory === 'LINES_ONLY' ? 'Lines Only' : 'Hidden'}`}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
                </svg>
                Orders
                {showOrderHistory === 'LINES_ONLY' && <span className="state-indicator" style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.7 }}>(L)</span>}
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  className="alert-trigger-btn"
                  onClick={() => setShowAlertPanel(!showAlertPanel)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                  </svg>
                  Alerts
                  {activeAlertsCount > 0 && (
                    <span className="alert-badge">{activeAlertsCount}</span>
                  )}
                </button>
                <AlertPanel
                  isOpen={showAlertPanel}
                  onClose={() => {
                    setShowAlertPanel(false);
                    setAlertInitialPrice(null);
                  }}
                  initialPrice={alertInitialPrice}
                />
              </div>
            </div>
          </div>
          <div className="chart-wrapper-container">
            <ChartWrapper
              onOrderCreate={handleOrderModalOpen}
              onOrderCancel={(data) => handleRequest(data, 'cancel')}
              onOrderPlace={(order) => handleRequest(order, 'order')}
              onOrderEdit={(order) => {
                handleOrderModalOpen({
                  price: order.price,
                  amount: order.origQty,
                  side: order.side,
                  symbol: order.symbol,
                  id: order.orderId
                });
              }}
              onAlertCreate={(price) => {
                setAlertInitialPrice(price);
                setShowAlertPanel(true);
              }}
              onViewSwitch={toggleView}
              showOrderHistory={showOrderHistory}
            />
          </div>
        </div>
      </div>
      <footer className="footer">
        <TradesPanel />
        <OrderBook callDialog={handleOrderModalOpen} />
        <InfoPanel handleRequest={handleRequest} />
      </footer>
    </>
  );

  // Toggle between views (ALT+Click triggers this)
  const toggleView = useCallback(() => {
    setCurrentView(prev => prev === VIEWS.DEPTH ? VIEWS.MAIN : VIEWS.DEPTH);
  }, []);

  // Determine if analytics panel should be visible
  const _showAnalyticsPanel = currentView === VIEWS.DEPTH || showAnalyticsPanelInMainView;

  return (
    <div className={`App market-mode-${marketMode}`}>
      <MarketModeSwitch
        mode={marketMode}
        onChange={handleMarketModeChange}
      />

      {isFuturesLiveMode ? (
        <main
          className="futures-mode-view is-production"
          data-testid="futures-live-view"
          aria-label="USDⓈ-M Futures production workspace"
        >
          <FuturesModeBanner />
          <FuturesProductionWorkstation
            enabled={isFuturesLiveMode}
            executionState={futuresProductionExecution}
            wsConnection={wsConnection}
            sendMessage={sendMessage}
          />
        </main>
      ) : (
        <>
          {/* Render the established spot view without changing its state or workflow. */}
          {currentView === VIEWS.DEPTH ? (
            renderDepthView()
          ) : (
            <>
              {/* Analytics Panel for MainView - rendered at App level for persistence */}
              {showAnalyticsPanelInMainView && (
                <div className="persistent-analytics-panel in-main-view">
                  <AnalyticsPanel onPairNavigate={handleAnalyticsPairClick} />
                </div>
              )}
              <MainView
                onSwitchToDepth={handleSwitchToDepth}
                onPairChange={handleMainViewPairChange}
                onSelectedSlotChange={handleMainViewSelectedSlotChange}
                showAnalyticsPanel={showAnalyticsPanelInMainView}
                onToggleAnalyticsPanel={() => setShowAnalyticsPanelInMainView(!showAnalyticsPanelInMainView)}
                isActive={currentView === VIEWS.MAIN}
              />
            </>
          )}

          {/* Spot execution modals never exist in the futures render branch. */}
          <OrderFormModal
            show={showOrderModal}
            onHide={() => setShowOrderModal(false)}
            onSave={handleOrderModalSave}
            initialData={orderModalData}
          />
          <QuickSwitchModal
            visible={quickSwitch.visible}
            mode={quickSwitch.mode}
            query={quickSwitch.query}
            results={quickSwitchResults}
            selectedIndex={quickSwitch.selectedIndex}
            onClose={closeQuickSwitch}
            onQueryChange={handleQuickSwitchQueryChange}
            onSelect={handleQuickSwitchSelect}
            onMoveSelection={moveQuickSwitchSelection}
          />
        </>
      )}
    </div>
  )
}

export default function App() {
  return (
    <NotificationProvider>
      <DataProvider>
        <AlertProvider>
          <DrawingProvider>
            <AppShell />
            {/* LoadingOverlay removed - charts load progressively */}
            <NotificationToast />
          </DrawingProvider>
        </AlertProvider>
      </DataProvider>
    </NotificationProvider>
  );
}
