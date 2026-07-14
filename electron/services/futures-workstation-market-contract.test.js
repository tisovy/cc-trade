import { describe, expect, it } from 'vitest';
import {
    FUTURES_WORKSTATION_EVENT_MAX_BYTES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    createFuturesProductionWorkstationEvent,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';
import { FUTURES_TESTNET_WORKSTATION_FIXTURE } from './futures-testnet-workstation-fixtures.js';
import {
    FUTURES_WORKSTATION_MARKET_LIMITS,
    FuturesWorkstationMarketContractError,
    appendFuturesWorkstationTrade,
    createFuturesWorkstationCatalogFrames,
    createFuturesWorkstationHeader,
    normalizeFuturesWorkstationDepthSnapshot,
    normalizeFuturesWorkstationExchangeInfo,
    normalizeFuturesWorkstationKlines,
    normalizeFuturesWorkstationPremiumIndex,
    normalizeFuturesWorkstationStreamFrame,
    normalizeFuturesWorkstationTicker,
    toRendererCandleRows,
    toRendererTradeRows,
    updateFuturesWorkstationCandles,
    updateFuturesWorkstationHeader,
} from './futures-workstation-market-contract.js';

const fixtureFor = symbol => FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols[symbol];
const expectation = (symbol = 'BTCUSDT', interval = '1m') => ({
    symbol,
    pair: symbol,
    interval,
});

describe('official Futures workstation market schemas', () => {
    it('normalizes a USDⓈ-M-only catalog with exact filters and allowlist state', () => {
        const catalog = normalizeFuturesWorkstationExchangeInfo(
            FUTURES_TESTNET_WORKSTATION_FIXTURE.catalog,
            new Set(['BTCUSDT']),
        );
        expect(catalog.map(contract => contract.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
        expect(catalog[0].allowlisted).toBe(true);
        expect(catalog[1].allowlisted).toBe(false);
        expect(catalog[0].filters).toEqual({
            price: { min: '0.10', max: '10000000.00000000', tickSize: '0.10' },
            quantity: { min: '0.001', max: '1000000.00000000', stepSize: '0.001' },
            marketQuantity: { min: '0.001', max: '100000.00000000', stepSize: '0.001' },
            percentPrice: {
                multiplierUp: '1.1500',
                multiplierDown: '0.8500',
                multiplierDecimal: 4,
            },
            maximumOrders: 200,
            maximumAlgoOrders: 100,
            minimumNotional: '5.00000000',
        });
        expect(Object.isFrozen(catalog)).toBe(true);
        expect(Object.isFrozen(catalog[0].filters)).toBe(true);
    });

    it('excludes non-USDT contracts from the catalog', () => {
        const source = JSON.parse(FUTURES_TESTNET_WORKSTATION_FIXTURE.catalog);
        source.symbols.push({
            ...source.symbols[0],
            symbol: 'BTCUSD',
            pair: 'BTCUSD',
            quoteAsset: 'USD',
            marginAsset: 'BTC',
        });
        const catalog = normalizeFuturesWorkstationExchangeInfo(
            JSON.stringify(source),
            new Set(['BTCUSDT']),
        );
        expect(catalog.some(contract => contract.symbol === 'BTCUSD')).toBe(false);
    });

    it.each(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])(
        'normalizes bounded %s snapshots, candles and headers',
        (symbol) => {
            const fixture = fixtureFor(symbol);
            const depth = normalizeFuturesWorkstationDepthSnapshot(fixture.depthSnapshot, symbol);
            const candles = normalizeFuturesWorkstationKlines(fixture.contractKlines);
            const premium = normalizeFuturesWorkstationPremiumIndex(fixture.premiumIndex, symbol);
            const ticker = normalizeFuturesWorkstationTicker(fixture.ticker, symbol);
            const header = createFuturesWorkstationHeader({ premium, ticker, contractStatus: 'TRADING' });
            expect(depth.lastUpdateId).toBe('1000');
            expect(depth.bids).toHaveLength(48);
            expect(candles).toHaveLength(96);
            expect(header.lastPrice).toMatch(/^\d+\.\d+$/);
            expect(header.markPrice).toMatch(/^\d+\.\d+$/);
            expect(header.basis).toBe('0.02');
            expect(header.fundingRatePercent).toBe('0.01');
            expect(Object.isFrozen(header)).toBe(true);
        },
    );

    it('normalizes every reviewed combined stream schema', () => {
        const frames = fixtureFor('BTCUSDT').streams.makeCycle(1, '5m');
        expect(frames.map(frame => normalizeFuturesWorkstationStreamFrame(
            frame,
            expectation('BTCUSDT', '5m'),
        ).kind)).toEqual(['depth', 'trade', 'kline', 'mark', 'ticker']);
    });

    it('preserves unquoted int64 stream identities beyond 2^53', () => {
        const tradeFrame = fixtureFor('BTCUSDT').streams.makeCycle(1)[1];
        const unsafeIdentity = '18446744073709551615';
        const raw = tradeFrame.replace(/"a":\d+/, `"a":${unsafeIdentity}`);
        const event = normalizeFuturesWorkstationStreamFrame(raw, expectation());
        expect(event.row.aggregateTradeId).toBe(unsafeIdentity);
        expect(typeof event.row.aggregateTradeId).toBe('string');
    });

    it('validates every frozen-but-unrendered REST schema field', () => {
        const fixture = fixtureFor('BTCUSDT');
        for (const index of [7, 8, 9, 10, 11]) {
            const kline = JSON.parse(fixture.contractKlines);
            kline[0][index] = true;
            expect(() => normalizeFuturesWorkstationKlines(JSON.stringify(kline)))
                .toThrow(FuturesWorkstationMarketContractError);
        }
        for (const field of ['estimatedSettlePrice', 'interestRate']) {
            const premium = JSON.parse(fixture.premiumIndex);
            premium[field] = null;
            expect(() => normalizeFuturesWorkstationPremiumIndex(
                JSON.stringify(premium),
                'BTCUSDT',
            )).toThrow(FuturesWorkstationMarketContractError);
        }
        for (const field of ['weightedAvgPrice', 'openPrice']) {
            const ticker = JSON.parse(fixture.ticker);
            ticker[field] = false;
            expect(() => normalizeFuturesWorkstationTicker(JSON.stringify(ticker), 'BTCUSDT'))
                .toThrow(FuturesWorkstationMarketContractError);
        }
        const ticker = JSON.parse(fixture.ticker);
        ticker.firstId = 20;
        ticker.lastId = 19;
        expect(() => normalizeFuturesWorkstationTicker(JSON.stringify(ticker), 'BTCUSDT'))
            .toThrowError(expect.objectContaining({ code: 'INVALID_TICKER_ID_RANGE' }));
    });

    it('validates every frozen-but-unrendered stream field and identity range', () => {
        const frames = fixtureFor('BTCUSDT').streams.makeCycle(1);
        const corrupt = [
            [1, payload => { payload.data.f = 20; payload.data.l = 19; }],
            [2, payload => { payload.data.k.f = 20; payload.data.k.L = 19; }],
            ...['q', 'V', 'Q', 'B'].map(field => [
                2,
                payload => { payload.data.k[field] = false; },
            ]),
            ...['P', 'ap'].map(field => [
                3,
                payload => { payload.data[field] = null; },
            ]),
            ...['w', 'o'].map(field => [
                4,
                payload => { payload.data[field] = false; },
            ]),
            [4, payload => { payload.data.F = 20; payload.data.L = 19; }],
        ];
        for (const [frameIndex, mutate] of corrupt) {
            const payload = JSON.parse(frames[frameIndex]);
            mutate(payload);
            expect(() => normalizeFuturesWorkstationStreamFrame(
                JSON.stringify(payload),
                expectation(),
            )).toThrow(FuturesWorkstationMarketContractError);
        }
    });

    it.each([
        ['wrong symbol', raw => raw.replace('"s":"BTCUSDT"', '"s":"ETHUSDT"'), 'WRONG_STREAM_SYMBOL'],
        ['COIN-M st', raw => raw.replace('"st":1', '"st":2'), 'WRONG_STREAM_MARKET_TYPE'],
        ['wrong pair', raw => raw.replace('"ps":"BTCUSDT"', '"ps":"ETHUSDT"'), 'WRONG_STREAM_PAIR'],
        ['floating identity', raw => raw.replace(/"U":\d+/, '"U":1.5'), 'INVALID_JSON_NUMBER'],
        ['extra key', raw => raw.replace('"e":"depthUpdate"', '"e":"depthUpdate","x":"drift"'), 'INVALID_DEPTH_STREAM'],
    ])('rejects %s stream corruption', (_label, mutate, code) => {
        const raw = mutate(fixtureFor('BTCUSDT').streams.bridgeDepth);
        expect(() => normalizeFuturesWorkstationStreamFrame(raw, expectation()))
            .toThrowError(expect.objectContaining({ code }));
    });

    it('rejects duplicate keys in an exchange frame', () => {
        const raw = fixtureFor('BTCUSDT').streams.bridgeDepth
            .replace('"s":"BTCUSDT"', '"s":"BTCUSDT","s":"BTCUSDT"');
        expect(() => normalizeFuturesWorkstationStreamFrame(raw, expectation()))
            .toThrowError(expect.objectContaining({ code: 'DUPLICATE_JSON_KEY' }));
    });

    it('rejects a stream name that does not match the selected generation', () => {
        const raw = fixtureFor('BTCUSDT').streams.bridgeDepth
            .replace('btcusdt@depth@100ms', 'ethusdt@depth@100ms');
        expect(() => normalizeFuturesWorkstationStreamFrame(raw, expectation()))
            .toThrowError(expect.objectContaining({ code: 'UNEXPECTED_STREAM' }));
    });

    it('rejects an oversized WebSocket frame before parsing', () => {
        const raw = `${fixtureFor('BTCUSDT').streams.bridgeDepth}${' '.repeat(65_536)}`;
        expect(() => normalizeFuturesWorkstationStreamFrame(raw, expectation()))
            .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }));
    });

    it('rejects duplicate and malformed REST candle rows', () => {
        const rows = JSON.parse(fixtureFor('BTCUSDT').contractKlines);
        rows.push(rows[0]);
        expect(() => normalizeFuturesWorkstationKlines(JSON.stringify(rows)))
            .toThrowError(expect.objectContaining({ code: 'DUPLICATE_KLINE' }));
        rows.pop();
        rows[0].push('extra');
        expect(() => normalizeFuturesWorkstationKlines(JSON.stringify(rows)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_KLINE_TUPLE' }));
    });

    it('rejects catalog schema drift and duplicate symbols', () => {
        const source = JSON.parse(FUTURES_TESTNET_WORKSTATION_FIXTURE.catalog);
        source.unreviewed = true;
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source), new Set()))
            .toThrow(FuturesWorkstationMarketContractError);
        delete source.unreviewed;
        source.symbols.push(source.symbols[0]);
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source), new Set()))
            .toThrowError(expect.objectContaining({ code: 'DUPLICATE_EXCHANGE_SYMBOL' }));
    });

    it('accepts officially disabled price bounds and rejects unreviewed filters', () => {
        const source = JSON.parse(FUTURES_TESTNET_WORKSTATION_FIXTURE.catalog);
        const price = source.symbols[0].filters.find(filter => filter.filterType === 'PRICE_FILTER');
        price.maxPrice = '0';
        price.tickSize = '0';
        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source), new Set());
        expect(catalog[0].filters.price).toMatchObject({ max: '0', tickSize: '0' });

        source.symbols[0].filters.push({ filterType: 'UNREVIEWED_FILTER', value: '1' });
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source), new Set()))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_FILTER' }));
    });

    it('rejects wrong-symbol REST header data', () => {
        expect(() => normalizeFuturesWorkstationPremiumIndex(
            fixtureFor('BTCUSDT').premiumIndex,
            'ETHUSDT',
        )).toThrowError(expect.objectContaining({ code: 'INVALID_PREMIUM_INDEX' }));
        expect(() => normalizeFuturesWorkstationTicker(
            fixtureFor('BTCUSDT').ticker,
            'ETHUSDT',
        )).toThrowError(expect.objectContaining({ code: 'INVALID_TICKER' }));
    });

    it('updates candle identity in place and bounds the cache', () => {
        let rows = normalizeFuturesWorkstationKlines(fixtureFor('BTCUSDT').contractKlines);
        const replacement = { ...rows.at(-1), close: '60000.00' };
        rows = updateFuturesWorkstationCandles(rows, replacement);
        expect(rows.at(-1).close).toBe('60000.00');
        for (let index = 0; index < 600; index += 1) {
            rows = updateFuturesWorkstationCandles(rows, {
                ...replacement,
                openTime: replacement.openTime + ((index + 1) * 60_000),
                closeTime: replacement.closeTime + ((index + 1) * 60_000),
            });
        }
        expect(rows).toHaveLength(FUTURES_WORKSTATION_MARKET_LIMITS.CANDLES);
        expect(toRendererCandleRows(rows)).toHaveLength(80);
    });

    it('deduplicates and bounds the aggregate-trade tape', () => {
        const seed = normalizeFuturesWorkstationStreamFrame(
            fixtureFor('BTCUSDT').streams.makeCycle(1)[1],
            expectation(),
        ).row;
        let rows = appendFuturesWorkstationTrade([], seed);
        rows = appendFuturesWorkstationTrade(rows, seed);
        expect(rows).toHaveLength(1);
        for (let index = 0; index < 600; index += 1) {
            rows = appendFuturesWorkstationTrade(rows, {
                ...seed,
                aggregateTradeId: `${BigInt(seed.aggregateTradeId) + BigInt(index + 1)}`,
                tradeTime: seed.tradeTime + index + 1,
            });
        }
        expect(rows).toHaveLength(FUTURES_WORKSTATION_MARKET_LIMITS.TRADES);
        expect(toRendererTradeRows(rows)).toHaveLength(80);
    });

    it('updates mark and ticker header fields independently', () => {
        const fixture = fixtureFor('BTCUSDT');
        const initial = createFuturesWorkstationHeader({
            premium: normalizeFuturesWorkstationPremiumIndex(fixture.premiumIndex, 'BTCUSDT'),
            ticker: normalizeFuturesWorkstationTicker(fixture.ticker, 'BTCUSDT'),
            contractStatus: 'TRADING',
        });
        const events = fixture.streams.makeCycle(2).map(raw => (
            normalizeFuturesWorkstationStreamFrame(raw, expectation())
        ));
        const afterMark = updateFuturesWorkstationHeader(
            initial,
            events.find(event => event.kind === 'mark'),
        );
        const afterTicker = updateFuturesWorkstationHeader(
            afterMark,
            events.find(event => event.kind === 'ticker'),
        );
        expect(afterMark.markPrice).not.toBe(initial.markPrice);
        expect(afterMark.basis).toBe('0.02');
        expect(afterMark.fundingRatePercent).toBe('0.01');
        expect(afterTicker.lastPrice).not.toBe(initial.lastPrice);
        expect(afterTicker.markPrice).toBe(afterMark.markPrice);
    });

    it('chunks a large catalog into bounded renderer frames', () => {
        const seed = normalizeFuturesWorkstationExchangeInfo(
            FUTURES_TESTNET_WORKSTATION_FIXTURE.catalog,
            new Set(['BTCUSDT']),
        )[0];
        const contracts = Array.from({ length: 95 }, (_, index) => ({
            ...seed,
            symbol: `A${String(index).padStart(3, '0')}USDT`,
            pair: `A${String(index).padStart(3, '0')}USDT`,
        }));
        const frames = createFuturesWorkstationCatalogFrames(contracts);
        expect(frames.map(frame => frame.contracts.length)).toEqual([
            8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7,
        ]);
        expect(frames.at(-1).complete).toBe(true);
        expect(frames.at(-1).total).toBe(95);
        for (const [index, frame] of frames.entries()) {
            const event = createFuturesProductionWorkstationEvent({
                requestId: 'catalog-frame-bound',
                symbol: 'BTCUSDT',
                generation: 1,
                revision: index + 1,
                resource: 'catalog',
                state: 'live',
                observedAt: 1_784_000_000_000,
                payload: frame,
            });
            expect(Buffer.byteLength(JSON.stringify(event), 'utf8'))
                .toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
        }
        const maximumDecimal = '9'.repeat(64);
        const maximumContract = {
            ...seed,
            symbol: 'A'.repeat(20),
            pair: 'B'.repeat(20),
            contractType: 'C'.repeat(32),
            status: 'S'.repeat(32),
            baseAsset: 'D'.repeat(16),
            filters: {
                price: { min: maximumDecimal, max: maximumDecimal, tickSize: maximumDecimal },
                quantity: { min: maximumDecimal, max: maximumDecimal, stepSize: maximumDecimal },
                marketQuantity: { min: maximumDecimal, max: maximumDecimal, stepSize: maximumDecimal },
                percentPrice: {
                    multiplierUp: maximumDecimal,
                    multiplierDown: maximumDecimal,
                    multiplierDecimal: 18,
                },
                maximumOrders: Number.MAX_SAFE_INTEGER,
                maximumAlgoOrders: Number.MAX_SAFE_INTEGER,
                minimumNotional: maximumDecimal,
            },
        };
        const maximumEvent = createFuturesProductionWorkstationEvent({
            requestId: 'catalog-frame-worst-case',
            symbol: 'BTCUSDT',
            generation: 1,
            revision: 1,
            resource: 'catalog',
            state: 'live',
            observedAt: 1_784_000_000_000,
            payload: {
                offset: 0,
                total: 512,
                complete: false,
                contracts: Array.from({ length: 8 }, () => maximumContract),
            },
        });
        expect(Buffer.byteLength(JSON.stringify(maximumEvent), 'utf8'))
            .toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
    });
});
