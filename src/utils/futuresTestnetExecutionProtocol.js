export const FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION = 1
export const FUTURES_TESTNET_EXECUTION_CHANNEL_ID = 'futures-execution'
export const FUTURES_TESTNET_EXECUTION_MARKET_TYPE = 'futures'
export const FUTURES_TESTNET_EXECUTION_ENVIRONMENT = 'testnet'
export const FUTURES_TESTNET_EXECUTION_STATUS_MAX_BYTES = 4096

export const FUTURES_TESTNET_EXECUTION_ACTIONS = Object.freeze({
  SUBSCRIBE_STATUS: 'futures.execution.subscribeStatus',
  UNSUBSCRIBE_STATUS: 'futures.execution.unsubscribeStatus',
  PREPARE_INTENT: 'futures.execution.prepareIntent',
  PLACE_ORDER: 'futures.execution.placeOrder',
  STATUS: 'futures.execution.status',
  ACKNOWLEDGEMENT: 'futures.execution.ack',
})

export const FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  UNKNOWN: 'unknown',
})

export const FUTURES_TESTNET_EXECUTION_STATES = Object.freeze({
  LOCALLY_REJECTED: 'locally_rejected',
  QUEUED: 'queued',
  DISPATCHED: 'dispatched',
  EXCHANGE_REJECTED: 'exchange_rejected',
  EXCHANGE_ACCEPTED: 'exchange_accepted',
  RECONCILING: 'reconciling',
  RESULT_UNKNOWN: 'result_unknown',
  CONFIRMED_OPEN: 'confirmed_open',
  CONFIRMED_FILLED: 'confirmed_filled',
  CONFIRMED_CANCELED: 'confirmed_canceled',
  RECONCILIATION_UNAVAILABLE: 'reconciliation_unavailable',
})

export const FUTURES_TESTNET_EXECUTION_SAFE_CODES = Object.freeze({
  ENABLED: 'FUTURES_EXECUTION_ENABLED',
  PENDING: 'FUTURES_EXECUTION_PENDING',
  CONFIRMED: 'FUTURES_EXECUTION_CONFIRMED',
  PROTOCOL_REJECTED: 'FUTURES_EXECUTION_PROTOCOL_REJECTED',
  DISABLED: 'FUTURES_EXECUTION_DISABLED',
  ENVIRONMENT_REJECTED: 'FUTURES_EXECUTION_ENVIRONMENT_REJECTED',
  CREDENTIALS_REJECTED: 'FUTURES_EXECUTION_CREDENTIALS_REJECTED',
  SESSION_REJECTED: 'FUTURES_EXECUTION_SESSION_REJECTED',
  SYMBOL_REJECTED: 'FUTURES_EXECUTION_SYMBOL_REJECTED',
  RISK_DATA_REJECTED: 'FUTURES_EXECUTION_RISK_DATA_REJECTED',
  FILTER_REJECTED: 'FUTURES_EXECUTION_FILTER_REJECTED',
  NOTIONAL_REJECTED: 'FUTURES_EXECUTION_NOTIONAL_REJECTED',
  LEVERAGE_REJECTED: 'FUTURES_EXECUTION_LEVERAGE_REJECTED',
  MARGIN_REJECTED: 'FUTURES_EXECUTION_MARGIN_REJECTED',
  POSITION_REJECTED: 'FUTURES_EXECUTION_POSITION_REJECTED',
  REDUCE_ONLY_REJECTED: 'FUTURES_EXECUTION_REDUCE_ONLY_REJECTED',
  LIQUIDATION_REJECTED: 'FUTURES_EXECUTION_LIQUIDATION_REJECTED',
  DUPLICATE_REJECTED: 'FUTURES_EXECUTION_DUPLICATE_REJECTED',
  INTERRUPTED_BEFORE_DISPATCH: 'FUTURES_EXECUTION_INTERRUPTED_BEFORE_DISPATCH',
  BUSY: 'FUTURES_EXECUTION_BUSY',
  RATE_LIMITED: 'FUTURES_EXECUTION_RATE_LIMITED',
  AUTH_REJECTED: 'FUTURES_EXECUTION_AUTH_REJECTED',
  EXCHANGE_REJECTED: 'FUTURES_EXECUTION_EXCHANGE_REJECTED',
  RESULT_UNKNOWN: 'FUTURES_EXECUTION_RESULT_UNKNOWN',
  RECONCILIATION_UNAVAILABLE: 'FUTURES_EXECUTION_RECONCILIATION_UNAVAILABLE',
})

export const FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES = Object.freeze({
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING]: 'Testnet reduce-only order is pending.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED]: 'Testnet reduce-only order is confirmed.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED]: 'Testnet reduce-only order command was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED]: 'Testnet futures execution is disabled.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENVIRONMENT_REJECTED]: 'Testnet futures execution environment was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.CREDENTIALS_REJECTED]: 'Testnet futures execution credentials were rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED]: 'Testnet futures execution session was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED]: 'Testnet futures execution symbol was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED]: 'Testnet futures execution risk data was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED]: 'Testnet futures execution filters rejected the order.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED]: 'Testnet futures execution notional limits rejected the order.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED]: 'Testnet futures execution leverage was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED]: 'Testnet futures execution margin state was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED]: 'Testnet futures execution position was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED]: 'Testnet futures execution reduce-only checks rejected the order.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED]: 'Testnet futures execution liquidation distance was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.DUPLICATE_REJECTED]: 'Testnet futures execution duplicate identity was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.INTERRUPTED_BEFORE_DISPATCH]: 'Testnet reduce-only order was interrupted before dispatch.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY]: 'Testnet futures execution is busy.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED]: 'Testnet futures execution is rate limited.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED]: 'Testnet futures execution authentication was rejected.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED]: 'Testnet futures exchange rejected the order.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN]: 'Testnet reduce-only order result is unknown.',
  [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE]: 'Testnet reduce-only order reconciliation is unavailable.',
})

export const FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES = Object.freeze({
  INVALID_ENCODING: 'FUTURES_TESTNET_EXECUTION_INVALID_ENCODING',
  MESSAGE_TOO_LARGE: 'FUTURES_TESTNET_EXECUTION_MESSAGE_TOO_LARGE',
  INVALID_JSON: 'FUTURES_TESTNET_EXECUTION_INVALID_JSON',
  INVALID_MESSAGE: 'FUTURES_TESTNET_EXECUTION_INVALID_MESSAGE',
  INVALID_FIELDS: 'FUTURES_TESTNET_EXECUTION_INVALID_FIELDS',
  INVALID_ACTION: 'FUTURES_TESTNET_EXECUTION_INVALID_ACTION',
  INVALID_SYMBOL: 'FUTURES_TESTNET_EXECUTION_INVALID_SYMBOL',
  INVALID_INTENT: 'FUTURES_TESTNET_EXECUTION_INVALID_INTENT',
  INVALID_STATUS: 'FUTURES_TESTNET_EXECUTION_INVALID_STATUS',
  INVALID_COMMAND: 'FUTURES_TESTNET_EXECUTION_INVALID_COMMAND',
})

export class FuturesTestnetExecutionRendererProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FuturesTestnetExecutionRendererProtocolError'
    this.code = code
  }
}

const SESSION_REQUEST_FIELDS = Object.freeze([
  'action',
  'version',
  'revision',
  'marketType',
  'environment',
  'symbol',
])
const STATUS_FIELDS = Object.freeze([
  'channelId',
  'action',
  'version',
  'revision',
  'marketType',
  'environment',
  'symbol',
  'capability',
  'intent',
  'attempt',
])
const CAPABILITY_FIELDS = Object.freeze(['enabled', 'code'])
const INTENT_FIELDS = Object.freeze([
  'requestId', 'clientOrderId', 'symbol', 'side', 'leverage', 'expiresAt',
])
const ACK_FIELDS = Object.freeze([
  'channelId',
  'action',
  'version',
  'revision',
  'requestId',
  'marketType',
  'environment',
  'symbol',
  'clientOrderId',
  'acknowledgement',
  'state',
  'code',
  'message',
  'observedAt',
  'order',
])
const ORDER_FIELDS = Object.freeze([
  'orderId',
  'status',
  'originalQuantity',
  'executedQuantity',
  'averagePrice',
  'updateTime',
])
const COMMAND_FIELDS = Object.freeze([
  'action',
  'version',
  'requestId',
  'marketType',
  'environment',
  'symbol',
  'side',
  'orderType',
  'quantity',
  'price',
  'timeInForce',
  'positionSide',
  'marginType',
  'leverage',
  'reduceOnly',
  'workingType',
  'priceProtect',
  'clientOrderId',
])

const STATUS_REQUEST_ACTIONS = new Set([
  FUTURES_TESTNET_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
  FUTURES_TESTNET_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS,
  FUTURES_TESTNET_EXECUTION_ACTIONS.PREPARE_INTENT,
])
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/
const POSITIVE_DECIMAL_PATTERN = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/
const CANONICAL_UNSIGNED_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/
const MAX_SAFE_INTEGER = 9_007_199_254_740_991
const MAX_SIGNED_INT64_TEXT = '9223372036854775807'
const ORDER_STATUSES = new Set([
  'NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'EXPIRED',
  'EXPIRED_IN_MATCH',
  'REJECTED',
])
const CAPABILITY_DISABLED_CODES = new Set(
  Object.values(FUTURES_TESTNET_EXECUTION_SAFE_CODES)
    .filter((code) => ![
      FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENABLED,
      FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING,
      FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
    ].includes(code)),
)
const LOCAL_REJECTION_CODES = new Set([
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENVIRONMENT_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.CREDENTIALS_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.DUPLICATE_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.INTERRUPTED_BEFORE_DISPATCH,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED,
])
const EXCHANGE_REJECTION_CODES = new Set([
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
])

const protocolError = (code, message) => (
  new FuturesTestnetExecutionRendererProtocolError(code, message)
)

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
)

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
    if (raw.length > FUTURES_TESTNET_EXECUTION_STATUS_MAX_BYTES || !hasOnlyUnicodeScalars(raw)) {
      throw protocolError(
        raw.length > FUTURES_TESTNET_EXECUTION_STATUS_MAX_BYTES
          ? FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE
          : FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING,
        'Futures testnet execution status is not bounded UTF-8 text',
      )
    }
    bytes = new TextEncoder().encode(raw)
    text = raw
  } else if (raw instanceof Uint8Array) {
    if (raw.byteLength > FUTURES_TESTNET_EXECUTION_STATUS_MAX_BYTES) {
      throw protocolError(
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE,
        'Futures testnet execution status exceeds the message bound',
      )
    }
    bytes = raw
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    } catch {
      throw protocolError(
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING,
        'Futures testnet execution status is not valid UTF-8 text',
      )
    }
  } else {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
      'Futures testnet execution status must be raw UTF-8 text',
    )
  }
  if (bytes.byteLength > FUTURES_TESTNET_EXECUTION_STATUS_MAX_BYTES) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE,
      'Futures testnet execution status exceeds the message bound',
    )
  }
  return text
}

const parseDuplicateAwareJsonObject = (text) => {
  let cursor = 0
  const fail = () => {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
      'Futures testnet execution status must be strict duplicate-free JSON',
    )
  }
  const skipWhitespace = () => {
    while ([' ', '\n', '\r', '\t'].includes(text[cursor])) cursor += 1
  }
  const parseString = () => {
    if (text[cursor] !== '"') fail()
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
      if (codeUnit < 0x20) fail()
      if (character === '\\') {
        cursor += 1
        const escape = text[cursor]
        if (escape === 'u') {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!/[0-9A-Fa-f]/.test(text[cursor + offset] ?? '')) fail()
          }
          cursor += 5
          continue
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail()
        cursor += 1
        continue
      }
      cursor += 1
    }
    if (!closed) fail()
    let value
    try {
      value = JSON.parse(text.slice(start, cursor))
    } catch {
      fail()
    }
    if (!hasOnlyUnicodeScalars(value)) fail()
    return value
  }
  const parseInteger = () => {
    const start = cursor
    if (text[cursor] === '-') cursor += 1
    if (text[cursor] === '0') {
      cursor += 1
      if (/[0-9]/.test(text[cursor] ?? '')) fail()
    } else {
      if (!/[1-9]/.test(text[cursor] ?? '')) fail()
      while (/[0-9]/.test(text[cursor] ?? '')) cursor += 1
    }
    if (['.', 'e', 'E'].includes(text[cursor])) fail()
    let value
    try {
      value = JSON.parse(text.slice(start, cursor))
    } catch {
      fail()
    }
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail()
    return value
  }
  const parseLiteral = (literal, value) => {
    if (text.slice(cursor, cursor + literal.length) !== literal) fail()
    cursor += literal.length
    return value
  }
  const parseValue = (depth) => {
    skipWhitespace()
    if (text[cursor] === '"') return parseString()
    if (text[cursor] === '{') return parseObject(depth + 1)
    if (text[cursor] === 't') return parseLiteral('true', true)
    if (text[cursor] === 'f') return parseLiteral('false', false)
    if (text[cursor] === 'n') return parseLiteral('null', null)
    if (text[cursor] === '[') fail()
    return parseInteger()
  }
  const parseObject = (depth) => {
    if (depth > 4 || text[cursor] !== '{') fail()
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
      if (keys.has(key)) fail()
      keys.add(key)
      skipWhitespace()
      if (text[cursor] !== ':') fail()
      cursor += 1
      entries.push([key, parseValue(depth)])
      skipWhitespace()
      if (text[cursor] === '}') {
        cursor += 1
        return Object.fromEntries(entries)
      }
      if (text[cursor] !== ',') fail()
      cursor += 1
      skipWhitespace()
    }
    fail()
    return null
  }
  skipWhitespace()
  const result = parseObject(1)
  skipWhitespace()
  if (cursor !== text.length) fail()
  return result
}

const readExactFields = (value, expectedFields, code) => {
  if (!isRecord(value)) {
    throw protocolError(code, 'Futures testnet execution value must be an ordinary object')
  }
  const actual = Reflect.ownKeys(value)
  const expected = new Set(expectedFields)
  if (actual.length !== expectedFields.length
    || actual.some((key) => typeof key !== 'string'
      || !expected.has(key)
      || Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true)) {
    throw protocolError(code, 'Futures testnet execution value has missing or unsupported fields')
  }
  return value
}

const requireSymbol = (symbol) => {
  if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol)) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL,
      'Futures testnet execution symbol is invalid',
    )
  }
  return symbol
}

const requireSafeTimestamp = (value) => (
  Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE_INTEGER
)

const requireCanonicalPositiveDecimal = (value) => {
  if (typeof value !== 'string' || value.length > 42 || !POSITIVE_DECIMAL_PATTERN.test(value)) return false
  const [integer, fraction = ''] = value.split('.')
  return integer.length + fraction.length <= 40 && fraction.length <= 18
}

const requireCanonicalNonNegativeDecimal = (value) => {
  if (typeof value !== 'string'
    || value.length > 42
    || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    return false
  }
  const [integer, fraction = ''] = value.split('.')
  return integer.length + fraction.length <= 40 && fraction.length <= 18
}

const compareCanonicalUnsignedText = (left, right) => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

export const compareFuturesTestnetExecutionRevisions = (left, right) => {
  if (typeof left !== 'string' || !REVISION_PATTERN.test(left)
    || typeof right !== 'string' || !REVISION_PATTERN.test(right)) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'Futures testnet execution revisions must be canonical decimal strings',
    )
  }
  return compareCanonicalUnsignedText(left, right)
}

const normalizeCapability = (value) => {
  const capability = readExactFields(
    value,
    CAPABILITY_FIELDS,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  const validCode = capability.enabled === true
    ? capability.code === FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENABLED
    : capability.enabled === false && CAPABILITY_DISABLED_CODES.has(capability.code)
  if (!validCode) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'Futures testnet execution capability is invalid',
    )
  }
  return Object.freeze({ enabled: capability.enabled, code: capability.code })
}

const normalizeIntent = (value, expectedSymbol = null) => {
  if (value === null) return null
  const intent = readExactFields(
    value,
    INTENT_FIELDS,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_INTENT,
  )
  if (typeof intent.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(intent.requestId)
    || intent.clientOrderId !== `cc6-${intent.requestId}`
    || typeof intent.symbol !== 'string'
    || !SYMBOL_PATTERN.test(intent.symbol)
    || (expectedSymbol !== null && intent.symbol !== expectedSymbol)
    || !['BUY', 'SELL'].includes(intent.side)
    || !Number.isSafeInteger(intent.leverage)
    || intent.leverage < 1
    || intent.leverage > 3
    || !requireSafeTimestamp(intent.expiresAt)) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_INTENT,
      'Futures testnet execution intent is invalid',
    )
  }
  return Object.freeze({
    requestId: intent.requestId,
    clientOrderId: intent.clientOrderId,
    symbol: intent.symbol,
    side: intent.side,
    leverage: intent.leverage,
    expiresAt: intent.expiresAt,
  })
}

const normalizeOrder = (value) => {
  if (value === null) return null
  const order = readExactFields(
    value,
    ORDER_FIELDS,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (typeof order.orderId !== 'string'
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(order.orderId)
    || order.orderId === '0'
    || compareCanonicalUnsignedText(order.orderId, MAX_SIGNED_INT64_TEXT) > 0
    || !ORDER_STATUSES.has(order.status)
    || !requireCanonicalPositiveDecimal(order.originalQuantity)
    || !requireCanonicalNonNegativeDecimal(order.executedQuantity)
    || !requireCanonicalNonNegativeDecimal(order.averagePrice)
    || !requireSafeTimestamp(order.updateTime)) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'Futures testnet execution order summary is invalid',
    )
  }
  return Object.freeze(Object.fromEntries(ORDER_FIELDS.map((field) => [field, order[field]])))
}

const isValidAttemptMatrix = ({ acknowledgement, state, code, order }) => {
  const acknowledgements = FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS
  const states = FUTURES_TESTNET_EXECUTION_STATES
  const codes = FUTURES_TESTNET_EXECUTION_SAFE_CODES
  const nonRejectedOrder = order === null || order.status !== 'REJECTED'
  if (state === states.LOCALLY_REJECTED) {
    return acknowledgement === acknowledgements.REJECTED && LOCAL_REJECTION_CODES.has(code) && order === null
  }
  if (state === states.EXCHANGE_REJECTED) {
    return acknowledgement === acknowledgements.REJECTED && EXCHANGE_REJECTION_CODES.has(code) && order === null
  }
  if (state === states.QUEUED || state === states.DISPATCHED) {
    return acknowledgement === acknowledgements.PENDING && code === codes.PENDING && order === null
  }
  if (state === states.RECONCILING) {
    return acknowledgement === acknowledgements.PENDING && code === codes.PENDING && nonRejectedOrder
  }
  if (state === states.EXCHANGE_ACCEPTED) {
    return acknowledgement === acknowledgements.ACCEPTED && code === codes.CONFIRMED && order !== null && nonRejectedOrder
  }
  if (state === states.CONFIRMED_OPEN) {
    return acknowledgement === acknowledgements.ACCEPTED
      && code === codes.CONFIRMED
      && (order?.status === 'NEW' || order?.status === 'PARTIALLY_FILLED')
  }
  if (state === states.CONFIRMED_FILLED) {
    return acknowledgement === acknowledgements.ACCEPTED && code === codes.CONFIRMED && order?.status === 'FILLED'
  }
  if (state === states.CONFIRMED_CANCELED) {
    return acknowledgement === acknowledgements.ACCEPTED
      && code === codes.CONFIRMED
      && ['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(order?.status)
  }
  if (state === states.RESULT_UNKNOWN) {
    return acknowledgement === acknowledgements.UNKNOWN && code === codes.RESULT_UNKNOWN && nonRejectedOrder
  }
  if (state === states.RECONCILIATION_UNAVAILABLE) {
    return acknowledgement === acknowledgements.UNKNOWN && code === codes.RECONCILIATION_UNAVAILABLE && nonRejectedOrder
  }
  return false
}

const normalizeAttempt = (value, symbol) => {
  if (value === null) return null
  const attempt = readExactFields(
    value,
    ACK_FIELDS,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  const order = normalizeOrder(attempt.order)
  const safeMessage = FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES[attempt.code]
  const protocolRejection = attempt.code === FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED
  const identitiesAreNull = attempt.requestId === null
    && attempt.symbol === null
    && attempt.clientOrderId === null
  const identitiesAreValid = typeof attempt.requestId === 'string'
    && REQUEST_ID_PATTERN.test(attempt.requestId)
    && attempt.symbol === symbol
    && attempt.clientOrderId === `cc6-${attempt.requestId}`
  if (attempt.channelId !== FUTURES_TESTNET_EXECUTION_CHANNEL_ID
    || attempt.action !== FUTURES_TESTNET_EXECUTION_ACTIONS.ACKNOWLEDGEMENT
    || attempt.version !== FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION
    || typeof attempt.revision !== 'string'
    || !REVISION_PATTERN.test(attempt.revision)
    || attempt.marketType !== FUTURES_TESTNET_EXECUTION_MARKET_TYPE
    || attempt.environment !== FUTURES_TESTNET_EXECUTION_ENVIRONMENT
    || (protocolRejection ? !identitiesAreNull : !identitiesAreValid)
    || attempt.message !== safeMessage
    || !requireSafeTimestamp(attempt.observedAt)
    || !isValidAttemptMatrix({
      acknowledgement: attempt.acknowledgement,
      state: attempt.state,
      code: attempt.code,
      order,
    })) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'Futures testnet execution attempt is invalid',
    )
  }
  return Object.freeze({
    ...Object.fromEntries(ACK_FIELDS.filter((field) => field !== 'order').map((field) => [field, attempt[field]])),
    order,
  })
}

export const createFuturesTestnetExecutionStatusRequest = (action, {
  symbol,
  revision = '0',
} = {}) => {
  if (!STATUS_REQUEST_ACTIONS.has(action)) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION,
      'Unsupported futures testnet execution status action',
    )
  }
  requireSymbol(symbol)
  if (typeof revision !== 'string' || !REVISION_PATTERN.test(revision)) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND,
      'Futures testnet execution request revision is invalid',
    )
  }
  return Object.freeze({
    action,
    version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    symbol,
  })
}

export const createFuturesTestnetExecutionSubscribeStatusRequest = (options) => (
  createFuturesTestnetExecutionStatusRequest(
    FUTURES_TESTNET_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
    options,
  )
)

export const createFuturesTestnetExecutionUnsubscribeStatusRequest = (options) => (
  createFuturesTestnetExecutionStatusRequest(
    FUTURES_TESTNET_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS,
    options,
  )
)

export const createFuturesTestnetExecutionPrepareIntentRequest = (options) => (
  createFuturesTestnetExecutionStatusRequest(
    FUTURES_TESTNET_EXECUTION_ACTIONS.PREPARE_INTENT,
    options,
  )
)

export const createFuturesTestnetExecutionPlaceOrderRequest = ({
  intent,
  symbol,
  quantity,
  price,
} = {}) => {
  requireSymbol(symbol)
  let normalizedIntent
  try {
    normalizedIntent = normalizeIntent(intent, symbol)
  } catch {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND,
      'Futures testnet execution place-order input is invalid',
    )
  }
  if (normalizedIntent === null
    || !requireCanonicalPositiveDecimal(quantity)
    || !requireCanonicalPositiveDecimal(price)
  ) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND,
      'Futures testnet execution place-order input is invalid',
    )
  }
  const command = {
    action: FUTURES_TESTNET_EXECUTION_ACTIONS.PLACE_ORDER,
    version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    requestId: normalizedIntent.requestId,
    marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    symbol,
    side: normalizedIntent.side,
    orderType: 'LIMIT',
    quantity,
    price,
    timeInForce: 'GTC',
    positionSide: 'BOTH',
    marginType: 'ISOLATED',
    leverage: normalizedIntent.leverage,
    reduceOnly: true,
    workingType: null,
    priceProtect: false,
    clientOrderId: normalizedIntent.clientOrderId,
  }
  return Object.freeze(Object.fromEntries(COMMAND_FIELDS.map((field) => [field, command[field]])))
}

export const parseFuturesTestnetExecutionStatus = (raw) => {
  const status = readExactFields(
    parseDuplicateAwareJsonObject(decodeRawUtf8(raw)),
    STATUS_FIELDS,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
  )
  if (status.channelId !== FUTURES_TESTNET_EXECUTION_CHANNEL_ID
    || status.action !== FUTURES_TESTNET_EXECUTION_ACTIONS.STATUS
    || status.version !== FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION
    || typeof status.revision !== 'string'
    || !REVISION_PATTERN.test(status.revision)
    || status.marketType !== FUTURES_TESTNET_EXECUTION_MARKET_TYPE
    || status.environment !== FUTURES_TESTNET_EXECUTION_ENVIRONMENT) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'Futures testnet execution status envelope is invalid',
    )
  }
  const symbol = requireSymbol(status.symbol)
  const capability = normalizeCapability(status.capability)
  const intent = normalizeIntent(status.intent, symbol)
  const attempt = normalizeAttempt(status.attempt, symbol)
  if (attempt !== null
    && compareFuturesTestnetExecutionRevisions(attempt.revision, status.revision) > 0) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'Futures testnet execution attempt revision exceeds its status revision',
    )
  }
  if (intent !== null && attempt !== null && intent.requestId === attempt.requestId) {
    throw protocolError(
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      'A consumed futures testnet execution intent cannot remain active',
    )
  }
  return Object.freeze({
    channelId: status.channelId,
    action: status.action,
    version: status.version,
    revision: status.revision,
    marketType: status.marketType,
    environment: status.environment,
    symbol,
    capability,
    intent,
    attempt,
  })
}

export const hasExactFuturesTestnetExecutionSessionRequestFields = (value) => {
  try {
    readExactFields(
      value,
      SESSION_REQUEST_FIELDS,
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
    )
    return true
  } catch {
    return false
  }
}
