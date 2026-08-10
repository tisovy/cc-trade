import { describe, expect, it } from 'vitest';
import {
    FUTURES_WORKSTATION_EVENT_MAX_BYTES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    createFuturesProductionWorkstationEvent,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';
import { FUTURES_PRODUCTION_WORKSTATION_FIXTURE } from './futures-production-workstation-fixtures.js';
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

const fixtureFor = symbol => FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols[symbol];
const expectation = (symbol = 'BTCUSDT', interval = '1m') => ({
    symbol,
    pair: symbol,
    interval,
});

describe('official Futures workstation market schemas', () => {
    it('normalizes every execution-compatible USDⓈ-M contract without a static symbol list', () => {
        const catalog = normalizeFuturesWorkstationExchangeInfo(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog,
        );
        expect(catalog.map(contract => contract.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
        expect(catalog[0].tradable).toBe(true);
        expect(catalog.every(contract => contract.tradable)).toBe(true);
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

    it('normalizes the current Production TUTUSDT contract as tradable', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        source.symbols = [{
            ...source.symbols[0],
            symbol: 'TUTUSDT',
            pair: 'TUTUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            baseAsset: 'TUT',
            quoteAsset: 'USDT',
            marginAsset: 'USDT',
            pricePrecision: 7,
            quantityPrecision: 0,
            filters: [
                {
                    minPrice: '0.0000100',
                    maxPrice: '200',
                    tickSize: '0.0000100',
                    filterType: 'PRICE_FILTER',
                },
                {
                    filterType: 'LOT_SIZE',
                    minQty: '1',
                    maxQty: '40000000',
                    stepSize: '1',
                },
                {
                    minQty: '1',
                    filterType: 'MARKET_LOT_SIZE',
                    stepSize: '1',
                    maxQty: '4000000',
                },
                { filterType: 'MAX_NUM_ORDERS', limit: 200 },
                { notional: '5', filterType: 'MIN_NOTIONAL' },
                {
                    multiplierDown: '0.8500',
                    filterType: 'PERCENT_PRICE',
                    multiplierUp: '1.1500',
                    multiplierDecimal: '4',
                },
                {
                    positionControlSide: 'NONE',
                    filterType: 'POSITION_RISK_CONTROL',
                },
            ],
        }];

        const [tut] = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));

        expect(tut).toEqual({
            symbol: 'TUTUSDT',
            pair: 'TUTUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            baseAsset: 'TUT',
            quoteAsset: 'USDT',
            marginAsset: 'USDT',
            tradable: true,
            filters: {
                price: { min: '0.0000100', max: '200', tickSize: '0.0000100' },
                quantity: { min: '1', max: '40000000', stepSize: '1' },
                marketQuantity: { min: '1', max: '4000000', stepSize: '1' },
                percentPrice: {
                    multiplierUp: '1.1500',
                    multiplierDown: '0.8500',
                    multiplierDecimal: 4,
                },
                maximumOrders: 200,
                maximumAlgoOrders: null,
                minimumNotional: '5',
            },
        });
    });

    it('excludes non-USDT contracts from the catalog', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        source.symbols.push({
            ...source.symbols[0],
            symbol: 'BTCUSD',
            pair: 'BTCUSD',
            quoteAsset: 'USD',
            marginAsset: 'BTC',
        });
        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));
        expect(catalog.some(contract => contract.symbol === 'BTCUSD')).toBe(false);
    });

    it('accepts the bounded current catalog above the legacy 512-contract limit', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        const seed = source.symbols[0];
        source.symbols = Array.from({ length: 600 }, (_, index) => {
            const baseAsset = `A${String(index).padStart(4, '0')}`;
            return {
                ...seed,
                symbol: `${baseAsset}USDT`,
                pair: `${baseAsset}USDT`,
                baseAsset,
            };
        });
        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));
        expect(catalog).toHaveLength(600);
        expect(catalog[0]).toMatchObject({ symbol: 'A0000USDT', tradable: true });
        expect(catalog.at(-1)).toMatchObject({ tradable: true });
    });

    it('rejects a catalog above the revised 1024-contract bound', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        const seed = source.symbols[0];
        source.symbols = Array.from({ length: 1_025 }, (_, index) => {
            const baseAsset = `A${String(index).padStart(4, '0')}`;
            return {
                ...seed,
                symbol: `${baseAsset}USDT`,
                pair: `${baseAsset}USDT`,
                baseAsset,
            };
        });
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_INFO' }));
    });

    it('accepts the official dated delivery-symbol grammar without widening pair grammar', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        source.symbols[0] = {
            ...source.symbols[0],
            symbol: 'BTCUSDT_260925',
            pair: 'BTCUSDT',
            contractType: 'CURRENT_QUARTER',
        };
        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));
        expect(catalog.find(contract => contract.symbol === 'BTCUSDT_260925')).toMatchObject({
            pair: 'BTCUSDT',
            contractType: 'CURRENT_QUARTER',
            tradable: false,
        });

        source.symbols[0].pair = 'BTCUSDT_260925';
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_INFO_SYMBOL' }));
    });

    it('does not mark a non-trading perpetual contract as tradable', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        source.symbols[0].status = 'PENDING_TRADING';
        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));
        expect(catalog.find(contract => contract.symbol === 'BTCUSDT')).toMatchObject({
            status: 'PENDING_TRADING',
            contractType: 'PERPETUAL',
            tradable: false,
        });
    });

    it('normalizes current metadata and bounded Unicode public symbols without execution authority', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        for (const symbol of source.symbols) {
            symbol.maxMoveOrderLimit = 1_000;
            symbol.filters = symbol.filters.filter(
                filter => filter.filterType !== 'MAX_NUM_ALGO_ORDERS',
            );
            symbol.filters.find(
                filter => filter.filterType === 'PERCENT_PRICE',
            ).multiplierDecimal = '4';
            symbol.filters.push({
                filterType: 'POSITION_RISK_CONTROL',
                positionControlSide: 'NONE',
            });
        }
        source.symbols[0].filters.find(
            filter => filter.filterType === 'MAX_NUM_ORDERS',
        ).limit = 0;
        source.symbols.push({
            ...source.symbols[0],
            symbol: 'BTCUSDT_260626',
            pair: 'BTCUSDT',
            contractType: 'CURRENT_QUARTER DELIVERING',
            status: 'DELIVERING',
        });
        source.symbols.push({
            ...source.symbols[0],
            symbol: '测试测试USDT',
            pair: '测试测试USDT',
            baseAsset: '测试测试',
        });

        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));

        expect(catalog.map(contract => contract.symbol)).toEqual([
            'BTCUSDT',
            'BTCUSDT_260626',
            'ETHUSDT',
            'SOLUSDT',
            '测试测试USDT',
        ]);
        expect(catalog.find(contract => contract.symbol === 'BTCUSDT')).toMatchObject({
            tradable: true,
            filters: { maximumOrders: 0, maximumAlgoOrders: null },
        });
        expect(catalog.find(contract => contract.symbol === 'BTCUSDT_260626')).toMatchObject({
            contractType: 'CURRENT_QUARTER DELIVERING',
            status: 'DELIVERING',
        });
        expect(catalog.find(contract => contract.symbol === '测试测试USDT')).toMatchObject({
            pair: '测试测试USDT',
            baseAsset: '测试测试',
            tradable: false,
        });
    });

    it('rejects Unicode exchange identities outside scalar and UTF-8 byte bounds', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        source.symbols[0] = {
            ...source.symbols[0],
            symbol: `${'测'.repeat(17)}USDT`,
            pair: `${'测'.repeat(17)}USDT`,
            baseAsset: '测'.repeat(17),
        };
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_INFO_SYMBOL' }));

        const fourByteLetter = '\u{20000}';
        source.symbols[0] = {
            ...source.symbols[0],
            symbol: `${fourByteLetter.repeat(16)}USDT`,
            pair: `${fourByteLetter.repeat(16)}USDT`,
            baseAsset: fourByteLetter.repeat(16),
        };
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_INFO_SYMBOL' }));
    });

    it('rejects malformed current filter metadata and the superseded symbol field name', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        const symbol = source.symbols[0];
        symbol.filters = symbol.filters.filter(
            filter => filter.filterType !== 'MAX_NUM_ALGO_ORDERS',
        );
        symbol.filters.push({
            filterType: 'POSITION_RISK_CONTROL',
            positionControlSide: 'NONE',
            unreviewed: true,
        });
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_FILTER' }));

        symbol.filters.at(-1).unreviewed = undefined;
        delete symbol.filters.at(-1).unreviewed;
        symbol.maxMoveOrderLimitPercent = 1_000;
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_INFO_SYMBOL' }));

        delete symbol.maxMoveOrderLimitPercent;
        symbol.maxMoveOrderLimit = '1000';
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'INVALID_INTEGER_IDENTITY' }));
    });

    it.each(['04', '+4', '4.0', '19', ''])(
        'rejects non-canonical current multiplierDecimal %s',
        (multiplierDecimal) => {
            const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
            source.symbols[0].filters.find(
                filter => filter.filterType === 'PERCENT_PRICE',
            ).multiplierDecimal = multiplierDecimal;
            expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
                .toThrowError(expect.objectContaining({ code: 'INVALID_EXCHANGE_FILTER' }));
        },
    );

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

    it('normalizes a dated delivery-contract stream identity exactly', () => {
        const raw = fixtureFor('BTCUSDT').streams.bridgeDepth
            .replace('btcusdt@depth@100ms', 'btcusdt_260925@depth@100ms')
            .replace('"s":"BTCUSDT"', '"s":"BTCUSDT_260925"');
        const event = normalizeFuturesWorkstationStreamFrame(raw, {
            symbol: 'BTCUSDT_260925',
            pair: 'BTCUSDT',
            interval: '1m',
        });
        expect(event).toMatchObject({ kind: 'depth', finalUpdateId: '1001' });
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
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        source.unreviewed = true;
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrow(FuturesWorkstationMarketContractError);
        delete source.unreviewed;
        source.symbols.push(source.symbols[0]);
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
            .toThrowError(expect.objectContaining({ code: 'DUPLICATE_EXCHANGE_SYMBOL' }));
    });

    it('accepts officially disabled price bounds and rejects unreviewed filters', () => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        const price = source.symbols[0].filters.find(filter => filter.filterType === 'PRICE_FILTER');
        price.maxPrice = '0';
        price.tickSize = '0';
        const catalog = normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source));
        expect(catalog[0].filters.price).toMatchObject({ max: '0', tickSize: '0' });

        source.symbols[0].filters.push({ filterType: 'UNREVIEWED_FILTER', value: '1' });
        expect(() => normalizeFuturesWorkstationExchangeInfo(JSON.stringify(source)))
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
        expect(toRendererTradeRows(rows)).toHaveLength(
            FUTURES_WORKSTATION_MARKET_LIMITS.RENDERER_TRADES,
        );
    });

    it('keeps a maximum-width aggregate-trade page within the outbound frame bound', () => {
        const maximumDecimal = '9'.repeat(64);
        const maximumIdentity = 18_446_744_073_709_551_615n;
        const rows = Array.from(
            { length: FUTURES_WORKSTATION_MARKET_LIMITS.RENDERER_TRADES },
            (_, index) => Object.freeze({
                aggregateTradeId: (maximumIdentity - BigInt(index)).toString(),
                price: maximumDecimal,
                quantity: maximumDecimal,
                normalQuantity: maximumDecimal,
                firstTradeId: (maximumIdentity - BigInt(index)).toString(),
                lastTradeId: maximumIdentity.toString(),
                tradeTime: Number.MAX_SAFE_INTEGER - index,
                buyerMaker: index % 2 === 0,
            }),
        );
        const event = createFuturesProductionWorkstationEvent({
            requestId: 'r'.repeat(96),
            symbol: 'S'.repeat(20),
            generation: Number.MAX_SAFE_INTEGER,
            revision: Number.MAX_SAFE_INTEGER,
            resource: 'trades',
            state: 'live',
            observedAt: Number.MAX_SAFE_INTEGER,
            payload: { rows },
        });
        expect(Buffer.byteLength(JSON.stringify(event), 'utf8'))
            .toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
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
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog,
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
                total: 1_024,
                complete: false,
                contracts: Array.from({ length: 8 }, () => maximumContract),
            },
        });
        expect(Buffer.byteLength(JSON.stringify(maximumEvent), 'utf8'))
            .toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
    });
});
