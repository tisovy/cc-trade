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
        quantity: '0.0100',
        price: '60000.1200',
        reduceOnly: false,
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
        allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
        maxLeverage: 3,
        maxOrderNotionalUsdt: '10000.0000',
        maxDailyNotionalUsdt: '50000.0000',
        minAvailableBalanceUsdt: '10.0000',
        minLiquidationDistanceBps: '1000',
        dailyUsedNotionalUsdt: '10000.000000000000000001',
        utcDay: '2026-07-13',
    },
    killSwitch: {
        engaged: true,
        policy: 'v1-persistent-block-new-exposure',
    },
    capabilities: {
        placeOrder: false,
        cancelAllOpenOrders: true,
        closePositions: true,
        engageKillSwitch: false,
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
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT,
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
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(prepareOrder()), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
        })).toEqual(prepareOrder());
        expect(parseFuturesProductionExecutionCommand(JSON.stringify(prepareOrder({
            side: 'SELL',
            reduceOnly: true,
        })), {
            accountFingerprint: FINGERPRINT,
            allowedSymbols: ['BTCUSDT'],
        })).toMatchObject({ side: 'SELL', reduceOnly: true });
    });

    it.each([
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
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
        ['wrong symbol', prepareOrder({ symbol: 'ETHUSDT' }), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT],
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
            caps: { dailyUsedNotionalUsdt: '10000.000000000000000001' },
            killSwitch: { engaged: true },
            recovery: { required: false, state: 'healthy' },
        });
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.caps)).toBe(true);
        expect(Object.isFrozen(parsed.caps.allowedSymbols)).toBe(true);
        expect(Object.isFrozen(parsed.intent)).toBe(true);
    });

    it('represents disabled production without exposing account or configured caps', () => {
        const status = createFuturesProductionExecutionStatus(createStatusInput({
            liveAuthorized: false,
            configured: false,
            account: null,
            caps: null,
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
                engageKillSwitch: false,
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
                dailyUsedNotionalUsdt: '50000.000000000000000001',
            },
        })), FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        for (const invalidCaps of [
            { ...createStatusInput().caps, allowedSymbols: ['BTCUSDT', 'BTCUSDT'] },
            { ...createStatusInput().caps, allowedSymbols: ['btcusdt'] },
            { ...createStatusInput().caps, minAvailableBalanceUsdt: '0' },
            { ...createStatusInput().caps, minLiquidationDistanceBps: '999' },
            { ...createStatusInput().caps, minLiquidationDistanceBps: '10001' },
        ]) {
            expectProtocolError(
                () => createFuturesProductionExecutionStatus(createStatusInput({ caps: invalidCaps })),
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
