import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
  createFuturesProductionWorkstationConfigureDepthRequest,
  createFuturesProductionWorkstationConfigureTapeRequest,
  createFuturesProductionWorkstationLoadCandleHistoryRequest,
  createFuturesProductionWorkstationSelectIntervalRequest,
  createFuturesProductionWorkstationSelectSymbolRequest,
  createFuturesProductionWorkstationSubscribeRequest,
  createFuturesProductionWorkstationUnsubscribeRequest,
} from '../utils/futuresProductionWorkstationProtocol.js'
import { DESK_FRAME_KINDS, ensureDeskFrameRouter } from '../utils/deskFrameRouter.js'
import {
  FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS,
  FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS,
  applyFuturesWorkstationEvent,
  transitionFuturesWorkstationConnectionState,
} from '../utils/futuresWorkstationProtocolShared.js'
import { readStoredTapeSettings } from '../utils/futuresTapeSettings.js'
import {
  FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS,
  FUTURES_CANDLE_HISTORY_INTERVAL_MS,
  futuresCandleHistoryCache,
} from '../utils/futuresCandleHistoryCache.js'

let requestSequence = 0

const createRequestId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `p8-${globalThis.crypto.randomUUID()}`
  }
  requestSequence += 1
  return `p8-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

const isOpenSocket = connection => connection?.readyState === 1

const emptyResources = () => Object.freeze({
  status: null,
  catalog: null,
  header: null,
  candles: null,
  candleHistory: null,
  depth: null,
  trades: null,
})

const EMPTY_CANDLE_HISTORY = Object.freeze({
  symbol: null,
  interval: null,
  rows: Object.freeze([]),
  exhausted: false,
})

// Older rows arrive in front of what is already loaded; an open time that is
// already known keeps the row already on the chart, so a re-read can never
// duplicate a bar or rewrite one the stream has since updated.
//
// The run is bounded by the same ceiling the disk cache applies, and the rows
// nearest the live end are the ones kept: a page is a thousand rows, so five
// scrolls put the renderer past a limit it was not enforcing anywhere. Past it
// the whole series is re-mapped, re-scaled and rewritten into two chart series
// on every frame that redraws — 1.1 ms at twenty thousand rows against 0.23 ms
// at the ceiling, for bars years behind the one being traded.
const mergeCandleHistoryRows = (older, known) => {
  if (known.length === 0) return Object.freeze(older.slice(-FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS))
  const oldest = known[0].openTime
  const merged = older.filter(row => row.openTime < oldest)
  if (merged.length === 0) return known
  return Object.freeze([...merged, ...known].slice(-FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS))
}

// The stream re-sends a bounded window of candles, and that window slides: when
// a bar opens, the oldest one in it is not in the next frame. History was read
// behind where the window stood at the time, so every bar that leaves the
// window afterwards is in neither run — and the chart drew the two sides
// against each other with nothing to say that minutes were missing between
// them. What leaves the window is kept here, at the end of the run it
// continues.
//
// Only when it continues it exactly. A window that jumped — a resync, a
// reconnection over a gap — leaves rows that do not touch what is on screen,
// and joining across that would present a hole as continuous data. Those are
// dropped, which is the state the chart was already in.
const holdRowsLeavingTheWindow = (held, leaving, oldestLive, intervalMs) => {
  const closed = leaving.filter(row => row.closed === true)
  if (closed.length === 0) return held
  if (!Number.isSafeInteger(intervalMs) || closed.at(-1).openTime + intervalMs !== oldestLive) {
    return held
  }
  if (held.length === 0) return Object.freeze(closed.slice(-FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS))
  const newest = held.at(-1).openTime
  const added = closed.filter(row => row.openTime > newest)
  if (added.length === 0) return held
  // The same contiguity, on the other side of the join: the run already held
  // has to reach the first row being added, or there is a hole behind them.
  if (newest + intervalMs !== added[0].openTime) return held
  return Object.freeze([...held, ...added].slice(-FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS))
}

// A page belongs to the contract and interval it was read for, and to nothing
// else. Merged into rows left over from a previous selection it would splice
// two markets — or two candle widths — into one series that still looks
// continuous: the chart would draw 15m bars in front of 1h bars and present the
// join as a gap in the market rather than as the mistake it is.
const applyCandleHistoryPage = (previous, { symbol, interval, rows, exhausted }) => {
  const base = previous.symbol === symbol && previous.interval === interval
    ? previous
    : EMPTY_CANDLE_HISTORY
  const merged = mergeCandleHistoryRows(rows, base.rows)
  // A page the run cannot hold — because it is full to its ceiling, or because
  // it did not reach behind what is already loaded — must not be asked for
  // again. The read is issued from the oldest row on the chart, so a page that
  // does not move that row would be requested, delivered and dropped for as
  // long as the operator sat at the left edge.
  const deepened = base.rows.length === 0 || merged[0].openTime < base.rows[0].openTime
  return Object.freeze({
    symbol,
    interval,
    exhausted: base.exhausted || exhausted || !deepened,
    rows: merged,
  })
}

const createState = ({ status, symbol, interval, requestId = null, reasonCode = null }) => (
  Object.freeze({
    status,
    environment: FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
    symbol,
    interval,
    requestId,
    generation: 0,
    revision: 0,
    observedAt: null,
    reasonCode,
    resources: emptyResources(),
  })
)

const useFuturesProductionWorkstation = ({
  enabled,
  symbol,
  interval,
  wsConnection,
  sendMessage,
  candleHistoryCache = futuresCandleHistoryCache,
}) => {
  const selectionRef = useRef(null)
  const catalogBufferRef = useRef(null)
  const activeSubscriptionRef = useRef(null)
  // Seeded from the persisted desk settings so a restored configuration is
  // re-sent on the first subscription, instead of the tape running at defaults
  // while the panel displays the restored values.
  const tapeSettingsRef = useRef(readStoredTapeSettings())
  // The reading the panel last stated, and the contract it stated it for. Held
  // rather than reset with the subscription, because the panel states it as the
  // contract opens — which is before the subscription that will carry it exists,
  // a child's effect running before its parent's. What was stated for the
  // contract being left is dropped by the symbol, not by the reset.
  const depthRangeRef = useRef(null)
  // What the current subscription was actually told, so a range restated
  // unchanged is not sent twice.
  const sentDepthRangeRef = useRef(null)
  const ownerRef = useRef(0)
  const historyRequestRef = useRef(null)
  const historySelectionRef = useRef(null)
  const [candleHistory, setCandleHistory] = useState(EMPTY_CANDLE_HISTORY)
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState(() => createState({
    status: enabled && isOpenSocket(wsConnection) ? 'loading' : enabled ? 'disconnected' : 'idle',
    symbol,
    interval,
  }))

  const retry = useCallback(() => {
    const activeSubscription = activeSubscriptionRef.current
    if (activeSubscription !== null) {
      try {
        activeSubscription.sendMessage(
          createFuturesProductionWorkstationUnsubscribeRequest({
            requestId: activeSubscription.requestId,
          }),
        )
      } catch {
        // A terminal backend owner may already be gone; the new request still owns recovery.
      }
    }
    selectionRef.current = null
    catalogBufferRef.current = null
    activeSubscriptionRef.current = null
    setRetryNonce(previous => previous + 1)
  }, [])

  // How far past the best price the rows on screen reach: how many of them,
  // times the step they are grouped by. The backend buys the book one page
  // deeper when the snapshot it holds does not prove that far, and opens a
  // contract on the cheapest page — a book bought as deep as the coarsest step
  // could ever want costs ten times a read at the finest.
  const sendDepthRange = useCallback((range, forSymbol) => {
    const activeSubscription = activeSubscriptionRef.current
    // Never to a subscription for another contract: the panel states the range
    // of the contract it is opening while the one it is leaving is still the
    // subscription on hand, and that range would buy a page for the wrong book.
    if (activeSubscription === null || activeSubscription.symbol !== forSymbol) return false
    if (sentDepthRangeRef.current === range) return false
    try {
      const sent = activeSubscription.sendMessage(
        createFuturesProductionWorkstationConfigureDepthRequest({
          requestId: activeSubscription.requestId,
          range,
        }),
      ) !== false
      if (sent) sentDepthRangeRef.current = range
      return sent
    } catch {
      return false
    }
  }, [])

  const configureDepth = useCallback((range) => {
    if (typeof range !== 'string') return false
    // Remembered whether or not it can be sent right now. A subscription that
    // arrives afterwards re-states it, so a contract opened before the panel
    // could speak still gets the page its rows need.
    depthRangeRef.current = Object.freeze({ symbol, range })
    return sendDepthRange(range, symbol)
  }, [sendDepthRange, symbol])

  const configureTape = useCallback((settings) => {
    const activeSubscription = activeSubscriptionRef.current
    if (activeSubscription === null) return false
    try {
      const sent = activeSubscription.sendMessage(
        createFuturesProductionWorkstationConfigureTapeRequest({
          requestId: activeSubscription.requestId,
          ...settings,
        }),
      ) !== false
      if (sent) tapeSettingsRef.current = Object.freeze({ ...settings })
      return sent
    } catch {
      return false
    }
  }, [])

  useEffect(() => () => {
    const activeSubscription = activeSubscriptionRef.current
    selectionRef.current = null
    catalogBufferRef.current = null
    activeSubscriptionRef.current = null
    if (activeSubscription === null) return
    try {
      activeSubscription.sendMessage(
        createFuturesProductionWorkstationUnsubscribeRequest({
          requestId: activeSubscription.requestId,
        }),
      )
    } catch {
      // Backend generation ownership already rejects late delivery.
    }
  }, [enabled, sendMessage, wsConnection])

  useEffect(() => {
    ownerRef.current += 1
    const owner = ownerRef.current
    let active = true
    const owned = () => active && ownerRef.current === owner

    if (!enabled) {
      selectionRef.current = null
      catalogBufferRef.current = null
      activeSubscriptionRef.current = null
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(createState({ status: 'idle', symbol, interval }))
      return () => { active = false }
    }
    if (!isOpenSocket(wsConnection)
      || typeof wsConnection?.addEventListener !== 'function'
      || typeof wsConnection?.removeEventListener !== 'function'
      || typeof sendMessage !== 'function') {
      selectionRef.current = null
      setState(previousState => Object.freeze({
        ...createState({ status: 'disconnected', symbol, interval }),
        resources: Object.freeze({
          ...emptyResources(),
          catalog: previousState.resources.catalog,
        }),
      }))
      return () => { active = false }
    }

    const requestId = createRequestId()
    catalogBufferRef.current = null
    // A new subscription owns a new contract or interval, so an in-flight read
    // for the previous one is abandoned here. The rows it already pulled in are
    // not carried over either: they are hidden from the moment the selection
    // changes, and the next page for the new selection replaces them outright.
    historyRequestRef.current = null
    historySelectionRef.current = null
    const previousSelection = selectionRef.current
    const previous = previousSelection?.connection === wsConnection
      ? previousSelection
      : null
    const intervalOnlyChange = previous !== null
      && previous.symbol === symbol
      && previous.interval !== interval
    const createRequest = previous === null
      ? createFuturesProductionWorkstationSubscribeRequest
      : previous.symbol !== symbol
        ? createFuturesProductionWorkstationSelectSymbolRequest
        : createFuturesProductionWorkstationSelectIntervalRequest
    selectionRef.current = Object.freeze({ connection: wsConnection, symbol, interval })
    setState((previousState) => {
      if (previous === null) {
        return Object.freeze({
          ...createState({ status: 'loading', symbol, interval, requestId }),
          resources: Object.freeze({
            ...emptyResources(),
            catalog: previousState.resources.catalog,
          }),
        })
      }
      if (!intervalOnlyChange) {
        return Object.freeze({
          ...createState({ status: 'loading', symbol, interval, requestId }),
          resources: Object.freeze({
            ...emptyResources(),
            catalog: previousState.resources.catalog,
          }),
        })
      }
      return Object.freeze({
        ...previousState,
        status: 'loading',
        interval,
        requestId,
        reasonCode: null,
        resources: Object.freeze({
          ...previousState.resources,
          status: null,
          candles: null,
        }),
      })
    })

    // Read and validated at the socket boundary, under the same protocol rules
    // this hook used to apply itself — the ownership guards below are what this
    // hook still owns, and they work on the typed event exactly as they did on
    // the one it parsed.
    const handleMessage = (frame) => {
      if (!owned()) return
      let message = frame?.payload
      if (message === undefined || message === null) return
      if (message.requestId !== requestId || message.symbol !== symbol) return
      if (message.resource === 'catalog') {
        const currentBuffer = catalogBufferRef.current
        const startsCatalog = message.payload.offset === 0
        const buffer = startsCatalog
          ? {
              generation: message.generation,
              total: message.payload.total,
              contracts: [],
            }
          : currentBuffer
        if (!buffer
          || buffer.generation !== message.generation
          || buffer.total !== message.payload.total
          || message.payload.offset !== buffer.contracts.length) {
          catalogBufferRef.current = null
          return
        }
        buffer.contracts.push(...message.payload.contracts)
        catalogBufferRef.current = buffer
        if (!message.payload.complete) return
        if (buffer.contracts.length !== buffer.total) {
          catalogBufferRef.current = null
          return
        }
        message = Object.freeze({
          ...message,
          payload: Object.freeze({
            offset: 0,
            total: buffer.total,
            complete: true,
            contracts: Object.freeze([...buffer.contracts]),
          }),
        })
        catalogBufferRef.current = null
      }
      setState((previousState) => {
        if (previousState.requestId !== requestId) return previousState
        if (message.generation < previousState.generation) return previousState
        if (message.generation === previousState.generation
          && message.revision <= previousState.revision) return previousState
        const next = applyFuturesWorkstationEvent(previousState, message)
        const preservesCatalog = message.resource === 'status'
          && message.state === 'loading'
        const resources = preservesCatalog
          ? Object.freeze({
              ...(intervalOnlyChange ? previousState.resources : next.resources),
              status: next.resources.status,
              catalog: previousState.resources.catalog,
            })
          : next.resources
        return Object.freeze({
          ...next,
          interval,
          resources,
          reasonCode: message.resource === 'status' ? message.payload.reasonCode : next.reasonCode,
        })
      })
    }
    const handleClose = () => {
      if (!owned()) return
      setState(previousState => transitionFuturesWorkstationConnectionState(
        previousState,
        'disconnected',
        'LOCAL_CONNECTION_CLOSED',
      ))
    }
    const handleError = () => {
      if (!owned()) return
      setState(previousState => transitionFuturesWorkstationConnectionState(
        previousState,
        'unavailable',
        'LOCAL_CONNECTION_ERROR',
      ))
    }

    const unsubscribe = ensureDeskFrameRouter(wsConnection)?.subscribe(
      DESK_FRAME_KINDS.WORKSTATION,
      handleMessage,
    ) ?? (() => {})
    wsConnection.addEventListener('close', handleClose)
    wsConnection.addEventListener('error', handleError)
    // The reading already stated for the contract being opened travels with the
    // request that opens it, so the first snapshot is bought against the rows
    // that will be drawn from it rather than against a range that arrives a
    // message later. A contract nothing has been stated for — the first of a
    // session, chosen before any book has been drawn — carries none and opens at
    // the cheapest page, as every contract did.
    const statedRange = depthRangeRef.current
    const openingRange = statedRange !== null && statedRange.symbol === symbol
      ? statedRange.range
      : undefined
    let sent = false
    try {
      sent = sendMessage(createRequest({
        requestId,
        symbol,
        interval,
        range: openingRange,
      })) !== false
    } catch {
      sent = false
    }
    if (!sent && owned()) {
      setState(previousState => Object.freeze({
        ...createState({
          status: 'unavailable',
          symbol,
          interval,
          requestId,
          reasonCode: 'LOCAL_SUBSCRIBE_REJECTED',
        }),
        resources: Object.freeze({
          ...emptyResources(),
          catalog: previousState.resources.catalog,
        }),
      }))
    } else if (sent) {
      activeSubscriptionRef.current = Object.freeze({ requestId, sendMessage, symbol })
      // What the subscription was opened with counts as stated, so a reading
      // that travelled with the request is not immediately restated as a second
      // message saying the same thing.
      sentDepthRangeRef.current = openingRange ?? null
      // Re-stated for the subscription that will carry it, the way the tape
      // settings below are: the panel states its reading when the reading
      // changes, and a new subscription for the same contract is not a change
      // it would notice.
      const depthRange = depthRangeRef.current
      if (depthRange !== null && depthRange.symbol === symbol) {
        sendDepthRange(depthRange.range, symbol)
      }
      const tapeSettings = tapeSettingsRef.current
      if (tapeSettings.throttleEnabled !== FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS.throttleEnabled
        || tapeSettings.timeoutMs !== FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS.timeoutMs
        || tapeSettings.minNotionalUsdt
          !== FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS.minNotionalUsdt) {
        try {
          sendMessage(createFuturesProductionWorkstationConfigureTapeRequest({
            requestId,
            ...tapeSettings,
          }))
        } catch {
          // The explicit UI action remains available to retry a rejected configuration.
        }
      }
    }

    return () => {
      active = false
      catalogBufferRef.current = null
      unsubscribe()
      wsConnection.removeEventListener('close', handleClose)
      wsConnection.removeEventListener('error', handleError)
    }
  }, [enabled, interval, retryNonce, sendDepthRange, sendMessage, symbol, wsConnection])

  // History is accumulated outside the resource snapshot: a resource is what the
  // exchange says now, while history is what the operator has already pulled
  // into view and must not lose to the next status transition.
  const historyResponse = state.resources.candleHistory
  useEffect(() => {
    if (!historyResponse?.complete) return
    const selection = historySelectionRef.current
    if (selection === null
      || selection.symbol !== state.symbol
      || selection.interval !== historyResponse.interval) return
    if (selection.endTime !== historyResponse.endTime) return
    historyRequestRef.current = null
    // Written back so the next run of the app starts where this one left off.
    void candleHistoryCache.writePage({
      symbol: state.symbol,
      interval: historyResponse.interval,
      rows: historyResponse.rows,
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandleHistory(previous => applyCandleHistoryPage(previous, {
      symbol: state.symbol,
      interval: historyResponse.interval,
      rows: historyResponse.rows,
      // A short answer is the exchange saying there is nothing older.
      exhausted: historyResponse.total < FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS.DEFAULT_ROWS,
    }))
  }, [candleHistoryCache, historyResponse, state.symbol])

  // The window the stream re-sends, watched for what falls off its front. Held
  // rather than derived, because a frame carries only where the window is now —
  // the bar that left is gone from it, and this is the last place it exists.
  const liveWindowRef = useRef(null)
  const liveCandles = state.resources.candles?.contract ?? null
  const liveInterval = state.resources.candles?.interval ?? null
  useEffect(() => {
    const previousWindow = liveWindowRef.current
    liveWindowRef.current = liveCandles === null
      ? null
      : { symbol: state.symbol, interval: liveInterval, rows: liveCandles }
    if (!Array.isArray(liveCandles) || liveCandles.length === 0) return
    if (previousWindow === null
      || previousWindow.symbol !== state.symbol
      || previousWindow.interval !== liveInterval) return
    const oldestLive = liveCandles[0].openTime
    const leaving = previousWindow.rows.filter(row => row.openTime < oldestLive)
    if (leaving.length === 0) return
    const intervalMs = FUTURES_CANDLE_HISTORY_INTERVAL_MS[liveInterval]
    setCandleHistory((previous) => {
      const base = previous.symbol === state.symbol && previous.interval === liveInterval
        ? previous
        : EMPTY_CANDLE_HISTORY
      const rows = holdRowsLeavingTheWindow(base.rows, leaving, oldestLive, intervalMs)
      if (rows === base.rows) return previous
      return Object.freeze({ ...base, symbol: state.symbol, interval: liveInterval, rows })
    })
  }, [liveCandles, liveInterval, state.symbol])

  const loadCandleHistory = useCallback(async (endTime) => {
    const activeSubscription = activeSubscriptionRef.current
    if (activeSubscription === null) return false
    if (!Number.isSafeInteger(endTime) || endTime <= 0) return false
    // One read at a time: the left edge fires continuously while scrolling.
    if (historyRequestRef.current !== null) return false
    const limit = FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS.DEFAULT_ROWS
    const selection = { symbol, interval, endTime }
    historyRequestRef.current = selection
    historySelectionRef.current = selection

    // A candle that has closed cannot change, so a page already held is the
    // same page the exchange would send — and asking for it again would cost a
    // round trip on a link that is the slowest part of this desk.
    const cached = await candleHistoryCache.readPage({ symbol, interval, endTime, limit })
    if (historyRequestRef.current !== selection) return false
    if (cached !== null && cached.length > 0) {
      historyRequestRef.current = null
      setCandleHistory(previous => applyCandleHistoryPage(previous, {
        symbol,
        interval,
        rows: cached,
        exhausted: cached.length < limit,
      }))
      return true
    }

    try {
      const sent = activeSubscription.sendMessage(
        createFuturesProductionWorkstationLoadCandleHistoryRequest({
          requestId: activeSubscription.requestId,
          symbol,
          interval,
          endTime,
          limit,
        }),
      ) !== false
      if (!sent) historyRequestRef.current = null
      return sent
    } catch {
      historyRequestRef.current = null
      return false
    }
  }, [candleHistoryCache, interval, symbol])

  return {
    ...state,
    candleHistory: candleHistory.symbol === symbol && candleHistory.interval === interval
      ? candleHistory
      : EMPTY_CANDLE_HISTORY,
    retry,
    configureTape,
    configureDepth,
    loadCandleHistory,
  }
}

export default useFuturesProductionWorkstation
export { useFuturesProductionWorkstation }
