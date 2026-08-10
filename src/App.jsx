import { Suspense, lazy, useCallback, useState } from 'react'
import './styles/app-layout.css'
import NotificationToast from './components/common/NotificationToast.jsx'
import { GatewayProvider, useGatewayContext } from './context/GatewayContext.jsx'
import { NotificationProvider } from './context/NotificationProvider.jsx'
import {
  describeUnavailableMarketWorkspace,
  isMarketWorkspaceAvailable,
} from './utils/marketCredentialAvailability.js'
import {
  MARKET_WORKSPACES,
  isActivatableMarketWorkspace,
  readLastMarketWorkspace,
  writeLastMarketWorkspace,
} from './utils/marketWorkspaceStorage.js'

const SpotWorkspace = lazy(() => import('./workspaces/SpotWorkspace.jsx'))
const FuturesWorkspace = lazy(() => import('./workspaces/FuturesWorkspace.jsx'))

const MARKET_MODES = Object.freeze({
  UNSELECTED: MARKET_WORKSPACES.UNSELECTED,
  SPOT: MARKET_WORKSPACES.SPOT,
  FUTURES_LIVE: MARKET_WORKSPACES.FUTURES_LIVE,
})

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
])

const MarketModeSwitch = ({ mode, onChange, startupStatus }) => (
  <div className="market-mode-switch" role="group" aria-label="Market mode">
    {MARKET_MODE_OPTIONS.map(option => {
      const unavailableReason = describeUnavailableMarketWorkspace(startupStatus, option.mode)
      return (
        <button
          type="button"
          className={`market-mode-option is-${option.tone}`
            + `${mode === option.mode ? ' active' : ''}`
            + `${unavailableReason ? ' is-unavailable' : ''}`}
          data-testid={option.testId}
          aria-pressed={mode === option.mode}
          disabled={Boolean(unavailableReason)}
          title={unavailableReason ?? undefined}
          aria-description={unavailableReason ?? undefined}
          onClick={() => onChange(option.mode)}
          key={option.mode}
        >
          <span className="market-mode-indicator" aria-hidden="true" />
          {option.label}
        </button>
      )
    })}
  </div>
)

const StartupGate = ({ startupStatus }) => {
  const isConfigurationError = startupStatus?.state === 'CONFIG_ERROR'

  return (
    <main
      className={`startup-gate${isConfigurationError ? ' is-error' : ''}`}
      data-testid={isConfigurationError ? 'startup-config-error' : 'startup-loading'}
      aria-live="polite"
    >
      <div className="startup-gate-card">
        <span className="startup-gate-kicker">
          {isConfigurationError ? 'CONFIGURATION REQUIRED' : 'STARTING'}
        </span>
        <h1>
          {isConfigurationError
            ? 'Binance access is not configured'
            : 'Checking Binance configuration'}
        </h1>
        {isConfigurationError ? (
          <>
            <p>
              Set <code>BK</code> and <code>BS</code> for Spot, and <code>BFK</code> and{' '}
              <code>BFS</code> for Futures, in the application environment. Either complete
              pair enables its own market. Retired Testnet/read-only variable names are not
              accepted.
            </p>
            <p className="startup-gate-code">Diagnostic: {startupStatus.code}</p>
            <p>Restart the application after updating the environment.</p>
          </>
        ) : (
          <p>No exchange market, account, or order connection starts before this check succeeds.</p>
        )}
      </div>
    </main>
  )
}

const MarketWorkspaceSelector = ({ onChange, startupStatus }) => {
  const unavailable = MARKET_MODE_OPTIONS
    .map(option => describeUnavailableMarketWorkspace(startupStatus, option.mode))
    .filter(Boolean)

  return (
    <main className="market-workspace-selector" data-testid="market-workspace-selector">
      <div className="market-workspace-selector-card">
        <span className="startup-gate-kicker">WORKSPACE</span>
        <h1>Select Spot or Futures</h1>
        <p>No market workspace is selected. Choose one to initialize it.</p>
        <MarketModeSwitch
          mode={MARKET_MODES.UNSELECTED}
          onChange={onChange}
          startupStatus={startupStatus}
        />
        {unavailable.map(reason => (
          <p className="market-workspace-unavailable" data-testid="market-unavailable" key={reason}>
            {reason}
          </p>
        ))}
      </div>
    </main>
  )
}

const WorkspaceLoading = ({ mode }) => (
  <main className="workspace-loading" data-testid="workspace-loading" aria-live="polite">
    Loading {mode === MARKET_MODES.SPOT ? 'Spot' : 'Futures'} workspace…
  </main>
)

const WorkspaceGateway = ({ marketMode, onMarketModeChange }) => {
  const { marketActivation, startupStatus } = useGatewayContext()

  if (startupStatus?.ready !== true) return <StartupGate startupStatus={startupStatus} />
  // A persisted workspace whose credentials are missing resolves to the neutral
  // selector. The stored value is deliberately left untouched so fixing the
  // environment restores the operator's last workspace on the next start.
  if (marketMode === MARKET_MODES.UNSELECTED
    || !isMarketWorkspaceAvailable(startupStatus, marketMode)) {
    return <MarketWorkspaceSelector onChange={onMarketModeChange} startupStatus={startupStatus} />
  }

  return (
    <div className={`App market-mode-${marketMode}`}>
      <MarketModeSwitch
        mode={marketMode}
        onChange={onMarketModeChange}
        startupStatus={startupStatus}
      />
      {/* The workspace mounts only once the backend has acknowledged this
          market. Its children issue refreshes and subscriptions from their own
          effects, and on a warm lazy switch those used to run before the
          parent's activation had been sent at all — ordering that rested on
          nothing but effect scheduling. */}
      {marketActivation?.marketMode === marketMode ? (
        <Suspense fallback={<WorkspaceLoading mode={marketMode} />}>
          {marketMode === MARKET_MODES.SPOT ? (
            <SpotWorkspace />
          ) : (
            <FuturesWorkspace />
          )}
        </Suspense>
      ) : (
        <WorkspaceLoading mode={marketMode} />
      )}
    </div>
  )
}

export default function App() {
  const [marketMode, setMarketMode] = useState(readLastMarketWorkspace)

  const handleMarketModeChange = useCallback((nextMode) => {
    if (!isActivatableMarketWorkspace(nextMode)) return
    writeLastMarketWorkspace(nextMode)
    setMarketMode(nextMode)
  }, [])

  return (
    <NotificationProvider>
      <GatewayProvider activeMarketMode={marketMode}>
        <WorkspaceGateway
          marketMode={marketMode}
          onMarketModeChange={handleMarketModeChange}
        />
        <NotificationToast />
      </GatewayProvider>
    </NotificationProvider>
  )
}
