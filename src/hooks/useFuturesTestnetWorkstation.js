import { useEffect, useRef, useState } from 'react'
import {
  FUTURES_TESTNET_WORKSTATION_ENVIRONMENT,
  createFuturesTestnetWorkstationSelectIntervalRequest,
  createFuturesTestnetWorkstationSelectSymbolRequest,
  createFuturesTestnetWorkstationSubscribeRequest,
  createFuturesTestnetWorkstationUnsubscribeRequest,
  parseFuturesTestnetWorkstationEvent,
} from '../utils/futuresTestnetWorkstationProtocol.js'
import {
  applyFuturesWorkstationEvent,
} from '../utils/futuresWorkstationProtocolShared.js'

let requestSequence = 0

const createRequestId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `t8-${globalThis.crypto.randomUUID()}`
  }
  requestSequence += 1
  return `t8-${Date.now().toString(36)}-${requestSequence.toString(36)}`
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
    environment: FUTURES_TESTNET_WORKSTATION_ENVIRONMENT,
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

const useFuturesTestnetWorkstation = ({
  enabled,
  symbol,
  interval,
  wsConnection,
  sendMessage,
}) => {
  const selectionRef = useRef(null)
  const ownerRef = useRef(0)
  const [state, setState] = useState(() => createState({
    status: enabled && isOpenSocket(wsConnection) ? 'loading' : enabled ? 'disconnected' : 'idle',
    symbol,
    interval,
  }))

  useEffect(() => {
    ownerRef.current += 1
    const owner = ownerRef.current
    let active = true
    const owned = () => active && ownerRef.current === owner

    if (!enabled) {
      selectionRef.current = null
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
    const previous = selectionRef.current
    const createRequest = previous === null
      ? createFuturesTestnetWorkstationSubscribeRequest
      : previous.symbol !== symbol
        ? createFuturesTestnetWorkstationSelectSymbolRequest
        : createFuturesTestnetWorkstationSelectIntervalRequest
    selectionRef.current = Object.freeze({ symbol, interval })
    setState(createState({ status: 'loading', symbol, interval, requestId }))

    const handleMessage = (event) => {
      if (!owned()) return
      let message
      try {
        message = parseFuturesTestnetWorkstationEvent(event?.data)
      } catch {
        return
      }
      if (message.requestId !== requestId || message.symbol !== symbol) return
      setState((previousState) => {
        if (previousState.requestId !== requestId) return previousState
        if (message.generation < previousState.generation) return previousState
        if (message.generation === previousState.generation
          && message.revision <= previousState.revision) return previousState
        const next = applyFuturesWorkstationEvent(previousState, message)
        return Object.freeze({
          ...next,
          interval,
          reasonCode: message.resource === 'status' ? message.payload.reasonCode : next.reasonCode,
        })
      })
    }
    const handleClose = () => {
      if (!owned()) return
      setState(previousState => Object.freeze({
        ...previousState,
        status: 'disconnected',
        reasonCode: 'LOCAL_CONNECTION_CLOSED',
      }))
    }
    const handleError = () => {
      if (!owned()) return
      setState(previousState => Object.freeze({
        ...previousState,
        status: 'unavailable',
        reasonCode: 'LOCAL_CONNECTION_ERROR',
      }))
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
    }

    return () => {
      active = false
      wsConnection.removeEventListener('message', handleMessage)
      wsConnection.removeEventListener('close', handleClose)
      wsConnection.removeEventListener('error', handleError)
      if (sent) {
        try {
          sendMessage(createFuturesTestnetWorkstationUnsubscribeRequest({ requestId }))
        } catch {
          // Backend generation ownership already rejects late delivery.
        }
      }
    }
  }, [enabled, interval, sendMessage, symbol, wsConnection])

  return state
}

export default useFuturesTestnetWorkstation
export { useFuturesTestnetWorkstation }
