import { describe, expect, it } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS,
    FuturesTestnetExecutionSessionProtocolError,
    createFuturesTestnetExecutionStatus,
    isPotentialFuturesTestnetExecutionFrame,
    parseFuturesTestnetExecutionSessionRequest,
    readFuturesTestnetExecutionAction,
} from './futures-testnet-execution-session-protocol.js';

const request = (action = FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.SUBSCRIBE_STATUS) => JSON.stringify({
    action,
    version: 1,
    revision: '0',
    marketType: 'futures',
    environment: 'testnet',
    symbol: 'BTCUSDT',
});

describe('futures execution session protocol', () => {
    it.each([
        FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.SUBSCRIBE_STATUS,
        FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.UNSUBSCRIBE_STATUS,
        FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.PREPARE_INTENT,
    ])('parses exact %s requests', (action) => {
        expect(parseFuturesTestnetExecutionSessionRequest(request(action))).toEqual({
            action,
            version: 1,
            revision: '0',
            marketType: 'futures',
            environment: 'testnet',
            symbol: 'BTCUSDT',
        });
        expect(readFuturesTestnetExecutionAction(request(action))).toBe(action);
    });

    it.each([
        ['extra field', request().replace(/}$/, ',"requestId":"forged"}')],
        ['duplicate key', request().replace('"symbol":"BTCUSDT"', '"symbol":"BTCUSDT","symbol":"ETHUSDT"')],
        ['float version', request().replace('"version":1', '"version":1.0')],
        ['numeric revision', request().replace('"revision":"0"', '"revision":0')],
        ['non-canonical revision', request().replace('"revision":"0"', '"revision":"00"')],
        ['production environment', request().replace('"testnet"', '"production"')],
        ['oversized', `${' '.repeat(4096)}${request()}`],
    ])('rejects %s', (_label, raw) => {
        expect(() => parseFuturesTestnetExecutionSessionRequest(raw))
            .toThrow(FuturesTestnetExecutionSessionProtocolError);
    });

    it('recognizes potentially hostile execution frames before generic JSON conversion', () => {
        expect(isPotentialFuturesTestnetExecutionFrame('{"action":"futures.execution.placeOrder"'))
            .toBe(true);
        expect(isPotentialFuturesTestnetExecutionFrame(
            '{"action":"futures.\\u0065xecution.placeOrder"}',
        )).toBe(true);
        expect(isPotentialFuturesTestnetExecutionFrame('{"action":"trade.placeOrder"}')).toBe(false);
    });

    it('creates the exact backend-owned status projection', () => {
        const status = createFuturesTestnetExecutionStatus({
            revision: '9007199254740993',
            symbol: 'BTCUSDT',
            capability: { enabled: true, code: 'FUTURES_EXECUTION_ENABLED' },
            intent: {
                requestId: '0123456789abcdef0123456789abcdef',
                clientOrderId: 'cc6-0123456789abcdef0123456789abcdef',
                symbol: 'BTCUSDT',
                side: 'SELL',
                leverage: 3,
                expiresAt: 1783814430000,
            },
        });
        expect(status).toEqual({
            channelId: 'futures-execution',
            action: 'futures.execution.status',
            version: 1,
            revision: '9007199254740993',
            marketType: 'futures',
            environment: 'testnet',
            symbol: 'BTCUSDT',
            capability: { enabled: true, code: 'FUTURES_EXECUTION_ENABLED' },
            intent: {
                requestId: '0123456789abcdef0123456789abcdef',
                clientOrderId: 'cc6-0123456789abcdef0123456789abcdef',
                symbol: 'BTCUSDT',
                side: 'SELL',
                leverage: 3,
                expiresAt: 1783814430000,
            },
            attempt: null,
        });
        expect(Object.isFrozen(status)).toBe(true);
    });
});
