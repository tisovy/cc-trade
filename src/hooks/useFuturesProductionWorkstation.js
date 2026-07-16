import { useEffect, useRef, useState } from 'react'
import {
  FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
  createFuturesProductionWorkstationSelectIntervalRequest,
  createFuturesProductionWorkstationSelectSymbolRequest,
  createFuturesProductionWorkstationSubscribeRequest,
  createFuturesProductionWorkstationUnsubscribeRequest,
  parseFuturesProductionWorkstationEvent,
} from '../utils/futuresProductionWorkstationProtocol.js'
import {
  applyFuturesWorkstationEvent,
  transitionFuturesWorkstationConnectionState,
} from '../utils/futuresWorkstationProtocolShared.js'

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
  depth: null,
  trades: null,
})

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
}) => {
  const selectionRef = useRef(null)
  const catalogBufferRef = useRef(null)
  const activeSubscriptionRef = useRef(null)
  const ownerRef = useRef(0)
  const [state, setState] = useState(() => createState({
    status: enabled && isOpenSocket(wsConnection) ? 'loading' : enabled ? 'disconnected' : 'idle',
    symbol,
    interval,
  }))

  useEffect(() => () => {
    const activeSubscription = activeSubscriptionRef.current
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
      setState(createState({ status: 'disconnected', symbol, interval }))
      return () => { active = false }
    }

    const requestId = createRequestId()
    catalogBufferRef.current = null
    const previous = selectionRef.current
    const intervalOnlyChange = previous !== null
      && previous.symbol === symbol
      && previous.interval !== interval
    const createRequest = previous === null
      ? createFuturesProductionWorkstationSubscribeRequest
      : previous.symbol !== symbol
        ? createFuturesProductionWorkstationSelectSymbolRequest
        : createFuturesProductionWorkstationSelectIntervalRequest
    selectionRef.current = Object.freeze({ symbol, interval })
    setState((previousState) => {
      if (!intervalOnlyChange) {
        return createState({ status: 'loading', symbol, interval, requestId })
      }
      const markStale = resource => resource === null
        ? null
        : Object.freeze({ ...resource, state: 'stale' })
      return Object.freeze({
        ...previousState,
        status: 'loading',
        interval,
        requestId,
        reasonCode: null,
        resources: Object.freeze({
          ...previousState.resources,
          status: null,
          header: markStale(previousState.resources.header),
          candles: null,
          depth: markStale(previousState.resources.depth),
          trades: markStale(previousState.resources.trades),
        }),
      })
    })

    const handleMessage = (event) => {
      if (!owned()) return
      let message
      try {
        message = parseFuturesProductionWorkstationEvent(event?.data)
      } catch {
        return
      }
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
        const resources = intervalOnlyChange
          && message.resource === 'status'
          && message.state === 'loading'
          ? Object.freeze({
              ...previousState.resources,
              status: next.resources.status,
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

    wsConnection.addEventListener('message', handleMessage)
    wsConnection.addEventListener('close', handleClose)
    wsConnection.addEventListener('error', handleError)
    let sent = false
    try {
      sent = sendMessage(createRequest({ requestId, symbol, interval })) !== false
    } catch {
      sent = false
    }
    if (!sent && owned()) {
      setState(createState({
        status: 'unavailable',
        symbol,
        interval,
        requestId,
        reasonCode: 'LOCAL_SUBSCRIBE_REJECTED',
      }))
    } else if (sent) {
      activeSubscriptionRef.current = Object.freeze({ requestId, sendMessage })
    }

    return () => {
      active = false
      catalogBufferRef.current = null
      wsConnection.removeEventListener('message', handleMessage)
      wsConnection.removeEventListener('close', handleClose)
      wsConnection.removeEventListener('error', handleError)
    }
  }, [enabled, interval, sendMessage, symbol, wsConnection])

  return state
}

export default useFuturesProductionWorkstation
export { useFuturesProductionWorkstation }
