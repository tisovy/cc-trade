import { describe, expect, it } from 'vitest';
import {
    E2E_FUTURES_ACCOUNT_FINGERPRINT,
    E2E_FUTURES_EXTERNAL_CLIENT_ORDER_ID,
    createE2eFuturesProductionExecutionRuntime,
} from './e2e-futures-production-execution-runtime.js';
import {
    FUTURES_PRODUCTION_EXECUTION_ACTIONS,
    FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
    FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    parseFuturesProductionExecutionStatus,
} from './services/futures-production-execution-protocol.js';

const CONNECTION_ID = '0123456789abcdef0123456789abcdef';
const BOOTSTRAP_FINGERPRINT = '0'.repeat(64);

const command = (action, revision, accountFingerprint, overrides = {}) => ({
    action,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint,
    ...overrides,
});

const finalCommand = (action, revision, requestId) => ({
    action,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    requestId,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    accountFingerprint: E2E_FUTURES_ACCOUNT_FINGERPRINT,
    confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action],
});

describe('E2E Futures production execution runtime', () => {
    it('keeps the entry cap while allowing a reducing order to cover the real position', async () => {
        const runtime = createE2eFuturesProductionExecutionRuntime({
            clock: () => 1_784_336_400_000,
        });
        const emitted = [];
        const context = {
            connectionId: CONNECTION_ID,
            emit: status => emitted.push(parseFuturesProductionExecutionStatus(status)),
        };
        await runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            '0',
            BOOTSTRAP_FINGERPRINT,
        )), context);

        const oversizedEntry = {
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'LONG',
            positionEffect: 'ENTRY',
            quantity: '0.002',
            price: '58400.00',
        };
        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            oversizedEntry,
        )), context)).resolves.toBe(false);

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            {
                ...oversizedEntry,
                side: 'SELL',
                positionEffect: 'EXIT',
            },
        )), context)).resolves.toBe(true);
        const exitIntent = emitted.at(-1).intent;
        await expect(runtime.service.handleRequest(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            emitted.at(-1).revision,
            exitIntent.requestId,
        )), context)).resolves.toBe(true);
        expect(emitted.at(-1).portfolio.openOrders).toContainEqual(expect.objectContaining({
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            originalQuantity: '0.002',
        }));

        await runtime.service.shutdown();
    });

    it('reconciles external snapshot plus deterministic create, amend and cancel in memory', async () => {
        const runtime = createE2eFuturesProductionExecutionRuntime({
            clock: () => 1_784_336_400_000,
        });
        const emitted = [];
        const context = {
            connectionId: CONNECTION_ID,
            emit: status => emitted.push(parseFuturesProductionExecutionStatus(status)),
        };

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            '0',
            BOOTSTRAP_FINGERPRINT,
        )), context)).resolves.toBe(true);
        expect(emitted.at(-1).portfolio).toMatchObject({
            state: 'live',
            availableBalanceUsdt: '250.00',
            syncState: 'live',
        });
        expect(emitted.at(-1).portfolio.openOrders).toEqual([
            expect.objectContaining({
                clientOrderId: E2E_FUTURES_EXTERNAL_CLIENT_ORDER_ID,
                isAppOwned: false,
                syncState: 'synced',
            }),
        ]);

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: E2E_FUTURES_EXTERNAL_CLIENT_ORDER_ID,
                price: '60300.00',
            },
        )), context)).resolves.toBe(true);
        const externalAmendIntent = emitted.at(-1).intent;
        await expect(runtime.service.handleRequest(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            emitted.at(-1).revision,
            externalAmendIntent.requestId,
        )), context)).resolves.toBe(true);
        expect(emitted.at(-1).portfolio.openOrders[0]).toMatchObject({
            clientOrderId: E2E_FUTURES_EXTERNAL_CLIENT_ORDER_ID,
            isAppOwned: false,
            price: '60300.00',
        });

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            {
                symbol: 'XRPUSDT',
                side: 'BUY',
                positionSide: 'LONG',
                positionEffect: 'ENTRY',
                quantity: '10',
                price: '0.50',
            },
        )), context)).resolves.toBe(true);
        const orderIntent = emitted.at(-1).intent;
        expect(orderIntent).toMatchObject({ kind: 'order' });

        await expect(runtime.service.handleRequest(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            emitted.at(-1).revision,
            orderIntent.requestId,
        )), context)).resolves.toBe(true);
        const appOrder = emitted.at(-1).portfolio.openOrders.find(order => order.isAppOwned);
        expect(appOrder).toMatchObject({
            clientOrderId: `cc7-${orderIntent.requestId}`,
            symbol: 'XRPUSDT',
            price: '0.50',
            status: 'NEW',
        });

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            {
                symbol: appOrder.symbol,
                positionSide: appOrder.positionSide,
                clientOrderId: appOrder.clientOrderId,
                price: '0.60',
            },
        )), context)).resolves.toBe(true);
        const amendIntent = emitted.at(-1).intent;
        await expect(runtime.service.handleRequest(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            emitted.at(-1).revision,
            amendIntent.requestId,
        )), context)).resolves.toBe(true);
        expect(emitted.at(-1).portfolio.openOrders.find(order => order.isAppOwned)?.price)
            .toBe('0.60');

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
        )), context)).resolves.toBe(true);
        const cancelIntent = emitted.at(-1).intent;
        await expect(runtime.service.handleRequest(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            emitted.at(-1).revision,
            cancelIntent.requestId,
        )), context)).resolves.toBe(true);
        expect(emitted.at(-1).portfolio.openOrders).toEqual([]);
        expect(runtime.inspect().shutDown).toBe(false);

        await runtime.service.shutdown();
        expect(runtime.inspect().shutDown).toBe(true);
    });

    it('rejects missing amendment targets and expired intents without false success', async () => {
        let now = 1_784_336_400_000;
        const runtime = createE2eFuturesProductionExecutionRuntime({ clock: () => now });
        const emitted = [];
        const context = {
            connectionId: CONNECTION_ID,
            emit: status => emitted.push(parseFuturesProductionExecutionStatus(status)),
        };
        await runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            '0',
            BOOTSTRAP_FINGERPRINT,
        )), context);

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: 'external-order-does-not-exist',
                price: '58450.00',
            },
        )), context)).resolves.toBe(false);
        expect(emitted.at(-1).intent).toBeNull();
        expect(emitted.at(-1).portfolio.openOrders[0].price).toBe('58445.00');

        await expect(runtime.service.handleRequest(JSON.stringify(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            emitted.at(-1).revision,
            E2E_FUTURES_ACCOUNT_FINGERPRINT,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: E2E_FUTURES_EXTERNAL_CLIENT_ORDER_ID,
                price: '58450.00',
            },
        )), context)).resolves.toBe(true);
        const expiringIntent = emitted.at(-1).intent;
        now = expiringIntent.expiresAt + 1;
        await expect(runtime.service.handleRequest(JSON.stringify(finalCommand(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            expiringIntent.revision,
            expiringIntent.requestId,
        )), context)).resolves.toBe(false);
        expect(emitted.at(-1).intent).toBeNull();
        expect(emitted.at(-1).portfolio.openOrders[0].price).toBe('58445.00');

        await runtime.service.shutdown();
    });
});
