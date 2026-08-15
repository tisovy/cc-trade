import { precisionTruncate } from "./precision";

export function round(number, precision = 0) {
    const d = Math.pow(10, precision);
    return Math.round(number * d) / d;
}

export function filterCoins(symbols, markets, coins_to_exclude) {
    let res = [];

    if (typeof symbols[0] === "string") {
        // Filter symbol list by market
        markets.forEach((market) => {
            symbols
                .filter((symbol) => symbol.endsWith(market))
                .forEach((item) => {
                    if (!res.includes(item)) res.push(item);
                });
        });
        // Remove excluded coins
        symbols = res.filter((e) => {
            return !coins_to_exclude.includes(e);
        });

        return symbols;
    } else {
        res = [];
        markets.forEach((market) => {
            symbols
                .filter((el) => el.symbol.endsWith(market))
                .forEach((item) => {
                    if (!res.includes(item)) res.push(item);
                });
        });

        return res.filter((item) => !coins_to_exclude.includes(item.symbol));
    }
}

export function getMarket(pair) {
    return pair.includes("USDT") ? "USDT" : "BTC";
}

export function getCoin(pair) {
    if (pair.includes("USDT")) {
        return pair.replace("USDT", "");
    } else {
        return pair.replace("BTC", "");
    }
}

function parseBalances(data, requestId) {
    let res = {};
    // filter out airdrop tokens and empty balance
    Object.keys(data).forEach((key) => {
        if (!coinsToFilter.includes(key)) res[key] = data[key];
    });
    return { type: "balances", payload: res, requestId };
}

function parseOrders(data, history, requestId) {
    const parsedOrders = data.map((order) => ({
        ...order,
        origQty: parseFloat(order.origQty) - parseFloat(order.executedQty),
    }));
    return { type: "orders", payload: parsedOrders, extra: history, requestId };
}

function parseDepth(data, requestId) {
    return { type: "depth", payload: data, requestId };
}

function parseFilters(data, requestId) {
    return { type: "filters", payload: data, requestId };
}

const inferMarketFromSymbol = (symbol) => {
    if (!symbol || typeof symbol !== "string") return null;
    if (symbol.endsWith("USDT")) return "USDT";
    if (symbol.endsWith("BTC")) return "BTC";
    return null;
};

const deduceMarketFromTradesPayload = (data, fallback) => {
    let symbol = null;
    if (Array.isArray(data) && data.length) {
        symbol = data[0]?.symbol || data[0]?.s;
    } else if (data && typeof data === "object") {
        symbol = data.symbol || data.s;
    }
    return inferMarketFromSymbol(symbol) || fallback;
};

const getTradeNotionalThreshold = (market) => {
    if (market === "BTC") return 0.01;
    if (market === "USDT") return 10;
    return 1;
};

function parseTrades(data, market, requestId) {
    const resolvedMarket = deduceMarketFromTradesPayload(data, market);
    const minNotionalThreshold = getTradeNotionalThreshold(resolvedMarket);
    if (Array.isArray(data)) {
        data = data.filter((e) =>
            parseFloat(e.price) * parseFloat(e.qty) > minNotionalThreshold
        );
        return { type: "trades", payload: data, requestId };
    } else {
        data.p = parseFloat(data.p);
        data.q = parseFloat(data.q);
        if (data.p * data.q > minNotionalThreshold) {
            return { type: "trades", payload: data, requestId };
        }
        return { type: "nothing", payload: [], requestId };
    }
}

function parseHistory(data, requestId) {
    let time,
        tmpData = {};
    data.forEach((item) => {
        if (!item.time) item.time = Date.now();
        time = parseInt(item.time.toString().slice(0, 10));
        if (!tmpData[time]) {
            tmpData[time] = item;
        } else {
            tmpData[time] = parseHistoryEntry(tmpData[time]);
            item = parseHistoryEntry(item);
            tmpData[time] = {
                ...tmpData[time],
                qty: tmpData[time].qty + item.qty,
                quoteQty: tmpData[time].quoteQty + item.quoteQty,
            };
        }
    });
    return { type: "history", payload: Object.values(tmpData).reverse(), requestId };
}

function parseHistoryEntry(data) {
    return {
        ...data,
        qty: parseFloat(data.qty),
        quoteQty: parseFloat(data.quoteQty),
    };
}

function parseTicker(data, requestId) {
    return { type: "ticker", payload: data, requestId };
}

function parseTickerUpdate(update, index, requestId) {
    return { type: "ticker_update", payload: index, extra: update, requestId };
}

function parseTickerBatch(updates, requestId) {
    return { type: "ticker_batch", payload: Array.isArray(updates) ? updates : [], requestId };
}

function parseBalanceUpdate(data, requestId) {
    data = data["B"];
    let coin, free, locked;
    var res = {};
    for (var i in data) {
        coin = data[i]["a"];
        free = data[i]["f"];
        locked = data[i]["l"];
        res[coin] = {};
        res[coin]["available"] = free;
        res[coin]["onOrder"] = locked;
    }

    return { type: "balance_update", payload: res, requestId };
}

function parseOrderUpdate(data, orders, history, requestId) {
    let sw = data["x"] || data["status"];
    if (!sw && data["orderId"]) sw = "CANCELED";
    switch (sw) {
        case "NEW":
            [orders, history] = fixOrder(data, orders, history, "new");
            break;
        case "CANCELED":
        case "REJECTED":
        case "EXPIRED":
        case "FILLED":
        case "TRADE":
            if (data["X"] === "PARTIALLY_FILLED") {
                [orders, history] = fixOrder(data, orders, history, "fix");
            } else {
                [orders, history] = fixOrder(data, orders, history, "delete");
            }
            break;
        case "REPLACED":
            console.log("called REPLACED state in execution_update");
            break;
        default:
    }

    return { type: "execution_update", payload: orders, extra: history, requestId };
}

function normalizeTimestamp(value) {
    if (value === undefined || value === null) return null;
    const numeric = typeof value === "string" ? parseFloat(value) : value;
    if (!Number.isFinite(numeric)) return null;
    // Assume millisecond precision for large numbers
    if (numeric > 1e12) {
        return Math.floor(numeric / 1000);
    }
    if (numeric > 1e10) {
        return Math.floor(numeric / 1000);
    }
    return Math.floor(numeric);
}

function mapEntryToCandle(timeValue, payload = {}) {
    const time = normalizeTimestamp(timeValue ?? payload.time);
    const open = parseFloat(payload.open);
    const high = parseFloat(payload.high);
    const low = parseFloat(payload.low);
    const close = parseFloat(payload.close);
    const volume = payload.volume !== undefined ? parseFloat(payload.volume) : 0;

    if (!Number.isFinite(time)) return null;
    if ([open, high, low, close].some((val) => Number.isNaN(val))) return null;

    return {
        time,
        open,
        high,
        low,
        close,
        volume: Number.isNaN(volume) ? 0 : volume,
        isFinal: payload.isFinal ?? payload.final ?? false,
    };
}

function normalizeLastTick(lastTick, fallback) {
    if (!lastTick) return fallback;

    if (Array.isArray(lastTick) && lastTick.length) {
        const candidate = lastTick[lastTick.length - 1];
        return mapEntryToCandle(candidate?.time, candidate) || fallback;
    }

    if (lastTick.time !== undefined) {
        return mapEntryToCandle(lastTick.time, lastTick) || fallback;
    }

    const keys = Object.keys(lastTick);
    if (!keys.length) return fallback;
    const key = keys[keys.length - 1];
    return mapEntryToCandle(key, lastTick[key]) || fallback;
}

function parseCharts(data, lastTick, requestId) {
    const res = [];

    if (Array.isArray(data)) {
        data.forEach((entry) => {
            const candle = mapEntryToCandle(entry?.time, entry);
            if (candle) {
                res.push(candle);
            }
        });
    } else {
        for (const timestamp in data) {
            if (!Object.prototype.hasOwnProperty.call(data, timestamp)) continue;
            const candle = mapEntryToCandle(timestamp, data[timestamp]);
            if (candle) {
                res.push(candle);
            }
        }
    }

    res.sort((a, b) => a.time - b.time);

    const normalizedLastTick = normalizeLastTick(lastTick, res[res.length - 1] || null);

    return { type: "chart", payload: res, extra: normalizedLastTick, requestId };
}

const coinsToFilter = ["CBM", "JEX", "USDSB"];

export function parseData(data, orders, history, panel) {
    data = JSON.parse(data);
    const requestId = data.requestId;
    const payloadKey = Object.keys(data).find((key) => key !== "requestId");
    if (!payloadKey) return null;
    const symbol = data.symbol || data.detailSymbol || data?.chart?.symbol;
    const interval = data.interval || data.detailInterval || data?.chart?.interval;
    const meta = { symbol, interval };
    switch (payloadKey) {
        case "chart":
            return { ...parseCharts(data["chart"], data["last_tick"], requestId), meta };
        case "depth":
            return { ...parseDepth(data["depth"], requestId), meta: { symbol: data.depth?.symbol || symbol, interval } };
        case "orders":
            return { ...parseOrders(data["orders"], history, requestId), meta };
        case "balances":
            return parseBalances(data["balances"], requestId);
        case "filters":
            return parseFilters(data["filters"], requestId);
        case "execution_update":
            return { ...parseOrderUpdate(data["execution_update"], orders, history, requestId), meta };
        case "balance_update":
            return parseBalanceUpdate(data["balance_update"], requestId);
        case "trades":
            return { ...parseTrades(data["trades"], panel.market, requestId), meta: { symbol: data.trades?.symbol || symbol, interval } };
        case "history":
            return { ...parseHistory(data["history"], requestId), meta };
        case "ticker":
            return parseTicker(data["ticker"], requestId);
        case "ticker_update":
            return parseTickerUpdate(data["ticker_update"], data["index"], requestId);
        case "ticker_batch":
            return parseTickerBatch(data["ticker_batch"], requestId);
        default:
    }
}
function fixOrder(data, orders, history, type) {
    let historyIds,
        status = data["x"] || data["status"];
    const orderId = data["i"] || data["orderId"];
    let newOrders = [...orders];
    let newHistory = [...history];

    switch (type) {
        case "new":
            if (newOrders.filter((el) => el.orderId === orderId).length === 0) {
                newOrders.push({
                    orderId: orderId,
                    origQty:
                        data["q"] ||
                        parseFloat(data["origQty"]) - parseFloat(data["executedQty"]),
                    price: data["p"] || data["price"],
                    side: data["S"] || data["side"],
                    status: data["X"] || data["status"],
                    stop: data["P"] || data["stopPrice"],
                    symbol: data["s"] || data["symbol"],
                    time: data["T"] || data["transactTime"],
                    timeInForce: data["f"] || data["timeInForce"],
                    type: data["o"] || data["type"],
                    updateTime: data["T"] || 0,
                });
            }
            break;
        case "fix":
            newOrders = newOrders.map(order => {
                if (order.orderId === orderId) {
                    return {
                        ...order,
                        origQty: parseFloat(order.origQty) - parseFloat(data["l"])
                    };
                }
                return order;
            });

            historyIds = newHistory.map((item) => item.orderId);
            if (historyIds.includes(orderId)) {
                newHistory = newHistory.map((item) => {
                    if (item.orderId === orderId) {
                        return { ...item, qty: data["z"] || data["executedQty"] };
                    }
                    return item;
                });
            } else {
                newHistory.unshift(parseHistoryPayload(data, orderId));
            }
            break;
        case "delete":
            newOrders = newOrders.filter((el) => el.orderId !== orderId);
            if (status === "CANCELED") break;

            historyIds = newHistory.map((item) => item.orderId);
            if (historyIds.includes(orderId)) {
                newHistory = newHistory.map((item) => {
                    if (item.orderId === orderId) {
                        return { ...item, qty: data["z"] || data["executedQty"] };
                    }
                    return item;
                });
            } else {
                newHistory.unshift(parseHistoryPayload(data, orderId));
            }

            break;
        default:
    }

    return [newOrders, newHistory];
}

function parseHistoryPayload(data, orderId) {
    let payload, fills;

    payload = {
        orderId: orderId,
        price: data["p"] || data["price"],
        qty: data["z"] || data["executedQty"],
        isBuyer: (data["S"] || data["side"]) === "BUY" ? true : false,
        status: data["X"] || data["status"],
        symbol: data["s"] || data["symbol"],
        time: data["T"] || data["transactTime"],
        timeInForce: data["f"] || data["timeInForce"],
        type: data["o"] || data["type"],
        updateTime: data["T"] || 0,
    };

    if ((data.fills && data.fills.length) || (data["O"] && data["O"].length)) {
        fills = parseHistory(data.fills ? data.fills : data["O"])[1];
        payload.price = fills[0].price;
        payload.qty = fills[0].qty;
    }

    return payload;
}

export function parseBooks(buyBook, sellBook, precision, shown_number) {
    let lastBuyTotal = 0,
        lastSellTotal = 0,
        lastBuyQty = 0,
        lastSellQty = 0;

    function parse(book, side = "buy") {
        let orderIndexes = [];
        let currentTotal = side === "buy" ? lastBuyTotal : lastSellTotal;
        let currentQty = side === "buy" ? lastBuyQty : lastSellQty;

        for (let i = 0; i < shown_number; i++) {
            if (!book[i]) {
                book[i] = [];
                book[i][0] = 0;
                book[i][1] = 0;
                book[i][4] = 0;
                book[i][2] = 0;
                currentTotal += book[i][2];
                book[i][0] = 0;
                book[i][1] = 0;
                book[i][2] = 0;
                book[i][3] = 0;
                book[i][7] = 0;
            } else {
                book[i][0] = parseFloat(book[i][0]);
                book[i][1] = parseFloat(book[i][1]);
                // accumulate orders and indexes
                orderIndexes.push([i, book[i][1]]);

                book[i][4] = book[i][2] ? parseFloat(book[i][2]) : book[i][0];
                book[i][2] = parseFloat(book[i][0]) * parseFloat(book[i][1]);

                currentTotal += book[i][2];
                currentQty += book[i][1];

                book[i][0] = precisionTruncate(book[i][0], precision.price);
                if (precision.price > 0) {
                    book[i][0] = book[i][0].toFixed(precision.price);
                    book[i][4] = book[i][4].toFixed(precision.price);
                }

                // Store raw quantity for cumulative calc before formatting? 
                // actually we already added to currentQty above using parseFloat values.

                book[i][1] = precisionTruncate(book[i][1], precision.quantity);
                if (precision.quantity > 0)
                    book[i][1] = book[i][1].toFixed(precision.quantity);

                book[i][2] = precisionTruncate(book[i][2], precision.notional);
                book[i][3] = precisionTruncate(currentTotal, precision.notional);

                // Store Cumulative Quantity in index 7
                book[i][7] = precisionTruncate(currentQty, precision.quantity);

                if (precision.notional > 0) {
                    book[i][2] = book[i][2].toFixed(precision.notional);
                    book[i][3] = book[i][3].toFixed(precision.notional);
                }
                if (precision.quantity > 0) {
                    book[i][7] = book[i][7].toFixed(precision.quantity);
                }
            }
        }
        // find and slice 4 biggest orders
        orderIndexes = orderIndexes.sort((a, b) => b[1] - a[1]).slice(0, 4);
        // set flag for biggest orders
        orderIndexes.forEach((order) => {
            if (order && book.length) book[order[0]][6] = true;
        });

        return book;
    }

    return [parse(buyBook, "buy"), parse(sellBook, "sell")];
}

export function balanceUpdate(newData, oldData) {
    return { ...oldData, ...newData };
}
