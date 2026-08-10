// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
    createFuturesAccountStateEnvelope,
    createInitialFuturesAccountResources,
    markFuturesOrderResourcesStale,
    markFuturesResourceFailed,
    markFuturesResourceLoading,
    markFuturesResourceReady,
    sanitizeFuturesAccountError,
} from './futures-account-state.js';

describe('Futures account resource state', () => {
    it('transitions independently through loading and ready with timestamps', () => {
        const initial = createInitialFuturesAccountResources();
        const loading = markFuturesResourceLoading(initial, 'balances', 100);
        const ready = markFuturesResourceReady(
            loading,
            'balances',
            { USDT: { available: '0', total: '0' } },
            120,
        );

        expect(loading.balances).toMatchObject({
            status: 'loading',
            data: null,
            lastAttemptAt: 100,
        });
        expect(ready.balances).toMatchObject({
            status: 'ready',
            data: { USDT: { available: '0', total: '0' } },
            updatedAt: 120,
            lastSuccessfulAt: 120,
            error: null,
        });
        expect(ready.positions).toBe(initial.positions);
    });

    it('distinguishes initial error from stale last-known data', () => {
        const initial = createInitialFuturesAccountResources();
        const initialFailure = markFuturesResourceFailed(
            markFuturesResourceLoading(initial, 'regularOrders', 10),
            'regularOrders',
            { code: 'ETIMEDOUT' },
            20,
        );
        const confirmed = markFuturesResourceReady(
            initialFailure,
            'regularOrders',
            [{ orderKind: 'REGULAR', orderId: 7 }],
            30,
        );
        const stale = markFuturesResourceFailed(
            markFuturesResourceLoading(confirmed, 'regularOrders', 40),
            'regularOrders',
            { status: 503 },
            50,
        );

        expect(initialFailure.regularOrders).toMatchObject({
            status: 'error',
            data: [],
            lastSuccessfulAt: null,
        });
        expect(stale.regularOrders).toMatchObject({
            status: 'stale',
            data: [{ orderKind: 'REGULAR', orderId: 7 }],
            lastSuccessfulAt: 30,
            lastAttemptAt: 50,
        });
    });

    it('marks confirmed regular and ALGO orders stale after a user-stream failure', () => {
        let resources = createInitialFuturesAccountResources();
        resources = markFuturesResourceReady(
            resources,
            'regularOrders',
            [{ orderKind: 'REGULAR', orderId: 7 }],
            30,
        );
        resources = markFuturesResourceReady(
            resources,
            'algoOrders',
            [{ orderKind: 'ALGO', algoId: 9 }],
            31,
        );

        const stale = markFuturesOrderResourcesStale(
            resources,
            { code: 'ECONNRESET' },
            50,
        );

        expect(stale.regularOrders).toMatchObject({
            status: 'stale',
            data: [{ orderKind: 'REGULAR', orderId: 7 }],
            lastSuccessfulAt: 30,
            lastAttemptAt: 50,
            error: { code: 'FUTURES_NETWORK_ERROR' },
        });
        expect(stale.algoOrders).toMatchObject({
            status: 'stale',
            data: [{ orderKind: 'ALGO', algoId: 9 }],
            lastSuccessfulAt: 31,
            lastAttemptAt: 50,
            error: { code: 'FUTURES_NETWORK_ERROR' },
        });
    });

    it('does not manufacture stale order data before either REST resource succeeds', () => {
        const resources = createInitialFuturesAccountResources();
        const failed = markFuturesOrderResourcesStale(
            resources,
            { code: 'ECONNRESET' },
            50,
        );

        expect(failed).toBe(resources);
        expect(failed.regularOrders.status).toBe('idle');
        expect(failed.algoOrders.status).toBe('idle');
    });

    it.each([
        [{ code: -2015 }, 'FUTURES_PERMISSION_DENIED', 'permission', false],
        [{ code: -1021 }, 'FUTURES_CLOCK_SKEW', 'clock', true],
        [{ status: 429 }, 'FUTURES_RATE_LIMITED', 'rate_limit', true],
        [{ code: 'ECONNREFUSED' }, 'FUTURES_NETWORK_ERROR', 'network', true],
        [{ status: 503 }, 'FUTURES_EXCHANGE_UNAVAILABLE', 'exchange', true],
        // A 4xx describes the request, not a passing condition: Retry cannot fix it.
        [{ status: 404 }, 'FUTURES_REQUEST_REJECTED', 'exchange', false],
        [{ status: 400 }, 'FUTURES_REQUEST_REJECTED', 'exchange', false],
        [{ status: 418 }, 'FUTURES_REQUEST_REJECTED', 'exchange', false],
        // An unclassified failure with no status keeps its retryable default:
        // a transport that never answered may well answer next time.
        [{}, 'FUTURES_ACCOUNT_REQUEST_FAILED', 'exchange', true],
        [{ status: 599 }, 'FUTURES_EXCHANGE_UNAVAILABLE', 'exchange', true],
    ])('maps %# to a bounded diagnostic', (error, code, category, retryable) => {
        expect(sanitizeFuturesAccountError(error)).toEqual({
            code,
            category,
            message: expect.any(String),
            retryable,
        });
    });

    it('keeps a permission 403 non-retryable rather than folding it into the 4xx rule', () => {
        expect(sanitizeFuturesAccountError({ status: 403 })).toMatchObject({
            code: 'FUTURES_PERMISSION_DENIED',
            retryable: false,
        });
        expect(sanitizeFuturesAccountError({ status: 429 })).toMatchObject({
            code: 'FUTURES_RATE_LIMITED',
            retryable: true,
        });
    });

    it('never copies raw signed request text into the renderer envelope', () => {
        const error = new Error('https://fapi.binance.com?signature=secret&BK=secret');
        error.body = { signature: 'secret' };
        const resources = markFuturesResourceFailed(
            createInitialFuturesAccountResources(),
            'balances',
            error,
            100,
        );
        const envelope = createFuturesAccountStateEnvelope(resources, 101);

        expect(envelope).toMatchObject({
            version: 1,
            type: 'futures_account_state',
            marketType: 'futures',
            updatedAt: 101,
        });
        expect(JSON.stringify(envelope)).not.toContain('signature')
        expect(JSON.stringify(envelope)).not.toContain('secret')
    });
});
