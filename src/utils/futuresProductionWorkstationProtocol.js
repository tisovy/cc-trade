import {
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  FUTURES_WORKSTATION_EVENT_MAX_NODES,
  FUTURES_WORKSTATION_MARKET_TYPE,
  FUTURES_WORKSTATION_PROTOCOL_VERSION,
  FUTURES_WORKSTATION_REQUEST_MAX_BYTES,
  createFuturesWorkstationEvent,
  createFuturesWorkstationRequest,
  parseBoundedFuturesWorkstationJson,
  validateFuturesWorkstationEvent,
  validateFuturesWorkstationRequest,
} from './futuresWorkstationProtocolShared.js'

export const FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID = 'futures-production-workstation'
export const FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT = 'PRODUCTION'
export const FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE = 'futures.production.workstation.resource'
export const FUTURES_PRODUCTION_WORKSTATION_PROTOCOL_VERSION = FUTURES_WORKSTATION_PROTOCOL_VERSION
export const FUTURES_PRODUCTION_WORKSTATION_MARKET_TYPE = FUTURES_WORKSTATION_MARKET_TYPE

export const FUTURES_PRODUCTION_WORKSTATION_ACTIONS = Object.freeze({
  SUBSCRIBE: 'futures.production.workstation.subscribe',
  SELECT_SYMBOL: 'futures.production.workstation.select-symbol',
  SELECT_INTERVAL: 'futures.production.workstation.select-interval',
  CONFIGURE_TAPE: 'futures.production.workstation.configure-tape',
  CONFIGURE_DEPTH: 'futures.production.workstation.configure-depth',
  LOAD_CANDLE_HISTORY: 'futures.production.workstation.load-candle-history',
  UNSUBSCRIBE: 'futures.production.workstation.unsubscribe',
})

const createRequest = (action, value) => createFuturesWorkstationRequest({
  channelId: FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID,
  environment: FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
  actions: FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  action,
  ...value,
})

export const createFuturesProductionWorkstationSubscribeRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE, value)
)

export const createFuturesProductionWorkstationSelectSymbolRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_SYMBOL, value)
)

export const createFuturesProductionWorkstationSelectIntervalRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL, value)
)

export const createFuturesProductionWorkstationConfigureTapeRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_TAPE, value)
)

export const createFuturesProductionWorkstationConfigureDepthRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_DEPTH, value)
)

export const createFuturesProductionWorkstationLoadCandleHistoryRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY, value)
)

export const createFuturesProductionWorkstationUnsubscribeRequest = value => (
  createRequest(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE, value)
)

export const readFuturesProductionWorkstationRequest = (raw) => {
  const value = parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_REQUEST_MAX_BYTES,
    maxDepth: 2,
    maxNodes: 16,
    maxStringBytes: 128,
  })
  return validateFuturesWorkstationRequest({
    value,
    channelId: FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID,
    environment: FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
    actions: FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  })
}

export const createFuturesProductionWorkstationEvent = value => createFuturesWorkstationEvent({
  channelId: FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID,
  environment: FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
  eventType: FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE,
  ...value,
})

// What a frame must satisfy once it has been read. Split from the reading itself
// so a boundary that already parsed the frame — because four subscribers were
// each parsing it again to find out whether they wanted it — can state the same
// rules without parsing it a second time.
export const readFuturesProductionWorkstationEvent = value => validateFuturesWorkstationEvent({
  value,
  channelId: FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID,
  environment: FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
  eventType: FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE,
})

export const parseFuturesProductionWorkstationEvent = raw => (
  readFuturesProductionWorkstationEvent(parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_EVENT_MAX_BYTES,
    maxNodes: FUTURES_WORKSTATION_EVENT_MAX_NODES,
  }))
)

export const isPotentialFuturesProductionWorkstationFrame = raw => (
  typeof raw === 'string'
  && (raw.includes(FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID)
    || raw.includes('futures.production.workstation.'))
)
