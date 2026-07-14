import {
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  FUTURES_WORKSTATION_MARKET_TYPE,
  FUTURES_WORKSTATION_PROTOCOL_VERSION,
  FUTURES_WORKSTATION_REQUEST_MAX_BYTES,
  createFuturesWorkstationEvent,
  createFuturesWorkstationRequest,
  parseBoundedFuturesWorkstationJson,
  validateFuturesWorkstationEvent,
  validateFuturesWorkstationRequest,
} from './futuresWorkstationProtocolShared.js'

export const FUTURES_TESTNET_WORKSTATION_CHANNEL_ID = 'futures-testnet-workstation'
export const FUTURES_TESTNET_WORKSTATION_ENVIRONMENT = 'TESTNET'
export const FUTURES_TESTNET_WORKSTATION_EVENT_TYPE = 'futures.testnet.workstation.resource'
export const FUTURES_TESTNET_WORKSTATION_PROTOCOL_VERSION = FUTURES_WORKSTATION_PROTOCOL_VERSION
export const FUTURES_TESTNET_WORKSTATION_MARKET_TYPE = FUTURES_WORKSTATION_MARKET_TYPE

export const FUTURES_TESTNET_WORKSTATION_ACTIONS = Object.freeze({
  SUBSCRIBE: 'futures.testnet.workstation.subscribe',
  SELECT_SYMBOL: 'futures.testnet.workstation.select-symbol',
  SELECT_INTERVAL: 'futures.testnet.workstation.select-interval',
  UNSUBSCRIBE: 'futures.testnet.workstation.unsubscribe',
})

const createRequest = (action, value) => createFuturesWorkstationRequest({
  channelId: FUTURES_TESTNET_WORKSTATION_CHANNEL_ID,
  environment: FUTURES_TESTNET_WORKSTATION_ENVIRONMENT,
  actions: FUTURES_TESTNET_WORKSTATION_ACTIONS,
  action,
  ...value,
})

export const createFuturesTestnetWorkstationSubscribeRequest = value => (
  createRequest(FUTURES_TESTNET_WORKSTATION_ACTIONS.SUBSCRIBE, value)
)

export const createFuturesTestnetWorkstationSelectSymbolRequest = value => (
  createRequest(FUTURES_TESTNET_WORKSTATION_ACTIONS.SELECT_SYMBOL, value)
)

export const createFuturesTestnetWorkstationSelectIntervalRequest = value => (
  createRequest(FUTURES_TESTNET_WORKSTATION_ACTIONS.SELECT_INTERVAL, value)
)

export const createFuturesTestnetWorkstationUnsubscribeRequest = value => (
  createRequest(FUTURES_TESTNET_WORKSTATION_ACTIONS.UNSUBSCRIBE, value)
)

export const readFuturesTestnetWorkstationRequest = (raw) => {
  const value = parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_REQUEST_MAX_BYTES,
    maxDepth: 2,
    maxNodes: 16,
    maxStringBytes: 128,
  })
  return validateFuturesWorkstationRequest({
    value,
    channelId: FUTURES_TESTNET_WORKSTATION_CHANNEL_ID,
    environment: FUTURES_TESTNET_WORKSTATION_ENVIRONMENT,
    actions: FUTURES_TESTNET_WORKSTATION_ACTIONS,
  })
}

export const createFuturesTestnetWorkstationEvent = value => createFuturesWorkstationEvent({
  channelId: FUTURES_TESTNET_WORKSTATION_CHANNEL_ID,
  environment: FUTURES_TESTNET_WORKSTATION_ENVIRONMENT,
  eventType: FUTURES_TESTNET_WORKSTATION_EVENT_TYPE,
  ...value,
})

export const parseFuturesTestnetWorkstationEvent = (raw) => {
  const value = parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  })
  return validateFuturesWorkstationEvent({
    value,
    channelId: FUTURES_TESTNET_WORKSTATION_CHANNEL_ID,
    environment: FUTURES_TESTNET_WORKSTATION_ENVIRONMENT,
    eventType: FUTURES_TESTNET_WORKSTATION_EVENT_TYPE,
  })
}

export const isPotentialFuturesTestnetWorkstationFrame = raw => (
  typeof raw === 'string'
  && (raw.includes(FUTURES_TESTNET_WORKSTATION_CHANNEL_ID)
    || raw.includes('futures.testnet.workstation.'))
)
