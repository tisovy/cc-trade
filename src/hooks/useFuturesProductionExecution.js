import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
  compareFuturesProductionExecutionRevisions,
  createFuturesProductionExecutionCancelAllOpenOrdersRequest,
  createFuturesProductionExecutionClosePositionsRequest,
  createFuturesProductionExecutionDisengageKillSwitchRequest,
  createFuturesProductionExecutionEngageKillSwitchRequest,
  createFuturesProductionExecutionPlaceOrderRequest,
  createFuturesProductionExecutionPrepareCancelAllOpenOrdersIntentRequest,
  createFuturesProductionExecutionPrepareClosePositionsIntentRequest,
  createFuturesProductionExecutionPrepareDisengageKillSwitchIntentRequest,
  createFuturesProductionExecutionPrepareEngageKillSwitchIntentRequest,
  createFuturesProductionExecutionPrepareOrderIntentRequest,
  createFuturesProductionExecutionSubscribeStatusRequest,
  createFuturesProductionExecutionUnsubscribeStatusRequest,
  parseFuturesProductionExecutionStatus,
} from '../utils/futuresProductionExecutionProtocol.js'

const BOOTSTRAP_ACCOUNT_FINGERPRINT = '0'.repeat(64)

const isOpenSocket = (connection) => {
  const openState = globalThis.WebSocket?.OPEN ?? 1
  return connection?.readyState === openState
}

const isUsableSocket = (connection) => isOpenSocket(connection)
  && typeof connection?.send === 'function'
  && typeof connection?.addEventListener === 'function'
  && typeof connection?.removeEventListener === 'function'

const createLifecycleState = ({ enabled, connection }) => ({
  connected: Boolean(enabled && isUsableSocket(connection)),
  subscribed: false,
  submissionLocked: false,
  revision: null,
  mode: null,
  liveAuthorized: null,
  configured: null,
  account: null,
  caps: null,
  killSwitch: null,
  capabilities: null,
  intent: null,
  attempt: null,
  reconciliation: null,
  recovery: null,
})

const capabilityForIntentKind = Object.freeze({
  [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER]: 'placeOrder',
  [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS]: 'cancelAllOpenOrders',
  [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS]: 'closePositions',
  [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH]: 'engageKillSwitch',
  [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH]: 'disengageKillSwitch',
})

const useFuturesProductionExecution = ({
  enabled,
  wsConnection,
} = {}) => {
  const generationRef = useRef(0)
  const revisionRef = useRef(null)
  const snapshotRef = useRef(null)
  const accountFingerprintRef = useRef(null)
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
    accountFingerprintRef.current = null
    subscribedRef.current = false
    submissionLockRef.current = false
    consumedIntentIdsRef.current = new Set()
    let active = true
    let subscriptionSent = false

    const isCurrentGeneration = () => active && generationRef.current === generation
    const reset = createLifecycleState({ enabled, connection: wsConnection })

    if (!enabled
      || !isUsableSocket(wsConnection)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((previous) => (
        Object.keys(reset).every((key) => previous[key] === reset[key]) ? previous : reset
      ))
      return () => {
        active = false
      }
    }

    const handleMessage = (event) => {
      if (!isCurrentGeneration()) return
      let status
      try {
        status = parseFuturesProductionExecutionStatus(event?.data)
      } catch {
        return
      }

      const receivedFingerprint = status.account?.fingerprint ?? null
      if (receivedFingerprint !== null
        && accountFingerprintRef.current !== null
        && receivedFingerprint !== accountFingerprintRef.current) {
        return
      }
      if (status.intent !== null && consumedIntentIdsRef.current.has(status.intent.requestId)) return
      if (revisionRef.current !== null
        && compareFuturesProductionExecutionRevisions(status.revision, revisionRef.current) <= 0) {
        return
      }

      if (receivedFingerprint !== null) accountFingerprintRef.current = receivedFingerprint
      revisionRef.current = status.revision
      snapshotRef.current = status
      submissionLockRef.current = false
      setState({
        connected: true,
        subscribed: true,
        submissionLocked: false,
        revision: status.revision,
        mode: status.mode,
        liveAuthorized: status.liveAuthorized,
        configured: status.configured,
        account: status.account,
        caps: status.caps,
        killSwitch: status.killSwitch,
        capabilities: status.capabilities,
        intent: status.intent,
        attempt: status.attempt,
        reconciliation: status.reconciliation,
        recovery: status.recovery,
      })
    }

    const retireConnection = () => {
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

    const handleClose = () => {
      retireConnection()
      active = false
    }

    const handleError = () => {
      retireConnection()
      active = false
    }

    wsConnection.addEventListener('message', handleMessage)
    wsConnection.addEventListener('close', handleClose)
    wsConnection.addEventListener('error', handleError)

    try {
      wsConnection.send(JSON.stringify(
        createFuturesProductionExecutionSubscribeStatusRequest({
          accountFingerprint: BOOTSTRAP_ACCOUNT_FINGERPRINT,
        }),
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
            createFuturesProductionExecutionUnsubscribeStatusRequest({
              revision: revisionRef.current ?? '0',
              accountFingerprint: BOOTSTRAP_ACCOUNT_FINGERPRINT,
            }),
          ))
        } catch {
          // Renderer ownership is already revoked; teardown never implies cancellation.
        }
      }
    }
  }, [enabled, wsConnection])

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
      wsConnection.send(JSON.stringify(createRequest()))
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

  const prepare = useCallback((kind, createRequest) => {
    const snapshot = snapshotRef.current
    const capability = capabilityForIntentKind[kind]
    const accountFingerprint = snapshot?.account?.fingerprint
    if (typeof capability !== 'string'
      || snapshot?.capabilities?.[capability] !== true
      || snapshot.intent !== null
      || typeof accountFingerprint !== 'string') {
      return false
    }
    return sendGuardedRequest(() => createRequest({
      revision: snapshot.revision,
      accountFingerprint,
    }))
  }, [sendGuardedRequest])

  const finalize = useCallback((kind, createRequest, confirmation) => {
    const snapshot = snapshotRef.current
    const capability = capabilityForIntentKind[kind]
    const intent = snapshot?.intent
    const accountFingerprint = snapshot?.account?.fingerprint
    if (typeof capability !== 'string'
      || snapshot?.capabilities?.[capability] !== true
      || intent?.kind !== kind
      || typeof accountFingerprint !== 'string') {
      return false
    }
    return sendGuardedRequest(() => createRequest({
      intent,
      accountFingerprint,
      confirmation,
    }), { consumeIntentId: intent.requestId })
  }, [sendGuardedRequest])

  const prepareOrderIntent = useCallback((draft) => prepare(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
    (identity) => createFuturesProductionExecutionPrepareOrderIntentRequest({
      ...identity,
      symbol: draft?.symbol,
      side: draft?.side,
      quantity: draft?.quantity,
      price: draft?.price,
      reduceOnly: draft?.reduceOnly,
    }),
  ), [prepare])

  const placeOrder = useCallback((confirmation) => finalize(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
    createFuturesProductionExecutionPlaceOrderRequest,
    confirmation,
  ), [finalize])

  const prepareCancelAllOpenOrdersIntent = useCallback(() => prepare(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
    createFuturesProductionExecutionPrepareCancelAllOpenOrdersIntentRequest,
  ), [prepare])

  const cancelAllOpenOrders = useCallback((confirmation) => finalize(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
    createFuturesProductionExecutionCancelAllOpenOrdersRequest,
    confirmation,
  ), [finalize])

  const prepareClosePositionsIntent = useCallback(() => prepare(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
    createFuturesProductionExecutionPrepareClosePositionsIntentRequest,
  ), [prepare])

  const closePositions = useCallback((confirmation) => finalize(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
    createFuturesProductionExecutionClosePositionsRequest,
    confirmation,
  ), [finalize])

  const prepareEngageKillSwitchIntent = useCallback(() => prepare(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
    createFuturesProductionExecutionPrepareEngageKillSwitchIntentRequest,
  ), [prepare])

  const engageKillSwitch = useCallback((confirmation) => finalize(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
    createFuturesProductionExecutionEngageKillSwitchRequest,
    confirmation,
  ), [finalize])

  const prepareDisengageKillSwitchIntent = useCallback(() => prepare(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
    createFuturesProductionExecutionPrepareDisengageKillSwitchIntentRequest,
  ), [prepare])

  const disengageKillSwitch = useCallback((confirmation) => finalize(
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
    createFuturesProductionExecutionDisengageKillSwitchRequest,
    confirmation,
  ), [finalize])

  return {
    ...state,
    prepareOrderIntent,
    placeOrder,
    prepareCancelAllOpenOrdersIntent,
    cancelAllOpenOrders,
    prepareClosePositionsIntent,
    closePositions,
    prepareEngageKillSwitchIntent,
    engageKillSwitch,
    prepareDisengageKillSwitchIntent,
    disengageKillSwitch,
  }
}

export default useFuturesProductionExecution
export { BOOTSTRAP_ACCOUNT_FINGERPRINT, useFuturesProductionExecution }
