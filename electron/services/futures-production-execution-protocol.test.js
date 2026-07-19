import { describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS,
    FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID,
    FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
    FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
    FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    FUTURES_PRODUCTION_EXECUTION_STATES,
    FuturesProductionExecutionProtocolError,
    compareFuturesProductionExecutionRevisions,
    createFuturesProductionExecutionStatus,
    hasExactFuturesProductionExecutionSessionRequestFields,
    isPotentialFuturesProductionExecutionFrame,
    parseFuturesProductionExecutionCommand,
    parseFuturesProductionExecutionStatus,
    readFuturesProductionExecutionAction,
    validateFuturesProductionExecutionCommandObject,
} from './futures-production-execution-protocol.js';

const FINGERPRINT = 'a'.repeat(64);
const REQUEST_ID = '0123456789abcdef0123456789abcdef';

const baseCommand = (action, overrides = {}) => ({
    action,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision: '7',
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint: FINGERPRINT,
    ...overrides,
});

const prepareOrder = (overrides = {}) => baseCommand(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
    {
        symbol: 'BTCUSDT',
        side: 'BUY',
        positionSide: 'LONG',
        positionEffect: 'ENTRY',
        quantity: '0.0100',
        price: '60000.1200',
        ...overrides,
    },
);

const prepareMargin = (overrides = {}) => baseCommand(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT,
    {
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        marginAction: 'ADD',
        amount: '5.25',
        ...overrides,
    },
);

const prepareAmendment = (overrides = {}) => baseCommand(
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
    {
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        clientOrderId: `cc7-${REQUEST_ID}`,
        price: '60100.1',
        ...overrides,
    },
);

const finalCommand = (action, overrides = {}) => ({
    action,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision: '8',
    requestId: REQUEST_ID,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint: FINGERPRINT,
    confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action],
    ...overrides,
});

const createStatusInput = (overrides = {}) => ({
    revision: '10',
    liveAuthorized: true,
    configured: true,
    account: { alias: 'reviewed-account-1', fingerprint: FINGERPRINT },
    caps: {
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
    intent: {
        requestId: REQUEST_ID,
        kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
        revision: '10',
        expiresAt: 1_783_957_630_000,
    },
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
            positionSide: 'LONG',
            quantity: '0.01',
            entryPrice: '60000',
            markPrice: '61000',
            notionalUsdt: '610',
            unrealizedPnlUsdt: '10',
            isolatedMarginUsdt: '300',
            liquidationPrice: '30000',
            leverage: 2,
            marginType: 'ISOLATED',
        }],
        openOrders: [],
    },
    ...overrides,
});

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
});

const expectProtocolError = (callback, code) => {
    try {
        callback();
    } catch (error) {
        expect(error).toBeInstanceOf(FuturesProductionExecutionProtocolError);
        if (code !== undefined) expect(error.code).toBe(code);
        return;
    }
    throw new Error('Expected production protocol validation to fail');
};

describe('production futures command protocol', () => {
    it.each([
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT,
    ])('parses exact production-only fixed-identity action %s', (action) => {
        const command = baseCommand(action);
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(command), {
            accountFingerprint: FINGERPRINT,
        })).toEqual(command);
        expect(readFuturesProductionExecutionAction(JSON.stringify(command))).toBe(action);
        expect(Object.isFrozen(parseFuturesProductionExecutionCommand(
            JSON.stringify(command),
        ))).toBe(true);
    });

    it('parses a full exact order draft only at prepare time', () => {
        const arbitraryContract = prepareOrder({ symbol: 'ARBUSDT' });
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(arbitraryContract), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT'],
        })).toEqual(arbitraryContract);
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(prepareOrder({
            side: 'SELL',
            positionEffect: 'EXIT',
        })), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT'],
        })).toMatchObject({ side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT' });
    });

    it('parses an exact isolated-margin leg draft only at prepare time', () => {
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(prepareMargin()), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT'],
        })).toEqual(prepareMargin());
        expectProtocolError(() => parseFuturesProductionExecutionCommand(JSON.stringify(
            prepareMargin({ marginAction: 'REMOVE' }),
        )), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
    });

    it('parses an exact owned LIMIT amendment draft and its one-use final action', () => {
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(prepareAmendment()), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT'],
        })).toEqual(prepareAmendment());
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
        )), {
            accountFingerprint: FINGERPRINT,
        })).toMatchObject({
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            confirmation: 'MOVE REAL FUTURES ORDER',
        });
        expectProtocolError(() => parseFuturesProductionExecutionCommand(JSON.stringify(
            prepareAmendment({ clientOrderId: `manual-${REQUEST_ID}` }),
        ), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT'],
        }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
    });

    it.each([
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
    ])('parses exact one-use final action %s without mutable financial fields', (action) => {
        const command = finalCommand(action);
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(command), {
            accountFingerprint: FINGERPRINT,
        })).toEqual(command);
        expect(Object.keys(command)).toEqual([
            'action',
            'version',
            'revision',
            'requestId',
            'marketType',
            'environment',
            'accountFingerprint',
            'confirmation',
        ]);
    });

    it('rejects duplicate raw keys before generic JSON parsing can collapse them', () => {
        const raw = JSON.stringify(prepareOrder()).replace(
            '"revision":"7"',
            '"revision":"7","revision":"8"',
        );
        expectProtocolError(
            () => parseFuturesProductionExecutionCommand(raw),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
        );
        expectProtocolError(
            () => readFuturesProductionExecutionAction(raw),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
        );
    });

    it.each([
        ['typed alias', prepareOrder({ action: 'order' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION],
        ['testnet alias', prepareOrder({ action: 'futures.execution.placeOrder' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION],
        ['production-like environment', prepareOrder({ environment: 'testnet' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY],
        ['account drift', prepareOrder({ accountFingerprint: 'b'.repeat(64) }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY],
        ['noncanonical revision', prepareOrder({ revision: '07' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REVISION],
        ['float quantity', prepareOrder({ quantity: '1e-3' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT],
        ['ambiguous Hedge side', prepareOrder({ side: 'SELL' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT],
        ['one-way position side', prepareOrder({ positionSide: 'BOTH' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT],
        ['malformed symbol', prepareOrder({ symbol: 'ethusdt' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT],
        ['mutable extra field', { ...finalCommand(FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER), price: '1' }, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS],
        ['wrong confirmation', finalCommand(FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER, { confirmation: 'place order' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_CONFIRMATION],
    ])('rejects %s', (_label, command, code) => {
        expectProtocolError(
            () => parseFuturesProductionExecutionCommand(JSON.stringify(command), {
                accountFingerprint: FINGERPRINT,
                allowedSymbols: ['BTCUSDT'],
            }),
            code,
        );
    });

    it('rejects accessors and oversized UTF-8 without invoking coercion', () => {
        let reads = 0;
        const command = prepareOrder();
        Object.defineProperty(command, 'price', {
            enumerable: true,
            get() {
                reads += 1;
                return '60000';
            },
        });
        expectProtocolError(
            () => validateFuturesProductionExecutionCommandObject(command),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
        );
        expect(reads).toBe(0);
        expectProtocolError(
            () => parseFuturesProductionExecutionCommand(`{"padding":"${'x'.repeat(4096)}"}`),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE,
        );
    });

    it('recognizes literal and escaped production frames before generic conversion', () => {
        expect(isPotentialFuturesProductionExecutionFrame(
            '{"action":"futures.production.placeOrder"',
        )).toBe(true);
        expect(isPotentialFuturesProductionExecutionFrame(
            '{"action":"futures.\\u0070roduction.placeOrder"',
        )).toBe(true);
        expect(isPotentialFuturesProductionExecutionFrame(
            '{"action":"futures.execution.placeOrder"',
        )).toBe(false);
    });

    it('identifies only the exact prepare/session field shapes', () => {
        expect(hasExactFuturesProductionExecutionSessionRequestFields(baseCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
        ))).toBe(true);
        expect(hasExactFuturesProductionExecutionSessionRequestFields(prepareOrder())).toBe(true);
        expect(hasExactFuturesProductionExecutionSessionRequestFields(prepareMargin())).toBe(true);
        expect(hasExactFuturesProductionExecutionSessionRequestFields({
            ...prepareOrder(),
            host: 'https://example.invalid',
        })).toBe(false);
    });
});

describe('production futures backend-owned status protocol', () => {
    it('creates and parses the complete strict backend projection', () => {
        const status = createFuturesProductionExecutionStatus(createStatusInput());
        const parsed = parseFuturesProductionExecutionStatus(JSON.stringify(status));
        expect(parsed).toEqual(status);
        expect(parsed).toMatchObject({
            channelId: FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.STATUS,
            environment: 'production',
            mode: 'production',
            liveAuthorized: true,
            configured: true,
            account: { alias: 'reviewed-account-1', fingerprint: FINGERPRINT },
            caps: { dailyUsedNotionalUsdt: '10.000000000000000001' },
            killSwitch: { engaged: true },
            recovery: { required: false, state: 'healthy' },
        });
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.caps)).toBe(true);
        expect(parsed.caps).not.toHaveProperty('allowedSymbols');
        expect(Object.isFrozen(parsed.caps.symbolConfigurations)).toBe(true);
        expect(Object.isFrozen(parsed.caps.symbolConfigurations[0])).toBe(true);
        expect(Object.isFrozen(parsed.intent)).toBe(true);
    });

    it('allows symbol configuration bootstrap to be empty or partial', () => {
        const input = createStatusInput();
        const empty = createFuturesProductionExecutionStatus(createStatusInput({
            caps: { ...input.caps, symbolConfigurations: [] },
        }));
        const partial = createFuturesProductionExecutionStatus(createStatusInput({
            caps: {
                ...input.caps,
                symbolConfigurations: [input.caps.symbolConfigurations[0]],
            },
        }));
        expect(empty.caps.symbolConfigurations).toEqual([]);
        expect(partial.caps.symbolConfigurations).toEqual([
            input.caps.symbolConfigurations[0],
        ]);
    });

    it('accepts independent symbol configurations beyond the former 16-symbol cap', () => {
        const input = createStatusInput();
        const symbolConfigurations = Array.from({ length: 17 }, (_, index) => ({
            symbol: `S${index}USDT`,
            marginType: 'ISOLATED',
            leverage: 2,
            isAutoAddMargin: false,
        }));
        const status = createFuturesProductionExecutionStatus(createStatusInput({
            caps: { ...input.caps, symbolConfigurations },
        }));
        expect(status.caps.symbolConfigurations).toHaveLength(17);

        expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
            caps: {
                ...input.caps,
                symbolConfigurations: Array.from({ length: 1025 }, (_, index) => ({
                    symbol: `S${index}USDT`,
                    marginType: 'ISOLATED',
                    leverage: 2,
                    isAutoAddMargin: false,
                })),
            },
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    });

    it('represents disabled production without exposing account or configured caps', () => {
        const status = createFuturesProductionExecutionStatus(createStatusInput({
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
        }));
        expect(status).toMatchObject({
            liveAuthorized: false,
            configured: false,
            account: null,
            caps: null,
        });
    });

    it.each([
        [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PENDING, FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILING],
        [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN, FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN],
        [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PARTIAL, FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL],
        [FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.ACCEPTED, FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CLOSED],
    ])('preserves reviewed %s/%s outcomes without inferring success', (acknowledgement, state) => {
        const status = createFuturesProductionExecutionStatus(createStatusInput({
            intent: null,
            attempt: {
                requestId: REQUEST_ID,
                kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
                revision: '10',
                acknowledgement,
                state,
                code: 'FUTURES_PRODUCTION_SAFE_RESULT',
                observedAt: 1_783_957_600_000,
                items: [
                    { symbol: 'BTCUSDT', outcome: acknowledgement === 'accepted' ? 'closed' : 'unknown', code: 'FUTURES_PRODUCTION_ITEM_RESULT' },
                ],
            },
            reconciliation: acknowledgement === 'unknown'
                ? { required: true, state: 'scheduled', nextAttemptAt: 1_783_957_601_000 }
                : null,
        }));
        expect(status.attempt).toMatchObject({ acknowledgement, state });
    });

    it('preserves portfolio truth and namespaces regular/algo order identities', () => {
        const input = createStatusInput();
        const created = createFuturesProductionExecutionStatus(createStatusInput({
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
        }));
        expect(created.portfolio.positions[0]).toMatchObject({
            leverage: 20,
            marginType: 'CROSSED',
        });
        expect(created.portfolio.openOrders).toHaveLength(2);
        expect(created.portfolio.openOrders[0]).toMatchObject({
            orderKind: 'REGULAR', status: 'PARTIALLY_FILLED', timeInForce: 'RPI',
        });
        expect(created.portfolio.openOrders[1]).toMatchObject({
            orderKind: 'ALGO', status: 'TRIGGERING', type: 'STOP_MARKET',
            price: '0', originalQuantity: '0',
        });
    });

    it('rejects order-kind/status mismatches and duplicates within one namespace', () => {
        const input = createStatusInput();
        for (const order of [
            portfolioOrder({ orderKind: 'REGULAR', status: 'TRIGGERING' }),
            portfolioOrder({ orderKind: 'ALGO', status: 'PARTIALLY_FILLED' }),
            portfolioOrder({ orderKind: 'UNKNOWN' }),
        ]) {
            expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
                portfolio: { ...input.portfolio, openOrders: [order] },
            })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
        expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
            portfolio: {
                ...input.portfolio,
                openOrders: [portfolioOrder(), portfolioOrder()],
            },
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    });

    it('rejects status duplicate keys, extra fields, impossible capabilities, and cap overflow', () => {
        const status = createFuturesProductionExecutionStatus(createStatusInput());
        expectProtocolError(
            () => parseFuturesProductionExecutionStatus(JSON.stringify(status).replace(
                '"revision":"10"',
                '"revision":"10","revision":"11"',
            )),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
        );
        expectProtocolError(
            () => parseFuturesProductionExecutionStatus(JSON.stringify({ ...status, extra: true })),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
        );
        expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
            liveAuthorized: false,
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
            caps: {
                ...createStatusInput().caps,
                dailyUsedNotionalUsdt: '50.000000000000000001',
            },
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        for (const invalidCaps of [
            {
                ...createStatusInput().caps,
                symbolConfigurations: [
                    createStatusInput().caps.symbolConfigurations[0],
                    createStatusInput().caps.symbolConfigurations[0],
                ],
            },
            {
                ...createStatusInput().caps,
                symbolConfigurations: [{
                    symbol: 'xrpusdt',
                    marginType: 'ISOLATED',
                    leverage: 2,
                    isAutoAddMargin: false,
                }],
            },
            {
                ...createStatusInput().caps,
                symbolConfigurations: [{
                    ...createStatusInput().caps.symbolConfigurations[0],
                    leverage: 126,
                }],
            },
            { ...createStatusInput().caps, maxLeverage: 1 },
            { ...createStatusInput().caps, maxLeverage: 3 },
            { ...createStatusInput().caps, maxOrderNotionalUsdt: '10.000000000000000001' },
            { ...createStatusInput().caps, maxDailyNotionalUsdt: '50.000000000000000001' },
            { ...createStatusInput().caps, minAvailableBalanceUsdt: '0' },
            { ...createStatusInput().caps, minLiquidationDistanceBps: '999' },
            { ...createStatusInput().caps, minLiquidationDistanceBps: '10001' },
        ]) {
            expectProtocolError(
                () => createFuturesProductionExecutionStatus(createStatusInput({ caps: invalidCaps })),
                FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
            );
        }
        for (const input of [
            createStatusInput({
                capabilities: { ...createStatusInput().capabilities, engageKillSwitch: true },
            }),
            createStatusInput({
                killSwitch: { ...createStatusInput().killSwitch, engaged: false },
                capabilities: {
                    ...createStatusInput().capabilities,
                    disengageKillSwitch: true,
                },
            }),
        ]) {
            expectProtocolError(
                () => createFuturesProductionExecutionStatus(input),
                FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
            );
        }
    });

    it('rejects an equal consumed intent and attempt and newer nested revisions', () => {
        expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
            attempt: {
                requestId: REQUEST_ID,
                kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
                revision: '10',
                acknowledgement: 'pending',
                state: 'queued',
                code: 'FUTURES_PRODUCTION_PENDING',
                observedAt: 1_783_957_600_000,
                items: [],
            },
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        expectProtocolError(() => createFuturesProductionExecutionStatus(createStatusInput({
            intent: { ...createStatusInput().intent, revision: '11' },
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    });

    it('compares arbitrary canonical revisions without Number conversion', () => {
        expect(compareFuturesProductionExecutionRevisions(
            '9007199254740992',
            '9007199254740991',
        )).toBe(1);
        expect(compareFuturesProductionExecutionRevisions(
            '999999999999999999999999',
            '1000000000000000000000000',
        )).toBe(-1);
        expectProtocolError(
            () => compareFuturesProductionExecutionRevisions('01', '1'),
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
        );
    });
});
