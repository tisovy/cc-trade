export const FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION = 2
export const FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID = 'futures-production-execution'
export const FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE = 'futures'
export const FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT = 'production'
export const FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES = 16384

const FUTURES_PRODUCTION_EXECUTION_RENDERER_CEILINGS = Object.freeze({
  maxLeverage: 2,
  maxOrderNotionalUsdt: '10',
  maxDailyNotionalUsdt: '50',
})

export const FUTURES_PRODUCTION_EXECUTION_ACTIONS = Object.freeze({
  SUBSCRIBE_STATUS: 'futures.production.subscribeStatus',
  UNSUBSCRIBE_STATUS: 'futures.production.unsubscribeStatus',
  REFRESH_PORTFOLIO: 'futures.production.refreshPortfolio',
  PREPARE_MARGIN_ADJUSTMENT_INTENT: 'futures.production.prepareMarginAdjustmentIntent',
  ADJUST_ISOLATED_MARGIN: 'futures.production.adjustIsolatedMargin',
  PREPARE_ORDER_AMENDMENT_INTENT: 'futures.production.prepareOrderAmendmentIntent',
  AMEND_ORDER: 'futures.production.amendOrder',
  PREPARE_ORDER_INTENT: 'futures.production.prepareOrderIntent',
  PLACE_ORDER: 'futures.production.placeOrder',
  PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT: 'futures.production.prepareCancelAllOpenOrdersIntent',
  CANCEL_ALL_OPEN_ORDERS: 'futures.production.cancelAllOpenOrders',
  PREPARE_CLOSE_POSITIONS_INTENT: 'futures.production.prepareClosePositionsIntent',
  CLOSE_POSITIONS: 'futures.production.closePositions',
  PREPARE_ENGAGE_KILL_SWITCH_INTENT: 'futures.production.prepareEngageKillSwitchIntent',
  ENGAGE_KILL_SWITCH: 'futures.production.engageKillSwitch',
  PREPARE_DISENGAGE_KILL_SWITCH_INTENT: 'futures.production.prepareDisengageKillSwitchIntent',
  DISENGAGE_KILL_SWITCH: 'futures.production.disengageKillSwitch',
  STATUS: 'futures.production.status',
})

export const FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS = Object.freeze({
  ORDER: 'order',
  MARGIN_ADJUSTMENT: 'margin_adjustment',
  ORDER_AMENDMENT: 'order_amendment',
  CANCEL_ALL_OPEN_ORDERS: 'cancel_all_open_orders',
  CLOSE_POSITIONS: 'close_positions',
  ENGAGE_KILL_SWITCH: 'engage_kill_switch',
  DISENGAGE_KILL_SWITCH: 'disengage_kill_switch',
})

export const FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS = Object.freeze({
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER]: 'PLACE REAL FUTURES ORDER',
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN]: 'ADJUST REAL FUTURES ISOLATED MARGIN',
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER]: 'MOVE REAL FUTURES ORDER',
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS]: 'CANCEL ALL REAL FUTURES ORDERS',
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS]: 'CLOSE ALL REAL FUTURES POSITIONS',
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH]: 'ENGAGE REAL FUTURES KILL SWITCH',
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH]: 'ARM LIVE FUTURES HEDGE ISOLATED 2X 10 USDT 50 USDT DAILY',
})

export const FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  UNKNOWN: 'unknown',
  PARTIAL: 'partial',
})

export const FUTURES_PRODUCTION_EXECUTION_STATES = Object.freeze({
  LOCALLY_REJECTED: 'locally_rejected',
  INTENT_ISSUED: 'intent_issued',
  QUEUED: 'queued',
  DISPATCHED: 'dispatched',
  EXCHANGE_REJECTED: 'exchange_rejected',
  EXCHANGE_ACCEPTED: 'exchange_accepted',
  RECONCILING: 'reconciling',
  RESULT_UNKNOWN: 'result_unknown',
  CONFIRMED_OPEN: 'confirmed_open',
  CONFIRMED_FILLED: 'confirmed_filled',
  CONFIRMED_CANCELED: 'confirmed_canceled',
  CONFIRMED_CLOSED: 'confirmed_closed',
  CONFIRMED_MARGIN_ADJUSTED: 'confirmed_margin_adjusted',
  CONFIRMED_ORDER_AMENDED: 'confirmed_order_amended',
  KILL_SWITCH_ENGAGED: 'kill_switch_engaged',
  KILL_SWITCH_DISENGAGED: 'kill_switch_disengaged',
  PARTIAL: 'partial',
  RECONCILIATION_UNAVAILABLE: 'reconciliation_unavailable',
  RECOVERY_REQUIRED: 'recovery_required',
  RECOVERING: 'recovering',
})

export const FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES = Object.freeze({
  INVALID_ENCODING: 'FUTURES_PRODUCTION_EXECUTION_INVALID_ENCODING',
  MESSAGE_TOO_LARGE: 'FUTURES_PRODUCTION_EXECUTION_MESSAGE_TOO_LARGE',
  INVALID_JSON: 'FUTURES_PRODUCTION_EXECUTION_INVALID_JSON',
  INVALID_MESSAGE: 'FUTURES_PRODUCTION_EXECUTION_INVALID_MESSAGE',
  INVALID_FIELDS: 'FUTURES_PRODUCTION_EXECUTION_INVALID_FIELDS',
  INVALID_ACTION: 'FUTURES_PRODUCTION_EXECUTION_INVALID_ACTION',
  INVALID_COMMAND: 'FUTURES_PRODUCTION_EXECUTION_INVALID_COMMAND',
  INVALID_STATUS: 'FUTURES_PRODUCTION_EXECUTION_INVALID_STATUS',
})

export class FuturesProductionExecutionRendererProtocolError extends Error {
  constructor(code) {
    super('Production futures execution renderer message was rejected')
    this.name = 'FuturesProductionExecutionRendererProtocolError'
    this.code = code
  }
}

const BASE_FIELDS = Object.freeze([
  'action', 'version', 'revision', 'marketType', 'environment', 'accountFingerprint',
])
const PREPARE_ORDER_FIELDS = Object.freeze([
  ...BASE_FIELDS, 'symbol', 'side', 'positionSide', 'positionEffect', 'quantity', 'price',
])
const PREPARE_MARGIN_FIELDS = Object.freeze([
  ...BASE_FIELDS, 'symbol', 'positionSide', 'marginAction', 'amount',
])
const PREPARE_AMEND_FIELDS = Object.freeze([
  ...BASE_FIELDS, 'symbol', 'positionSide', 'clientOrderId', 'price',
])
const FINAL_FIELDS = Object.freeze([
  'action', 'version', 'revision', 'requestId', 'marketType', 'environment',
  'accountFingerprint', 'confirmation',
])
const STATUS_FIELDS = Object.freeze([
  'channelId', 'action', 'version', 'revision', 'marketType', 'environment', 'mode',
  'liveAuthorized', 'configured', 'account', 'caps', 'killSwitch', 'capabilities',
  'intent', 'attempt', 'reconciliation', 'recovery', 'portfolio',
])
const ACCOUNT_FIELDS = Object.freeze(['alias', 'fingerprint'])
const CAPS_FIELDS = Object.freeze([
  'allowedSymbols',
  'maxLeverage', 'maxOrderNotionalUsdt', 'maxDailyNotionalUsdt',
  'minAvailableBalanceUsdt', 'minLiquidationDistanceBps',
  'dailyUsedNotionalUsdt', 'utcDay',
])
const KILL_SWITCH_FIELDS = Object.freeze(['engaged', 'policy'])
const CAPABILITY_FIELDS = Object.freeze([
  'placeOrder', 'adjustMargin', 'amendOrder', 'cancelAllOpenOrders', 'closePositions', 'engageKillSwitch',
  'disengageKillSwitch', 'code',
])
const INTENT_FIELDS = Object.freeze(['requestId', 'kind', 'revision', 'expiresAt'])
const ATTEMPT_FIELDS = Object.freeze([
  'requestId', 'kind', 'revision', 'acknowledgement', 'state', 'code', 'observedAt', 'items',
])
const ATTEMPT_ITEM_FIELDS = Object.freeze(['symbol', 'outcome', 'code'])
const RECONCILIATION_FIELDS = Object.freeze(['required', 'state', 'nextAttemptAt'])
const RECOVERY_FIELDS = Object.freeze(['required', 'state', 'code'])
const PORTFOLIO_FIELDS = Object.freeze(['state', 'observedAt', 'positions', 'openOrders'])
const POSITION_FIELDS = Object.freeze([
  'symbol', 'positionSide', 'quantity', 'entryPrice', 'markPrice', 'notionalUsdt',
  'unrealizedPnlUsdt', 'isolatedMarginUsdt', 'liquidationPrice', 'leverage', 'marginType',
])
const OPEN_ORDER_FIELDS = Object.freeze([
  'symbol', 'orderId', 'clientOrderId', 'side', 'positionSide', 'positionEffect',
  'price', 'originalQuantity', 'executedQuantity', 'status', 'type', 'timeInForce',
])
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/
const ORDER_ID_PATTERN = /^[1-9][0-9]{0,18}$/
const OWNED_CLIENT_ORDER_ID_PATTERN = /^cc7-[0-9a-f]{32}$/
const SAFE_CODE_PATTERN = /^FUTURES_PRODUCTION_[A-Z0-9_]{1,64}$/
const POSITIVE_DECIMAL_PATTERN = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/
const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const SIGNED_DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const INTENT_KIND_SET = new Set(Object.values(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS))
const MAX_JSON_NODES = 1024
const MAX_JSON_STRING_BYTES = 512
const MAX_PORTFOLIO_ITEMS = 16
const KILL_SWITCH_POLICY = 'v1-persistent-block-new-exposure'

const FINAL_KIND_BY_ACTION = Object.freeze({
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT,
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT,
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
  [FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH]: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
})

const fail = (code) => {
  throw new FuturesProductionExecutionRendererProtocolError(code)
}

const hasOnlyUnicodeScalars = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

const decodeRawUtf8 = (raw) => {
  let bytes
  let text
  if (typeof raw === 'string') {
    if (raw.length > FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES || !hasOnlyUnicodeScalars(raw)) {
      fail(raw.length > FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES
        ? FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE
        : FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING)
    }
    bytes = new TextEncoder().encode(raw)
    text = raw
  } else if (raw instanceof Uint8Array) {
    if (raw.byteLength > FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES) {
      fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE)
    }
    bytes = raw
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    } catch {
      fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING)
    }
  } else {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE)
  }
  if (bytes.byteLength > FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE)
  }
  return text
}

const parseDuplicateAwareJson = (text) => {
  let cursor = 0
  let nodes = 0
  const invalid = () => fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON)
  const countNode = () => {
    nodes += 1
    if (nodes > MAX_JSON_NODES) invalid()
  }
  const skipWhitespace = () => {
    while ([' ', '\n', '\r', '\t'].includes(text[cursor])) cursor += 1
  }
  const parseString = () => {
    if (text[cursor] !== '"') invalid()
    const start = cursor
    cursor += 1
    let closed = false
    while (cursor < text.length) {
      const character = text[cursor]
      const codeUnit = text.charCodeAt(cursor)
      if (character === '"') {
        cursor += 1
        closed = true
        break
      }
      if (codeUnit < 0x20) invalid()
      if (character === '\\') {
        cursor += 1
        const escape = text[cursor]
        if (escape === 'u') {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!/[0-9A-Fa-f]/.test(text[cursor + offset] ?? '')) invalid()
          }
          cursor += 5
          continue
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) invalid()
        cursor += 1
        continue
      }
      cursor += 1
    }
    if (!closed) invalid()
    let value
    try {
      value = JSON.parse(text.slice(start, cursor))
    } catch {
      invalid()
    }
    if (!hasOnlyUnicodeScalars(value)
      || new TextEncoder().encode(value).byteLength > MAX_JSON_STRING_BYTES) invalid()
    return value
  }
  const parseInteger = () => {
    const start = cursor
    if (text[cursor] === '-') cursor += 1
    if (text[cursor] === '0') {
      cursor += 1
      if (/[0-9]/.test(text[cursor] ?? '')) invalid()
    } else {
      if (!/[1-9]/.test(text[cursor] ?? '')) invalid()
      while (/[0-9]/.test(text[cursor] ?? '')) cursor += 1
    }
    if (['.', 'e', 'E'].includes(text[cursor])) invalid()
    const value = Number(text.slice(start, cursor))
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) invalid()
    return value
  }
  const parseLiteral = (literal, value) => {
    if (text.slice(cursor, cursor + literal.length) !== literal) invalid()
    cursor += literal.length
    return value
  }
  const parseValue = (depth) => {
    countNode()
    skipWhitespace()
    if (text[cursor] === '"') return parseString()
    if (text[cursor] === '{') return parseObject(depth + 1)
    if (text[cursor] === '[') return parseArray(depth + 1)
    if (text[cursor] === 't') return parseLiteral('true', true)
    if (text[cursor] === 'f') return parseLiteral('false', false)
    if (text[cursor] === 'n') return parseLiteral('null', null)
    return parseInteger()
  }
  const parseObject = (depth) => {
    if (depth > 6 || text[cursor] !== '{') invalid()
    cursor += 1
    skipWhitespace()
    const entries = []
    const keys = new Set()
    if (text[cursor] === '}') {
      cursor += 1
      return {}
    }
    while (cursor < text.length) {
      const key = parseString()
      if (keys.has(key)) invalid()
      keys.add(key)
      skipWhitespace()
      if (text[cursor] !== ':') invalid()
      cursor += 1
      entries.push([key, parseValue(depth)])
      skipWhitespace()
      if (text[cursor] === '}') {
        cursor += 1
        return Object.fromEntries(entries)
      }
      if (text[cursor] !== ',') invalid()
      cursor += 1
      skipWhitespace()
    }
    invalid()
    return null
  }
  const parseArray = (depth) => {
    if (depth > 6 || text[cursor] !== '[') invalid()
    cursor += 1
    skipWhitespace()
    const values = []
    if (text[cursor] === ']') {
      cursor += 1
      return values
    }
    while (cursor < text.length) {
      if (values.length >= 16) invalid()
      values.push(parseValue(depth))
      skipWhitespace()
      if (text[cursor] === ']') {
        cursor += 1
        return values
      }
      if (text[cursor] !== ',') invalid()
      cursor += 1
      skipWhitespace()
    }
    invalid()
    return null
  }
  skipWhitespace()
  countNode()
  const value = parseObject(1)
  skipWhitespace()
  if (cursor !== text.length) invalid()
  return value
}

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
)

const readExactFields = (value, expectedFields, code) => {
  if (!isPlainObject(value)) fail(code)
  const actual = Reflect.ownKeys(value)
  const expected = new Set(expectedFields)
  if (actual.length !== expectedFields.length
    || actual.some((key) => typeof key !== 'string' || !expected.has(key))) fail(code)
  const result = Object.create(null)
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail(code)
    }
    result[key] = descriptor.value
  }
  return result
}

const freezeFields = (fields, value) => Object.freeze(Object.fromEntries(
  fields.map((field) => [field, value[field]]),
))

const requireRevision = (value, code = FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND) => {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) fail(code)
  return value
}

const requireFingerprint = (value, code = FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND) => {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) fail(code)
  return value
}

const requireTimestamp = (value, code) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(code)
  return value
}

const isExactDecimal = (value, pattern, allowZero) => {
  if (typeof value !== 'string'
    || new TextEncoder().encode(value).byteLength > 42
    || !pattern.test(value)) return false
  const unsigned = value[0] === '-' ? value.slice(1) : value
  const [integer, fraction = ''] = unsigned.split('.')
  if (integer.length + fraction.length > 40 || fraction.length > 18) return false
  return allowZero || !/^0(?:\.0+)?$/.test(unsigned)
}

const requirePositiveDecimal = (value) => isExactDecimal(value, POSITIVE_DECIMAL_PATTERN, false)
const requireNonNegativeDecimal = (value) => isExactDecimal(value, NON_NEGATIVE_DECIMAL_PATTERN, true)
const requireSignedDecimal = (value) => isExactDecimal(value, SIGNED_DECIMAL_PATTERN, true)
  && !/^-0(?:\.0+)?$/.test(value)

const decimalParts = (value) => {
  const [integer, fraction = ''] = value.split('.')
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length }
}

const compareDecimals = (left, right) => {
  const leftParts = decimalParts(left)
  const rightParts = decimalParts(right)
  const scale = Math.max(leftParts.scale, rightParts.scale)
  const alignedLeft = leftParts.coefficient * (10n ** BigInt(scale - leftParts.scale))
  const alignedRight = rightParts.coefficient * (10n ** BigInt(scale - rightParts.scale))
  if (alignedLeft < alignedRight) return -1
  if (alignedLeft > alignedRight) return 1
  return 0
}

const createBaseRequest = (action, { revision = '0', accountFingerprint } = {}) => {
  if (![FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT,
  ].includes(action)) fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION)
  requireRevision(revision)
  requireFingerprint(accountFingerprint)
  return Object.freeze({
    action,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint,
  })
}

export const createFuturesProductionExecutionSubscribeStatusRequest = (options) => (
  createBaseRequest(FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS, options)
)

export const createFuturesProductionExecutionUnsubscribeStatusRequest = (options) => (
  createBaseRequest(FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS, options)
)

export const createFuturesProductionExecutionRefreshPortfolioRequest = (options) => (
  createBaseRequest(FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO, options)
)

export const createFuturesProductionExecutionPrepareCancelAllOpenOrdersIntentRequest = (options) => (
  createBaseRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
    options,
  )
)

export const createFuturesProductionExecutionPrepareClosePositionsIntentRequest = (options) => (
  createBaseRequest(FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT, options)
)

export const createFuturesProductionExecutionPrepareEngageKillSwitchIntentRequest = (options) => (
  createBaseRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT,
    options,
  )
)

export const createFuturesProductionExecutionPrepareDisengageKillSwitchIntentRequest = (options) => (
  createBaseRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT,
    options,
  )
)

export const createFuturesProductionExecutionPrepareOrderIntentRequest = ({
  revision = '0',
  accountFingerprint,
  symbol,
  side,
  positionSide,
  positionEffect,
  quantity,
  price,
} = {}) => {
  requireRevision(revision)
  requireFingerprint(accountFingerprint)
  if (typeof symbol !== 'string'
    || !SYMBOL_PATTERN.test(symbol)
    || !['BUY', 'SELL'].includes(side)
    || !['LONG', 'SHORT'].includes(positionSide)
    || !['ENTRY', 'EXIT'].includes(positionEffect)
    || (positionSide === 'LONG' && side !== (positionEffect === 'ENTRY' ? 'BUY' : 'SELL'))
    || (positionSide === 'SHORT' && side !== (positionEffect === 'ENTRY' ? 'SELL' : 'BUY'))
    || !requirePositiveDecimal(quantity)
    || !requirePositiveDecimal(price)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  }
  return Object.freeze({
    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint,
    symbol,
    side,
    positionSide,
    positionEffect,
    quantity,
    price,
  })
}

export const createFuturesProductionExecutionPrepareMarginAdjustmentIntentRequest = ({
  revision = '0',
  accountFingerprint,
  symbol,
  positionSide,
  marginAction,
  amount,
} = {}) => {
  requireRevision(revision)
  requireFingerprint(accountFingerprint)
  if (typeof symbol !== 'string'
    || !SYMBOL_PATTERN.test(symbol)
    || !['LONG', 'SHORT'].includes(positionSide)
    || !['ADD', 'REDUCE'].includes(marginAction)
    || !requirePositiveDecimal(amount)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  }
  return Object.freeze({
    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint,
    symbol,
    positionSide,
    marginAction,
    amount,
  })
}

export const createFuturesProductionExecutionPrepareOrderAmendmentIntentRequest = ({
  revision = '0',
  accountFingerprint,
  symbol,
  positionSide,
  clientOrderId,
  price,
} = {}) => {
  requireRevision(revision)
  requireFingerprint(accountFingerprint)
  if (typeof symbol !== 'string'
    || !SYMBOL_PATTERN.test(symbol)
    || !['LONG', 'SHORT'].includes(positionSide)
    || typeof clientOrderId !== 'string'
    || !OWNED_CLIENT_ORDER_ID_PATTERN.test(clientOrderId)
    || !requirePositiveDecimal(price)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  }
  return Object.freeze({
    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint,
    symbol,
    positionSide,
    clientOrderId,
    price,
  })
}

const normalizeIntentForFinalAction = (intent, action) => {
  const value = readExactFields(
    intent,
    INTENT_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND,
  )
  if (typeof value.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(value.requestId)
    || value.kind !== FINAL_KIND_BY_ACTION[action]) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  }
  requireRevision(value.revision)
  requireTimestamp(value.expiresAt, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  return value
}

export const createFuturesProductionExecutionFinalRequest = (action, {
  intent,
  accountFingerprint,
  confirmation,
} = {}) => {
  if (!Object.hasOwn(FINAL_KIND_BY_ACTION, action)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION)
  }
  const normalizedIntent = normalizeIntentForFinalAction(intent, action)
  requireFingerprint(accountFingerprint)
  if (confirmation !== FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action]) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  }
  return Object.freeze({
    action,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision: normalizedIntent.revision,
    requestId: normalizedIntent.requestId,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint,
    confirmation,
  })
}

export const createFuturesProductionExecutionPlaceOrderRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
    options,
  )
)

export const createFuturesProductionExecutionAdjustIsolatedMarginRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
    options,
  )
)

export const createFuturesProductionExecutionAmendOrderRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
    options,
  )
)

export const createFuturesProductionExecutionCancelAllOpenOrdersRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
    options,
  )
)

export const createFuturesProductionExecutionClosePositionsRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
    options,
  )
)

export const createFuturesProductionExecutionEngageKillSwitchRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
    options,
  )
)

export const createFuturesProductionExecutionDisengageKillSwitchRequest = (options) => (
  createFuturesProductionExecutionFinalRequest(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
    options,
  )
)

export const compareFuturesProductionExecutionRevisions = (left, right) => {
  requireRevision(left, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  requireRevision(right, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

const normalizeAccount = (value) => {
  if (value === null) return null
  const account = readExactFields(
    value,
    ACCOUNT_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof account.alias !== 'string'
    || new TextEncoder().encode(account.alias).byteLength > 64
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(account.alias)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  requireFingerprint(account.fingerprint, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  return freezeFields(ACCOUNT_FIELDS, account)
}

const isCanonicalUtcDay = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const normalizeCapSymbols = (value) => {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > 16) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  const symbols = []
  const unique = new Set()
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || !SYMBOL_PATTERN.test(descriptor.value)
      || unique.has(descriptor.value)) {
      fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
    }
    unique.add(descriptor.value)
    symbols.push(descriptor.value)
  }
  if (Reflect.ownKeys(value).length !== symbols.length + 1) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return Object.freeze(symbols)
}

const normalizeCaps = (value) => {
  if (value === null) return null
  const caps = readExactFields(
    value,
    CAPS_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  const allowedSymbols = normalizeCapSymbols(caps.allowedSymbols)
  if (!Number.isSafeInteger(caps.maxLeverage)
    || caps.maxLeverage !== FUTURES_PRODUCTION_EXECUTION_RENDERER_CEILINGS.maxLeverage
    || !requirePositiveDecimal(caps.maxOrderNotionalUsdt)
    || !requirePositiveDecimal(caps.maxDailyNotionalUsdt)
    || !requirePositiveDecimal(caps.minAvailableBalanceUsdt)
    || typeof caps.minLiquidationDistanceBps !== 'string'
    || !/^[1-9][0-9]{3,4}$/.test(caps.minLiquidationDistanceBps)
    || BigInt(caps.minLiquidationDistanceBps) < 1000n
    || BigInt(caps.minLiquidationDistanceBps) > 10000n
    || !requireNonNegativeDecimal(caps.dailyUsedNotionalUsdt)
    || compareDecimals(
      caps.maxOrderNotionalUsdt,
      FUTURES_PRODUCTION_EXECUTION_RENDERER_CEILINGS.maxOrderNotionalUsdt,
    ) > 0
    || compareDecimals(
      caps.maxDailyNotionalUsdt,
      FUTURES_PRODUCTION_EXECUTION_RENDERER_CEILINGS.maxDailyNotionalUsdt,
    ) > 0
    || compareDecimals(caps.maxOrderNotionalUsdt, caps.maxDailyNotionalUsdt) > 0
    || compareDecimals(caps.dailyUsedNotionalUsdt, caps.maxDailyNotionalUsdt) > 0
    || !isCanonicalUtcDay(caps.utcDay)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return freezeFields(CAPS_FIELDS, { ...caps, allowedSymbols })
}

const normalizeKillSwitch = (value) => {
  const killSwitch = readExactFields(
    value,
    KILL_SWITCH_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof killSwitch.engaged !== 'boolean' || killSwitch.policy !== KILL_SWITCH_POLICY) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return freezeFields(KILL_SWITCH_FIELDS, killSwitch)
}

const normalizeCapabilities = (value) => {
  const capabilities = readExactFields(
    value,
    CAPABILITY_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (CAPABILITY_FIELDS.slice(0, -1).some((field) => typeof capabilities[field] !== 'boolean')
    || typeof capabilities.code !== 'string'
    || !SAFE_CODE_PATTERN.test(capabilities.code)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return freezeFields(CAPABILITY_FIELDS, capabilities)
}

const normalizeIntent = (value) => {
  if (value === null) return null
  const intent = readExactFields(
    value,
    INTENT_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof intent.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(intent.requestId)
    || !INTENT_KIND_SET.has(intent.kind)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  requireRevision(intent.revision, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  requireTimestamp(intent.expiresAt, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  return freezeFields(INTENT_FIELDS, intent)
}

const normalizeAttemptItems = (value) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  const outcomes = new Set([
    'pending', 'accepted', 'rejected', 'unknown', 'open', 'canceled', 'closed', 'adjusted',
    'amended',
  ])
  const symbols = new Set()
  return Object.freeze(value.map((item) => {
    const normalized = readExactFields(
      item,
      ATTEMPT_ITEM_FIELDS,
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
    if ((normalized.symbol !== null
        && (typeof normalized.symbol !== 'string'
          || !SYMBOL_PATTERN.test(normalized.symbol)
          || symbols.has(normalized.symbol)))
      || !outcomes.has(normalized.outcome)
      || typeof normalized.code !== 'string'
      || !SAFE_CODE_PATTERN.test(normalized.code)) {
      fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
    }
    if (normalized.symbol !== null) symbols.add(normalized.symbol)
    return freezeFields(ATTEMPT_ITEM_FIELDS, normalized)
  }))
}

const validAttemptMatrix = (acknowledgement, state) => {
  const acks = FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS
  const states = FUTURES_PRODUCTION_EXECUTION_STATES
  return (acknowledgement === acks.PENDING
      && [states.INTENT_ISSUED, states.QUEUED, states.DISPATCHED, states.RECONCILING, states.RECOVERING].includes(state))
    || (acknowledgement === acks.ACCEPTED
      && [states.EXCHANGE_ACCEPTED, states.CONFIRMED_OPEN, states.CONFIRMED_FILLED,
        states.CONFIRMED_CANCELED, states.CONFIRMED_CLOSED,
        states.CONFIRMED_MARGIN_ADJUSTED, states.CONFIRMED_ORDER_AMENDED,
        states.KILL_SWITCH_ENGAGED,
        states.KILL_SWITCH_DISENGAGED].includes(state))
    || (acknowledgement === acks.REJECTED
      && [states.LOCALLY_REJECTED, states.EXCHANGE_REJECTED].includes(state))
    || (acknowledgement === acks.UNKNOWN
      && [states.RESULT_UNKNOWN, states.RECONCILIATION_UNAVAILABLE, states.RECOVERY_REQUIRED].includes(state))
    || (acknowledgement === acks.PARTIAL && state === states.PARTIAL)
}

const normalizeAttempt = (value) => {
  if (value === null) return null
  const attempt = readExactFields(
    value,
    ATTEMPT_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof attempt.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(attempt.requestId)
    || !INTENT_KIND_SET.has(attempt.kind)
    || typeof attempt.code !== 'string'
    || !SAFE_CODE_PATTERN.test(attempt.code)
    || !validAttemptMatrix(attempt.acknowledgement, attempt.state)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  requireRevision(attempt.revision, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  requireTimestamp(attempt.observedAt, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  return Object.freeze({
    ...freezeFields(ATTEMPT_FIELDS.slice(0, -1), attempt),
    items: normalizeAttemptItems(attempt.items),
  })
}

const normalizeReconciliation = (value) => {
  if (value === null) return null
  const reconciliation = readExactFields(
    value,
    RECONCILIATION_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof reconciliation.required !== 'boolean'
    || !['idle', 'scheduled', 'querying', 'confirmed', 'unknown', 'unavailable'].includes(reconciliation.state)
    || (reconciliation.nextAttemptAt !== null
      && (!Number.isSafeInteger(reconciliation.nextAttemptAt) || reconciliation.nextAttemptAt < 0))
    || (reconciliation.required === false && reconciliation.nextAttemptAt !== null)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return freezeFields(RECONCILIATION_FIELDS, reconciliation)
}

const normalizeRecovery = (value) => {
  const recovery = readExactFields(
    value,
    RECOVERY_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof recovery.required !== 'boolean'
    || !['healthy', 'blocked', 'recovering'].includes(recovery.state)
    || typeof recovery.code !== 'string'
    || !SAFE_CODE_PATTERN.test(recovery.code)
    || (recovery.required === false && recovery.state !== 'healthy')
    || (recovery.required === true && recovery.state === 'healthy')) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return freezeFields(RECOVERY_FIELDS, recovery)
}

const normalizeDensePortfolioArray = (value, normalizeItem) => {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > MAX_PORTFOLIO_ITEMS
    || Reflect.ownKeys(value).length !== value.length + 1) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  const items = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
    }
    items.push(normalizeItem(descriptor.value))
  }
  return Object.freeze(items)
}

const requirePortfolioDecimal = (value, predicate) => {
  if (typeof value !== 'string' || !predicate(value)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return value
}

const normalizePortfolioPosition = (value) => {
  const position = readExactFields(
    value,
    POSITION_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof position.symbol !== 'string'
    || !SYMBOL_PATTERN.test(position.symbol)
    || !['LONG', 'SHORT'].includes(position.positionSide)
    || position.leverage !== FUTURES_PRODUCTION_EXECUTION_RENDERER_CEILINGS.maxLeverage
    || position.marginType !== 'ISOLATED') {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  requirePortfolioDecimal(position.quantity, requirePositiveDecimal)
  requirePortfolioDecimal(position.entryPrice, requirePositiveDecimal)
  requirePortfolioDecimal(position.markPrice, requirePositiveDecimal)
  requirePortfolioDecimal(position.notionalUsdt, requirePositiveDecimal)
  requirePortfolioDecimal(position.unrealizedPnlUsdt, requireSignedDecimal)
  requirePortfolioDecimal(position.isolatedMarginUsdt, requireNonNegativeDecimal)
  requirePortfolioDecimal(position.liquidationPrice, requireNonNegativeDecimal)
  return freezeFields(POSITION_FIELDS, position)
}

const normalizePortfolioOrder = (value) => {
  const order = readExactFields(
    value,
    OPEN_ORDER_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  const expectedEffect = order.positionSide === 'LONG'
    ? (order.side === 'BUY' ? 'ENTRY' : 'EXIT')
    : (order.side === 'SELL' ? 'ENTRY' : 'EXIT')
  if (typeof order.symbol !== 'string'
    || !SYMBOL_PATTERN.test(order.symbol)
    || typeof order.orderId !== 'string'
    || !ORDER_ID_PATTERN.test(order.orderId)
    || typeof order.clientOrderId !== 'string'
    || !OWNED_CLIENT_ORDER_ID_PATTERN.test(order.clientOrderId)
    || !['BUY', 'SELL'].includes(order.side)
    || !['LONG', 'SHORT'].includes(order.positionSide)
    || order.positionEffect !== expectedEffect
    || !['NEW', 'PARTIALLY_FILLED'].includes(order.status)
    || order.type !== 'LIMIT'
    || order.timeInForce !== 'GTC') {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  requirePortfolioDecimal(order.price, requirePositiveDecimal)
  requirePortfolioDecimal(order.originalQuantity, requirePositiveDecimal)
  requirePortfolioDecimal(order.executedQuantity, requireNonNegativeDecimal)
  return freezeFields(OPEN_ORDER_FIELDS, order)
}

const normalizePortfolio = (value) => {
  const portfolio = readExactFields(
    value,
    PORTFOLIO_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (!['live', 'unavailable', 'truncated'].includes(portfolio.state)
    || (portfolio.observedAt !== null
      && (!Number.isSafeInteger(portfolio.observedAt) || portfolio.observedAt < 0))) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  const positions = normalizeDensePortfolioArray(portfolio.positions, normalizePortfolioPosition)
  const openOrders = normalizeDensePortfolioArray(portfolio.openOrders, normalizePortfolioOrder)
  const positionKeys = new Set(positions.map(position => `${position.symbol}:${position.positionSide}`))
  const orderIds = new Set(openOrders.map(order => order.orderId))
  const clientOrderIds = new Set(openOrders.map(order => order.clientOrderId))
  if (positionKeys.size !== positions.length
    || orderIds.size !== openOrders.length
    || clientOrderIds.size !== openOrders.length
    || (portfolio.state === 'live' && portfolio.observedAt === null)
    || (portfolio.state !== 'live' && (positions.length !== 0 || openOrders.length !== 0))) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return Object.freeze({
    state: portfolio.state,
    observedAt: portfolio.observedAt,
    positions,
    openOrders,
  })
}

export const parseFuturesProductionExecutionStatus = (raw) => {
  const status = readExactFields(
    parseDuplicateAwareJson(decodeRawUtf8(raw)),
    STATUS_FIELDS,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (status.channelId !== FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID
    || status.action !== FUTURES_PRODUCTION_EXECUTION_ACTIONS.STATUS
    || status.version !== FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION
    || status.marketType !== FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE
    || status.environment !== FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT
    || status.mode !== 'production'
    || typeof status.liveAuthorized !== 'boolean'
    || typeof status.configured !== 'boolean') {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  requireRevision(status.revision, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  const account = normalizeAccount(status.account)
  const caps = normalizeCaps(status.caps)
  const killSwitch = normalizeKillSwitch(status.killSwitch)
  const capabilities = normalizeCapabilities(status.capabilities)
  const intent = normalizeIntent(status.intent)
  const attempt = normalizeAttempt(status.attempt)
  const reconciliation = normalizeReconciliation(status.reconciliation)
  const recovery = normalizeRecovery(status.recovery)
  const portfolio = normalizePortfolio(status.portfolio)
  const anyCapability = CAPABILITY_FIELDS.slice(0, -1).some((field) => capabilities[field])
  if ((status.configured && (account === null || caps === null))
    || (!status.configured && (account !== null || caps !== null))
    || (anyCapability && (!status.liveAuthorized || !status.configured || recovery.required))
    || (capabilities.engageKillSwitch && killSwitch.engaged)
    || (capabilities.disengageKillSwitch && !killSwitch.engaged)
    || (intent !== null && compareFuturesProductionExecutionRevisions(intent.revision, status.revision) > 0)
    || (attempt !== null && compareFuturesProductionExecutionRevisions(attempt.revision, status.revision) > 0)
    || (intent !== null && attempt !== null && intent.requestId === attempt.requestId)) {
    fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS)
  }
  return Object.freeze({
    channelId: status.channelId,
    action: status.action,
    version: status.version,
    revision: status.revision,
    marketType: status.marketType,
    environment: status.environment,
    mode: status.mode,
    liveAuthorized: status.liveAuthorized,
    configured: status.configured,
    account,
    caps,
    killSwitch,
    capabilities,
    intent,
    attempt,
    reconciliation,
    recovery,
    portfolio,
  })
}

export const hasExactFuturesProductionExecutionSessionRequestFields = (value) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'action')
    readExactFields(
      value,
      descriptor?.value === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT
        ? PREPARE_ORDER_FIELDS
        : descriptor?.value
          === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT
          ? PREPARE_MARGIN_FIELDS
          : descriptor?.value
            === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT
            ? PREPARE_AMEND_FIELDS
        : BASE_FIELDS,
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
    )
    return true
  } catch {
    return false
  }
}
