import {
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  FUTURES_WORKSTATION_MARKET_TYPE,
  FUTURES_WORKSTATION_PROTOCOL_VERSION,
  FUTURES_WORKSTATION_REQUEST_MAX_BYTES,
  FuturesWorkstationProtocolError,
  createFuturesWorkstationEvent,
  createFuturesWorkstationRequest,
  freezeFuturesWorkstationValue,
  hasExactFuturesWorkstationKeys,
  isFuturesWorkstationInterval,
  isFuturesWorkstationRequestId,
  isFuturesWorkstationSymbol,
  parseBoundedFuturesWorkstationJson,
  validateFuturesWorkstationEvent,
  validateFuturesWorkstationRequest,
} from './futuresWorkstationProtocolShared.js'
import { splitFrameMarks } from './frameMarks.js'

export const FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID = 'futures-production-workstation'
export const FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT = 'PRODUCTION'
export const FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE = 'futures.production.workstation.resource'
export const FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOME_TYPE = (
  'futures.production.workstation.history-outcome'
)
export const FUTURES_PRODUCTION_WORKSTATION_PROTOCOL_VERSION = FUTURES_WORKSTATION_PROTOCOL_VERSION
export const FUTURES_PRODUCTION_WORKSTATION_MARKET_TYPE = FUTURES_WORKSTATION_MARKET_TYPE

export const FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOMES = Object.freeze({
  UNAVAILABLE: 'unavailable',
})

export const FUTURES_PRODUCTION_WORKSTATION_HISTORY_REASON_CODES = Object.freeze({
  OWNER_UNAVAILABLE: 'CANDLE_HISTORY_OWNER_UNAVAILABLE',
})

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
  }))
)

export const readFuturesProductionWorkstationHistoryOutcome = (value) => {
  if (!hasExactFuturesWorkstationKeys(value, [
    'channelId',
    'version',
    'marketType',
    'environment',
    'type',
    'action',
    'requestId',
    'symbol',
    'interval',
    'endTime',
    'outcome',
    'reasonCode',
  ])
    || value.channelId !== FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID
    || value.version !== FUTURES_PRODUCTION_WORKSTATION_PROTOCOL_VERSION
    || value.marketType !== FUTURES_PRODUCTION_WORKSTATION_MARKET_TYPE
    || value.environment !== FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT
    || value.type !== FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOME_TYPE
    || value.action !== FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY
    || !isFuturesWorkstationRequestId(value.requestId)
    || !isFuturesWorkstationSymbol(value.symbol)
    || !isFuturesWorkstationInterval(value.interval)
    || !Number.isSafeInteger(value.endTime)
    || value.endTime <= 0
    || value.outcome !== FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOMES.UNAVAILABLE
    || value.reasonCode !== FUTURES_PRODUCTION_WORKSTATION_HISTORY_REASON_CODES.OWNER_UNAVAILABLE) {
    throw new FuturesWorkstationProtocolError('INVALID_HISTORY_OUTCOME')
  }
  return freezeFuturesWorkstationValue(value)
}

export const createFuturesProductionWorkstationHistoryOutcome = ({
  requestId,
  symbol,
  interval,
  endTime,
  reasonCode = FUTURES_PRODUCTION_WORKSTATION_HISTORY_REASON_CODES.OWNER_UNAVAILABLE,
}) => readFuturesProductionWorkstationHistoryOutcome({
  channelId: FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID,
  version: FUTURES_PRODUCTION_WORKSTATION_PROTOCOL_VERSION,
  marketType: FUTURES_PRODUCTION_WORKSTATION_MARKET_TYPE,
  environment: FUTURES_PRODUCTION_WORKSTATION_ENVIRONMENT,
  type: FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOME_TYPE,
  action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY,
  requestId,
  symbol,
  interval,
  endTime,
  outcome: FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOMES.UNAVAILABLE,
  reasonCode,
})

export const parseFuturesProductionWorkstationHistoryOutcome = raw => (
  readFuturesProductionWorkstationHistoryOutcome(parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  }))
)

/**
 * The same reading, plus whatever the transport wrote on the envelope.
 *
 * The split happens here, between the parse and the validation, because those
 * are the only two points it can happen between: before the parse there is
 * nothing to take the marks off, and after the validation the frame has already
 * been refused for carrying them. Still one parse — the cost §3 of
 * `carry-execution-ahead-of-market-data` brought down from four is not given back
 * for a diagnostic.
 */
export const parseMarkedFuturesProductionWorkstationEvent = (raw) => {
  const { frame, marks } = splitFrameMarks(parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  }))
  return { event: readFuturesProductionWorkstationEvent(frame), marks }
}

export const parseMarkedFuturesProductionWorkstationFrame = (raw) => {
  const { frame, marks } = splitFrameMarks(parseBoundedFuturesWorkstationJson(raw, {
    maxBytes: FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  }))
  try {
    return { event: readFuturesProductionWorkstationEvent(frame), marks }
  } catch (eventError) {
    try {
      return { event: readFuturesProductionWorkstationHistoryOutcome(frame), marks }
    } catch {
      throw eventError
    }
  }
}

export const isPotentialFuturesProductionWorkstationFrame = raw => (
  typeof raw === 'string'
  && (raw.includes(FUTURES_PRODUCTION_WORKSTATION_CHANNEL_ID)
    || raw.includes('futures.production.workstation.'))
)
