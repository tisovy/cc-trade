import { describe, expect, it } from 'vitest'
import {
  FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS,
  FUTURES_TESTNET_EXECUTION_ACTIONS,
  FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
  FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
  FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
  FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES,
  FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
  FUTURES_TESTNET_EXECUTION_SAFE_CODES,
  FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES,
  FUTURES_TESTNET_EXECUTION_STATES,
  FuturesTestnetExecutionRendererProtocolError,
  compareFuturesTestnetExecutionRevisions,
  createFuturesTestnetExecutionPlaceOrderRequest,
  createFuturesTestnetExecutionPrepareIntentRequest,
  createFuturesTestnetExecutionStatusRequest,
  createFuturesTestnetExecutionSubscribeStatusRequest,
  createFuturesTestnetExecutionUnsubscribeStatusRequest,
  hasExactFuturesTestnetExecutionSessionRequestFields,
  parseFuturesTestnetExecutionStatus,
} from './futuresTestnetExecutionProtocol.js'

const REQUEST_ID = '0123456789abcdef0123456789abcdef'
const OTHER_REQUEST_ID = 'abcdef0123456789abcdef0123456789'

const createIntent = (requestId = REQUEST_ID) => ({
  requestId,
  clientOrderId: `cc6-${requestId}`,
  symbol: 'BTCUSDT',
  side: 'SELL',
  leverage: 2,
  expiresAt: 1_783_857_630_000,
})

const createOrder = (overrides = {}) => ({
  orderId: '9223372036854775807',
  status: 'NEW',
  originalQuantity: '0.0100',
  executedQuantity: '0.0000',
  averagePrice: '0',
  updateTime: 1_783_857_600_000,
  ...overrides,
})

const createAttempt = (overrides = {}) => ({
  channelId: FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
  action: FUTURES_TESTNET_EXECUTION_ACTIONS.ACKNOWLEDGEMENT,
  version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
  revision: '7',
  requestId: OTHER_REQUEST_ID,
  marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
  environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
  symbol: 'BTCUSDT',
  clientOrderId: `cc6-${OTHER_REQUEST_ID}`,
  acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.ACCEPTED,
  state: FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN,
  code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
  message: FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES[FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED],
  observedAt: 1_783_857_600_000,
  order: createOrder(),
  ...overrides,
})

const createStatus = (overrides = {}) => ({
  channelId: FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
  action: FUTURES_TESTNET_EXECUTION_ACTIONS.STATUS,
  version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
  revision: '8',
  marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
  environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
  symbol: 'BTCUSDT',
  capability: {
    enabled: true,
    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENABLED,
  },
  intent: createIntent(),
  attempt: null,
  ...overrides,
})

const expectProtocolError = (callback, code) => {
  try {
    callback()
  } catch (error) {
    expect(error).toBeInstanceOf(FuturesTestnetExecutionRendererProtocolError)
    expect(error.code).toBe(code)
    return
  }
  throw new Error('Expected strict futures testnet execution validation to fail')
}

describe('futures testnet execution renderer requests', () => {
  it('creates exact subscribe, unsubscribe, and prepare requests', () => {
    const expectedBase = {
      version: 1,
      revision: '0',
      marketType: 'futures',
      environment: 'testnet',
      symbol: 'BTCUSDT',
    }

    expect(createFuturesTestnetExecutionSubscribeStatusRequest({ symbol: 'BTCUSDT' })).toEqual({
      action: 'futures.execution.subscribeStatus',
      ...expectedBase,
    })
    expect(createFuturesTestnetExecutionUnsubscribeStatusRequest({ symbol: 'BTCUSDT' })).toEqual({
      action: 'futures.execution.unsubscribeStatus',
      ...expectedBase,
    })
    expect(createFuturesTestnetExecutionPrepareIntentRequest({ symbol: 'BTCUSDT' })).toEqual({
      action: 'futures.execution.prepareIntent',
      ...expectedBase,
    })
  })

  it('rejects aliases, malformed symbols, and extra session fields', () => {
    expectProtocolError(
      () => createFuturesTestnetExecutionStatusRequest('order', { symbol: 'BTCUSDT' }),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION,
    )
    expectProtocolError(
      () => createFuturesTestnetExecutionSubscribeStatusRequest({ symbol: 'btcusdt' }),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL,
    )
    expectProtocolError(
      () => createFuturesTestnetExecutionPrepareIntentRequest({
        symbol: 'BTCUSDT',
        revision: '01',
      }),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND,
    )
    expect(hasExactFuturesTestnetExecutionSessionRequestFields({
      ...createFuturesTestnetExecutionSubscribeStatusRequest({ symbol: 'BTCUSDT' }),
      requestId: REQUEST_ID,
    })).toBe(false)
  })

  it('uses only a backend-issued intent and preserves exact financial strings', () => {
    expect(createFuturesTestnetExecutionPlaceOrderRequest({
      intent: createIntent(),
      symbol: 'BTCUSDT',
      quantity: '0.0100',
      price: '60000.1200',
    })).toEqual({
      action: 'futures.execution.placeOrder',
      version: 1,
      requestId: REQUEST_ID,
      marketType: 'futures',
      environment: 'testnet',
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'LIMIT',
      quantity: '0.0100',
      price: '60000.1200',
      timeInForce: 'GTC',
      positionSide: 'BOTH',
      marginType: 'ISOLATED',
      leverage: 2,
      reduceOnly: true,
      workingType: null,
      priceProtect: false,
      clientOrderId: `cc6-${REQUEST_ID}`,
    })
  })

  it.each([
    [{ ...createIntent(), clientOrderId: `cc6-${OTHER_REQUEST_ID}` }, '0.01', '60000'],
    [{ ...createIntent(), leverage: 4 }, '0.01', '60000'],
    [null, '0.01', '60000'],
    [createIntent(), '1e-2', '60000'],
    [createIntent(), '0.01', '60000.1234567890123456789'],
  ])('rejects malformed place-order inputs without coercion', (intent, quantity, price) => {
    expectProtocolError(() => createFuturesTestnetExecutionPlaceOrderRequest({
      intent,
      symbol: 'BTCUSDT',
      quantity,
      price,
    }), FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  })
})

describe('futures testnet execution status parser', () => {
  it('parses an exact backend-owned capability and one-use intent', () => {
    const parsed = parseFuturesTestnetExecutionStatus(JSON.stringify(createStatus()))

    expect(parsed).toEqual(createStatus())
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.capability)).toBe(true)
    expect(Object.isFrozen(parsed.intent)).toBe(true)
  })

  it('parses a lossless signed-int64 confirmed-open attempt', () => {
    const status = createStatus({ intent: null, attempt: createAttempt() })
    const parsed = parseFuturesTestnetExecutionStatus(JSON.stringify(status))

    expect(parsed.attempt.order.orderId).toBe('9223372036854775807')
    expect(parsed.attempt.order.originalQuantity).toBe('0.0100')
    expect(parsed.attempt.acknowledgement).toBe('accepted')
  })

  it('accepts a safe protocol rejection without echoing untrusted identities', () => {
    const attempt = createAttempt({
      requestId: null,
      symbol: null,
      clientOrderId: null,
      acknowledgement: 'rejected',
      state: 'locally_rejected',
      code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED,
      message: FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES[FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED],
      order: null,
    })
    const parsed = parseFuturesTestnetExecutionStatus(JSON.stringify(createStatus({
      intent: null,
      attempt,
    })))

    expect(parsed.attempt).toMatchObject({
      requestId: null,
      symbol: null,
      clientOrderId: null,
      acknowledgement: 'rejected',
    })
  })

  it.each([
    ['queued', 'pending', FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING, null],
    ['dispatched', 'pending', FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING, null],
    ['result_unknown', 'unknown', FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN, null],
    ['reconciliation_unavailable', 'unknown', FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE, null],
  ])('accepts the reviewed %s acknowledgement matrix', (state, acknowledgement, code, order) => {
    const attempt = createAttempt({
      state,
      acknowledgement,
      code,
      message: FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES[code],
      order,
    })
    const parsed = parseFuturesTestnetExecutionStatus(JSON.stringify(createStatus({
      intent: null,
      attempt,
    })))
    expect(parsed.attempt).toMatchObject({ state, acknowledgement, code })
  })

  it('rejects duplicate keys before ordinary JSON parsing can collapse them', () => {
    const raw = JSON.stringify(createStatus()).replace(
      '"revision":"8"',
      '"revision":"8","revision":"9"',
    )
    expectProtocolError(
      () => parseFuturesTestnetExecutionStatus(raw),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
    )
  })

  it('rejects extra fields, unsafe timestamps, identity drift, and wrong safe messages', () => {
    const cases = [
      [{ ...createStatus(), extra: true }, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS],
      [
        createStatus({ intent: { ...createIntent(), expiresAt: Number.MAX_SAFE_INTEGER + 1 } }),
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
      ],
      [
        createStatus({ attempt: createAttempt({ symbol: 'ETHUSDT' }), intent: null }),
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      ],
      [createStatus({
        attempt: createAttempt({ message: 'exchange said something else' }),
        intent: null,
      }), FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS],
    ]
    for (const [value, code] of cases) {
      expectProtocolError(
        () => parseFuturesTestnetExecutionStatus(JSON.stringify(value)),
        code,
      )
    }
  })

  it('rejects an attempt revision newer than its containing backend status', () => {
    expectProtocolError(
      () => parseFuturesTestnetExecutionStatus(JSON.stringify(createStatus({
        revision: '8',
        intent: null,
        attempt: createAttempt({ revision: '9' }),
      }))),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
  })

  it('rejects unbounded order decimals and malformed empty JSON through protocol errors', () => {
    expectProtocolError(
      () => parseFuturesTestnetExecutionStatus(JSON.stringify(createStatus({
        intent: null,
        attempt: createAttempt({
          order: createOrder({ executedQuantity: `1.${'0'.repeat(19)}` }),
        }),
      }))),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
    expectProtocolError(
      () => parseFuturesTestnetExecutionStatus(''),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
    )
  })

  it('rejects oversized UTF-8 before parsing and invalid object inputs', () => {
    expectProtocolError(
      () => parseFuturesTestnetExecutionStatus(`{"padding":"${'x'.repeat(4096)}"}`),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE,
    )
    expectProtocolError(
      () => parseFuturesTestnetExecutionStatus(createStatus()),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
    )
  })

  it('compares arbitrary-size canonical revisions without Number conversion', () => {
    expect(compareFuturesTestnetExecutionRevisions('0', '0')).toBe(0)
    expect(compareFuturesTestnetExecutionRevisions('9007199254740992', '9007199254740991')).toBe(1)
    expect(compareFuturesTestnetExecutionRevisions('999999999999999999999999', '1000000000000000000000000')).toBe(-1)
    expectProtocolError(
      () => compareFuturesTestnetExecutionRevisions('01', '1'),
      FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
  })
})
