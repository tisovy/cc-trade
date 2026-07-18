import { describe, expect, it } from 'vitest'
import {
  FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS,
  FUTURES_PRODUCTION_EXECUTION_ACTIONS,
  FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID,
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
  FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
  FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES,
  FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES,
  FUTURES_PRODUCTION_EXECUTION_STATES,
  FuturesProductionExecutionRendererProtocolError,
  compareFuturesProductionExecutionRevisions,
  createFuturesProductionExecutionCancelAllOpenOrdersRequest,
  createFuturesProductionExecutionAdjustIsolatedMarginRequest,
  createFuturesProductionExecutionAmendOrderRequest,
  createFuturesProductionExecutionClosePositionsRequest,
  createFuturesProductionExecutionDisengageKillSwitchRequest,
  createFuturesProductionExecutionEngageKillSwitchRequest,
  createFuturesProductionExecutionPlaceOrderRequest,
  createFuturesProductionExecutionPrepareCancelAllOpenOrdersIntentRequest,
  createFuturesProductionExecutionPrepareClosePositionsIntentRequest,
  createFuturesProductionExecutionPrepareDisengageKillSwitchIntentRequest,
  createFuturesProductionExecutionPrepareEngageKillSwitchIntentRequest,
  createFuturesProductionExecutionPrepareOrderIntentRequest,
  createFuturesProductionExecutionPrepareMarginAdjustmentIntentRequest,
  createFuturesProductionExecutionPrepareOrderAmendmentIntentRequest,
  createFuturesProductionExecutionRefreshPortfolioRequest,
  createFuturesProductionExecutionSubscribeStatusRequest,
  createFuturesProductionExecutionUnsubscribeStatusRequest,
  hasExactFuturesProductionExecutionSessionRequestFields,
  parseFuturesProductionExecutionStatus,
} from './futuresProductionExecutionProtocol.js'

const FINGERPRINT = 'a'.repeat(64)
const REQUEST_ID = '0123456789abcdef0123456789abcdef'

const intent = (kind, overrides = {}) => ({
  requestId: REQUEST_ID,
  kind,
  revision: '8',
  expiresAt: 1_783_957_630_000,
  ...overrides,
})

const status = (overrides = {}) => ({
  channelId: FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID,
  action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.STATUS,
  version: 3,
  revision: '8',
  marketType: 'futures',
  environment: 'production',
  mode: 'production',
  liveAuthorized: true,
  configured: true,
  account: { alias: 'reviewed-account-1', fingerprint: FINGERPRINT },
  caps: {
    allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
    symbolConfigurations: [
      {
        symbol: 'BTCUSDT',
        marginType: 'ISOLATED',
        leverage: 2,
        isAutoAddMargin: false,
      },
      {
        symbol: 'ETHUSDT',
        marginType: 'CROSSED',
        leverage: 20,
        isAutoAddMargin: true,
      },
    ],
    maxLeverage: 2,
    maxOrderNotionalUsdt: '10.0000',
    maxDailyNotionalUsdt: '50.0000',
    minAvailableBalanceUsdt: '10.0000',
    minLiquidationDistanceBps: '1000',
    dailyUsedNotionalUsdt: '10.000000000000000001',
    utcDay: '2026-07-13',
  },
  killSwitch: {
    engaged: true,
    policy: 'v1-persistent-block-new-exposure',
  },
  capabilities: {
    placeOrder: false,
    adjustMargin: false,
    amendOrder: false,
    cancelAllOpenOrders: true,
    closePositions: true,
    engageKillSwitch: false,
    disengageKillSwitch: false,
    code: 'FUTURES_PRODUCTION_GATES_SATISFIED',
  },
  intent: intent(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS),
  attempt: null,
  reconciliation: null,
  recovery: {
    required: false,
    state: 'healthy',
    code: 'FUTURES_PRODUCTION_RECOVERY_HEALTHY',
  },
  portfolio: {
    state: 'live',
    observedAt: 1_783_957_600_000,
    availableBalanceUsdt: '250.5',
    syncState: 'live',
    syncCode: null,
    positions: [{
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      quantity: '0.01',
      entryPrice: '60000',
      markPrice: '59000',
      notionalUsdt: '590',
      unrealizedPnlUsdt: '10',
      isolatedMarginUsdt: '300',
      liquidationPrice: '90000',
      leverage: 2,
      marginType: 'ISOLATED',
    }],
    openOrders: [],
  },
  ...overrides,
})

const portfolioOrder = (overrides = {}) => ({
  symbol: 'BTCUSDT',
  orderKind: 'REGULAR',
  orderId: '42',
  clientOrderId: 'external-order',
  side: 'SELL',
  positionSide: 'LONG',
  positionEffect: 'EXIT',
  price: '61000',
  originalQuantity: '0.01',
  executedQuantity: '0.001',
  status: 'PARTIALLY_FILLED',
  type: 'LIMIT',
  timeInForce: 'RPI',
  isAppOwned: false,
  updateTime: 1_783_957_600_001,
  syncState: 'synced',
  ...overrides,
})

const expectProtocolError = (callback, code) => {
  try {
    callback()
  } catch (error) {
    expect(error).toBeInstanceOf(FuturesProductionExecutionRendererProtocolError)
    if (code !== undefined) expect(error.code).toBe(code)
    return
  }
  throw new Error('Expected renderer production protocol validation to fail')
}

describe('production futures renderer request builders', () => {
  it('creates exact subscribe and unsubscribe requests on the dedicated channel contract', () => {
    const expected = {
      version: 3,
      revision: '0',
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: FINGERPRINT,
    }
    expect(createFuturesProductionExecutionSubscribeStatusRequest({
      accountFingerprint: FINGERPRINT,
    })).toEqual({
      action: 'futures.production.subscribeStatus',
      ...expected,
    })
    expect(createFuturesProductionExecutionUnsubscribeStatusRequest({
      accountFingerprint: FINGERPRINT,
    })).toEqual({
      action: 'futures.production.unsubscribeStatus',
      ...expected,
    })
    expect(createFuturesProductionExecutionRefreshPortfolioRequest({
      revision: '7',
      accountFingerprint: FINGERPRINT,
    })).toEqual({
      action: 'futures.production.refreshPortfolio',
      ...expected,
      revision: '7',
    })
  })

  it('creates the only request that carries a mutable financial draft', () => {
    const request = createFuturesProductionExecutionPrepareOrderIntentRequest({
      revision: '7',
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      side: 'SELL',
      positionSide: 'LONG',
      positionEffect: 'EXIT',
      quantity: '0.0100',
      price: '60000.1200',
    })
    expect(request).toEqual({
      action: 'futures.production.prepareOrderIntent',
      version: 3,
      revision: '7',
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      side: 'SELL',
      positionSide: 'LONG',
      positionEffect: 'EXIT',
      quantity: '0.0100',
      price: '60000.1200',
    })
    expect(Object.isFrozen(request)).toBe(true)
  })

  it('creates a bounded isolated-margin leg draft without placing it', () => {
    const request = createFuturesProductionExecutionPrepareMarginAdjustmentIntentRequest({
      revision: '7',
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      marginAction: 'REDUCE',
      amount: '5.25',
    })
    expect(request).toMatchObject({
      action: 'futures.production.prepareMarginAdjustmentIntent',
      positionSide: 'SHORT',
      marginAction: 'REDUCE',
      amount: '5.25',
    })
    expect(Object.isFrozen(request)).toBe(true)
  })

  it('creates an exact owned-order amendment prepare/final pair', () => {
    const prepare = createFuturesProductionExecutionPrepareOrderAmendmentIntentRequest({
      revision: '8',
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: `cc7-${REQUEST_ID}`,
      price: '60100.1',
    })
    expect(prepare).toEqual({
      action: 'futures.production.prepareOrderAmendmentIntent',
      version: 3,
      revision: '8',
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: `cc7-${REQUEST_ID}`,
      price: '60100.1',
    })
    expect(createFuturesProductionExecutionAmendOrderRequest({
      intent: intent(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT),
      accountFingerprint: FINGERPRINT,
      confirmation: 'MOVE REAL FUTURES ORDER',
    })).toMatchObject({
      action: 'futures.production.amendOrder',
      confirmation: 'MOVE REAL FUTURES ORDER',
    })
  })

  it('creates distinct fixed-identity prepare requests for every safety action', () => {
    const builders = [
      [createFuturesProductionExecutionPrepareCancelAllOpenOrdersIntentRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT],
      [createFuturesProductionExecutionPrepareClosePositionsIntentRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT],
      [createFuturesProductionExecutionPrepareEngageKillSwitchIntentRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT],
      [createFuturesProductionExecutionPrepareDisengageKillSwitchIntentRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT],
    ]
    for (const [builder, action] of builders) {
      expect(builder({ revision: '7', accountFingerprint: FINGERPRINT })).toEqual({
        action,
        version: 3,
        revision: '7',
        marketType: 'futures',
        environment: 'production',
        accountFingerprint: FINGERPRINT,
      })
    }
  })

  it('creates one-use final commands with no mutable draft, host, or network fields', () => {
    const cases = [
      [createFuturesProductionExecutionPlaceOrderRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER],
      [createFuturesProductionExecutionAdjustIsolatedMarginRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT],
      [createFuturesProductionExecutionCancelAllOpenOrdersRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS],
      [createFuturesProductionExecutionClosePositionsRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS],
      [createFuturesProductionExecutionEngageKillSwitchRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH],
      [createFuturesProductionExecutionDisengageKillSwitchRequest,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH],
    ]
    for (const [builder, action, kind] of cases) {
      const request = builder({
        intent: intent(kind),
        accountFingerprint: FINGERPRINT,
        confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action],
      })
      expect(request).toEqual({
        action,
        version: 3,
        revision: '8',
        requestId: REQUEST_ID,
        marketType: 'futures',
        environment: 'production',
        accountFingerprint: FINGERPRINT,
        confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action],
      })
      expect(Object.keys(request)).not.toContain('quantity')
      expect(Object.keys(request)).not.toContain('host')
    }
  })

  it.each([
    ['action alias', () => createFuturesProductionExecutionPrepareOrderIntentRequest({
      accountFingerprint: FINGERPRINT,
      symbol: 'btcusdt',
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      quantity: '1',
      price: '1',
    })],
    ['float quantity', () => createFuturesProductionExecutionPrepareOrderIntentRequest({
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      quantity: '1e-3',
      price: '1',
    })],
    ['wrong intent kind', () => createFuturesProductionExecutionPlaceOrderRequest({
      intent: intent(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS),
      accountFingerprint: FINGERPRINT,
      confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
      ],
    })],
    ['confirmation alias', () => createFuturesProductionExecutionClosePositionsRequest({
      intent: intent(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS),
      accountFingerprint: FINGERPRINT,
      confirmation: 'close positions',
    })],
    ['ARM confirmation alias', () => createFuturesProductionExecutionDisengageKillSwitchRequest({
      intent: intent(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH),
      accountFingerprint: FINGERPRINT,
      confirmation: 'ARM LIVE',
    })],
  ])('rejects %s without coercion', (_label, callback) => {
    expectProtocolError(callback, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)
  })

  it('recognizes only exact session request shapes', () => {
    const request = createFuturesProductionExecutionPrepareOrderIntentRequest({
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      quantity: '1',
      price: '1',
    })
    expect(hasExactFuturesProductionExecutionSessionRequestFields(request)).toBe(true)
    expect(hasExactFuturesProductionExecutionSessionRequestFields({
      ...request,
      requestId: REQUEST_ID,
    })).toBe(false)
  })
})

describe('production futures renderer status parser', () => {
  it('parses the strict backend-owned production/account/cap/kill projection', () => {
    const parsed = parseFuturesProductionExecutionStatus(JSON.stringify(status()))
    expect(parsed).toEqual(status())
    expect(parsed).toMatchObject({
      channelId: 'futures-production-execution',
      mode: 'production',
      liveAuthorized: true,
      configured: true,
      account: { alias: 'reviewed-account-1', fingerprint: FINGERPRINT },
      caps: { dailyUsedNotionalUsdt: '10.000000000000000001' },
      killSwitch: { engaged: true },
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.caps)).toBe(true)
    expect(Object.isFrozen(parsed.caps.allowedSymbols)).toBe(true)
    expect(Object.isFrozen(parsed.caps.symbolConfigurations)).toBe(true)
    expect(Object.isFrozen(parsed.caps.symbolConfigurations[0])).toBe(true)
    expect(Object.isFrozen(parsed.intent)).toBe(true)
  })

  it('allows symbol configuration bootstrap to be empty or partial', () => {
    const input = status()
    const empty = parseFuturesProductionExecutionStatus(JSON.stringify(status({
      caps: { ...input.caps, symbolConfigurations: [] },
    })))
    const partial = parseFuturesProductionExecutionStatus(JSON.stringify(status({
      caps: {
        ...input.caps,
        symbolConfigurations: [input.caps.symbolConfigurations[0]],
      },
    })))
    expect(empty.caps.symbolConfigurations).toEqual([])
    expect(partial.caps.symbolConfigurations).toEqual([
      input.caps.symbolConfigurations[0],
    ])
  })

  it.each([
    [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PENDING, FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILING],
    [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN, FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN],
    [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PARTIAL, FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL],
  ])('retains exact %s/%s state without mapping it to accepted', (acknowledgement, stateValue) => {
    const attempt = {
      requestId: REQUEST_ID,
      kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
      revision: '8',
      acknowledgement,
      state: stateValue,
      code: 'FUTURES_PRODUCTION_SAFE_RESULT',
      observedAt: 1_783_957_600_000,
      items: [
        { symbol: 'BTCUSDT', outcome: 'unknown', code: 'FUTURES_PRODUCTION_ITEM_RESULT' },
      ],
    }
    const parsed = parseFuturesProductionExecutionStatus(JSON.stringify(status({
      intent: null,
      attempt,
      reconciliation: acknowledgement === 'unknown'
        ? { required: true, state: 'scheduled', nextAttemptAt: 1_783_957_601_000 }
        : null,
    })))
    expect(parsed.attempt).toMatchObject({ acknowledgement, state: stateValue })
    expect(parsed.attempt.acknowledgement).not.toBe('accepted')
  })

  it('parses a disabled status without leaking an account identity or caps', () => {
    const parsed = parseFuturesProductionExecutionStatus(JSON.stringify(status({
      liveAuthorized: false,
      configured: false,
      account: null,
      caps: null,
      capabilities: {
        placeOrder: false,
        adjustMargin: false,
        amendOrder: false,
        cancelAllOpenOrders: false,
        closePositions: false,
        engageKillSwitch: false,
        disengageKillSwitch: false,
        code: 'FUTURES_PRODUCTION_LIVE_AUTHORIZATION_REJECTED',
      },
      intent: null,
    })))
    expect(parsed).toMatchObject({
      liveAuthorized: false,
      configured: false,
      account: null,
      caps: null,
    })
  })

  it('parses portfolio truth and namespaces regular/algo order identities', () => {
    const input = status()
    const parsed = parseFuturesProductionExecutionStatus(JSON.stringify(status({
      portfolio: {
        ...input.portfolio,
        positions: [{
          ...input.portfolio.positions[0],
          leverage: 20,
          marginType: 'CROSSED',
          isolatedMarginUsdt: '0',
        }],
        openOrders: [
          portfolioOrder(),
          portfolioOrder({
            orderKind: 'ALGO',
            status: 'TRIGGERING',
            type: 'STOP_MARKET',
            timeInForce: 'GTE_GTC',
            price: '0',
            originalQuantity: '0',
            executedQuantity: '0',
          }),
        ],
      },
    })))
    expect(parsed.portfolio.positions[0]).toMatchObject({
      leverage: 20,
      marginType: 'CROSSED',
    })
    expect(parsed.portfolio.openOrders).toHaveLength(2)
    expect(parsed.portfolio.openOrders[0]).toMatchObject({
      orderKind: 'REGULAR', status: 'PARTIALLY_FILLED', timeInForce: 'RPI',
    })
    expect(parsed.portfolio.openOrders[1]).toMatchObject({
      orderKind: 'ALGO', status: 'TRIGGERING', type: 'STOP_MARKET',
      price: '0', originalQuantity: '0',
    })
  })

  it('accepts bounded Unicode and delivery symbols only on authoritative portfolio ingress', () => {
    const input = status()
    const unicodeSymbol = '東京USDT'
    const deliverySymbol = 'BTCUSDT_260925'
    const parsed = parseFuturesProductionExecutionStatus(JSON.stringify(status({
      portfolio: {
        ...input.portfolio,
        positions: [{
          ...input.portfolio.positions[0],
          symbol: unicodeSymbol,
        }],
        openOrders: [
          portfolioOrder({
            symbol: unicodeSymbol,
            clientOrderId: 'external-unicode-order',
          }),
          portfolioOrder({
            symbol: deliverySymbol,
            orderId: '43',
            clientOrderId: 'external-delivery-order',
          }),
        ],
      },
    })))

    expect(parsed.portfolio.positions[0].symbol).toBe(unicodeSymbol)
    expect(parsed.portfolio.openOrders.map(order => order.symbol))
      .toEqual([unicodeSymbol, deliverySymbol])
    expectProtocolError(() => createFuturesProductionExecutionPrepareOrderIntentRequest({
      revision: '7',
      accountFingerprint: FINGERPRINT,
      symbol: unicodeSymbol,
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      quantity: '0.001',
      price: '60000',
    }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_COMMAND)

    for (const symbol of [
      'btcUSDT',
      'A\u030ABTCUSDT',
      'BTCUSDT_26092',
      `${'𠀀'.repeat(64)}_260925`,
    ]) {
      expectProtocolError(
        () => parseFuturesProductionExecutionStatus(JSON.stringify(status({
          portfolio: {
            ...input.portfolio,
            positions: [{ ...input.portfolio.positions[0], symbol }],
          },
        }))),
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      )
    }
  })

  it('rejects order-kind/status mismatches and duplicates within one namespace', () => {
    const input = status()
    for (const order of [
      portfolioOrder({ orderKind: 'REGULAR', status: 'TRIGGERING' }),
      portfolioOrder({ orderKind: 'ALGO', status: 'PARTIALLY_FILLED' }),
      portfolioOrder({ orderKind: 'UNKNOWN' }),
    ]) {
      expectProtocolError(
        () => parseFuturesProductionExecutionStatus(JSON.stringify(status({
          portfolio: { ...input.portfolio, openOrders: [order] },
        }))),
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      )
    }
    expectProtocolError(
      () => parseFuturesProductionExecutionStatus(JSON.stringify(status({
        portfolio: {
          ...input.portfolio,
          openOrders: [portfolioOrder(), portfolioOrder()],
        },
      }))),
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
  })

  it('rejects duplicate keys before JSON collapse and rejects extra fields', () => {
    const raw = JSON.stringify(status()).replace(
      '"revision":"8"',
      '"revision":"8","revision":"9"',
    )
    expectProtocolError(
      () => parseFuturesProductionExecutionStatus(raw),
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
    )
    expectProtocolError(
      () => parseFuturesProductionExecutionStatus(JSON.stringify({ ...status(), extra: true })),
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
  })

  it('rejects impossible capability, cap, recovery, and revision combinations', () => {
    const cases = [
      status({ liveAuthorized: false }),
      status({ caps: { ...status().caps, dailyUsedNotionalUsdt: '50.000000000000000001' } }),
      status({ caps: { ...status().caps, maxLeverage: 1 } }),
      status({ caps: { ...status().caps, maxOrderNotionalUsdt: '10.000000000000000001' } }),
      status({ caps: { ...status().caps, maxDailyNotionalUsdt: '50.000000000000000001' } }),
      status({ caps: { ...status().caps, allowedSymbols: ['BTCUSDT', 'BTCUSDT'] } }),
      status({ caps: { ...status().caps, allowedSymbols: ['btcusdt'] } }),
      status({
        caps: {
          ...status().caps,
          symbolConfigurations: [
            status().caps.symbolConfigurations[0],
            status().caps.symbolConfigurations[0],
          ],
        },
      }),
      status({
        caps: {
          ...status().caps,
          symbolConfigurations: [{
            symbol: 'XRPUSDT',
            marginType: 'ISOLATED',
            leverage: 2,
            isAutoAddMargin: false,
          }],
        },
      }),
      status({
        caps: {
          ...status().caps,
          symbolConfigurations: [{
            ...status().caps.symbolConfigurations[0],
            leverage: 126,
          }],
        },
      }),
      status({ caps: { ...status().caps, minAvailableBalanceUsdt: '0' } }),
      status({ caps: { ...status().caps, minLiquidationDistanceBps: '999' } }),
      status({ caps: { ...status().caps, minLiquidationDistanceBps: '10001' } }),
      status({ recovery: { required: false, state: 'blocked', code: 'FUTURES_PRODUCTION_BLOCKED' } }),
      status({ capabilities: { ...status().capabilities, engageKillSwitch: true } }),
      status({
        killSwitch: { ...status().killSwitch, engaged: false },
        capabilities: { ...status().capabilities, disengageKillSwitch: true },
      }),
      status({ intent: { ...status().intent, revision: '9' } }),
    ]
    for (const value of cases) {
      expectProtocolError(
        () => parseFuturesProductionExecutionStatus(JSON.stringify(value)),
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
      )
    }
  })

  it('rejects object input and oversized UTF-8 status frames', () => {
    expectProtocolError(
      () => parseFuturesProductionExecutionStatus(status()),
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
    )
    expectProtocolError(
      () => parseFuturesProductionExecutionStatus(
        `{"padding":"${'x'.repeat(FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES)}"}`,
      ),
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE,
    )
  })

  it('compares unbounded canonical revision text without Number conversion', () => {
    expect(compareFuturesProductionExecutionRevisions(
      '9007199254740992',
      '9007199254740991',
    )).toBe(1)
    expect(compareFuturesProductionExecutionRevisions(
      '999999999999999999999999',
      '1000000000000000000000000',
    )).toBe(-1)
    expectProtocolError(
      () => compareFuturesProductionExecutionRevisions('01', '1'),
      FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    )
  })
})
