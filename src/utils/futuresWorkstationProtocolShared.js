export const FUTURES_WORKSTATION_MARKET_TYPE = 'USD_M_FUTURES'
export const FUTURES_WORKSTATION_PROTOCOL_VERSION = '4'
export const FUTURES_WORKSTATION_REQUEST_MAX_BYTES = 1_024
export const FUTURES_WORKSTATION_EVENT_MAX_BYTES = 15 * 1_024
export const FUTURES_WORKSTATION_UINT64_MAX = '18446744073709551615'

export const FUTURES_WORKSTATION_INTERVALS = Object.freeze([
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
])

export const FUTURES_WORKSTATION_RESOURCES = Object.freeze({
  STATUS: 'status',
  CATALOG: 'catalog',
  HEADER: 'header',
  CANDLES: 'candles',
  DEPTH: 'depth',
  TRADES: 'trades',
})

export const FUTURES_WORKSTATION_STATES = Object.freeze({
  LOADING: 'loading',
  LIVE: 'live',
  STALE: 'stale',
  DISCONNECTED: 'disconnected',
  RESYNCHRONIZING: 'resynchronizing',
  UNAVAILABLE: 'unavailable',
})

const RESOURCE_VALUES = new Set(Object.values(FUTURES_WORKSTATION_RESOURCES))
const STATE_VALUES = new Set(Object.values(FUTURES_WORKSTATION_STATES))
const INTERVAL_VALUES = new Set(FUTURES_WORKSTATION_INTERVALS)
const SYMBOL_PATTERN = /^(?:[A-Z0-9]{1,20}|[A-Z0-9]{1,13}_[0-9]{6})$/
const PAIR_PATTERN = /^[A-Z0-9]{1,20}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/
const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const NONNEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const NON_LIVE_RESOURCE_STATES = new Set([
  FUTURES_WORKSTATION_STATES.DISCONNECTED,
  FUTURES_WORKSTATION_STATES.RESYNCHRONIZING,
  FUTURES_WORKSTATION_STATES.UNAVAILABLE,
])

export class FuturesWorkstationProtocolError extends Error {
  constructor(code) {
    super('Futures workstation protocol value was rejected')
    this.name = 'FuturesWorkstationProtocolError'
    this.code = code
  }
}

const fail = (code) => {
  throw new FuturesWorkstationProtocolError(code)
}

export const isFuturesWorkstationRecord = value => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

export const hasExactFuturesWorkstationKeys = (value, expectedKeys) => {
  if (!isFuturesWorkstationRecord(value)) return false
  const actualKeys = Object.keys(value).sort()
  const sortedExpected = [...expectedKeys].sort()
  return actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index])
}

export const isCanonicalFuturesDecimal = value => (
  typeof value === 'string'
  && value.length <= 64
  && DECIMAL_PATTERN.test(value)
)

export const isCanonicalFuturesIdentity = value => (
  typeof value === 'string'
  && UNSIGNED_INTEGER_PATTERN.test(value)
  && (value.length < FUTURES_WORKSTATION_UINT64_MAX.length
    || (value.length === FUTURES_WORKSTATION_UINT64_MAX.length
      && value <= FUTURES_WORKSTATION_UINT64_MAX))
)

export const isFuturesWorkstationSymbol = value => (
  typeof value === 'string' && SYMBOL_PATTERN.test(value)
)

export const isFuturesWorkstationInterval = value => INTERVAL_VALUES.has(value)

const isSafeTimestamp = value => Number.isSafeInteger(value) && value >= 0
const isPositiveSafeInteger = value => Number.isSafeInteger(value) && value > 0
const isReasonCode = value => (
  value === null
  || (typeof value === 'string' && /^[A-Z0-9_]{1,96}$/.test(value))
)

const utf8Length = (value) => new TextEncoder().encode(value).byteLength

const hasOnlyUnicodeScalars = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

export const parseBoundedFuturesWorkstationJson = (
  text,
  {
    maxBytes,
    maxDepth = 12,
    maxNodes = 8_192,
    maxStringBytes = 8_192,
  },
) => {
  if (typeof text !== 'string'
    || utf8Length(text) > maxBytes
    || !hasOnlyUnicodeScalars(text)) {
    fail('INVALID_JSON_ENCODING')
  }

  let cursor = 0
  let nodes = 0
  const countNode = () => {
    nodes += 1
    if (nodes > maxNodes) fail('JSON_RESOURCE_LIMIT')
  }
  const skipWhitespace = () => {
    while ([' ', '\n', '\r', '\t'].includes(text[cursor])) cursor += 1
  }
  const parseString = () => {
    if (text[cursor] !== '"') fail('INVALID_JSON')
    const start = cursor
    cursor += 1
    let closed = false
    while (cursor < text.length) {
      const character = text[cursor]
      const unit = text.charCodeAt(cursor)
      if (character === '"') {
        cursor += 1
        closed = true
        break
      }
      if (unit < 0x20) fail('INVALID_JSON')
      if (character === '\\') {
        cursor += 1
        const escape = text[cursor]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor + 1, cursor + 5))) {
            fail('INVALID_JSON')
          }
          cursor += 5
          continue
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
          fail('INVALID_JSON')
        }
        cursor += 1
        continue
      }
      cursor += 1
    }
    if (!closed) fail('INVALID_JSON')
    let value
    try {
      value = JSON.parse(text.slice(start, cursor))
    } catch {
      fail('INVALID_JSON')
    }
    if (!hasOnlyUnicodeScalars(value) || utf8Length(value) > maxStringBytes) {
      fail('JSON_RESOURCE_LIMIT')
    }
    return value
  }
  const parseInteger = () => {
    const start = cursor
    if (text[cursor] === '-') cursor += 1
    if (text[cursor] === '0') {
      cursor += 1
      if (/^[0-9]$/.test(text[cursor] ?? '')) fail('INVALID_JSON')
    } else {
      if (!/^[1-9]$/.test(text[cursor] ?? '')) fail('INVALID_JSON')
      while (/^[0-9]$/.test(text[cursor] ?? '')) cursor += 1
    }
    if (['.', 'e', 'E'].includes(text[cursor])) fail('INVALID_JSON_NUMBER')
    const value = Number(text.slice(start, cursor))
    if (!Number.isSafeInteger(value)) fail('UNSAFE_JSON_INTEGER')
    return value
  }
  const parseObject = (depth) => {
    cursor += 1
    skipWhitespace()
    const result = Object.create(null)
    const keys = new Set()
    if (text[cursor] === '}') {
      cursor += 1
      return result
    }
    while (cursor < text.length) {
      const key = parseString()
      if (keys.has(key)) fail('DUPLICATE_JSON_KEY')
      keys.add(key)
      skipWhitespace()
      if (text[cursor] !== ':') fail('INVALID_JSON')
      cursor += 1
      result[key] = parseValue(depth)
      skipWhitespace()
      if (text[cursor] === '}') {
        cursor += 1
        return result
      }
      if (text[cursor] !== ',') fail('INVALID_JSON')
      cursor += 1
      skipWhitespace()
    }
    fail('INVALID_JSON')
  }
  const parseArray = (depth) => {
    cursor += 1
    skipWhitespace()
    const result = []
    if (text[cursor] === ']') {
      cursor += 1
      return result
    }
    while (cursor < text.length) {
      result.push(parseValue(depth))
      skipWhitespace()
      if (text[cursor] === ']') {
        cursor += 1
        return result
      }
      if (text[cursor] !== ',') fail('INVALID_JSON')
      cursor += 1
      skipWhitespace()
    }
    fail('INVALID_JSON')
  }
  const parseValue = (depth) => {
    if (depth > maxDepth) fail('JSON_RESOURCE_LIMIT')
    countNode()
    skipWhitespace()
    if (text[cursor] === '"') return parseString()
    if (text[cursor] === '{') return parseObject(depth + 1)
    if (text[cursor] === '[') return parseArray(depth + 1)
    if (text.slice(cursor, cursor + 4) === 'true') {
      cursor += 4
      return true
    }
    if (text.slice(cursor, cursor + 5) === 'false') {
      cursor += 5
      return false
    }
    if (text.slice(cursor, cursor + 4) === 'null') {
      cursor += 4
      return null
    }
    return parseInteger()
  }

  skipWhitespace()
  const result = parseValue(0)
  skipWhitespace()
  if (cursor !== text.length) fail('INVALID_JSON')
  return result
}

export const freezeFuturesWorkstationValue = (value) => {
  if (Array.isArray(value)) {
    value.forEach(freezeFuturesWorkstationValue)
    return Object.freeze(value)
  }
  if (isFuturesWorkstationRecord(value)) {
    Object.values(value).forEach(freezeFuturesWorkstationValue)
    return Object.freeze(value)
  }
  return value
}

const isCanonicalNonnegativeFuturesDecimal = value => (
  typeof value === 'string'
  && value.length <= 64
  && NONNEGATIVE_DECIMAL_PATTERN.test(value)
)

const isCanonicalPositiveFuturesDecimal = value => (
  isCanonicalNonnegativeFuturesDecimal(value)
  && !/^0(?:\.0+)?$/.test(value)
)

const validateRangeFilter = (value, stepKey, allowDisabled) => (
  value === null
  || (hasExactFuturesWorkstationKeys(value, ['min', 'max', stepKey])
    && isCanonicalNonnegativeFuturesDecimal(value.min)
    && (allowDisabled
      ? isCanonicalNonnegativeFuturesDecimal(value.max)
      : isCanonicalPositiveFuturesDecimal(value.max))
    && (allowDisabled
      ? isCanonicalNonnegativeFuturesDecimal(value[stepKey])
      : isCanonicalPositiveFuturesDecimal(value[stepKey])))
)

const validatePercentPriceFilter = value => (
  hasExactFuturesWorkstationKeys(value, [
    'multiplierUp',
    'multiplierDown',
    'multiplierDecimal',
  ])
  && isCanonicalPositiveFuturesDecimal(value.multiplierUp)
  && isCanonicalPositiveFuturesDecimal(value.multiplierDown)
  && Number.isSafeInteger(value.multiplierDecimal)
  && value.multiplierDecimal >= 0
  && value.multiplierDecimal <= 18
)

const validateContract = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'symbol',
    'pair',
    'contractType',
    'status',
    'baseAsset',
    'quoteAsset',
    'marginAsset',
    'allowlisted',
    'filters',
  ])
  && isFuturesWorkstationSymbol(value.symbol)
  && typeof value.pair === 'string'
  && PAIR_PATTERN.test(value.pair)
  && typeof value.contractType === 'string'
  && value.contractType.length > 0
  && value.contractType.length <= 32
  && typeof value.status === 'string'
  && value.status.length > 0
  && value.status.length <= 32
  && /^[A-Z0-9]{1,16}$/.test(value.baseAsset)
  && /^[A-Z0-9]{1,16}$/.test(value.quoteAsset)
  && value.marginAsset === 'USDT'
  && typeof value.allowlisted === 'boolean'
  && hasExactFuturesWorkstationKeys(value.filters, [
    'price',
    'quantity',
    'marketQuantity',
    'percentPrice',
    'maximumOrders',
    'maximumAlgoOrders',
    'minimumNotional',
  ])
  && validateRangeFilter(value.filters.price, 'tickSize', true)
  && validateRangeFilter(value.filters.quantity, 'stepSize', false)
  && validateRangeFilter(value.filters.marketQuantity, 'stepSize', false)
  && validatePercentPriceFilter(value.filters.percentPrice)
  && Number.isSafeInteger(value.filters.maximumOrders)
  && value.filters.maximumOrders >= 0
  && (value.filters.maximumAlgoOrders === null
    || isPositiveSafeInteger(value.filters.maximumAlgoOrders))
  && isCanonicalNonnegativeFuturesDecimal(value.filters.minimumNotional)
)

const validateCatalog = (value) => (
  hasExactFuturesWorkstationKeys(value, ['offset', 'total', 'complete', 'contracts'])
  && Number.isSafeInteger(value.offset)
  && value.offset >= 0
  && Number.isSafeInteger(value.total)
  && value.total >= 0
  && value.total <= 1_024
  && typeof value.complete === 'boolean'
  && Array.isArray(value.contracts)
  && value.contracts.length <= 8
  && value.contracts.every(validateContract)
)

const validateHeader = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'lastPrice',
    'markPrice',
    'indexPrice',
    'basis',
    'priceChange',
    'priceChangePercent',
    'highPrice',
    'lowPrice',
    'volume',
    'quoteVolume',
    'lastQuantity',
    'fundingRate',
    'fundingRatePercent',
    'nextFundingTime',
    'eventTime',
    'contractStatus',
  ])
  && [
    value.lastPrice,
    value.markPrice,
    value.indexPrice,
    value.basis,
    value.priceChange,
    value.priceChangePercent,
    value.highPrice,
    value.lowPrice,
    value.volume,
    value.quoteVolume,
    value.lastQuantity,
    value.fundingRate,
    value.fundingRatePercent,
  ].every(isCanonicalFuturesDecimal)
  && isSafeTimestamp(value.nextFundingTime)
  && isSafeTimestamp(value.eventTime)
  && typeof value.contractStatus === 'string'
  && value.contractStatus.length > 0
  && value.contractStatus.length <= 32
)

const validateCandle = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'openTime',
    'closeTime',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'closed',
  ])
  && isSafeTimestamp(value.openTime)
  && isSafeTimestamp(value.closeTime)
  && value.closeTime >= value.openTime
  && [value.open, value.high, value.low, value.close, value.volume]
    .every(isCanonicalFuturesDecimal)
  && typeof value.closed === 'boolean'
)

const validateCandles = (value) => (
  hasExactFuturesWorkstationKeys(value, ['series', 'interval', 'rows'])
  && ['contract', 'mark', 'index'].includes(value.series)
  && isFuturesWorkstationInterval(value.interval)
  && Array.isArray(value.rows)
  && value.rows.length <= 80
  && value.rows.every(validateCandle)
)

const validateDepthLevel = (value) => (
  hasExactFuturesWorkstationKeys(value, ['price', 'quantity', 'total'])
  && [value.price, value.quantity, value.total].every(isCanonicalFuturesDecimal)
)

const validateDepth = (value) => (
  hasExactFuturesWorkstationKeys(value, ['lastUpdateId', 'bids', 'asks', 'spread'])
  && isCanonicalFuturesIdentity(value.lastUpdateId)
  && Array.isArray(value.bids)
  && Array.isArray(value.asks)
  && value.bids.length <= 24
  && value.asks.length <= 24
  && value.bids.every(validateDepthLevel)
  && value.asks.every(validateDepthLevel)
  && isCanonicalFuturesDecimal(value.spread)
)

const validateTrade = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'aggregateTradeId',
    'price',
    'quantity',
    'normalQuantity',
    'firstTradeId',
    'lastTradeId',
    'tradeTime',
    'buyerMaker',
  ])
  && [value.aggregateTradeId, value.firstTradeId, value.lastTradeId]
    .every(isCanonicalFuturesIdentity)
  && [value.price, value.quantity, value.normalQuantity]
    .every(isCanonicalFuturesDecimal)
  && isSafeTimestamp(value.tradeTime)
  && typeof value.buyerMaker === 'boolean'
)

const validateTrades = (value) => (
  hasExactFuturesWorkstationKeys(value, ['rows'])
  && Array.isArray(value.rows)
  && value.rows.length <= 80
  && value.rows.every(validateTrade)
)

const validateStatus = (value) => (
  hasExactFuturesWorkstationKeys(value, ['connected', 'reasonCode'])
  && typeof value.connected === 'boolean'
  && isReasonCode(value.reasonCode)
)

export const validateFuturesWorkstationPayload = (resource, payload) => {
  if (resource === FUTURES_WORKSTATION_RESOURCES.STATUS) return validateStatus(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.CATALOG) return validateCatalog(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.HEADER) return validateHeader(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.CANDLES) return validateCandles(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.DEPTH) return validateDepth(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.TRADES) return validateTrades(payload)
  return false
}

export const validateFuturesWorkstationRequest = ({
  value,
  channelId,
  environment,
  actions,
}) => {
  if (!isFuturesWorkstationRecord(value)
    || value.channelId !== channelId
    || value.version !== FUTURES_WORKSTATION_PROTOCOL_VERSION
    || value.marketType !== FUTURES_WORKSTATION_MARKET_TYPE
    || value.environment !== environment
    || !Object.values(actions).includes(value.action)
    || !REQUEST_ID_PATTERN.test(value.requestId ?? '')) {
    fail('INVALID_REQUEST_IDENTITY')
  }

  if (value.action === actions.UNSUBSCRIBE) {
    if (!hasExactFuturesWorkstationKeys(value, [
      'channelId', 'version', 'marketType', 'environment', 'action', 'requestId',
    ])) fail('INVALID_REQUEST_SHAPE')
    return freezeFuturesWorkstationValue(value)
  }

  if (!hasExactFuturesWorkstationKeys(value, [
    'channelId',
    'version',
    'marketType',
    'environment',
    'action',
    'requestId',
    'symbol',
    'interval',
  ])
    || !isFuturesWorkstationSymbol(value.symbol)
    || !isFuturesWorkstationInterval(value.interval)) {
    fail('INVALID_REQUEST_SHAPE')
  }
  return freezeFuturesWorkstationValue(value)
}

export const validateFuturesWorkstationEvent = ({
  value,
  channelId,
  environment,
  eventType,
}) => {
  if (!hasExactFuturesWorkstationKeys(value, [
    'channelId',
    'version',
    'marketType',
    'environment',
    'type',
    'requestId',
    'symbol',
    'generation',
    'revision',
    'resource',
    'state',
    'observedAt',
    'payload',
  ])
    || value.channelId !== channelId
    || value.version !== FUTURES_WORKSTATION_PROTOCOL_VERSION
    || value.marketType !== FUTURES_WORKSTATION_MARKET_TYPE
    || value.environment !== environment
    || value.type !== eventType
    || !REQUEST_ID_PATTERN.test(value.requestId ?? '')
    || !isFuturesWorkstationSymbol(value.symbol)
    || !isPositiveSafeInteger(value.generation)
    || !isPositiveSafeInteger(value.revision)
    || !RESOURCE_VALUES.has(value.resource)
    || !STATE_VALUES.has(value.state)
    || !isSafeTimestamp(value.observedAt)
    || !validateFuturesWorkstationPayload(value.resource, value.payload)) {
    fail('INVALID_EVENT')
  }
  return freezeFuturesWorkstationValue(value)
}

export const createFuturesWorkstationRequest = ({
  channelId,
  environment,
  action,
  requestId,
  symbol,
  interval,
  actions,
}) => validateFuturesWorkstationRequest({
  value: {
    channelId,
    version: FUTURES_WORKSTATION_PROTOCOL_VERSION,
    marketType: FUTURES_WORKSTATION_MARKET_TYPE,
    environment,
    action,
    requestId,
    ...(action === actions.UNSUBSCRIBE ? {} : { symbol, interval }),
  },
  channelId,
  environment,
  actions,
})

export const createFuturesWorkstationEvent = ({
  channelId,
  environment,
  eventType,
  requestId,
  symbol,
  generation,
  revision,
  resource,
  state,
  observedAt,
  payload,
}) => validateFuturesWorkstationEvent({
  value: {
    channelId,
    version: FUTURES_WORKSTATION_PROTOCOL_VERSION,
    marketType: FUTURES_WORKSTATION_MARKET_TYPE,
    environment,
    type: eventType,
    requestId,
    symbol,
    generation,
    revision,
    resource,
    state,
    observedAt,
    payload,
  },
  channelId,
  environment,
  eventType,
})

const createEmptyFuturesWorkstationResources = () => ({
  status: null,
  catalog: null,
  header: null,
  candles: null,
  depth: null,
  trades: null,
})

const transitionFuturesWorkstationResources = (resources, nextState, observedAt) => (
  Object.freeze(Object.fromEntries(
    Object.entries(resources).map(([resource, value]) => [
      resource,
      value === null
        ? null
        : Object.freeze({
          ...value,
          state: nextState,
          ...(observedAt === undefined ? {} : { observedAt }),
        }),
    ]),
  ))
)

export const transitionFuturesWorkstationConnectionState = (state, status, reasonCode) => {
  if (![FUTURES_WORKSTATION_STATES.DISCONNECTED, FUTURES_WORKSTATION_STATES.UNAVAILABLE]
    .includes(status)
    || !isReasonCode(reasonCode)) {
    fail('INVALID_CONNECTION_TRANSITION')
  }
  const resources = transitionFuturesWorkstationResources(state.resources, status)
  return Object.freeze({
    ...state,
    status,
    reasonCode,
    resources: Object.freeze({
      ...resources,
      status: Object.freeze({
        connected: false,
        reasonCode,
        state: status,
        observedAt: state.observedAt,
      }),
    }),
  })
}

export const applyFuturesWorkstationEvent = (state, event) => {
  const generationChanged = event.generation > state.generation
  const generationResources = generationChanged
    ? createEmptyFuturesWorkstationResources()
    : state.resources
  const baseResources = event.resource === FUTURES_WORKSTATION_RESOURCES.STATUS
    && NON_LIVE_RESOURCE_STATES.has(event.state)
    ? transitionFuturesWorkstationResources(
      generationResources,
      event.state,
      event.observedAt,
    )
    : generationResources
  const nextResources = { ...baseResources }
  if (event.resource === FUTURES_WORKSTATION_RESOURCES.CATALOG) {
    const previousContracts = event.payload.offset === 0
      ? []
      : (baseResources.catalog?.contracts ?? [])
    nextResources.catalog = Object.freeze({
      ...event.payload,
      contracts: Object.freeze([...previousContracts, ...event.payload.contracts]),
      state: event.state,
      observedAt: event.observedAt,
    })
  } else if (event.resource === FUTURES_WORKSTATION_RESOURCES.CANDLES) {
    const previous = baseResources.candles ?? Object.freeze({
      interval: event.payload.interval,
      contract: Object.freeze([]),
      mark: Object.freeze([]),
      index: Object.freeze([]),
    })
    nextResources.candles = Object.freeze({
      ...previous,
      interval: event.payload.interval,
      [event.payload.series]: event.payload.rows,
      state: event.state,
      observedAt: event.observedAt,
    })
  } else {
    nextResources[event.resource] = Object.freeze({
      ...event.payload,
      state: event.state,
      observedAt: event.observedAt,
    })
  }

  const statusState = event.resource === FUTURES_WORKSTATION_RESOURCES.STATUS
    ? event.state
    : generationChanged
      ? FUTURES_WORKSTATION_STATES.LOADING
      : state.status
  return Object.freeze({
    ...state,
    status: statusState,
    symbol: event.symbol,
    generation: event.generation,
    revision: event.revision,
    observedAt: event.observedAt,
    resources: Object.freeze(nextResources),
  })
}
