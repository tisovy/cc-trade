import { describe, expect, it } from 'vitest';
import {
    applyFuturesAcceptedAmendProjection,
    applyFuturesAcceptedCreateProjection,
    applyFuturesAlgoUpdate,
    applyFuturesAuthoritativeOrderResult,
    applyFuturesOrderTradeUpdate,
    beginFuturesOpenOrdersSnapshot,
    completeFuturesOpenOrdersSnapshot,
    createFuturesClientOrderKey,
    createFuturesOpenOrderKey,
    createFuturesOpenOrdersReconciliationState,
    failFuturesOpenOrdersPendingCancel,
    failFuturesOpenOrdersSnapshot,
    markFuturesOpenOrdersPendingCancel,
    normalizeFuturesRestAlgoOpenOrder,
    normalizeFuturesOrderTradeUpdate,
    normalizeFuturesRestOpenOrder,
    removeFuturesOpenOrdersForSymbols,
} from './futures-production-open-orders-reconciler.js';

const restAlgoOrder = (overrides = {}) => ({
    algoId: '9007199254740993',
    clientAlgoId: 'external-stop-1',
    algoType: 'CONDITIONAL',
    orderType: 'STOP_MARKET',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'LONG',
    timeInForce: 'GTE_GTC',
    quantity: '0.010',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualPrice: '0',
    triggerPrice: '64000.0',
    price: '0',
    closePosition: false,
    reduceOnly: false,
    createTime: 1_783_814_400_000,
    updateTime: 1_783_814_400_100,
    ...overrides,
});

const algoUpdate = (orderOverrides = {}, overrides = {}) => ({
    e: 'ALGO_UPDATE',
    T: 1_783_814_400_250,
    E: 1_783_814_400_300,
    o: {
        caid: 'external-stop-1',
        aid: '9007199254740993',
        at: 'CONDITIONAL',
        o: 'STOP_MARKET',
        s: 'BTCUSDT',
        S: 'SELL',
        ps: 'LONG',
        f: 'GTE_GTC',
        q: '0.010',
        X: 'NEW',
        ai: '',
        ap: '0',
        aq: '0',
        tp: '64000.0',
        p: '0',
        cp: false,
        R: false,
        ...orderOverrides,
    },
    ...overrides,
});

const restOrder = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    orderId: '9223372036854775807',
    clientOrderId: 'manual-order-1',
    side: 'BUY',
    positionSide: 'LONG',
    type: 'STOP',
    timeInForce: 'GTC',
    price: '65000.0',
    origQty: '0.010',
    executedQty: '0.002',
    status: 'PARTIALLY_FILLED',
    reduceOnly: false,
    closePosition: false,
    updateTime: 1_783_814_400_100,
    ...overrides,
});

const orderTradeUpdate = (overrides = {}, orderOverrides = {}) => ({
    e: 'ORDER_TRADE_UPDATE',
    E: 1_783_814_400_300,
    T: 1_783_814_400_200,
    o: {
        s: 'BTCUSDT',
        c: 'manual-order-1',
        S: 'BUY',
        o: 'STOP',
        f: 'GTC',
        q: '0.010',
        p: '65000.0',
        x: 'TRADE',
        X: 'PARTIALLY_FILLED',
        i: '9223372036854775807',
        z: '0.003',
        ps: 'LONG',
        R: false,
        cp: false,
        T: 1_783_814_400_250,
        ...orderOverrides,
    },
    ...overrides,
});

const authoritativeOrder = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    orderId: '9223372036854775807',
    clientOrderId: 'manual-order-1',
    side: 'BUY',
    positionSide: 'LONG',
    type: 'LIMIT',
    originalType: 'LIMIT',
    timeInForce: 'GTC',
    status: 'NEW',
    originalQuantity: '0.010',
    executedQuantity: '0',
    averagePrice: '0',
    price: '65000.0',
    reduceOnly: false,
    closePosition: false,
    updateTime: 1_783_814_400_250,
    ...overrides,
});

const syncSnapshot = (rows, startedAt = 1_783_814_400_000) => {
    const started = beginFuturesOpenOrdersSnapshot(
        createFuturesOpenOrdersReconciliationState(),
        { startedAt },
    );
    return completeFuturesOpenOrdersSnapshot(started, {
        snapshotId: started.activeSnapshotId,
        rows,
        completedAt: startedAt + 500,
    });
};

describe('Futures production open-order reconciliation', () => {
    it('normalizes external and app-owned orders without filtering order types', () => {
        const external = normalizeFuturesRestOpenOrder(restOrder());
        const appOwned = normalizeFuturesRestOpenOrder(restOrder({
            orderId: '2',
            clientOrderId: `cc7-${'a'.repeat(32)}`,
            type: 'TRAILING_STOP_MARKET',
        }));

        expect(external).toMatchObject({
            key: 'BTCUSDT:9223372036854775807',
            clientKey: 'BTCUSDT:manual-order-1',
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'LONG',
            positionEffect: 'ENTRY',
            type: 'STOP',
            price: '65000.0',
            originalQuantity: '0.010',
            filledQuantity: '0.002',
            status: 'PARTIALLY_FILLED',
            isAppOwned: false,
            updateTime: 1_783_814_400_100,
            updateTimeSource: 'rest.updateTime',
            syncState: 'synced',
        });
        expect(appOwned).toMatchObject({
            type: 'TRAILING_STOP_MARKET',
            isAppOwned: true,
        });
        expect(normalizeFuturesRestOpenOrder(restOrder({
            type: 'STOP_MARKET',
            price: '0',
            origQty: '0',
            closePosition: true,
        }))).toMatchObject({
            type: 'STOP_MARKET',
            price: '0',
            originalQuantity: '0',
            closePosition: true,
        });
        expect(normalizeFuturesRestOpenOrder(restOrder({ timeInForce: 'RPI' })))
            .toMatchObject({ orderKind: 'REGULAR', timeInForce: 'RPI' });
    });

    it('accepts the reviewed 2,048 combined-order capacity and rejects one row over it', () => {
        const rows = Array.from({ length: 2_048 }, (_, index) => restOrder({
            orderId: String(index + 1),
            clientOrderId: `manual-${index + 1}`,
        }));
        expect(syncSnapshot(rows).orders).toHaveLength(2_048);
        expect(() => syncSnapshot([
            ...rows,
            restOrder({ orderId: '2049', clientOrderId: 'manual-2049' }),
        ])).toThrowError(expect.objectContaining({ code: 'INVALID_OPEN_ORDERS_SNAPSHOT' }));
    });

    it('merges external algo REST orders and reconciles ALGO_UPDATE losslessly', () => {
        const normalized = normalizeFuturesRestAlgoOpenOrder(restAlgoOrder());
        expect(normalized).toMatchObject({
            key: 'BTCUSDT:ALGO:9007199254740993',
            clientKey: 'BTCUSDT:ALGO:external-stop-1',
            orderKind: 'ALGO',
            orderId: '9007199254740993',
            type: 'STOP_MARKET',
            price: '64000.0',
            originalQuantity: '0.010',
            filledQuantity: '0',
            status: 'NEW',
            timeInForce: 'GTE_GTC',
            positionEffect: 'EXIT',
        });

        let state = syncSnapshot([restOrder({ orderId: '1' }), restAlgoOrder()]);
        expect(state.orders.map(order => order.orderKind)).toEqual(['REGULAR', 'ALGO']);
        state = applyFuturesAlgoUpdate(state, algoUpdate({ X: 'TRIGGERING' }));
        expect(state.orders.find(order => order.orderKind === 'ALGO')).toMatchObject({
            status: 'TRIGGERING',
            updateTime: 1_783_814_400_250,
        });
        state = applyFuturesAlgoUpdate(state, algoUpdate({ X: 'CANCELED' }, {
            T: 1_783_814_400_350,
        }));
        expect(state.orders.map(order => order.orderKind)).toEqual(['REGULAR']);
        expect(state.tombstones).toContainEqual(expect.objectContaining({
            key: 'BTCUSDT:ALGO:9007199254740993',
            status: 'CANCELED',
        }));
    });

    it('uses composite primary and secondary identities across symbols', () => {
        const state = syncSnapshot([
            restOrder({ symbol: 'BTCUSDT', orderId: '1', clientOrderId: 'manual-shared' }),
            restOrder({ symbol: 'ETHUSDT', orderId: '1', clientOrderId: 'manual-shared' }),
        ]);

        expect(state.orders.map(order => order.key)).toEqual([
            'BTCUSDT:1',
            'ETHUSDT:1',
        ]);
        expect(state.orders.map(order => order.clientKey)).toEqual([
            'BTCUSDT:manual-shared',
            'ETHUSDT:manual-shared',
        ]);
        expect(createFuturesOpenOrderKey('ETHUSDT', '1')).toBe('ETHUSDT:1');
        expect(createFuturesClientOrderKey('ETHUSDT', 'manual-shared'))
            .toBe('ETHUSDT:manual-shared');
    });

    it('prefers inner order T, then transaction T, and uses E only as a final fallback', () => {
        const inner = normalizeFuturesOrderTradeUpdate(orderTradeUpdate());
        const transaction = normalizeFuturesOrderTradeUpdate(orderTradeUpdate({}, { T: undefined }));
        const delivery = normalizeFuturesOrderTradeUpdate(orderTradeUpdate(
            { T: undefined },
            { T: undefined },
        ));

        expect(inner).toMatchObject({
            updateTime: 1_783_814_400_250,
            updateTimeSource: 'order.T',
        });
        expect(transaction).toMatchObject({
            updateTime: 1_783_814_400_200,
            updateTimeSource: 'event.T',
        });
        expect(delivery).toMatchObject({
            updateTime: 1_783_814_400_300,
            updateTimeSource: 'event.E',
        });
    });

    it('overlays a buffered terminal event so a delayed snapshot cannot resurrect an order', () => {
        let state = beginFuturesOpenOrdersSnapshot(
            createFuturesOpenOrdersReconciliationState(),
            { startedAt: 1_783_814_400_000 },
        );
        state = applyFuturesOrderTradeUpdate(state, orderTradeUpdate({}, {
            x: 'CANCELED',
            X: 'CANCELED',
            z: '0.002',
            T: 1_783_814_400_250,
        }));
        expect(state.bufferedEvents).toHaveLength(1);

        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [restOrder({ updateTime: 1_783_814_400_100 })],
            completedAt: 1_783_814_400_500,
        });

        expect(state.syncState).toBe('live');
        expect(state.orders).toEqual([]);
        expect(state.tombstones).toEqual([
            expect.objectContaining({
                key: 'BTCUSDT:9223372036854775807',
                status: 'CANCELED',
                updateTime: 1_783_814_400_250,
            }),
        ]);
    });

    it('ignores duplicate and stale stream events while applying a newer partial fill', () => {
        let state = syncSnapshot([restOrder({ executedQty: '0', status: 'NEW' })]);
        const newer = orderTradeUpdate({}, {
            z: '0.004',
            T: 1_783_814_400_250,
        });
        state = applyFuturesOrderTradeUpdate(state, newer);
        expect(state.orders[0]).toMatchObject({
            filledQuantity: '0.004',
            updateTime: 1_783_814_400_250,
        });

        const afterNewer = state;
        expect(applyFuturesOrderTradeUpdate(state, newer)).toBe(afterNewer);
        expect(applyFuturesOrderTradeUpdate(state, orderTradeUpdate({}, {
            z: '0.001',
            T: 1_783_814_400_150,
        }))).toBe(afterNewer);

        state = applyFuturesOrderTradeUpdate(state, orderTradeUpdate({}, {
            z: '0.006',
            T: 1_783_814_400_350,
        }));
        expect(state.orders[0]).toMatchObject({
            filledQuantity: '0.006',
            updateTime: 1_783_814_400_350,
        });
    });

    it('projects authoritative create, amend, and terminal query results immediately', () => {
        let state = syncSnapshot([]);
        state = applyFuturesAuthoritativeOrderResult(state, authoritativeOrder());
        expect(state.orders).toEqual([
            expect.objectContaining({
                clientOrderId: 'manual-order-1',
                price: '65000.0',
                syncState: 'synced',
            }),
        ]);

        state = applyFuturesAuthoritativeOrderResult(state, authoritativeOrder({
            price: '65100.0',
            updateTime: 1_783_814_400_300,
        }));
        expect(state.orders[0].price).toBe('65100.0');

        state = applyFuturesAuthoritativeOrderResult(state, authoritativeOrder({
            status: 'CANCELED',
            updateTime: 1_783_814_400_350,
        }));
        expect(state.orders).toEqual([]);
        expect(state.tombstones[0]).toMatchObject({ status: 'CANCELED' });
    });

    it('keeps an ACK-backed create pending until an equal-time authoritative result confirms it', () => {
        const accepted = authoritativeOrder({
            orderId: '7',
            clientOrderId: `cc7-${'7'.repeat(32)}`,
            updateTime: 1_783_814_400_600,
        });
        let state = applyFuturesAcceptedCreateProjection(syncSnapshot([]), accepted);
        expect(state.orders).toEqual([
            expect.objectContaining({
                orderId: '7',
                clientOrderId: `cc7-${'7'.repeat(32)}`,
                price: '65000.0',
                syncState: 'pending',
                updateTimeSource: 'ack.transactTime',
            }),
        ]);

        state = applyFuturesAuthoritativeOrderResult(state, accepted);
        expect(state.orders).toEqual([
            expect.objectContaining({
                orderId: '7',
                syncState: 'synced',
                updateTimeSource: 'query.updateTime',
            }),
        ]);
    });

    it('preserves a pending create across a stale empty snapshot then removes it on rejection', () => {
        const accepted = authoritativeOrder({
            orderId: '8',
            clientOrderId: `cc7-${'8'.repeat(32)}`,
            updateTime: 1_783_814_400_600,
        });
        let state = applyFuturesAcceptedCreateProjection(syncSnapshot([]), accepted);
        state = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_400_700 });
        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [],
            completedAt: 1_783_814_400_800,
        });
        expect(state.orders).toEqual([
            expect.objectContaining({ orderId: '8', syncState: 'pending' }),
        ]);

        state = applyFuturesAuthoritativeOrderResult(state, {
            ...accepted,
            status: 'REJECTED',
            updateTime: 1_783_814_400_900,
        });
        expect(state.orders).toEqual([]);
        expect(state.tombstones).toEqual(expect.arrayContaining([
            expect.objectContaining({ orderId: '8', status: 'REJECTED' }),
        ]));
    });

    it('projects an amend by regular order identity without replacing external algo inventory', () => {
        let state = syncSnapshot([
            restOrder({
                orderId: '9',
                clientOrderId: 'regular-amend-9',
                type: 'LIMIT',
                executedQty: '0',
            }),
            restAlgoOrder(),
        ]);
        const accepted = authoritativeOrder({
            orderId: '9',
            clientOrderId: 'regular-amend-9',
            price: '65100.0',
            updateTime: 1_783_814_400_600,
        });
        state = applyFuturesAcceptedAmendProjection(state, accepted);
        expect(state.orders).toEqual(expect.arrayContaining([
            expect.objectContaining({
                orderKind: 'REGULAR',
                orderId: '9',
                price: '65100.0',
                syncState: 'pending',
            }),
            expect.objectContaining({
                orderKind: 'ALGO',
                orderId: '9007199254740993',
                clientOrderId: 'external-stop-1',
                syncState: 'synced',
            }),
        ]));

        state = applyFuturesOrderTradeUpdate(state, orderTradeUpdate({}, {
            i: '9',
            c: 'regular-amend-9',
            o: 'LIMIT',
            p: '65100.0',
            z: '0',
            T: 1_783_814_400_600,
        }));
        expect(state.orders.find(candidate => candidate.orderId === '9')).toMatchObject({
            price: '65100.0',
            syncState: 'synced',
            updateTimeSource: 'order.T',
        });
    });

    it('marks cancel rows pending without removing them and recovers them as stale on GET failure', () => {
        let state = syncSnapshot([
            restOrder({ orderId: '10', clientOrderId: 'btc-cancel-10' }),
            restOrder({
                symbol: 'ETHUSDT',
                orderId: '11',
                clientOrderId: 'eth-external-11',
            }),
        ]);
        state = markFuturesOpenOrdersPendingCancel(state, {
            symbol: 'BTCUSDT',
            requestedAt: 1_783_814_400_700,
        });
        expect(state.orders).toEqual(expect.arrayContaining([
            expect.objectContaining({ symbol: 'BTCUSDT', syncState: 'pending' }),
            expect.objectContaining({ symbol: 'ETHUSDT', syncState: 'synced' }),
        ]));

        state = failFuturesOpenOrdersPendingCancel(state, {
            symbol: 'BTCUSDT',
            failedAt: 1_783_814_400_800,
        });
        expect(state.orders).toEqual(expect.arrayContaining([
            expect.objectContaining({ symbol: 'BTCUSDT', syncState: 'stale' }),
            expect.objectContaining({ symbol: 'ETHUSDT', syncState: 'synced' }),
        ]));
    });

    it('uses reconciliation ownership instead of comparing Binance and local wall clocks', () => {
        let state = syncSnapshot([restOrder({
            orderId: '12',
            clientOrderId: 'clock-skew-cancel-12',
            updateTime: 1_900_000_000_000,
        })]);
        state = markFuturesOpenOrdersPendingCancel(state, {
            symbol: 'BTCUSDT',
            requestedAt: 1_700_000_000_000,
        });
        expect(state.orders).toEqual([
            expect.objectContaining({ orderId: '12', syncState: 'pending' }),
        ]);

        state = failFuturesOpenOrdersPendingCancel(state, {
            symbol: 'BTCUSDT',
            failedAt: 1_700_000_000_001,
        });
        expect(state.orders[0].syncState).toBe('stale');

        state = markFuturesOpenOrdersPendingCancel(state, {
            symbol: 'BTCUSDT',
            requestedAt: 1_700_000_000_002,
        });
        state = removeFuturesOpenOrdersForSymbols(state, {
            symbols: ['BTCUSDT'],
            confirmedAt: 1_900_000_000_001,
        });
        expect(state.orders).toEqual([]);
        expect(state.tombstones).toEqual([
            expect.objectContaining({
                key: 'BTCUSDT:12',
                updateTime: 1_900_000_000_001,
                updateTimeSource: 'cancel.confirmed',
            }),
        ]);
    });

    it('does not let an older authoritative snapshot revert a newer live order', () => {
        let state = syncSnapshot([restOrder({
            type: 'LIMIT',
            price: '65100.0',
            executedQty: '0',
            status: 'NEW',
            updateTime: 1_783_814_400_300,
        })]);
        state = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_400_400 });
        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [restOrder({
                type: 'LIMIT',
                price: '65000.0',
                executedQty: '0',
                status: 'NEW',
                updateTime: 1_783_814_400_100,
            })],
            completedAt: 1_783_814_400_500,
        });

        expect(state.orders[0]).toMatchObject({
            price: '65100.0',
            updateTime: 1_783_814_400_300,
        });
    });

    it('tombstones orders missing from an authoritative snapshot', () => {
        let state = syncSnapshot([restOrder()]);
        state = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_401_000 });
        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [],
            completedAt: 1_783_814_401_200,
        });
        expect(state.orders).toEqual([]);
        expect(state.tombstones).toEqual([
            expect.objectContaining({
                key: 'BTCUSDT:9223372036854775807',
                updateTimeSource: 'snapshot.absent',
            }),
        ]);

        state = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_401_300 });
        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [restOrder({ updateTime: 1_783_814_400_100 })],
            completedAt: 1_783_814_401_400,
        });
        expect(state.orders).toEqual([]);
    });

    it('removes only confirmed symbols and prevents a stale snapshot from restoring them', () => {
        let state = syncSnapshot([
            restOrder({ orderId: '1', clientOrderId: 'btc-order' }),
            restOrder({
                symbol: 'ETHUSDT',
                orderId: '2',
                clientOrderId: 'eth-order',
            }),
        ]);
        state = removeFuturesOpenOrdersForSymbols(state, {
            symbols: ['BTCUSDT'],
            confirmedAt: 1_783_814_400_500,
        });
        expect(state.orders).toEqual([
            expect.objectContaining({ symbol: 'ETHUSDT', orderId: '2' }),
        ]);
        expect(state.tombstones).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'BTCUSDT:1',
                updateTimeSource: 'cancel.confirmed',
            }),
        ]));

        state = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_400_600 });
        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [
                restOrder({ orderId: '1', clientOrderId: 'btc-order' }),
                restOrder({
                    symbol: 'ETHUSDT',
                    orderId: '2',
                    clientOrderId: 'eth-order',
                }),
            ],
            completedAt: 1_783_814_400_700,
        });
        expect(state.orders).toEqual([
            expect.objectContaining({ symbol: 'ETHUSDT', orderId: '2' }),
        ]);
    });

    it('keeps terminal tombstones across later resyncs but permits a new orderId', () => {
        let state = syncSnapshot([restOrder()]);
        state = applyFuturesOrderTradeUpdate(state, orderTradeUpdate({}, {
            X: 'FILLED',
            x: 'TRADE',
            z: '0.010',
            T: 1_783_814_400_400,
        }));
        expect(state.orders).toEqual([]);

        state = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_401_000 });
        state = completeFuturesOpenOrdersSnapshot(state, {
            snapshotId: state.activeSnapshotId,
            rows: [
                restOrder({ updateTime: 1_783_814_400_100 }),
                restOrder({ orderId: '3', updateTime: 1_783_814_400_900 }),
            ],
            completedAt: 1_783_814_401_200,
        });

        expect(state.orders).toEqual([
            expect.objectContaining({
                key: 'BTCUSDT:3',
                clientKey: 'BTCUSDT:manual-order-1',
            }),
        ]);
        expect(state.tombstones).toHaveLength(1);
    });

    it('ignores a stale snapshot generation and preserves last valid data on failure', () => {
        let state = syncSnapshot([restOrder()]);
        const first = beginFuturesOpenOrdersSnapshot(state, { startedAt: 1_783_814_401_000 });
        const second = beginFuturesOpenOrdersSnapshot(first, { startedAt: 1_783_814_401_100 });
        expect(completeFuturesOpenOrdersSnapshot(second, {
            snapshotId: first.activeSnapshotId,
            rows: [],
            completedAt: 1_783_814_401_200,
        })).toBe(second);

        state = failFuturesOpenOrdersSnapshot(second, {
            snapshotId: second.activeSnapshotId,
            errorCode: 'OPEN_ORDERS_UNAVAILABLE',
        });
        expect(state).toMatchObject({
            syncState: 'degraded',
            errorCode: 'OPEN_ORDERS_UNAVAILABLE',
        });
        expect(state.orders).toEqual([
            expect.objectContaining({
                key: 'BTCUSDT:9223372036854775807',
                syncState: 'stale',
            }),
        ]);
    });
});
