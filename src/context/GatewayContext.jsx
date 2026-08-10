import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import useWebSocket from '../hooks/useWebSocket.js'
import { useNotifications } from '../hooks/useNotifications.js'
import {
  getRendererLocalWebSocketAccess,
  redactLocalWebSocketAccess,
  withLocalWebSocketAccess,
} from '../utils/localWebSocketAccess.js'
import {
  MARKET_CREDENTIAL_FIELDS,
  formatMarketConfigurationError,
  isMarketWorkspaceAvailable,
} from '../utils/marketCredentialAvailability.js'
import { MARKET_WORKSPACES } from '../utils/marketWorkspaceStorage.js'

const createLoadingMarketStatus = market => Object.freeze({
  market,
  label: market === 'spot' ? 'Spot' : 'Futures',
  ready: false,
  code: 'CHECKING_CONFIGURATION',
  missingFields: [],
})

const STARTUP_STATUS_LOADING = Object.freeze({
  version: 2,
  type: 'startup_status',
  state: 'LOADING',
  code: 'CHECKING_CONFIGURATION',
  ready: false,
  missingFields: [],
  retiredFields: [],
  markets: Object.freeze({
    spot: createLoadingMarketStatus('spot'),
    futures: createLoadingMarketStatus('futures'),
  }),
})

const boundedStringList = (value, limit) => (Array.isArray(value)
  ? Object.freeze(value.filter(entry => typeof entry === 'string').slice(0, limit))
  : Object.freeze([]))

// A main process that predates per-market credentials sends no `markets`
// section. Degrading each market to the aggregate keeps the gates defined
// instead of leaving them undefined, which would read as "not ready" and
// silently block a correctly configured market.
const normalizeMarketStatus = (payload, market, aggregateReady) => {
  const section = payload?.markets?.[market]
  const ready = section
    ? section.ready === true
    : aggregateReady
  return Object.freeze({
    market,
    label: typeof section?.label === 'string'
      ? section.label.slice(0, 32)
      : market === 'spot' ? 'Spot' : 'Futures',
    ready,
    code: typeof section?.code === 'string'
      ? section.code.slice(0, 64)
      : ready ? 'READY' : 'INVALID_CONFIGURATION',
    missingFields: section
      ? boundedStringList(section.missingFields, 2)
      : ready ? Object.freeze([]) : MARKET_CREDENTIAL_FIELDS[market],
  })
}

const normalizeStartupStatus = payload => {
  if (!payload || payload.type !== 'startup_status') return null

  const ready = payload.ready === true && payload.state === 'READY'
  return Object.freeze({
    version: 2,
    type: 'startup_status',
    state: ready ? 'READY' : 'CONFIG_ERROR',
    code: typeof payload.code === 'string'
      ? payload.code.slice(0, 64)
      : ready ? 'READY' : 'INVALID_CONFIGURATION',
    ready,
    missingFields: boundedStringList(payload.missingFields, 4),
    retiredFields: boundedStringList(payload.retiredFields, 16),
    markets: Object.freeze({
      spot: normalizeMarketStatus(payload, 'spot', ready),
      futures: normalizeMarketStatus(payload, 'futures', ready),
    }),
  })
}

const formatStartupConfigurationError = startupStatus => {
  const retired = startupStatus.retiredFields.length
    ? ` Retired variable names: ${startupStatus.retiredFields.join(', ')}.`
    : ''
  return `Binance configuration error (${startupStatus.code}).${retired}`
    + ' Configure BK and BS for Spot and BFK and BFS for Futures, then restart the application.'
}

const GatewayContext = createContext(null)

export const GatewayProvider = ({
  activeMarketMode = MARKET_WORKSPACES.UNSELECTED,
  children,
}) => {
  const notifications = useNotifications()
  const [startupSnapshot, setStartupSnapshot] = useState(() => ({
    connection: null,
    status: STARTUP_STATUS_LOADING,
  }))
  const [spotDetailSubscription, setSpotDetailSubscription] = useState(null)
  // Null until the backend says which market it activated. Nothing
  // market-scoped is sent before that.
  const [marketActivation, setMarketActivation] = useState(null)
  const startupAlertFingerprintRef = useRef(new Set())
  const deliveredTransportFailureRef = useRef(null)
  const messageListenersRef = useRef(new Set())

  // Null when this window was never issued a runtime. There is no default
  // endpoint to fall back to on purpose: see `src/utils/rendererRuntime.js`.
  const localWebSocketAccess = useMemo(() => getRendererLocalWebSocketAccess(), [])
  const wsUrl = localWebSocketAccess === null
    ? null
    : withLocalWebSocketAccess(
      `ws://${localWebSocketAccess.host}:${localWebSocketAccess.port}`,
      localWebSocketAccess,
    )

  const handleSocketUpdate = useCallback((event, connection, normalized) => {
    let payload
    try {
      payload = JSON.parse(event?.data)
    } catch {
      payload = null
    }

    const nextStartupStatus = normalizeStartupStatus(payload)
    if (nextStartupStatus) {
      setStartupSnapshot({ connection, status: nextStartupStatus })
      return
    }

    // The backend's acknowledgement that a market is now the activated one.
    // Market-scoped work waits for it: a child effect that ran ahead of its
    // parent's activation used to reach the backend first, and the ordering
    // depended on nothing more solid than effect scheduling.
    //
    // The connection it arrived on is kept with it. An acknowledgement belongs
    // to one socket: after a reconnect the backend has no activated market
    // again, and carrying the old one across would open the workspace before
    // anything had been activated for it.
    if (payload?.type === 'market_activation'
      && typeof payload.marketMode === 'string'
      && Number.isSafeInteger(payload.generation)) {
      setMarketActivation({
        connection,
        marketMode: payload.marketMode,
        generation: payload.generation,
      })
      return
    }

    for (const listener of messageListenersRef.current) {
      listener(event, connection, normalized)
    }
  }, [])

  const {
    connection: wsConnection,
    failure: transportFailure,
    reconnect: reconnectTransport,
    sendMessage: sendRawMessage,
    subscribe,
    unsubscribe,
  } = useWebSocket(
    wsUrl,
    activeMarketMode === MARKET_WORKSPACES.SPOT ? spotDetailSubscription : null,
    handleSocketUpdate,
  )
  const openState = globalThis.WebSocket?.OPEN ?? 1
  const startupStatus = wsConnection?.readyState === openState
    && startupSnapshot.connection === wsConnection
    ? startupSnapshot.status
    : STARTUP_STATUS_LOADING
  // An activation is only an activation of the connection that acknowledged it.
  const activation = marketActivation?.connection === wsConnection
    ? marketActivation
    : null
  const activationGeneration = activation?.generation ?? null

  // Every market-scoped frame carries the activation it was issued under, so a
  // frame that was in flight across a switch cannot be applied to the market
  // that is active now. The market name alone does not separate them: Spot →
  // Futures → Spot leaves the name equal to what the stale frame carries.
  const sendMessage = useCallback((message) => {
    if (activationGeneration === null
      || message?.action === 'activate_market'
      || message?.action === 'get_startup_status') {
      return sendRawMessage(message)
    }
    return sendRawMessage({ ...message, generation: activationGeneration })
  }, [activationGeneration, sendRawMessage])

  useEffect(() => {
    if (wsUrl === null) return
    console.log(
      'Using WebSocket URL:',
      redactLocalWebSocketAccess(wsUrl, localWebSocketAccess?.tokenParam),
    )
  }, [localWebSocketAccess?.tokenParam, wsUrl])

  // A transport that has stopped retrying must say so out loud. Silence here
  // reads as "still connecting", which is how the previous endless reconnect
  // stayed invisible for a whole session. Announced once per distinct failure,
  // the way the startup alerts are.
  useEffect(() => {
    if (!transportFailure) return
    if (deliveredTransportFailureRef.current === transportFailure.code) return
    deliveredTransportFailureRef.current = transportFailure.code
    notifications?.notifyError(transportFailure.message, 0)
  }, [notifications, transportFailure])

  useEffect(() => {
    if (!wsConnection || wsConnection.readyState !== openState) return
    sendMessage({ action: 'get_startup_status' })
  }, [openState, sendMessage, wsConnection])

  useEffect(() => {
    if (!wsConnection
      || wsConnection.readyState !== openState
      || !startupStatus.ready) return

    const requested = Object.values(MARKET_WORKSPACES).includes(activeMarketMode)
      ? activeMarketMode
      : MARKET_WORKSPACES.UNSELECTED
    // Never request a market whose credentials are incomplete: the main process
    // would reject it, and the renderer would show a workspace that can never
    // connect. Deactivating instead keeps the neutral selector authoritative.
    const marketMode = isMarketWorkspaceAvailable(startupStatus, requested)
      ? requested
      : MARKET_WORKSPACES.UNSELECTED
    // The acknowledgement that arrives names the market it activated, and every
    // consumer compares it against the one it wants — so an acknowledgement for
    // the market being left is never mistaken for permission for the new one.
    sendMessage({ action: 'activate_market', marketMode })
  }, [activeMarketMode, openState, sendMessage, startupStatus, wsConnection])

  useEffect(() => {
    if (startupStatus.state === 'LOADING') return

    // One alert per unconfigured market, so a Spot problem and a Futures
    // problem never suppress each other. Recomputing the fingerprint set each
    // time re-arms an alert after the market recovers and fails again.
    const pending = startupStatus.ready
      ? Object.values(startupStatus.markets)
        .filter(market => !market.ready)
        .map(market => [
          [market.market, market.code, ...market.missingFields].join(':'),
          formatMarketConfigurationError(market),
        ])
      : [[
        ['startup', startupStatus.code, ...startupStatus.missingFields, ...startupStatus.retiredFields].join(':'),
        formatStartupConfigurationError(startupStatus),
      ]]

    const delivered = startupAlertFingerprintRef.current
    for (const [fingerprint, message] of pending) {
      if (delivered.has(fingerprint)) continue
      notifications?.notifyError(message, 0)
    }
    startupAlertFingerprintRef.current = new Set(pending.map(([fingerprint]) => fingerprint))
  }, [notifications, startupStatus])

  const addMessageListener = useCallback((listener) => {
    if (typeof listener !== 'function') return () => {}
    messageListenersRef.current.add(listener)
    return () => messageListenersRef.current.delete(listener)
  }, [])

  const value = useMemo(() => ({
    addMessageListener,
    notifications,
    notifyError: notifications?.notifyError,
    notifyInfo: notifications?.notifyInfo,
    notifySuccess: notifications?.notifySuccess,
    notifyWarning: notifications?.notifyWarning,
    marketActivation: activation,
    marketGeneration: activationGeneration,
    reconnectTransport,
    sendMessage,
    setSpotDetailSubscription,
    startupStatus,
    subscribe,
    transportFailure,
    unsubscribe,
    wsConnection,
  }), [
    activation,
    activationGeneration,
    addMessageListener,
    notifications,
    reconnectTransport,
    sendMessage,
    startupStatus,
    subscribe,
    transportFailure,
    unsubscribe,
    wsConnection,
  ])

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useGatewayContext = () => {
  const context = useContext(GatewayContext)
  if (!context) throw new Error('useGatewayContext must be used within GatewayProvider')
  return context
}
