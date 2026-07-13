import { useCallback, useEffect, useRef, useState } from 'react'
import {
  compareFuturesTestnetExecutionRevisions,
  createFuturesTestnetExecutionPlaceOrderRequest,
  createFuturesTestnetExecutionPrepareIntentRequest,
  createFuturesTestnetExecutionSubscribeStatusRequest,
  createFuturesTestnetExecutionUnsubscribeStatusRequest,
  parseFuturesTestnetExecutionStatus,
} from '../utils/futuresTestnetExecutionProtocol.js'

const isOpenSocket = (connection) => {
  const openState = globalThis.WebSocket?.OPEN ?? 1
  return connection?.readyState === openState
}

const createLifecycleState = ({ enabled, connection }) => ({
  connected: Boolean(enabled && isOpenSocket(connection)),
  subscribed: false,
  submissionLocked: false,
  revision: null,
  symbol: null,
  capability: null,
  intent: null,
  attempt: null,
})

const useFuturesTestnetExecution = ({
  enabled,
  symbol,
  wsConnection,
} = {}) => {
  const generationRef = useRef(0)
  const revisionRef = useRef(null)
  const snapshotRef = useRef(null)
  const subscribedRef = useRef(false)
  const submissionLockRef = useRef(false)
  const consumedIntentIdsRef = useRef(new Set())
  const [state, setState] = useState(() => createLifecycleState({
    enabled,
    connection: wsConnection,
  }))

  const releaseSubmissionLock = useCallback(() => {
    submissionLockRef.current = false
    setState((previous) => (
      previous.submissionLocked ? { ...previous, submissionLocked: false } : previous
    ))
  }, [])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    revisionRef.current = null
    snapshotRef.current = null
    subscribedRef.current = false
    submissionLockRef.current = false
    let active = true
    let subscriptionSent = false

    const isCurrentGeneration = () => active && generationRef.current === generation
    const reset = createLifecycleState({ enabled, connection: wsConnection })

    if (!enabled
      || typeof symbol !== 'string'
      || !isOpenSocket(wsConnection)
      || typeof wsConnection?.send !== 'function'
      || typeof wsConnection?.addEventListener !== 'function'
      || typeof wsConnection?.removeEventListener !== 'function') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(reset)
      return () => {
        active = false
      }
    }

    const handleMessage = (event) => {
      if (!isCurrentGeneration()) return
      let status
      try {
        status = parseFuturesTestnetExecutionStatus(event?.data)
      } catch {
        return
      }
      if (status.symbol !== symbol) return
      if (status.intent !== null && consumedIntentIdsRef.current.has(status.intent.requestId)) return
      if (revisionRef.current !== null
        && compareFuturesTestnetExecutionRevisions(status.revision, revisionRef.current) <= 0) {
        return
      }

      revisionRef.current = status.revision
      snapshotRef.current = status
      submissionLockRef.current = false
      setState({
        connected: true,
        subscribed: true,
        submissionLocked: false,
        revision: status.revision,
        symbol: status.symbol,
        capability: status.capability,
        intent: status.intent,
        attempt: status.attempt,
      })
    }

    const handleClose = () => {
      if (!isCurrentGeneration()) return
      subscribedRef.current = false
      submissionLockRef.current = false
      setState((previous) => ({
        ...previous,
        connected: false,
        subscribed: false,
        submissionLocked: false,
      }))
      active = false
    }

    const handleError = () => {
      if (!isCurrentGeneration()) return
      subscribedRef.current = false
      submissionLockRef.current = false
      setState((previous) => ({
        ...previous,
        connected: false,
        subscribed: false,
        submissionLocked: false,
      }))
    }

    wsConnection.addEventListener('message', handleMessage)
    wsConnection.addEventListener('close', handleClose)
    wsConnection.addEventListener('error', handleError)

    try {
      wsConnection.send(JSON.stringify(
        createFuturesTestnetExecutionSubscribeStatusRequest({ symbol }),
      ))
      subscriptionSent = true
      subscribedRef.current = true
      setState({ ...reset, connected: true, subscribed: true })
    } catch {
      active = false
      setState(reset)
    }

    return () => {
      active = false
      subscribedRef.current = false
      submissionLockRef.current = false
      wsConnection.removeEventListener('message', handleMessage)
      wsConnection.removeEventListener('close', handleClose)
      wsConnection.removeEventListener('error', handleError)
      if (subscriptionSent && isOpenSocket(wsConnection)) {
        try {
          wsConnection.send(JSON.stringify(
            createFuturesTestnetExecutionUnsubscribeStatusRequest({
              symbol,
              revision: revisionRef.current ?? '0',
            }),
          ))
        } catch {
          // Backend session ownership is already revoked locally.
        }
      }
    }
  }, [enabled, symbol, wsConnection])

  const sendGuardedRequest = useCallback((createRequest, { consumeIntentId = null } = {}) => {
    if (!enabled
      || !subscribedRef.current
      || submissionLockRef.current
      || !isOpenSocket(wsConnection)
      || typeof wsConnection?.send !== 'function') {
      return false
    }

    submissionLockRef.current = true
    setState((previous) => ({ ...previous, submissionLocked: true }))
    try {
      const request = createRequest()
      wsConnection.send(JSON.stringify(request))
      if (consumeIntentId !== null) {
        const consumed = consumedIntentIdsRef.current
        consumed.add(consumeIntentId)
        if (consumed.size > 32) consumed.delete(consumed.values().next().value)
      }
      return true
    } catch {
      releaseSubmissionLock()
      return false
    }
  }, [enabled, releaseSubmissionLock, wsConnection])

  const prepareIntent = useCallback(() => {
    const snapshot = snapshotRef.current
    if (snapshot?.capability?.enabled !== true || snapshot.intent !== null) return false
    return sendGuardedRequest(() => (
      createFuturesTestnetExecutionPrepareIntentRequest({
        symbol,
        revision: snapshot.revision,
      })
    ))
  }, [sendGuardedRequest, symbol])

  const placeOrder = useCallback(({ quantity, price } = {}) => {
    const snapshot = snapshotRef.current
    const intent = snapshot?.intent
    if (snapshot?.capability?.enabled !== true || intent === null || intent === undefined) return false
    return sendGuardedRequest(() => createFuturesTestnetExecutionPlaceOrderRequest({
      intent,
      symbol,
      quantity,
      price,
    }), { consumeIntentId: intent.requestId })
  }, [sendGuardedRequest, symbol])

  return {
    ...state,
    prepareIntent,
    placeOrder,
  }
}

export default useFuturesTestnetExecution
export { useFuturesTestnetExecution }
