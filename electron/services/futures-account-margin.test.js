// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
    computeFuturesAccountMarginEstimates,
    createFuturesMarginEstimateEvents,
} from './futures-account-margin.js';

const bracketTable = (symbol) => ({
    symbol,
    maxLeverage: 20,
    brackets: [
        {
            initialLeverage: 20,
            notionalFloor: '0',
            notionalCap: '1000',
            maintMarginRatio: '0.01',
            cum: '0',
        },
        {
            initialLeverage: 10,
            notionalFloor: '1000',
            notionalCap: '5000',
            maintMarginRatio: '0.02',
            cum: '10',
        },
    ],
});
const reading = () => ({
    positions: [
        {
            symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '10',
            entryPrice: '100', isolatedWallet: '0',
        },
        {
            symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '-5',
            entryPrice: '100', isolatedWallet: '0',
        },
        {
            symbol: 'ETHUSDT', positionSide: 'BOTH', quantity: '4',
            entryPrice: '40', isolatedWallet: '30',
        },
    ],
    balances: { USDT: { crossWallet: '200', available: '81' } },
    regularOrders: [
        {
            orderId: 1, symbol: 'BTCUSDT', side: 'BUY', origQty: '2',
            executedQty: '0', price: '110', reduceOnly: false,
        },
        {
            orderId: 2, symbol: 'BTCUSDT', side: 'BUY', origQty: '1',
            executedQty: '0', price: '100', reduceOnly: false,
        },
        {
            orderId: 3, symbol: 'BTCUSDT', side: 'SELL', origQty: '3',
            executedQty: '0', price: '130', reduceOnly: false,
        },
        {
            orderId: 4, symbol: 'BTCUSDT', side: 'SELL', origQty: '100',
            executedQty: '0', price: '130', reduceOnly: true,
        },
    ],
    algoOrders: [],
    marks: { BTCUSDT: '120', ETHUSDT: '50' },
    symbolConfigs: new Map([
        ['BTCUSDT', { symbol: 'BTCUSDT', leverage: 10, marginType: 'CROSSED' }],
        ['ETHUSDT', { symbol: 'ETHUSDT', leverage: 5, marginType: 'ISOLATED' }],
    ]),
    leverageBrackets: new Map([
        ['BTCUSDT', bracketTable('BTCUSDT')],
        ['ETHUSDT', bracketTable('ETHUSDT')],
    ]),
});

describe('computeFuturesAccountMarginEstimates', () => {
    it('computes both margin modes, a hedge pair and only the heavier resting side', () => {
        const estimates = computeFuturesAccountMarginEstimates(reading());

        expect(estimates.positions['BTCUSDT:LONG']).toMatchObject({
            notional: 1200,
            initialMargin: 120,
            maintenanceMargin: 14,
        });
        expect(estimates.positions['BTCUSDT:LONG'].liquidationPrice)
            .toBeCloseTo(91.4285714286, 8);
        expect(estimates.positions['BTCUSDT:SHORT']).toMatchObject({
            notional: 600,
            initialMargin: 60,
            maintenanceMargin: 6,
        });
        expect(estimates.positions['BTCUSDT:SHORT'].liquidationPrice)
            .toBeCloseTo(175.4455445545, 8);
        expect(estimates.positions['ETHUSDT:BOTH']).toMatchObject({
            notional: 200,
            // An isolated position commits the wallet the exchange walled off,
            // not notional divided by leverage.
            initialMargin: 30,
            maintenanceMargin: 2,
        });
        expect(estimates.positions['ETHUSDT:BOTH'].liquidationPrice)
            .toBeCloseTo(32.8282828283, 8);

        // Cross wallet 200 + cross uPnL 100 - cross initial 180 - orders 39.
        // BUY commits 32, SELL commits 39, and the reduce-only order commits 0.
        expect(estimates.freeMargin).toBeCloseTo(81, 10);
    });

    // A resting order holds the same margin from the moment it is placed until
    // it is cancelled or filled: its own price times its own quantity, over the
    // leverage. Nothing about that moves with the market, so nothing about it
    // needs a live mark — and demanding one anyway is what took the whole sum
    // away, since the sum is all-or-nothing across the account and marks are
    // followed per position. An entry order is by definition an order on a
    // contract holding no position.
    it('values a resting order at its own price when its contract has no mark', () => {
        const value = reading();
        const withOrderOnly = extra => ({
            ...value,
            regularOrders: [...value.regularOrders, extra],
            // SOLUSDT is the contract the account only has an order on. Its
            // leverage and bracket are held — that much was already fixed — and
            // `marks` deliberately says nothing about it.
            symbolConfigs: new Map([
                ...value.symbolConfigs,
                ['SOLUSDT', { symbol: 'SOLUSDT', leverage: 10, marginType: 'CROSSED' }],
            ]),
            leverageBrackets: new Map([...value.leverageBrackets, ['SOLUSDT', bracketTable('SOLUSDT')]]),
        });

        // Four at twenty-five is a hundred of notional at ten times, so ten more
        // committed against the eighty-one that was spendable without it.
        expect(computeFuturesAccountMarginEstimates(withOrderOnly({
            orderId: 5, symbol: 'SOLUSDT', side: 'BUY', origQty: '4',
            executedQty: '0', price: '25', reduceOnly: false,
        })).freeMargin).toBeCloseTo(71, 10);

        // And nothing is loosened: an order that names no price at all — a
        // market-triggered stop reports `price` as zero — has only the mark to be
        // valued at, and without one the sum still refuses rather than
        // understating what the account has committed.
        expect(computeFuturesAccountMarginEstimates(withOrderOnly({
            orderId: 6, symbol: 'SOLUSDT', side: 'BUY', origQty: '4',
            executedQty: '0', price: '0', reduceOnly: false,
        })).freeMargin).toBeNull();
    });

    it.each([
        ['mark', value => ({ ...value, marks: {} })],
        ['bracket', value => ({ ...value, leverageBrackets: new Map() })],
        ['leverage', value => ({
            ...value,
            symbolConfigs: new Map([
                ['BTCUSDT', { symbol: 'BTCUSDT', leverage: null, marginType: 'CROSSED' }],
                ['ETHUSDT', { symbol: 'ETHUSDT', leverage: 5, marginType: 'ISOLATED' }],
            ]),
        })],
        ['margin mode', value => ({
            ...value,
            symbolConfigs: new Map([
                ['BTCUSDT', { symbol: 'BTCUSDT', leverage: 10, marginType: null }],
                ['ETHUSDT', { symbol: 'ETHUSDT', leverage: 5, marginType: 'ISOLATED' }],
            ]),
        })],
    ])('returns absence instead of a partial result when the %s is missing', (_name, omit) => {
        const estimates = computeFuturesAccountMarginEstimates(omit(reading()));
        expect(estimates.positions['BTCUSDT:LONG']).toBeUndefined();
        expect(estimates.freeMargin).toBeNull();
    });

    it('does not treat account resources that have never been read as empty sets', () => {
        const value = reading();
        expect(computeFuturesAccountMarginEstimates({
            ...value,
            regularOrders: null,
        }).freeMargin).toBeNull();
        expect(computeFuturesAccountMarginEstimates({
            ...value,
            positions: null,
        }).freeMargin).toBeNull();
    });
});

describe('createFuturesMarginEstimateEvents', () => {
    const positions = [
        {
            symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1',
            notional: '100', initialMargin: '50', maintenanceMargin: '10',
            liquidationPrice: '20',
        },
        {
            symbol: 'ETHUSDT', positionSide: 'BOTH', quantity: '1',
            notional: '200', initialMargin: '100', maintenanceMargin: '20',
            liquidationPrice: '30',
        },
    ];

    it('emits one aggregate per position value with only counters and whole bps', () => {
        const events = createFuturesMarginEstimateEvents({
            resource: 'positions',
            positions,
            estimates: {
                positions: {
                    'BTCUSDT:LONG': {
                        notional: 101,
                        initialMargin: 50,
                        maintenanceMargin: 9,
                        liquidationPrice: 20,
                    },
                },
            },
        });

        expect(events).toEqual([
            {
                value: 'notional', compared: 1, unavailable: 1,
                deviationBps: 100, symbol: 'BTCUSDT',
            },
            {
                value: 'initial-margin', compared: 1, unavailable: 1,
                deviationBps: 0, symbol: 'BTCUSDT',
            },
            {
                value: 'maintenance-margin', compared: 1, unavailable: 1,
                deviationBps: 1000, symbol: 'BTCUSDT',
            },
            {
                value: 'liquidation-price', compared: 1, unavailable: 1,
                deviationBps: 0, symbol: 'BTCUSDT',
            },
        ]);
        expect(JSON.stringify(events)).not.toMatch(/initialMargin|maintenanceMargin|liquidationPrice/);
    });

    it('records an unavailable pass distinctly from agreement', () => {
        const [event] = createFuturesMarginEstimateEvents({
            resource: 'balances',
            balances: { USDT: { available: '100' } },
            estimates: { positions: {}, freeMargin: null },
        });
        expect(event).toEqual({
            value: 'free-margin',
            compared: 0,
            unavailable: 1,
            deviationBps: null,
            symbol: null,
        });
    });

    it('drops an aggregate whose ratio is outside the bounded record domain', () => {
        expect(createFuturesMarginEstimateEvents({
            resource: 'balances',
            balances: { USDT: { available: '1' } },
            estimates: { positions: {}, freeMargin: 100_000 },
        })).toEqual([]);
    });
});
