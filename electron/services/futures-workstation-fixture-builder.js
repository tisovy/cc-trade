const FIXTURE_START_TIME = 1_784_000_000_000;

const formatCents = (value) => {
    const cents = BigInt(value);
    const negative = cents < 0n;
    const digits = (negative ? -cents : cents).toString().padStart(3, '0');
    return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

const freezeDeep = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freezeDeep);
    }
    return value;
};

const makeFilters = (tickSize, stepSize, minimumNotional) => ([
    {
        filterType: 'PRICE_FILTER',
        minPrice: tickSize,
        maxPrice: '10000000.00000000',
        tickSize,
    },
    {
        filterType: 'LOT_SIZE',
        minQty: stepSize,
        maxQty: '1000000.00000000',
        stepSize,
    },
    {
        filterType: 'MARKET_LOT_SIZE',
        minQty: stepSize,
        maxQty: '100000.00000000',
        stepSize,
    },
    {
        filterType: 'MIN_NOTIONAL',
        notional: minimumNotional,
    },
    {
        filterType: 'MAX_NUM_ORDERS',
        limit: 200,
    },
    {
        filterType: 'MAX_NUM_ALGO_ORDERS',
        limit: 100,
    },
    {
        filterType: 'PERCENT_PRICE',
        multiplierUp: '1.1500',
        multiplierDown: '0.8500',
        multiplierDecimal: 4,
    },
]);

const makeSymbol = ({ symbol, baseAsset, tickSize, stepSize }) => ({
    symbol,
    pair: symbol,
    contractType: 'PERPETUAL',
    deliveryDate: 4_133_404_800_000,
    onboardDate: 1_569_398_400_000,
    status: 'TRADING',
    baseAsset,
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 2,
    quantityPrecision: stepSize.split('.')[1]?.length ?? 0,
    filters: makeFilters(tickSize, stepSize, '5.00000000'),
    orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC', 'FOK'],
});

const makeKlines = ({ baseCents, intervalMs, count = 96, timeOffset = 0 }) => (
    Array.from({ length: count }, (_, index) => {
        const openTime = FIXTURE_START_TIME + timeOffset - ((count - index) * intervalMs);
        const drift = BigInt((index % 12) - 6) * 7n;
        const open = BigInt(baseCents) + drift;
        const close = open + BigInt((index % 5) - 2) * 3n;
        const high = (open > close ? open : close) + 15n;
        const low = (open < close ? open : close) - 15n;
        return [
            openTime,
            formatCents(open),
            formatCents(high),
            formatCents(low),
            formatCents(close),
            `${100 + index}.12500000`,
            openTime + intervalMs - 1,
            `${100000 + index}.00000000`,
            50 + index,
            `${40 + index}.00000000`,
            `${40000 + index}.00000000`,
            '0',
        ];
    })
);

const makeDepth = (baseCents) => {
    const bids = [];
    const asks = [];
    for (let index = 0; index < 48; index += 1) {
        bids.push([formatCents(BigInt(baseCents) - BigInt(index + 1) * 5n), `${index + 1}.12500000`]);
        asks.push([formatCents(BigInt(baseCents) + BigInt(index + 1) * 5n), `${index + 1}.25000000`]);
    }
    return { bids, asks };
};

const makeRestFixture = ({ symbol, baseCents, timeOffset }) => {
    const eventTime = FIXTURE_START_TIME + timeOffset;
    const depth = makeDepth(baseCents);
    const dailyMove = BigInt(baseCents) / 20n;
    return {
        depthSnapshot: JSON.stringify({
            lastUpdateId: 1000,
            E: eventTime,
            T: eventTime,
            bids: depth.bids,
            asks: depth.asks,
        }),
        contractKlines: JSON.stringify(makeKlines({
            baseCents,
            intervalMs: 60_000,
            timeOffset,
        })),
        markKlines: JSON.stringify(makeKlines({
            baseCents: BigInt(baseCents) - 3n,
            intervalMs: 60_000,
            timeOffset,
        })),
        indexKlines: JSON.stringify(makeKlines({
            baseCents: BigInt(baseCents) - 5n,
            intervalMs: 60_000,
            timeOffset,
        })),
        premiumIndex: JSON.stringify({
            symbol,
            markPrice: formatCents(BigInt(baseCents) - 3n),
            indexPrice: formatCents(BigInt(baseCents) - 5n),
            estimatedSettlePrice: formatCents(BigInt(baseCents) - 4n),
            lastFundingRate: '0.00010000',
            interestRate: '0.00010000',
            nextFundingTime: eventTime + (8 * 60 * 60 * 1000),
            time: eventTime,
        }),
        ticker: JSON.stringify({
            symbol,
            priceChange: '421.25000000',
            priceChangePercent: '0.72500000',
            weightedAvgPrice: formatCents(BigInt(baseCents) - 1000n),
            lastPrice: formatCents(baseCents),
            lastQty: '0.12500000',
            openPrice: formatCents(BigInt(baseCents) - dailyMove),
            highPrice: formatCents(BigInt(baseCents) + (dailyMove * 2n)),
            lowPrice: formatCents(BigInt(baseCents) - (dailyMove * 2n)),
            volume: '125000.50000000',
            quoteVolume: '7280450000.12500000',
            openTime: eventTime - (24 * 60 * 60 * 1000),
            closeTime: eventTime,
            firstId: 9_007_199_254_700_001,
            lastId: 9_007_199_254_700_099,
            count: 99,
        }),
    };
};

const combined = (stream, data) => JSON.stringify({ stream, data });

const makeStreamFrames = ({ symbol, baseCents, timeOffset }) => {
    const lower = symbol.toLowerCase();
    const eventTime = FIXTURE_START_TIME + timeOffset + 100;
    return {
        bridgeDepth: combined(`${lower}@depth@100ms`, {
            e: 'depthUpdate',
            E: eventTime,
            T: eventTime,
            s: symbol,
            U: 1000,
            u: 1001,
            pu: 999,
            b: [[formatCents(BigInt(baseCents) - 5n), '2.00000000']],
            a: [[formatCents(BigInt(baseCents) + 5n), '3.00000000']],
            ps: symbol,
            st: 1,
        }),
        makeCycle: (cycle, interval = '1m') => {
            const cycleTime = eventTime + (cycle * 750);
            const updateId = 1001 + cycle;
            const nextUpdateId = updateId + 1;
            const drift = BigInt(cycle % 20) * 2n;
            const price = BigInt(baseCents) + drift;
            const dailyMove = BigInt(baseCents) / 20n;
            return Object.freeze([
                combined(`${lower}@depth@100ms`, {
                    e: 'depthUpdate',
                    E: cycleTime,
                    T: cycleTime,
                    s: symbol,
                    U: nextUpdateId,
                    u: nextUpdateId,
                    pu: updateId,
                    b: [[formatCents(price - 5n), `${2 + (cycle % 7)}.00000000`]],
                    a: [[formatCents(price + 5n), `${3 + (cycle % 5)}.00000000`]],
                    ps: symbol,
                    st: 1,
                }),
                combined(`${lower}@aggTrade`, {
                    e: 'aggTrade',
                    E: cycleTime,
                    s: symbol,
                    a: 9_007_199_254_700_100 + cycle,
                    p: formatCents(price),
                    q: '0.25000000',
                    nq: '0.25000000',
                    f: 9_007_199_254_700_200 + cycle,
                    l: 9_007_199_254_700_200 + cycle,
                    T: cycleTime,
                    m: cycle % 2 === 0,
                    st: 1,
                }),
                combined(`${lower}@kline_${interval}`, {
                    e: 'kline',
                    E: cycleTime,
                    s: symbol,
                    k: {
                        t: FIXTURE_START_TIME + timeOffset,
                        T: FIXTURE_START_TIME + timeOffset + 59_999,
                        s: symbol,
                        i: interval,
                        f: 9_007_199_254_700_300,
                        L: 9_007_199_254_700_300 + cycle,
                        o: formatCents(baseCents),
                        c: formatCents(price),
                        h: formatCents(price + 25n),
                        l: formatCents(BigInt(baseCents) - 25n),
                        v: `${100 + cycle}.50000000`,
                        n: 10 + cycle,
                        x: false,
                        q: '5842000.00000000',
                        V: '50.00000000',
                        Q: '2921000.00000000',
                        B: '0',
                    },
                }),
                combined(`${lower}@markPrice@1s`, {
                    e: 'markPriceUpdate',
                    E: cycleTime,
                    s: symbol,
                    p: formatCents(price - 3n),
                    i: formatCents(price - 5n),
                    P: formatCents(price - 4n),
                    r: '0.00010000',
                    ap: '0.00000000',
                    T: FIXTURE_START_TIME + timeOffset + (8 * 60 * 60 * 1000),
                    st: 1,
                }),
                combined(`${lower}@ticker`, {
                    e: '24hrTicker',
                    E: cycleTime,
                    s: symbol,
                    p: '421.25000000',
                    P: '0.72500000',
                    w: formatCents(price - 1000n),
                    c: formatCents(price),
                    Q: '0.25000000',
                    o: formatCents(price - dailyMove),
                    h: formatCents(price + (dailyMove * 2n)),
                    l: formatCents(price - (dailyMove * 2n)),
                    v: '125001.00000000',
                    q: '7280500000.00000000',
                    O: cycleTime - (24 * 60 * 60 * 1000),
                    C: cycleTime,
                    F: 9_007_199_254_700_001,
                    L: 9_007_199_254_700_099 + cycle,
                    n: 100 + cycle,
                    ps: symbol,
                    st: 1,
                }),
            ]);
        },
    };
};

export const createFuturesWorkstationFixture = ({ timeOffset = 0, priceOffsetCents = 0n }) => {
    const specifications = Object.freeze([
        Object.freeze({
            symbol: 'BTCUSDT',
            baseAsset: 'BTC',
            tickSize: '0.10',
            stepSize: '0.001',
            baseCents: 5_842_000n + BigInt(priceOffsetCents),
        }),
        Object.freeze({
            symbol: 'ETHUSDT',
            baseAsset: 'ETH',
            tickSize: '0.01',
            stepSize: '0.001',
            baseCents: 316_000n + BigInt(priceOffsetCents),
        }),
        Object.freeze({
            symbol: 'SOLUSDT',
            baseAsset: 'SOL',
            tickSize: '0.001',
            stepSize: '0.1',
            baseCents: 17_200n + BigInt(priceOffsetCents),
        }),
    ]);
    const catalog = JSON.stringify({
        timezone: 'UTC',
        serverTime: FIXTURE_START_TIME + timeOffset,
        futuresType: 'U_MARGINED',
        rateLimits: [],
        exchangeFilters: [],
        assets: [],
        symbols: specifications.map(makeSymbol),
    });
    const symbols = Object.fromEntries(specifications.map(specification => [
        specification.symbol,
        freezeDeep({
            ...makeRestFixture({ ...specification, timeOffset }),
            streams: makeStreamFrames({ ...specification, timeOffset }),
        }),
    ]));
    return freezeDeep({
        catalog,
        symbols,
        now: FIXTURE_START_TIME + timeOffset + 1_000,
    });
};
