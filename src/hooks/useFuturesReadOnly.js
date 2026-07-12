import { useEffect, useRef, useState } from 'react'
import {
  FUTURES_MARKET_TYPE,
  FUTURES_READ_CHANNEL_ID,
  FUTURES_READ_ENVIRONMENTS,
  FUTURES_READ_PROTOCOL_VERSION,
  FUTURES_READ_RESPONSE_TYPES,
  createFuturesReadSubscribeRequest,
  createFuturesReadUnsubscribeRequest,
  parseFuturesReadMessage,
} from '../utils/futuresReadOnlyProtocol.js'

const SNAPSHOT_STATUSES = new Set([
  'loading',
  'ready',
  'partial',
  'unavailable',
  'stale',
  'disconnected',
  'error',
])

const RESOURCE_STATUSES = new Set([
  'loading',
  'ready',
  'empty',
  'unavailable',
  'stale',
  'disconnected',
  'error',
])

const RESOURCE_KEYS = Object.freeze([
  'exchangeInfo',
  'market',
  'positions',
  'marginBalance',
  'openOrders',
  'algoOpenOrders',
])

const SNAPSHOT_KEYS = Object.freeze([
  'status',
  'connected',
  'symbol',
  'environment',
  'resources',
])

const RESOURCE_STATE_KEYS = Object.freeze([
  'status',
  'data',
  'lastUpdatedAt',
  'errorCode',
])

const EXCHANGE_INFO_KEYS = Object.freeze([
  'marketType',
  'symbol',
  'pair',
  'contractType',
  'status',
  'assets',
  'filters',
  'supportedOrderTypes',
  'supportedTimeInForce',
])

const MARGIN_BALANCE_KEYS = Object.freeze([
  'marketType',
  'accountAlias',
  'asset',
  'balance',
  'crossWalletBalance',
  'crossUnPnl',
  'availableBalance',
  'maxWithdrawAmount',
  'marginAvailable',
  'updateTime',
])

const POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT'])
const ARRAY_RESOURCE_KEYS = new Set(['positions', 'openOrders', 'algoOpenOrders'])

let requestSequence = 0

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (value, keys) => {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const isExactString = (value) => typeof value === 'string' && value.length > 0 && value.trim() === value

const isOpenSocket = (wsConnection) => {
  const openState = globalThis.WebSocket?.OPEN ?? 1
  return wsConnection?.readyState === openState
}

const createOpaqueRequestId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  requestSequence += 1
  return `futures-read-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

const createLifecycleState = ({
  status,
  environment,
  symbol = null,
  requestId = null,
  errorCode = null,
}) => ({
  status,
  connected: false,
  symbol,
  environment,
  resources: null,
  requestId,
  errorCode,
})

const createInitialState = (enabled, symbol, wsConnection, environment) => {
  if (!enabled) return createLifecycleState({ status: 'idle', environment })
  if (!isExactString(symbol)) {
    return createLifecycleState({
      status: 'unavailable',
      environment,
      errorCode: 'FUTURES_READ_INVALID_SYMBOL',
    })
  }
  return createLifecycleState({
    status: isOpenSocket(wsConnection) ? 'loading' : 'disconnected',
    symbol,
    environment,
  })
}

const isExactStringOrNull = (value) => value === null || isExactString(value)

const isSafeTimestamp = (value) => Number.isSafeInteger(value) && value >= 0

const isStringArray = (value) => Array.isArray(value) && value.every(isExactString)

const hasFuturesIdentity = (value, symbol) => (
  isRecord(value)
  && value.marketType === FUTURES_MARKET_TYPE
  && value.symbol === symbol
)

const isRangeFilter = (value, stepKey) => (
  value === null
  || (hasExactKeys(value, ['min', 'max', stepKey])
    && isExactString(value.min)
    && isExactString(value.max)
    && isExactString(value[stepKey]))
)

const isExchangeInfo = (value, symbol) => (
  hasExactKeys(value, EXCHANGE_INFO_KEYS)
  && hasFuturesIdentity(value, symbol)
  && isExactString(value.pair)
  && isExactString(value.contractType)
  && isExactString(value.status)
  && hasExactKeys(value.assets, ['base', 'quote', 'margin'])
  && isExactString(value.assets.base)
  && isExactString(value.assets.quote)
  && value.assets.margin === 'USDT'
  && hasExactKeys(value.filters, ['price', 'quantity', 'marketQuantity', 'minimumNotional'])
  && isRangeFilter(value.filters.price, 'tickSize')
  && isRangeFilter(value.filters.quantity, 'stepSize')
  && isRangeFilter(value.filters.marketQuantity, 'stepSize')
  && isExactStringOrNull(value.filters.minimumNotional)
  && isStringArray(value.supportedOrderTypes)
  && isStringArray(value.supportedTimeInForce)
)

const isMarketState = (value, symbol) => {
  if (!hasExactKeys(value, ['markPrice', 'fundingState'])) return false
  const { markPrice, fundingState } = value
  return hasExactKeys(markPrice, [
    'marketType',
    'symbol',
    'markPrice',
    'indexPrice',
    'estimatedSettlePrice',
    'time',
  ])
    && hasFuturesIdentity(markPrice, symbol)
    && isExactString(markPrice.markPrice)
    && isExactString(markPrice.indexPrice)
    && isExactString(markPrice.estimatedSettlePrice)
    && isSafeTimestamp(markPrice.time)
    && hasExactKeys(fundingState, [
      'marketType',
      'symbol',
      'lastFundingRate',
      'interestRate',
      'nextFundingTime',
      'time',
    ])
    && hasFuturesIdentity(fundingState, symbol)
    && isExactString(fundingState.lastFundingRate)
    && isExactStringOrNull(fundingState.interestRate)
    && isSafeTimestamp(fundingState.nextFundingTime)
    && isSafeTimestamp(fundingState.time)
}

const isPosition = (value, symbol) => (
  hasFuturesIdentity(value, symbol)
  && POSITION_SIDES.has(value.positionSide)
  && value.marginAsset === 'USDT'
  && isExactString(value.positionAmt)
  && isExactString(value.unRealizedProfit)
  && isExactString(value.liquidationPrice)
)

const isMarginBalance = (value) => (
  hasExactKeys(value, MARGIN_BALANCE_KEYS)
  && value.marketType === FUTURES_MARKET_TYPE
  && isExactString(value.accountAlias)
  && value.asset === 'USDT'
  && [
    value.balance,
    value.crossWalletBalance,
    value.crossUnPnl,
    value.availableBalance,
    value.maxWithdrawAmount,
  ].every(isExactString)
  && typeof value.marginAvailable === 'boolean'
  && isSafeTimestamp(value.updateTime)
)

const isIdentityArray = (value, symbol) => (
  Array.isArray(value) && value.every((row) => hasFuturesIdentity(row, symbol))
)

const isValidResourceData = (key, data, symbol) => {
  if (data === null) return true
  if (key === 'exchangeInfo') return isExchangeInfo(data, symbol)
  if (key === 'market') return isMarketState(data, symbol)
  if (key === 'positions') {
    return isIdentityArray(data, symbol) && data.every((position) => isPosition(position, symbol))
  }
  if (key === 'marginBalance') return isMarginBalance(data)
  if (key === 'openOrders' || key === 'algoOpenOrders') return isIdentityArray(data, symbol)
  return false
}

const isValidResourceState = (resource, key, symbol) => {
  if (!hasExactKeys(resource, RESOURCE_STATE_KEYS) || !RESOURCE_STATUSES.has(resource.status)) return false
  if (resource.lastUpdatedAt !== null
    && (!Number.isSafeInteger(resource.lastUpdatedAt) || resource.lastUpdatedAt < 0)) return false
  if (resource.errorCode !== null && !isExactString(resource.errorCode)) return false
  if (!isValidResourceData(key, resource.data, symbol)) return false
  if (resource.status === 'loading') return resource.data === null && resource.lastUpdatedAt === null
  if (resource.status === 'ready' || resource.status === 'stale') return resource.data !== null
  if (resource.status === 'empty') {
    return ARRAY_RESOURCE_KEYS.has(key) && Array.isArray(resource.data) && resource.data.length === 0
  }
  return true
}

const isValidSnapshotPayload = (payload, symbol, environment) => {
  if (!hasExactKeys(payload, SNAPSHOT_KEYS)
    || !SNAPSHOT_STATUSES.has(payload.status)
    || typeof payload.connected !== 'boolean'
    || payload.symbol !== symbol
    || payload.environment !== environment
    || !hasExactKeys(payload.resources, RESOURCE_KEYS)) {
    return false
  }

  return RESOURCE_KEYS.every((key) => isValidResourceState(payload.resources[key], key, symbol))
}

const useFuturesReadOnly = ({
  enabled,
  symbol,
  environment = FUTURES_READ_ENVIRONMENTS.MOCK,
  wsConnection,
  sendMessage,
}) => {
  const expectedEnvironment = environment === FUTURES_READ_ENVIRONMENTS.TESTNET
    ? FUTURES_READ_ENVIRONMENTS.TESTNET
    : FUTURES_READ_ENVIRONMENTS.MOCK
  const generationRef = useRef(0)
  const [state, setState] = useState(() => (
    createInitialState(enabled, symbol, wsConnection, expectedEnvironment)
  ))

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    let active = true

    const isCurrentGeneration = () => active && generationRef.current === generation

    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((previous) => (
        previous.status === 'idle'
          && previous.requestId === null
          && previous.symbol === null
          && previous.environment === expectedEnvironment
          ? previous
          : createLifecycleState({ status: 'idle', environment: expectedEnvironment })
      ))
      return () => {
        active = false
      }
    }

    if (!isExactString(symbol)) {
      setState((previous) => (
        previous.status === 'unavailable'
          && previous.errorCode === 'FUTURES_READ_INVALID_SYMBOL'
          && previous.environment === expectedEnvironment
          ? previous
          : createLifecycleState({
            status: 'unavailable',
            environment: expectedEnvironment,
            errorCode: 'FUTURES_READ_INVALID_SYMBOL',
          })
      ))
      return () => {
        active = false
      }
    }

    if (!isOpenSocket(wsConnection)
      || typeof wsConnection?.addEventListener !== 'function'
      || typeof wsConnection?.removeEventListener !== 'function'
      || typeof sendMessage !== 'function') {
      setState((previous) => (
        previous.status === 'disconnected'
          && previous.symbol === symbol
          && previous.requestId === null
          && previous.environment === expectedEnvironment
          ? previous
          : createLifecycleState({
            status: 'disconnected',
            symbol,
            environment: expectedEnvironment,
          })
      ))
      return () => {
        active = false
      }
    }

    const requestId = createOpaqueRequestId()
    let subscriptionSent = false

    setState(createLifecycleState({
      status: 'loading',
      symbol,
      requestId,
      environment: expectedEnvironment,
    }))

    const handleMessage = (event) => {
      if (!isCurrentGeneration()) return

      let message
      try {
        message = parseFuturesReadMessage(event?.data)
      } catch {
        return
      }

      if (message.channelId !== FUTURES_READ_CHANNEL_ID
        || message.version !== FUTURES_READ_PROTOCOL_VERSION
        || message.marketType !== FUTURES_MARKET_TYPE
        || message.requestId !== requestId
        || message.environment !== expectedEnvironment) {
        return
      }

      if (message.type === FUTURES_READ_RESPONSE_TYPES.REJECTION) {
        setState((previous) => {
          if (previous.requestId !== requestId) return previous
          return {
            ...previous,
            status: 'error',
            connected: isOpenSocket(wsConnection),
            environment: expectedEnvironment,
            errorCode: message.payload.code,
          }
        })
        active = false
        return
      }

      if (message.type !== FUTURES_READ_RESPONSE_TYPES.SNAPSHOT
        || message.symbol !== symbol
        || !isValidSnapshotPayload(message.payload, symbol, message.environment)) {
        return
      }

      setState({
        ...message.payload,
        requestId,
        errorCode: null,
      })
    }

    const handleClose = () => {
      if (!isCurrentGeneration()) return
      setState((previous) => {
        if (previous.requestId !== requestId) return previous
        return {
          ...previous,
          status: 'disconnected',
          connected: false,
        }
      })
      active = false
    }

    const handleError = () => {
      if (!isCurrentGeneration()) return
      setState((previous) => {
        if (previous.requestId !== requestId) return previous
        return {
          ...previous,
          status: 'error',
          connected: false,
          errorCode: 'FUTURES_READ_CONNECTION_ERROR',
        }
      })
      active = false
    }

    wsConnection.addEventListener('message', handleMessage)
    wsConnection.addEventListener('close', handleClose)
    wsConnection.addEventListener('error', handleError)

    try {
      const sent = sendMessage(createFuturesReadSubscribeRequest({ symbol, requestId }))
      subscriptionSent = sent !== false
      if (!subscriptionSent && isCurrentGeneration()) {
        setState(createLifecycleState({
          status: 'error',
          symbol,
          requestId,
          environment: expectedEnvironment,
          errorCode: 'FUTURES_READ_SUBSCRIBE_FAILED',
        }))
        active = false
      }
    } catch {
      if (isCurrentGeneration()) {
        setState(createLifecycleState({
          status: 'error',
          symbol,
          requestId,
          environment: expectedEnvironment,
          errorCode: 'FUTURES_READ_SUBSCRIBE_FAILED',
        }))
        active = false
      }
    }

    return () => {
      active = false
      wsConnection.removeEventListener('message', handleMessage)
      wsConnection.removeEventListener('close', handleClose)
      wsConnection.removeEventListener('error', handleError)

      if (subscriptionSent) {
        try {
          sendMessage(createFuturesReadUnsubscribeRequest({ requestId }))
        } catch {
          // The connection can disappear during teardown; ownership is already revoked locally.
        }
      }
    }
  }, [enabled, expectedEnvironment, sendMessage, symbol, wsConnection])

  return state
}

export default useFuturesReadOnly
export { useFuturesReadOnly }
