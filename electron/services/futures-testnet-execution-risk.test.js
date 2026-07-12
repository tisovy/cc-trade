import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_RISK_REASONS,
    evaluateFuturesTestnetExecutionRisk,
} from './futures-testnet-execution-risk.js';
import { FUTURES_TESTNET_EXECUTION_SAFE_CODES } from './futures-testnet-execution-protocol.js';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';
const IDENTITY = Object.freeze({
    environment: 'testnet',
    symbol: 'BTCUSDT',
    credentialIdentity: 'credential-1',
    accountIdentity: 'account-1',
    connectionIdentity: 'connection-1',
    generation: 'generation-1',
});

const observe = (data, overrides = {}) => ({
    data,
    complete: true,
    connected: true,
    ...IDENTITY,
    ageMs: 0,
    futureDated: false,
    regressed: false,
    ...overrides,
});

const makeInput = () => ({
    command: {
        action: 'futures.execution.placeOrder',
        version: 1,
        requestId: REQUEST_ID,
        marketType: 'futures',
        environment: 'testnet',
        symbol: 'BTCUSDT',
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: '0.1',
        price: '100.0',
        timeInForce: 'GTC',
        positionSide: 'BOTH',
        marginType: 'ISOLATED',
        leverage: 3,
        reduceOnly: true,
        workingType: null,
        priceProtect: false,
        clientOrderId: `cc6-${REQUEST_ID}`,
    },
    policy: {
        allowedSymbols: ['BTCUSDT'],
        maxNotionalUsdt: '100.0',
        maxLeverage: 3,
        minAvailableBalanceUsdt: '1.0',
        minLiquidationDistanceBps: '1000',
    },
    ownership: {
        ...IDENTITY,
        selectedMetadataDigest: 'digest-1',
        currentMetadataDigest: 'digest-1',
        selectedMetadataVersion: 'version-1',
        currentMetadataVersion: 'version-1',
        selectedMetadataGeneration: 'generation-1',
        currentMetadataGeneration: 'generation-1',
        validationToDispatchAgeMs: 0,
    },
    observations: {
        serverTime: observe({
            serverTime: 1783814400000,
            roundTripMs: 100,
        }),
        exchangeInfo: observe({
            symbol: 'BTCUSDT',
            status: 'TRADING',
            contractType: 'PERPETUAL',
            quoteAsset: 'USDT',
            marginAsset: 'USDT',
            supportedOrderTypes: ['LIMIT'],
            supportedTimeInForce: ['GTC'],
            filters: {
                price: {
                    minPrice: '0',
                    maxPrice: '1000.0',
                    tickSize: '0.1',
                },
                percentPrice: {
                    multiplierUp: '1.2',
                    multiplierDown: '0.8',
                    multiplierDecimal: '1',
                },
                lotSize: {
                    minQty: '0.1',
                    maxQty: '10.0',
                    stepSize: '0.1',
                },
                minNotional: { notional: '10.0' },
                maxNumOrders: { limit: 1 },
            },
            metadataDigest: 'digest-1',
            metadataVersion: 'version-1',
            metadataGeneration: 'generation-1',
        }),
        markPrice: observe({
            symbol: 'BTCUSDT',
            markPrice: '100.0',
        }),
        accountConfig: observe({
            canTrade: true,
            dualSidePosition: false,
            multiAssetsMargin: false,
        }),
        symbolConfig: observe({
            symbol: 'BTCUSDT',
            marginType: 'ISOLATED',
            isAutoAddMargin: false,
            leverage: 3,
            maxNotionalValue: '200.0',
        }),
        positions: observe({
            positions: [{
                symbol: 'BTCUSDT',
                positionSide: 'BOTH',
                positionAmt: '1.0',
                liquidationPrice: '90.0',
                marginAsset: 'USDT',
                notional: '100.0',
                isolatedWallet: '20.0',
                isolatedMargin: '20.0',
                initialMargin: '10.0',
                maintMargin: '1.0',
                positionInitialMargin: '10.0',
                openOrderInitialMargin: '0',
            }],
        }),
        balance: observe({
            balances: [{
                asset: 'USDT',
                availableBalance: '1.0',
                marginAvailable: true,
            }],
        }),
        regularOpenOrders: observe({ orders: [] }),
        algoOpenOrders: observe({ orders: [] }),
    },
});

const expectRejected = (input, code, reason) => {
    expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({
        ok: false,
        code,
        reason,
    });
};

const freezeDeep = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Reflect.ownKeys(value).forEach((key) => freezeDeep(value[key]));
        Object.freeze(value);
    }
    return value;
};

describe('pure futures testnet execution risk evaluator', () => {
    it('accepts exact long and short one-way isolated full-position reductions', () => {
        expect(evaluateFuturesTestnetExecutionRisk(makeInput())).toEqual({ ok: true });

        const short = makeInput();
        short.command.side = 'BUY';
        short.observations.positions.data.positions[0].positionAmt = '-1.0';
        short.observations.positions.data.positions[0].notional = '-100.0';
        short.observations.positions.data.positions[0].liquidationPrice = '110.0';
        expect(evaluateFuturesTestnetExecutionRisk(short)).toEqual({ ok: true });
    });

    it('is deterministic, mutation-free, and independent of clock/network globals', () => {
        const input = freezeDeep(makeInput());
        const before = structuredClone(input);
        const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('clock access is forbidden');
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = () => {
            throw new Error('network access is forbidden');
        };
        try {
            expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
            expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
            expect(input).toEqual(before);
        } finally {
            dateSpy.mockRestore();
            globalThis.fetch = originalFetch;
        }
    });

    it('fails closed on extra fields, custom prototypes, sparse arrays, and accessors', () => {
        const extra = makeInput();
        extra.endpoint = '/fapi/v1/order';
        expectRejected(
            extra,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
        );

        const customPrototype = makeInput();
        customPrototype.policy = Object.assign(
            Object.create({ inherited: true }),
            customPrototype.policy,
        );
        expectRejected(
            customPrototype,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
        );

        const sparse = makeInput();
        sparse.observations.positions.data.positions = Array(1);
        expectRejected(
            sparse,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
        );

        const accessor = makeInput();
        let calls = 0;
        Object.defineProperty(accessor.observations.markPrice.data, 'markPrice', {
            enumerable: true,
            get() {
                calls += 1;
                return '100';
            },
        });
        expectRejected(
            accessor,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
        );
        expect(calls).toBe(0);
    });
});

describe('risk ownership, identity, and freshness', () => {
    it.each([
        ['command symbol', (input) => { input.command.symbol = 'ETHUSDT'; }],
        ['ownership symbol', (input) => { input.ownership.symbol = 'ETHUSDT'; }],
        ['exchange symbol', (input) => { input.observations.exchangeInfo.data.symbol = 'ETHUSDT'; }],
        ['mark symbol', (input) => { input.observations.markPrice.data.symbol = 'ETHUSDT'; }],
        ['symbol config identity', (input) => { input.observations.symbolConfig.data.symbol = 'ETHUSDT'; }],
        ['observation symbol', (input) => { input.observations.balance.symbol = 'ETHUSDT'; }],
    ])('rejects exact %s mismatch', (_name, mutate) => {
        const input = makeInput();
        mutate(input);
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
        );
    });

    it('rejects a mixed generation in every individual observation', () => {
        Object.keys(makeInput().observations).forEach((name) => {
            const input = makeInput();
            input.observations[name].generation = 'generation-2';
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
            );
        });
    });

    it('classifies a wrong position-row symbol as a position identity rejection', () => {
        const input = makeInput();
        input.observations.positions.data.positions[0].symbol = 'ETHUSDT';
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY,
        );
    });

    it.each([
        ['credentialIdentity', 'credential-2'],
        ['accountIdentity', 'account-2'],
        ['connectionIdentity', 'connection-2'],
        ['generation', 'generation-2'],
        ['environment', 'mock'],
    ])('rejects mixed observation %s', (field, value) => {
        const input = makeInput();
        input.observations.balance[field] = value;
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );
    });

    it('rejects exchange metadata identity drift independently of ownership drift', () => {
        for (const [field, value] of [
            ['metadataDigest', 'digest-2'],
            ['metadataVersion', 'version-2'],
            ['metadataGeneration', 'generation-2'],
        ]) {
            const input = makeInput();
            input.observations.exchangeInfo.data[field] = value;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
            );
        }
    });

    it.each([
        ['selectedMetadataDigest', 'digest-2'],
        ['selectedMetadataVersion', 'version-2'],
        ['selectedMetadataGeneration', 'generation-2'],
        ['currentMetadataGeneration', 'generation-2'],
    ])('rejects ownership metadata drift in %s', (field, value) => {
        const input = makeInput();
        input.ownership[field] = value;
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );
    });

    it('accepts every resource at exactly five seconds and rejects each at five seconds plus one', () => {
        const boundary = makeInput();
        Object.values(boundary.observations).forEach((observation) => {
            observation.ageMs = 5000;
        });
        expect(evaluateFuturesTestnetExecutionRisk(boundary)).toEqual({ ok: true });

        Object.keys(makeInput().observations).forEach((name) => {
            const input = makeInput();
            input.observations[name].ageMs = 5001;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
            );
        });
    });

    it.each([
        ['complete', false],
        ['connected', false],
        ['futureDated', true],
        ['regressed', true],
    ])('rejects %s freshness fact', (field, value) => {
        const input = makeInput();
        input.observations.markPrice[field] = value;
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );
    });

    it('enforces exact server RTT and validation-to-dispatch boundaries', () => {
        const boundary = makeInput();
        boundary.observations.serverTime.data.roundTripMs = 1000;
        boundary.ownership.validationToDispatchAgeMs = 1000;
        expect(evaluateFuturesTestnetExecutionRisk(boundary)).toEqual({ ok: true });

        const slowRtt = makeInput();
        slowRtt.observations.serverTime.data.roundTripMs = 1001;
        expectRejected(
            slowRtt,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );

        const slowDispatch = makeInput();
        slowDispatch.ownership.validationToDispatchAgeMs = 1001;
        expectRejected(
            slowDispatch,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );

        const zeroServerTime = makeInput();
        zeroServerTime.observations.serverTime.data.serverTime = 0;
        expectRejected(
            zeroServerTime,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );
    });
});

describe('exchange and exact filter risk checks', () => {
    it.each([
        ['status', 'BREAK'],
        ['contractType', 'CURRENT_QUARTER'],
        ['quoteAsset', 'BUSD'],
        ['marginAsset', 'BTC'],
        ['supportedOrderTypes', ['MARKET']],
        ['supportedTimeInForce', ['IOC']],
    ])('rejects exchange contract mismatch %s', (field, value) => {
        const input = makeInput();
        input.observations.exchangeInfo.data[field] = value;
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.EXCHANGE_CONTRACT,
        );
    });

    it.each([
        ['zero tick', (input) => { input.observations.exchangeInfo.data.filters.price.tickSize = '0'; }],
        ['negative tick', (input) => { input.observations.exchangeInfo.data.filters.price.tickSize = '-0.1'; }],
        ['zero min quantity', (input) => { input.observations.exchangeInfo.data.filters.lotSize.minQty = '0'; }],
        ['zero max quantity', (input) => { input.observations.exchangeInfo.data.filters.lotSize.maxQty = '0'; }],
        ['zero step', (input) => { input.observations.exchangeInfo.data.filters.lotSize.stepSize = '0'; }],
        ['inverted lot size', (input) => { input.observations.exchangeInfo.data.filters.lotSize.minQty = '11'; }],
        ['inconsistent lot size', (input) => { input.observations.exchangeInfo.data.filters.lotSize.maxQty = '10.05'; }],
        ['zero minimum notional', (input) => { input.observations.exchangeInfo.data.filters.minNotional.notional = '0'; }],
        ['zero max orders', (input) => { input.observations.exchangeInfo.data.filters.maxNumOrders.limit = 0; }],
        ['fractional max orders', (input) => { input.observations.exchangeInfo.data.filters.maxNumOrders.limit = 1.5; }],
        ['string max orders', (input) => { input.observations.exchangeInfo.data.filters.maxNumOrders.limit = '1'; }],
        ['inverted multipliers', (input) => { input.observations.exchangeInfo.data.filters.percentPrice.multiplierDown = '1.3'; }],
        ['invalid multiplier decimals', (input) => { input.observations.exchangeInfo.data.filters.percentPrice.multiplierDecimal = '19'; }],
        ['contradictory multiplier decimals', (input) => { input.observations.exchangeInfo.data.filters.percentPrice.multiplierDecimal = '0'; }],
        ['mixed multiplier scales', (input) => { input.observations.exchangeInfo.data.filters.percentPrice.multiplierUp = '1.20'; }],
    ])('fails closed for malformed filter metadata: %s', (_name, mutate) => {
        const input = makeInput();
        mutate(input);
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.FILTER_SCHEMA,
        );
    });

    it('accepts multiplier strings only when both exact scales match multiplierDecimal', () => {
        const input = makeInput();
        input.observations.exchangeInfo.data.filters.percentPrice.multiplierUp = '1.20';
        input.observations.exchangeInfo.data.filters.percentPrice.multiplierDown = '0.80';
        input.observations.exchangeInfo.data.filters.percentPrice.multiplierDecimal = '2';
        expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
    });

    it('requires every named Phase 6 exchange filter', () => {
        for (const filterName of [
            'price',
            'percentPrice',
            'lotSize',
            'minNotional',
            'maxNumOrders',
        ]) {
            const input = makeInput();
            delete input.observations.exchangeInfo.data.filters[filterName];
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.FILTER_SCHEMA,
            );
        }
    });

    it('treats zero price min/max as disabled but still enforces a positive tick', () => {
        const input = makeInput();
        input.observations.exchangeInfo.data.filters.price.maxPrice = '0';
        input.command.price = '100000.0';
        input.observations.markPrice.data.markPrice = '100000.0';
        input.observations.positions.data.positions[0].liquidationPrice = '90000.0';
        input.observations.exchangeInfo.data.filters.percentPrice.multiplierUp = '2.0';
        input.policy.maxNotionalUsdt = '10000';
        input.command.quantity = '0.1';
        input.observations.symbolConfig.data.maxNotionalValue = '10000';
        expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
    });

    it('enforces price min/max equality and the minimum-relative tick exactly', () => {
        const equality = makeInput();
        equality.observations.exchangeInfo.data.filters.price.minPrice = '100.0';
        equality.observations.exchangeInfo.data.filters.price.maxPrice = '100.0';
        expect(evaluateFuturesTestnetExecutionRisk(equality)).toEqual({ ok: true });

        for (const price of ['99.9', '100.1']) {
            const input = makeInput();
            input.observations.exchangeInfo.data.filters.price.minPrice = '100.0';
            input.observations.exchangeInfo.data.filters.price.maxPrice = '100.0';
            input.command.price = price;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.PRICE_FILTER,
            );
        }

        const offTick = makeInput();
        offTick.observations.exchangeInfo.data.filters.price.minPrice = '99.95';
        offTick.observations.exchangeInfo.data.filters.price.tickSize = '0.1';
        offTick.command.price = '100.0';
        expectRejected(
            offTick,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.PRICE_FILTER,
        );
    });

    it.each([
        ['BUY', '-1.0', 'BUY lower equality', '90.0', true],
        ['BUY', '-1.0', 'BUY official upper equality', '110.0', true],
        ['BUY', '-1.0', 'BUY local lower breach', '89.9', false],
        ['BUY', '-1.0', 'BUY official upper breach', '110.1', false],
        ['SELL', '1.0', 'SELL official lower equality', '90.0', true],
        ['SELL', '1.0', 'SELL upper equality', '110.0', true],
        ['SELL', '1.0', 'SELL official lower breach', '89.9', false],
        ['SELL', '1.0', 'SELL local upper breach', '110.1', false],
    ])('applies side-specific percent price plus opposite local bound: %s', (
        side,
        positionAmt,
        _name,
        price,
        passes,
    ) => {
        const input = makeInput();
        input.command.side = side;
        input.command.price = price;
        input.observations.positions.data.positions[0].positionAmt = positionAmt;
        input.observations.positions.data.positions[0].notional = positionAmt.startsWith('-')
            ? '-100.0'
            : '100.0';
        input.observations.positions.data.positions[0].liquidationPrice = side === 'BUY'
            ? '110.0'
            : '90.0';
        input.observations.exchangeInfo.data.filters.percentPrice.multiplierUp = '1.1';
        input.observations.exchangeInfo.data.filters.percentPrice.multiplierDown = '0.9';
        input.observations.exchangeInfo.data.filters.minNotional.notional = '1.0';
        if (passes) {
            expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
        } else {
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.PERCENT_PRICE,
            );
        }
    });

    it('enforces quantity min/max equality and non-zero-origin step exactly', () => {
        for (const quantity of ['0.1', '10.0']) {
            const input = makeInput();
            input.command.quantity = quantity;
            input.observations.positions.data.positions[0].positionAmt = '10.0';
            input.policy.maxNotionalUsdt = '10000';
            input.observations.symbolConfig.data.maxNotionalValue = '10000';
            expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
        }

        for (const quantity of ['0.0', '0.05', '10.1', '0.15']) {
            const input = makeInput();
            input.command.quantity = quantity;
            input.observations.positions.data.positions[0].positionAmt = '20.0';
            if (quantity === '0.0') {
                expectRejected(
                    input,
                    FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                    FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
                );
            } else {
                expectRejected(
                    input,
                    FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
                    FUTURES_TESTNET_EXECUTION_RISK_REASONS.QUANTITY_FILTER,
                );
            }
        }
    });
});

describe('account, leverage, margin, position, and reduce-only checks', () => {
    it.each([
        ['canTrade', false, FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.ACCOUNT_PERMISSION],
        ['dualSidePosition', true, FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_MODE],
        ['multiAssetsMargin', true, FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE],
    ])('rejects account configuration mismatch %s', (field, value, code, reason) => {
        const input = makeInput();
        input.observations.accountConfig.data[field] = value;
        expectRejected(input, code, reason);
    });

    it.each([
        ['marginType', 'CROSSED'],
        ['isAutoAddMargin', true],
    ])('rejects symbol margin mismatch %s', (field, value) => {
        const input = makeInput();
        input.observations.symbolConfig.data[field] = value;
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
        );
    });

    it('enforces observed leverage equality, configured cap, and hard 3x ceiling', () => {
        const mismatch = makeInput();
        mismatch.observations.symbolConfig.data.leverage = 2;
        expectRejected(
            mismatch,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.LEVERAGE_STATE,
        );

        const cap = makeInput();
        cap.command.leverage = 2;
        cap.observations.symbolConfig.data.leverage = 2;
        cap.policy.maxLeverage = 2;
        expect(evaluateFuturesTestnetExecutionRisk(cap)).toEqual({ ok: true });

        const overConfigured = makeInput();
        overConfigured.policy.maxLeverage = 2;
        expectRejected(
            overConfigured,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.LEVERAGE_STATE,
        );

        const hardCeiling = makeInput();
        hardCeiling.command.leverage = 4;
        hardCeiling.observations.symbolConfig.data.leverage = 4;
        expectRejected(
            hardCeiling,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.LEVERAGE_STATE,
        );

        const invalidPolicy = makeInput();
        invalidPolicy.policy.maxLeverage = 4;
        expectRejected(
            invalidPolicy,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
        );
    });

    it.each([
        ['zero position', (input) => { input.observations.positions.data.positions[0].positionAmt = '0'; }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_ZERO],
        ['missing position', (input) => { input.observations.positions.data.positions = []; }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY],
        ['duplicate position', (input) => { input.observations.positions.data.positions.push({ ...input.observations.positions.data.positions[0] }); }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY],
        ['hedge side', (input) => { input.observations.positions.data.positions[0].positionSide = 'LONG'; }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY],
        ['wrong long side', (input) => { input.command.side = 'BUY'; }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE],
        ['oversize reduction', (input) => { input.command.quantity = '1.1'; }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE],
        ['regular open order', (input) => { input.observations.regularOpenOrders.data.orders.push({}); }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE],
        ['algo open order', (input) => { input.observations.algoOpenOrders.data.orders.push({}); }, FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED, FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE],
    ])('rejects %s', (_name, mutate, code, reason) => {
        const input = makeInput();
        mutate(input);
        expectRejected(input, code, reason);
    });

    it('requires exactly one USDT balance, margin availability, and the configured positive buffer', () => {
        const equality = makeInput();
        equality.observations.balance.data.balances[0].availableBalance = '1.000000000000000000';
        expect(evaluateFuturesTestnetExecutionRisk(equality)).toEqual({ ok: true });

        const invalidCases = [
            (input) => { input.observations.balance.data.balances = []; },
            (input) => { input.observations.balance.data.balances[0].asset = 'BUSD'; },
            (input) => { input.observations.balance.data.balances.push({ ...input.observations.balance.data.balances[0] }); },
            (input) => { input.observations.balance.data.balances[0].marginAvailable = false; },
            (input) => { input.observations.balance.data.balances[0].availableBalance = '0.999999999999999999'; },
            (input) => { input.observations.balance.data.balances[0].availableBalance = '-1'; },
        ];
        invalidCases.forEach((mutate) => {
            const input = makeInput();
            mutate(input);
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        });

        const extraAsset = makeInput();
        extraAsset.observations.balance.data.balances.push({
            asset: 'BNB',
            availableBalance: '0',
            marginAvailable: false,
        });
        expectRejected(
            extraAsset,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
        );
    });

    it('rejects wrong position margin asset and a non-positive configured balance buffer', () => {
        const wrongAsset = makeInput();
        wrongAsset.observations.positions.data.positions[0].marginAsset = 'BTC';
        expectRejected(
            wrongAsset,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
        );

        for (const buffer of ['0', '-1']) {
            const input = makeInput();
            input.policy.minAvailableBalanceUsdt = buffer;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
            );
        }
    });

    it.each([
        'isolatedWallet',
        'isolatedMargin',
        'initialMargin',
        'maintMargin',
        'positionInitialMargin',
        'openOrderInitialMargin',
    ])('requires canonical non-negative position margin field %s while accepting zero', (field) => {
        const zero = makeInput();
        zero.observations.positions.data.positions[0][field] = '0.000000000000000000';
        expect(evaluateFuturesTestnetExecutionRisk(zero)).toEqual({ ok: true });

        for (const value of ['-0.1', '01', 0, null]) {
            const input = makeInput();
            input.observations.positions.data.positions[0][field] = value;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }
    });
});

describe('notional and liquidation boundaries', () => {
    it('enforces minimum notional equality and deliberately rejects reduce-only dust below it', () => {
        expect(evaluateFuturesTestnetExecutionRisk(makeInput())).toEqual({ ok: true });

        const dust = makeInput();
        dust.command.price = '99.9';
        expectRejected(
            dust,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        );
    });

    it('enforces configured and symbol maximum notional equality and one tick over', () => {
        const equality = makeInput();
        equality.command.quantity = '1.0';
        equality.policy.maxNotionalUsdt = '100.0';
        equality.observations.symbolConfig.data.maxNotionalValue = '100.0';
        expect(evaluateFuturesTestnetExecutionRisk(equality)).toEqual({ ok: true });

        const configuredOver = makeInput();
        configuredOver.command.quantity = '1.0';
        configuredOver.command.price = '100.1';
        configuredOver.observations.symbolConfig.data.maxNotionalValue = '200';
        expectRejected(
            configuredOver,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        );

        const symbolOver = makeInput();
        symbolOver.command.quantity = '1.0';
        symbolOver.command.price = '100.1';
        symbolOver.policy.maxNotionalUsdt = '200';
        symbolOver.observations.symbolConfig.data.maxNotionalValue = '100.0';
        expectRejected(
            symbolOver,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        );
    });

    it('uses quantity times the greater of limit and mark for both maximum caps', () => {
        const markAbove = makeInput();
        markAbove.command.quantity = '1.0';
        markAbove.command.price = '90.0';
        markAbove.observations.markPrice.data.markPrice = '100.1';
        markAbove.observations.positions.data.positions[0].liquidationPrice = '90.0';
        expectRejected(
            markAbove,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        );

        const limitAbove = makeInput();
        limitAbove.command.quantity = '1.0';
        limitAbove.command.price = '100.1';
        expectRejected(
            limitAbove,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        );
    });

    it.each([
        ['long equality', '1.0', 'SELL', '90.0', '1000', true],
        ['long above', '1.0', 'SELL', '89.99999999', '1000', true],
        ['long below', '1.0', 'SELL', '90.00000001', '1000', false],
        ['short equality', '-1.0', 'BUY', '110.0', '1000', true],
        ['short above', '-1.0', 'BUY', '110.00000001', '1000', true],
        ['short below', '-1.0', 'BUY', '109.99999999', '1000', false],
    ])('enforces exact liquidation distance by cross multiplication: %s', (
        _name,
        positionAmt,
        side,
        liquidationPrice,
        bps,
        passes,
    ) => {
        const input = makeInput();
        input.command.side = side;
        input.observations.positions.data.positions[0].positionAmt = positionAmt;
        input.observations.positions.data.positions[0].notional = positionAmt.startsWith('-')
            ? '-100'
            : '100';
        input.observations.positions.data.positions[0].liquidationPrice = liquidationPrice;
        input.policy.minLiquidationDistanceBps = bps;
        if (passes) {
            expect(evaluateFuturesTestnetExecutionRisk(input)).toEqual({ ok: true });
        } else {
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
            );
        }
    });

    it.each(['0', '100.0', '110.0'])(
        'rejects zero or wrong-side long liquidation price %s',
        (liquidationPrice) => {
            const input = makeInput();
            input.observations.positions.data.positions[0].liquidationPrice = liquidationPrice;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
            );
        },
    );

    it('rejects missing liquidation identity and a short liquidation price on the wrong side', () => {
        const missing = makeInput();
        delete missing.observations.positions.data.positions[0].liquidationPrice;
        expectRejected(
            missing,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
        );

        const wrongShort = makeInput();
        wrongShort.command.side = 'BUY';
        wrongShort.observations.positions.data.positions[0].positionAmt = '-1';
        wrongShort.observations.positions.data.positions[0].notional = '-100';
        wrongShort.observations.positions.data.positions[0].liquidationPrice = '90';
        expectRejected(
            wrongShort,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
        );
    });

    it('enforces the non-lowerable 1000-bps floor and 10000-bps upper grammar', () => {
        for (const value of ['999', '10001', '01000', '1000.0']) {
            const input = makeInput();
            input.policy.minLiquidationDistanceBps = value;
            expectRejected(
                input,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
            );
        }
    });

    it('rejects a configured notional above the non-raiseable 10000-USDT ceiling', () => {
        const input = makeInput();
        input.policy.maxNotionalUsdt = '10000.000000000000000001';
        expectRejected(
            input,
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
        );
    });
});

describe('deterministic risk rejection precedence', () => {
    it.each([
        [
            'policy before symbol',
            (input) => {
                input.policy.maxNotionalUsdt = '0';
                input.command.symbol = 'ETHUSDT';
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
        ],
        [
            'symbol before freshness',
            (input) => {
                input.command.symbol = 'ETHUSDT';
                input.observations.markPrice.ageMs = 5001;
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
        ],
        [
            'freshness before exchange contract',
            (input) => {
                input.observations.markPrice.ageMs = 5001;
                input.observations.exchangeInfo.data.status = 'BREAK';
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        ],
        [
            'exchange contract before account permission',
            (input) => {
                input.observations.exchangeInfo.data.status = 'BREAK';
                input.observations.accountConfig.data.canTrade = false;
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.EXCHANGE_CONTRACT,
        ],
        [
            'account permission before margin mode',
            (input) => {
                input.observations.accountConfig.data.canTrade = false;
                input.observations.accountConfig.data.multiAssetsMargin = true;
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.ACCOUNT_PERMISSION,
        ],
        [
            'margin mode before leverage',
            (input) => {
                input.observations.symbolConfig.data.marginType = 'CROSSED';
                input.observations.symbolConfig.data.leverage = 2;
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
        ],
        [
            'position identity before reduce-only state',
            (input) => {
                input.observations.positions.data.positions = [];
                input.observations.regularOpenOrders.data.orders = [{}];
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY,
        ],
        [
            'reduce-only state before price filters',
            (input) => {
                input.command.side = 'BUY';
                input.command.price = '100.05';
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE,
        ],
        [
            'price filters before notional',
            (input) => {
                input.command.price = '100.05';
                input.observations.exchangeInfo.data.filters.minNotional.notional = '1000';
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.PRICE_FILTER,
        ],
        [
            'notional before liquidation distance',
            (input) => {
                input.observations.exchangeInfo.data.filters.minNotional.notional = '1000';
                input.observations.positions.data.positions[0].liquidationPrice = '110';
            },
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        ],
    ])('keeps %s stable under simultaneous failures', (_name, mutate, code, reason) => {
        const input = makeInput();
        mutate(input);
        expectRejected(input, code, reason);
    });
});
