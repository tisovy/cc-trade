import { describe, expect, it } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS,
    FUTURES_TESTNET_EXECUTION_ACK_ACTION,
    FUTURES_TESTNET_EXECUTION_ACTION,
    FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
    FUTURES_TESTNET_EXECUTION_COMMAND_MAX_BYTES,
    FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES,
    FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES,
    FUTURES_TESTNET_EXECUTION_STATES,
    FuturesTestnetExecutionProtocolError,
    createFuturesTestnetExecutionAcknowledgement,
    createFuturesTestnetExecutionProtocolRejection,
    parseFuturesTestnetExecutionAcknowledgement,
    parseFuturesTestnetExecutionCommand,
    validateFuturesTestnetExecutionCommandObject,
} from './futures-testnet-execution-protocol.js';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';
const CLIENT_ORDER_ID = `cc6-${REQUEST_ID}`;
const ALLOWED_SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT']);

const makeCommand = (overrides = {}) => ({
    action: FUTURES_TESTNET_EXECUTION_ACTION,
    version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    requestId: REQUEST_ID,
    marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    symbol: 'BTCUSDT',
    side: 'SELL',
    orderType: 'LIMIT',
    quantity: '0.001',
    price: '70000.0',
    timeInForce: 'GTC',
    positionSide: 'BOTH',
    marginType: 'ISOLATED',
    leverage: 3,
    reduceOnly: true,
    workingType: null,
    priceProtect: false,
    clientOrderId: CLIENT_ORDER_ID,
    ...overrides,
});

const makeOrder = (overrides = {}) => ({
    orderId: '22542179',
    status: 'NEW',
    originalQuantity: '0.001',
    executedQuantity: '0',
    averagePrice: '0.00000',
    updateTime: 1783814400123,
    ...overrides,
});

const makeAckFields = (overrides = {}) => ({
    channelId: FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
    action: FUTURES_TESTNET_EXECUTION_ACK_ACTION,
    version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    revision: '7',
    requestId: REQUEST_ID,
    marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    symbol: 'BTCUSDT',
    clientOrderId: CLIENT_ORDER_ID,
    acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.PENDING,
    state: FUTURES_TESTNET_EXECUTION_STATES.QUEUED,
    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING,
    observedAt: 1783814400000,
    order: null,
    ...overrides,
});

const expectProtocolError = (operation, code) => {
    try {
        operation();
        throw new Error('Expected futures testnet execution protocol validation to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(FuturesTestnetExecutionProtocolError);
        expect(error.code).toBe(code);
    }
};

describe('futures testnet execution command schema', () => {
    it('parses the exact command and preserves original decimal transport strings', () => {
        const parsed = parseFuturesTestnetExecutionCommand(
            JSON.stringify(makeCommand()),
            { allowedSymbols: ALLOWED_SYMBOLS },
        );

        expect(parsed).toEqual(makeCommand());
        expect(parsed.quantity).toBe('0.001');
        expect(parsed.price).toBe('70000.0');
        expect(Object.isFrozen(parsed)).toBe(true);
    });

    it('accepts exactly 4096 UTF-8 bytes and rejects 4097 before conversion', () => {
        const compact = JSON.stringify(makeCommand());
        const atLimit = `${compact.slice(0, -1)}${' '.repeat(
            FUTURES_TESTNET_EXECUTION_COMMAND_MAX_BYTES - compact.length,
        )}}`;
        const overLimit = `${atLimit.slice(0, -1)} }`;

        expect(new TextEncoder().encode(atLimit).byteLength).toBe(4096);
        expect(parseFuturesTestnetExecutionCommand(atLimit, {
            allowedSymbols: ALLOWED_SYMBOLS,
        })).toEqual(makeCommand());
        expect(new TextEncoder().encode(overLimit).byteLength).toBe(4097);
        expectProtocolError(
            () => parseFuturesTestnetExecutionCommand(overLimit, {
                allowedSymbols: ALLOWED_SYMBOLS,
            }),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.COMMAND_TOO_LARGE,
        );
    });

    it('counts multibyte bytes and rejects malformed UTF-8 before JSON parsing', () => {
        const oversized = `{"extra":"${'€'.repeat(1400)}"}`;
        expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(4096);
        expectProtocolError(
            () => parseFuturesTestnetExecutionCommand(oversized, {
                allowedSymbols: ALLOWED_SYMBOLS,
            }),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.COMMAND_TOO_LARGE,
        );
        expectProtocolError(
            () => parseFuturesTestnetExecutionCommand(
                new Uint8Array([0xc3, 0x28]),
                { allowedSymbols: ALLOWED_SYMBOLS },
            ),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING,
        );
        const oversizedInvalidBytes = new Uint8Array(4097);
        oversizedInvalidBytes[0] = 0xff;
        expectProtocolError(
            () => parseFuturesTestnetExecutionCommand(oversizedInvalidBytes, {
                allowedSymbols: ALLOWED_SYMBOLS,
            }),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.COMMAND_TOO_LARGE,
        );
        expectProtocolError(
            () => parseFuturesTestnetExecutionCommand('\ud800', {
                allowedSymbols: ALLOWED_SYMBOLS,
            }),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING,
        );
    });

    it('rejects literal and escape-aliased duplicate keys', () => {
        const command = JSON.stringify(makeCommand());
        const literalDuplicate = command.replace(
            '"symbol":"BTCUSDT"',
            '"symbol":"BTCUSDT","symbol":"ETHUSDT"',
        );
        const escapedDuplicate = command.replace(
            '"symbol":"BTCUSDT"',
            '"symbol":"BTCUSDT","\\u0073ymbol":"ETHUSDT"',
        );

        for (const raw of [literalDuplicate, escapedDuplicate]) {
            expectProtocolError(
                () => parseFuturesTestnetExecutionCommand(raw, {
                    allowedSymbols: ALLOWED_SYMBOLS,
                }),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
            );
        }
    });

    it.each([
        '{',
        '[]',
        '{} trailing',
        '{"action":tru}',
        '{"action":"bad\\xescape"}',
        '{"action":{}}',
        '{"action":[]}',
        JSON.stringify(makeCommand()).replace('"version":1', '"version":1.0'),
        JSON.stringify(makeCommand()).replace('"version":1', '"version":1e0'),
        JSON.stringify(makeCommand()).replace('"leverage":3', '"leverage":3.0'),
    ])('rejects malformed, nested, or non-integer-token raw JSON', (raw) => {
        expectProtocolError(
            () => parseFuturesTestnetExecutionCommand(raw, {
                allowedSymbols: ALLOWED_SYMBOLS,
            }),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
        );
    });

    it('rejects missing, extra, endpoint, URL, option, transport, and account-mutation fields', () => {
        const { price: _price, ...missingPrice } = makeCommand();
        const invalidCommands = [
            missingPrice,
            { ...makeCommand(), endpoint: '/fapi/v1/order' },
            { ...makeCommand(), url: 'https://example.invalid' },
            { ...makeCommand(), options: {} },
            { ...makeCommand(), timestamp: 1 },
            { ...makeCommand(), signature: 'secret' },
            { ...makeCommand(), retries: 0 },
            { ...makeCommand(), sessionId: 'renderer-selected' },
            { ...makeCommand(), cancelOrderId: '1' },
            { ...makeCommand(), changeLeverage: true },
            { ...makeCommand(), marginModeMutation: 'ISOLATED' },
            { ...makeCommand(), recvWindow: 5000 },
        ];

        invalidCommands.forEach((command) => {
            expectProtocolError(
                () => validateFuturesTestnetExecutionCommandObject(command, {
                    allowedSymbols: ALLOWED_SYMBOLS,
                }),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            );
        });
    });

    it('rejects every individual missing command field', () => {
        Object.keys(makeCommand()).forEach((field) => {
            const command = makeCommand();
            delete command[field];
            expectProtocolError(
                () => validateFuturesTestnetExecutionCommandObject(command, {
                    allowedSymbols: ALLOWED_SYMBOLS,
                }),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            );
        });
    });

    it('rejects custom/null prototypes, arrays, symbols, non-enumerables, and accessors', () => {
        const getterCommand = makeCommand();
        let getterCalls = 0;
        Object.defineProperty(getterCommand, 'symbol', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'BTCUSDT';
            },
        });
        const symbolCommand = makeCommand();
        symbolCommand[Symbol('extra')] = true;
        const hiddenCommand = makeCommand();
        Object.defineProperty(hiddenCommand, 'hidden', { value: true });
        const nullPrototype = Object.assign(Object.create(null), makeCommand());
        const customPrototype = Object.assign(Object.create({ inherited: true }), makeCommand());

        for (const command of [
            getterCommand,
            symbolCommand,
            hiddenCommand,
            nullPrototype,
            customPrototype,
            [],
        ]) {
            expectProtocolError(
                () => validateFuturesTestnetExecutionCommandObject(command, {
                    allowedSymbols: ALLOWED_SYMBOLS,
                }),
                command === getterCommand || command === symbolCommand || command === hiddenCommand
                    ? FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS
                    : FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
            );
        }
        expect(getterCalls).toBe(0);
    });

    it.each([
        ['action', 'trade.placeOrder', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION],
        ['version', 2, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_VERSION],
        ['requestId', 'A'.repeat(32), FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REQUEST_ID],
        ['requestId', 'a'.repeat(31), FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REQUEST_ID],
        ['requestId', 'a'.repeat(33), FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REQUEST_ID],
        ['marketType', 'spot', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MARKET_TYPE],
        ['environment', 'mock', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENVIRONMENT],
        ['symbol', 'btcusdt', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ['symbol', 'BTCUSDT_', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ['symbol', 'X', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ['symbol', 'A'.repeat(21), FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ['symbol', 'ETHUSDTX', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ['side', 'sell', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SIDE],
        ['side', 'HOLD', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SIDE],
        ['orderType', 'MARKET', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_TYPE],
        ['quantity', '0', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_QUANTITY],
        ['quantity', '01.0', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_QUANTITY],
        ['quantity', '1e-3', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_QUANTITY],
        ['price', 70000, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_PRICE],
        ['price', '70000.', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_PRICE],
        ['timeInForce', 'IOC', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_TIME_IN_FORCE],
        ['positionSide', 'LONG', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_POSITION_SIDE],
        ['marginType', 'CROSSED', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MARGIN_TYPE],
        ['leverage', 0, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE],
        ['leverage', -0, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE],
        ['leverage', '3', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE],
        ['leverage', 3.5, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE],
        ['leverage', Number.POSITIVE_INFINITY, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE],
        ['leverage', Number.MAX_SAFE_INTEGER + 1, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE],
        ['reduceOnly', false, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REDUCE_ONLY],
        ['workingType', 'MARK_PRICE', FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_WORKING_TYPE],
        ['priceProtect', true, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_PRICE_PROTECT],
        ['clientOrderId', `other-${REQUEST_ID}`, FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_CLIENT_ORDER_ID],
    ])('rejects an invalid exact %s field', (field, value, code) => {
        expectProtocolError(
            () => validateFuturesTestnetExecutionCommandObject(
                makeCommand({ [field]: value }),
                { allowedSymbols: ALLOWED_SYMBOLS },
            ),
            code,
        );
    });

    it('accepts both sides, symbol grammar bounds, and decimal digit/scale boundaries', () => {
        const twoCharacterSymbol = makeCommand({
            symbol: 'A1',
            side: 'BUY',
            quantity: '9'.repeat(40),
            price: `0.${'0'.repeat(17)}1`,
        });
        const parsed = validateFuturesTestnetExecutionCommandObject(twoCharacterSymbol, {
            allowedSymbols: ['A1'],
        });
        expect(parsed.side).toBe('BUY');
        expect(parsed.quantity.length).toBe(40);

        const twentyCharacterSymbol = 'A'.repeat(20);
        expect(validateFuturesTestnetExecutionCommandObject(makeCommand({
            symbol: twentyCharacterSymbol,
        }), {
            allowedSymbols: [twentyCharacterSymbol],
        }).symbol).toBe(twentyCharacterSymbol);

        for (const [field, value] of [
            ['quantity', '9'.repeat(41)],
            ['price', `0.${'0'.repeat(18)}1`],
        ]) {
            expectProtocolError(
                () => validateFuturesTestnetExecutionCommandObject(
                    makeCommand({ [field]: value }),
                    { allowedSymbols: ALLOWED_SYMBOLS },
                ),
                field === 'quantity'
                    ? FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_QUANTITY
                    : FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_PRICE,
            );
        }
    });

    it('fails closed on malformed, duplicate, or oversized allowlists', () => {
        let accessorCalls = 0;
        const accessorAllowlist = ['placeholder'];
        Object.defineProperty(accessorAllowlist, 0, {
            enumerable: true,
            get() {
                accessorCalls += 1;
                return 'BTCUSDT';
            },
        });
        const overriddenIncludes = ['ETHUSDT'];
        Object.defineProperty(overriddenIncludes, 'includes', {
            value: () => true,
        });
        const customPrototype = ['BTCUSDT'];
        Object.setPrototypeOf(customPrototype, { inherited: true });
        const invalidAllowlists = [
            undefined,
            [],
            ['BTCUSDT', 'BTCUSDT'],
            ['btcusdt'],
            Array.from({ length: 17 }, (_, index) => `S${index}`),
            new Set(['BTCUSDT']),
            Array(2).fill(undefined).map((value, index) => (
                index === 1 ? 'BTCUSDT' : value
            )),
            (() => {
                const sparse = [];
                sparse[1] = 'BTCUSDT';
                return sparse;
            })(),
            accessorAllowlist,
            overriddenIncludes,
            customPrototype,
        ];
        invalidAllowlists.forEach((allowedSymbols) => {
            expectProtocolError(
                () => validateFuturesTestnetExecutionCommandObject(makeCommand(), {
                    allowedSymbols,
                }),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ALLOWLIST,
            );
        });
        expect(accessorCalls).toBe(0);
    });
});

describe('futures testnet execution acknowledgement schema', () => {
    it('creates the exact pending acknowledgement with a fixed static message', () => {
        const acknowledgement = createFuturesTestnetExecutionAcknowledgement(makeAckFields());

        expect(acknowledgement).toEqual({
            ...makeAckFields(),
            message: 'Testnet reduce-only order is pending.',
        });
        expect(Object.isFrozen(acknowledgement)).toBe(true);
    });

    it('creates protocol rejection without echoing any untrusted identity', () => {
        expect(createFuturesTestnetExecutionProtocolRejection({
            revision: '0',
            observedAt: 1783814400000,
        })).toEqual({
            channelId: 'futures-execution',
            action: 'futures.execution.ack',
            version: 1,
            revision: '0',
            requestId: null,
            marketType: 'futures',
            environment: 'testnet',
            symbol: null,
            clientOrderId: null,
            acknowledgement: 'rejected',
            state: 'locally_rejected',
            code: 'FUTURES_EXECUTION_PROTOCOL_REJECTED',
            message: 'Testnet reduce-only order command was rejected.',
            observedAt: 1783814400000,
            order: null,
        });
    });

    it.each([
        [FUTURES_TESTNET_EXECUTION_STATES.QUEUED, 'pending', 'FUTURES_EXECUTION_PENDING', null],
        [FUTURES_TESTNET_EXECUTION_STATES.DISPATCHED, 'pending', 'FUTURES_EXECUTION_PENDING', null],
        [FUTURES_TESTNET_EXECUTION_STATES.RECONCILING, 'pending', 'FUTURES_EXECUTION_PENDING', null],
        [FUTURES_TESTNET_EXECUTION_STATES.RECONCILING, 'pending', 'FUTURES_EXECUTION_PENDING', makeOrder()],
        [FUTURES_TESTNET_EXECUTION_STATES.EXCHANGE_ACCEPTED, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder()],
        [FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder()],
        [FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder({ status: 'PARTIALLY_FILLED' })],
        [FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_FILLED, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder({ status: 'FILLED' })],
        [FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_CANCELED, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder({ status: 'CANCELED' })],
        [FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_CANCELED, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder({ status: 'EXPIRED' })],
        [FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_CANCELED, 'accepted', 'FUTURES_EXECUTION_CONFIRMED', makeOrder({ status: 'EXPIRED_IN_MATCH' })],
        [FUTURES_TESTNET_EXECUTION_STATES.RESULT_UNKNOWN, 'unknown', 'FUTURES_EXECUTION_RESULT_UNKNOWN', null],
        [FUTURES_TESTNET_EXECUTION_STATES.RESULT_UNKNOWN, 'unknown', 'FUTURES_EXECUTION_RESULT_UNKNOWN', makeOrder()],
        [FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE, 'unknown', 'FUTURES_EXECUTION_RECONCILIATION_UNAVAILABLE', null],
        [FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE, 'unknown', 'FUTURES_EXECUTION_RECONCILIATION_UNAVAILABLE', makeOrder()],
    ])('accepts exact state/code/order mapping for %s', (state, acknowledgement, code, order) => {
        expect(createFuturesTestnetExecutionAcknowledgement(makeAckFields({
            state,
            acknowledgement,
            code,
            order,
        })).state).toBe(state);
    });

    it('accepts every fixed local and exchange rejection code only in its allowed state', () => {
        const localCodes = [
            'PROTOCOL_REJECTED',
            'DISABLED',
            'ENVIRONMENT_REJECTED',
            'CREDENTIALS_REJECTED',
            'SESSION_REJECTED',
            'SYMBOL_REJECTED',
            'RISK_DATA_REJECTED',
            'FILTER_REJECTED',
            'NOTIONAL_REJECTED',
            'LEVERAGE_REJECTED',
            'MARGIN_REJECTED',
            'POSITION_REJECTED',
            'REDUCE_ONLY_REJECTED',
            'LIQUIDATION_REJECTED',
            'DUPLICATE_REJECTED',
            'INTERRUPTED_BEFORE_DISPATCH',
            'BUSY',
            'RATE_LIMITED',
            'AUTH_REJECTED',
        ];
        localCodes.forEach((name) => {
            const protocol = name === 'PROTOCOL_REJECTED';
            const acknowledgement = createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                requestId: protocol ? null : REQUEST_ID,
                symbol: protocol ? null : 'BTCUSDT',
                clientOrderId: protocol ? null : CLIENT_ORDER_ID,
                acknowledgement: 'rejected',
                state: 'locally_rejected',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES[name],
            }));
            expect(acknowledgement.code).toBe(FUTURES_TESTNET_EXECUTION_SAFE_CODES[name]);
        });

        for (const name of ['RATE_LIMITED', 'AUTH_REJECTED', 'EXCHANGE_REJECTED']) {
            expect(createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                acknowledgement: 'rejected',
                state: 'exchange_rejected',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES[name],
            })).code).toBe(FUTURES_TESTNET_EXECUTION_SAFE_CODES[name]);
        }
    });

    it('rejects mismatched states, acknowledgements, codes, order presence, and statuses', () => {
        const invalid = [
            makeAckFields({ acknowledgement: 'accepted' }),
            makeAckFields({ code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED }),
            makeAckFields({ order: makeOrder() }),
            makeAckFields({ state: 'unknown_state' }),
            makeAckFields({
                acknowledgement: 'accepted',
                state: 'confirmed_open',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                order: null,
            }),
            makeAckFields({
                acknowledgement: 'accepted',
                state: 'confirmed_open',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                order: makeOrder({ status: 'FILLED' }),
            }),
            makeAckFields({
                acknowledgement: 'accepted',
                state: 'confirmed_filled',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                order: makeOrder({ status: 'NEW' }),
            }),
            makeAckFields({
                acknowledgement: 'unknown',
                state: 'result_unknown',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                order: makeOrder({ status: 'REJECTED' }),
            }),
        ];

        invalid.forEach((fields) => {
            expectProtocolError(
                () => createFuturesTestnetExecutionAcknowledgement(fields),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            );
        });
    });

    it('requires protocol rejection identities to be all null and all trusted identities otherwise', () => {
        const validProtocol = createFuturesTestnetExecutionProtocolRejection({
            revision: '1',
            observedAt: 1,
        });
        expectProtocolError(
            () => parseFuturesTestnetExecutionAcknowledgement({
                ...validProtocol,
                requestId: REQUEST_ID,
            }),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
        );
        expectProtocolError(
            () => createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                requestId: null,
            })),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
        );
        expectProtocolError(
            () => createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                clientOrderId: `cc6-${'f'.repeat(32)}`,
            })),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
        );
    });

    it.each(['0', '1', '7', '9007199254740993', '9'.repeat(100)])(
        'preserves canonical decimal-string revision %s without numeric conversion',
        (revision) => {
            expect(createFuturesTestnetExecutionAcknowledgement(
                makeAckFields({ revision }),
            ).revision).toBe(revision);
        },
    );

    it.each(['', '00', '01', '-1', '+1', '1.0', '1e0', 1])(
        'rejects invalid revision %j',
        (revision) => {
            expectProtocolError(
                () => createFuturesTestnetExecutionAcknowledgement(
                    makeAckFields({ revision }),
                ),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            );
        },
    );

    it.each([
        '9007199254740991',
        '9007199254740992',
        '9223372036854775807',
    ])('preserves lossless positive order ID %s', (orderId) => {
        const acknowledgement = createFuturesTestnetExecutionAcknowledgement(makeAckFields({
            acknowledgement: 'accepted',
            state: 'exchange_accepted',
            code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
            order: makeOrder({ orderId }),
        }));
        expect(acknowledgement.order.orderId).toBe(orderId);
    });

    it.each(['0', '01', '-1', '9223372036854775808', 22542179])(
        'rejects invalid lossless order ID %j',
        (orderId) => {
            expectProtocolError(
                () => createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                    acknowledgement: 'accepted',
                    state: 'exchange_accepted',
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                    order: makeOrder({ orderId }),
                })),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            );
        },
    );

    it('validates exact order fields, decimal kinds, statuses, and safe timestamps', () => {
        const invalidOrders = [
            { ...makeOrder(), endpoint: 'queryOrder' },
            makeOrder({ status: 'UNKNOWN' }),
            makeOrder({ originalQuantity: '0' }),
            makeOrder({ executedQuantity: '-1' }),
            makeOrder({ averagePrice: 0 }),
            makeOrder({ updateTime: -1 }),
            makeOrder({ updateTime: Number.MAX_SAFE_INTEGER + 1 }),
        ];
        invalidOrders.forEach((order) => {
            expectProtocolError(
                () => createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                    acknowledgement: 'accepted',
                    state: 'exchange_accepted',
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                    order,
                })),
                order.endpoint
                    ? FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS
                    : FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            );
        });
    });

    it('parses duplicate-aware raw acknowledgements and returns detached nested order data', () => {
        const built = createFuturesTestnetExecutionAcknowledgement(makeAckFields({
            acknowledgement: 'accepted',
            state: 'exchange_accepted',
            code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
            order: makeOrder(),
        }));
        const parsed = parseFuturesTestnetExecutionAcknowledgement(JSON.stringify(built));
        expect(parsed).toEqual(built);
        expect(parsed.order).not.toBe(built.order);
        expect(Object.isFrozen(parsed.order)).toBe(true);

        const duplicateTop = JSON.stringify(built).replace(
            '"revision":"7"',
            '"revision":"7","revision":"8"',
        );
        const duplicateNested = JSON.stringify(built).replace(
            '"status":"NEW"',
            '"status":"NEW","\\u0073tatus":"FILLED"',
        );
        for (const raw of [duplicateTop, duplicateNested]) {
            expectProtocolError(
                () => parseFuturesTestnetExecutionAcknowledgement(raw),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
            );
        }
    });

    it('rejects message tampering, unsafe observed time, unknown codes, and extra fields', () => {
        const valid = createFuturesTestnetExecutionAcknowledgement(makeAckFields());
        const invalid = [
            { ...valid, message: 'HTTP 500 raw exchange error' },
            { ...valid, observedAt: Number.MAX_SAFE_INTEGER + 1 },
            { ...valid, code: 'RAW_BINANCE_ERROR', message: 'raw' },
            { ...valid, endpoint: '/fapi/v1/order' },
        ];
        invalid.forEach((acknowledgement) => {
            expectProtocolError(
                () => parseFuturesTestnetExecutionAcknowledgement(acknowledgement),
                acknowledgement.endpoint
                    ? FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS
                    : FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            );
        });

        expect(Object.keys(FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES).sort()).toEqual(
            Object.values(FUTURES_TESTNET_EXECUTION_SAFE_CODES).sort(),
        );
    });

    it('rejects every individual missing acknowledgement and order field', () => {
        const valid = createFuturesTestnetExecutionAcknowledgement(makeAckFields());
        Object.keys(valid).forEach((field) => {
            const acknowledgement = { ...valid };
            delete acknowledgement[field];
            expectProtocolError(
                () => parseFuturesTestnetExecutionAcknowledgement(acknowledgement),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            );
        });

        Object.keys(makeOrder()).forEach((field) => {
            const order = makeOrder();
            delete order[field];
            expectProtocolError(
                () => createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                    acknowledgement: 'accepted',
                    state: 'exchange_accepted',
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                    order,
                })),
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            );
        });
    });

    it('rejects acknowledgement and nested order accessors without invoking them', () => {
        const valid = createFuturesTestnetExecutionAcknowledgement(makeAckFields());
        let calls = 0;
        const accessorAck = { ...valid };
        Object.defineProperty(accessorAck, 'symbol', {
            enumerable: true,
            get() {
                calls += 1;
                return 'BTCUSDT';
            },
        });
        const accessorOrder = makeOrder();
        Object.defineProperty(accessorOrder, 'status', {
            enumerable: true,
            get() {
                calls += 1;
                return 'NEW';
            },
        });

        expectProtocolError(
            () => parseFuturesTestnetExecutionAcknowledgement(accessorAck),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
        );
        expectProtocolError(
            () => createFuturesTestnetExecutionAcknowledgement(makeAckFields({
                acknowledgement: 'accepted',
                state: 'exchange_accepted',
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
                order: accessorOrder,
            })),
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
        );
        expect(calls).toBe(0);
    });
});
