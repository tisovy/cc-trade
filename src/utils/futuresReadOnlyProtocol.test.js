import { describe, expect, it } from 'vitest';
import {
    FUTURES_MARKET_TYPE,
    FUTURES_READ_ACTIONS,
    FUTURES_READ_CHANNEL_ID,
    FUTURES_READ_ENVIRONMENTS,
    FUTURES_READ_PROTOCOL_ERROR_CODES,
    FUTURES_READ_PROTOCOL_VERSION,
    FUTURES_READ_RESPONSE_TYPES,
    FuturesReadOnlyProtocolError,
    createFuturesReadOnlyResponse,
    createFuturesReadSubscribeRequest,
    createFuturesReadUnsubscribeRequest,
    parseFuturesReadMessage,
    parseFuturesReadOnlyRequest,
} from './futuresReadOnlyProtocol.js';

const expectProtocolError = (operation, code) => {
    try {
        operation();
        throw new Error('Expected futures read-only protocol validation to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(FuturesReadOnlyProtocolError);
        expect(error.code).toBe(code);
    }
};

describe('futures read-only request protocol', () => {
    it('builds exact versioned subscribe and unsubscribe requests without transport fields', () => {
        expect(createFuturesReadSubscribeRequest({
            symbol: 'BTCUSDT',
            requestId: 'request-0001',
        })).toEqual({
            action: FUTURES_READ_ACTIONS.SUBSCRIBE,
            version: FUTURES_READ_PROTOCOL_VERSION,
            marketType: FUTURES_MARKET_TYPE,
            requestId: 'request-0001',
            symbol: 'BTCUSDT',
        });

        expect(createFuturesReadUnsubscribeRequest({
            requestId: 'request-0001',
        })).toEqual({
            action: FUTURES_READ_ACTIONS.UNSUBSCRIBE,
            version: FUTURES_READ_PROTOCOL_VERSION,
            marketType: FUTURES_MARKET_TYPE,
            requestId: 'request-0001',
        });
    });

    it('parses JSON without coercing exact symbols or request identifiers', () => {
        const parsed = parseFuturesReadOnlyRequest(JSON.stringify({
            action: FUTURES_READ_ACTIONS.SUBSCRIBE,
            version: 1,
            marketType: 'futures',
            requestId: '0009007199254740993',
            symbol: 'BTCUSDT_260925',
        }));

        expect(parsed.requestId).toBe('0009007199254740993');
        expect(parsed.symbol).toBe('BTCUSDT_260925');
    });

    it('rejects endpoint names, arbitrary options, symbol-bearing unsubscribe, and missing fields', () => {
        const validSubscribe = createFuturesReadSubscribeRequest({
            symbol: 'BTCUSDT',
            requestId: 'strict-fields',
        });
        const invalidMessages = [
            { ...validSubscribe, endpoint: '/fapi/v3/balance' },
            { ...validSubscribe, options: { recvWindow: 60000 } },
            {
                ...createFuturesReadUnsubscribeRequest({ requestId: 'strict-fields' }),
                symbol: 'BTCUSDT',
            },
            {
                action: FUTURES_READ_ACTIONS.SUBSCRIBE,
                version: 1,
                marketType: 'futures',
                requestId: 'strict-fields',
            },
        ];

        invalidMessages.forEach((message) => {
            expectProtocolError(
                () => parseFuturesReadOnlyRequest(message),
                FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            );
        });
    });

    it('rejects wrong action, version, market identity, identifiers, and malformed JSON', () => {
        const base = createFuturesReadSubscribeRequest({
            symbol: 'BTCUSDT',
            requestId: 'validation',
        });
        const invalidCases = [
            [{ ...base, action: 'trade.placeOrder' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_ACTION],
            [{ ...base, version: 2 }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_VERSION],
            [{ ...base, marketType: 'spot' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_MARKET_TYPE],
            [{ ...base, requestId: 123 }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_REQUEST_ID],
            [{ ...base, symbol: ' BTCUSDT' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
            [{ ...base, symbol: 'btcusdt' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
            [{ ...base, symbol: 'BTCUSDT?stream=other' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ];

        invalidCases.forEach(([message, code]) => {
            expectProtocolError(() => parseFuturesReadOnlyRequest(message), code);
        });
        expectProtocolError(
            () => parseFuturesReadOnlyRequest('{'),
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_JSON,
        );
    });
});

describe('futures read-only response protocol', () => {
    it('builds and parses a detached snapshot envelope while preserving exact values', () => {
        const payload = {
            market: {
                markPrice: '00117.93000000',
                indexPrice: '00117.92000000',
                nextFundingTime: 1783814400000,
            },
            positions: [{
                positionSide: 'LONG',
                unRealizedProfit: '-0.00000000',
                liquidationPrice: '0',
            }],
        };
        const response = createFuturesReadOnlyResponse({
            requestId: 'snapshot-0001',
            type: FUTURES_READ_RESPONSE_TYPES.SNAPSHOT,
            symbol: 'BTCUSDT',
            environment: FUTURES_READ_ENVIRONMENTS.MOCK,
            payload,
        });

        expect(response).toEqual({
            channelId: FUTURES_READ_CHANNEL_ID,
            version: FUTURES_READ_PROTOCOL_VERSION,
            marketType: FUTURES_MARKET_TYPE,
            requestId: 'snapshot-0001',
            type: FUTURES_READ_RESPONSE_TYPES.SNAPSHOT,
            symbol: 'BTCUSDT',
            environment: FUTURES_READ_ENVIRONMENTS.MOCK,
            payload,
        });
        expect(response.payload).not.toBe(payload);
        expect(response.payload.market).not.toBe(payload.market);

        payload.market.markPrice = 'mutated';
        expect(response.payload.market.markPrice).toBe('00117.93000000');

        const reparsed = parseFuturesReadMessage(JSON.stringify(response));
        expect(reparsed).toEqual(response);
        expect(reparsed.payload).not.toBe(response.payload);
    });

    it('builds a rejection with a nullable symbol and exact safe error payload', () => {
        expect(createFuturesReadOnlyResponse({
            requestId: 'rejection-0001',
            type: FUTURES_READ_RESPONSE_TYPES.REJECTION,
            symbol: null,
            environment: FUTURES_READ_ENVIRONMENTS.TESTNET,
            payload: {
                code: 'INVALID_FUTURES_READ_REQUEST',
                message: 'Futures read-only request was rejected',
            },
        })).toEqual({
            channelId: FUTURES_READ_CHANNEL_ID,
            version: 1,
            marketType: 'futures',
            requestId: 'rejection-0001',
            type: 'rejection',
            symbol: null,
            environment: 'testnet',
            payload: {
                code: 'INVALID_FUTURES_READ_REQUEST',
                message: 'Futures read-only request was rejected',
            },
        });
    });

    it('rejects unknown envelope fields, wrong channel identity, and invalid discriminants', () => {
        const response = createFuturesReadOnlyResponse({
            requestId: 'strict-response',
            type: FUTURES_READ_RESPONSE_TYPES.SNAPSHOT,
            symbol: 'BTCUSDT',
            environment: FUTURES_READ_ENVIRONMENTS.MOCK,
            payload: {},
        });
        const invalidCases = [
            [{ ...response, endpoint: 'getBalanceV3' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_FIELDS],
            [{ ...response, channelId: 'detail' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_CHANNEL_ID],
            [{ ...response, type: 'execution' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_RESPONSE_TYPE],
            [{ ...response, environment: 'production' }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_ENVIRONMENT],
            [{ ...response, symbol: null }, FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_SYMBOL],
        ];

        invalidCases.forEach(([message, code]) => {
            expectProtocolError(() => parseFuturesReadMessage(message), code);
        });
    });

    it('rejects unsafe numeric payloads, mutable object types, cycles, and malformed rejections', () => {
        const buildSnapshot = (payload) => createFuturesReadOnlyResponse({
            requestId: 'payload-validation',
            type: FUTURES_READ_RESPONSE_TYPES.SNAPSHOT,
            symbol: 'BTCUSDT',
            environment: FUTURES_READ_ENVIRONMENTS.MOCK,
            payload,
        });
        const cyclicPayload = {};
        cyclicPayload.self = cyclicPayload;
        const invalidPayloads = [
            { timestamp: Number.MAX_SAFE_INTEGER + 1 },
            { value: 1.25 },
            { date: new Date(0) },
            cyclicPayload,
            Array(1),
        ];
        const symbolPayload = {};
        symbolPayload[Symbol('unsupported')] = 'value';
        invalidPayloads.push(symbolPayload);

        invalidPayloads.forEach((payload) => {
            expectProtocolError(
                () => buildSnapshot(payload),
                FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
            );
        });

        expectProtocolError(
            () => createFuturesReadOnlyResponse({
                requestId: 'bad-rejection',
                type: FUTURES_READ_RESPONSE_TYPES.REJECTION,
                symbol: null,
                environment: FUTURES_READ_ENVIRONMENTS.MOCK,
                payload: { errorCode: 'WRONG_KEY', message: 'no' },
            }),
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
        );

        const prototypeKeyPayload = JSON.parse('{"__proto__":{"polluted":true}}');
        const response = buildSnapshot(prototypeKeyPayload);
        expect(Object.hasOwn(response.payload, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(response.payload)).toBe(Object.prototype);
        expect({}.polluted).toBeUndefined();
    });
});
