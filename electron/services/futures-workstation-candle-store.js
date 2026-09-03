/**
 * The local candle store: the machine's own database of closed minutes.
 *
 * `hunter` and `trader` keep every USDⓈ-M contract's closed minutes in
 * Timescale (`binance_usdm_ohlcv_1m`, fed live by the scanner and the bot),
 * and `hunter`'s UI backend serves them on loopback as candles of any chart
 * interval. Measured 2026-09-03: 533 contracts, 526 fresh within fifteen
 * minutes, thirty-five days deep and deepening by a day a day. Every candle
 * the desk drew until then came from the exchange, through the proxy, at
 * exchange weight — a window on every open and switch, a page of a thousand
 * at weight five on every scroll.
 *
 * This is the second network module of the workstation, beside the reviewed
 * transport, and the boundary guard holds it to its shape: `node:http` only,
 * one request, GET, a loopback host, `market=usdm` and `topup=false` on the
 * query — the last because `hunter` otherwise reads Binance itself for a span
 * its database does not cover, up to eight pages of fifteen hundred klines
 * from this machine's IP, outside the desk's limiter.
 *
 * It answers rows in the exact shape the exchange's klines are normalized to,
 * or nothing. A page is served whole or not at all: the renderer reads a short
 * page as the contract's first candle, and that meaning belongs to the
 * exchange's answer alone. A window is served as the whole buckets the store
 * holds without a hole — a young listing, a database younger than the span,
 * a scanner a few minutes behind all shorten it, and never fill a bucket
 * with part of one: the store builds a bucket from the minutes it has, so a
 * bucket the first or last minute falls inside is not the exchange's candle
 * and is left to the exchange.
 */
import http from 'node:http';
import { normalizeFuturesWorkstationKlines } from './futures-workstation-market-contract.js';

export const FUTURES_CANDLE_STORE_DEFAULT_URL = 'http://127.0.0.1:8765';
export const FUTURES_CANDLE_STORE_DEADLINE_MS = 1_500;
// After a failure the store is not asked again for this long; every read
// inside it is recorded as skipped rather than made.
export const FUTURES_CANDLE_STORE_COOLDOWN_MS = 30_000;
// The scanner writes a minute a little after it closes. A window ends at the
// newest bucket that closed at least this long ago, so its last bucket is
// whole in the store; the exchange's window covers the rest.
export const FUTURES_CANDLE_STORE_SETTLE_MS = 3 * 60_000;
// A thousand bars of six floats, with room for the envelope.
export const FUTURES_CANDLE_STORE_BODY_LIMIT_BYTES = 512 * 1024;
export const FUTURES_CANDLE_STORE_MAX_ROWS = 1_000;
export const FUTURES_CANDLE_STORE_INTERVAL_MS = Object.freeze({
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
});
// The epoch was a Thursday. The exchange's weekly candles open on Monday
// 00:00 UTC, and so do the store's weekly buckets; every other interval is
// epoch-aligned. A week floored to the epoch asked the store for a window
// starting on a Thursday, and the store answered it with a bucket built from
// four days — a weekly bar that was nobody's (audit, 2026-09-04).
export const FUTURES_CANDLE_STORE_WEEK_EPOCH_OFFSET_MS = 4 * 86_400_000;
const MINUTE_MS = 60_000;
const STORE_PATH_PREFIX = '/api/candles/';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MODES = new Set(['window', 'page']);

export class FuturesWorkstationCandleStoreError extends Error {
    constructor(code) {
        super(`Futures candle store: ${code}`);
        this.name = 'FuturesWorkstationCandleStoreError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesWorkstationCandleStoreError(code);
};

// The bucket of the interval an instant falls in: its open time.
export const floorFuturesCandleStoreBucket = (time, interval) => {
    const intervalMs = FUTURES_CANDLE_STORE_INTERVAL_MS[interval];
    if (intervalMs === undefined || !Number.isSafeInteger(time)) return null;
    const offset = interval === '1w' ? FUTURES_CANDLE_STORE_WEEK_EPOCH_OFFSET_MS : 0;
    return time - ((((time - offset) % intervalMs) + intervalMs) % intervalMs);
};

export const isFuturesCandleStoreBucketAligned = (time, interval) => (
    floorFuturesCandleStoreBucket(time, interval) === time
);

// The store's address comes from the environment, as the transport's proxy
// does; the compositions stay environment-free. Unset is the default loopback
// backend, empty is off, and anything that is not a plain `http:` origin on a
// loopback host is off with a code the record states once per session.
export const resolveFuturesCandleStoreUrl = (env = process.env) => {
    const raw = env?.FUTURES_CANDLE_STORE_URL;
    const text = raw === undefined ? FUTURES_CANDLE_STORE_DEFAULT_URL : String(raw).trim();
    if (text === '') return Object.freeze({ url: null, errorCode: 'CANDLE_STORE_OFF' });
    let url;
    try {
        url = new URL(text);
    } catch {
        return Object.freeze({ url: null, errorCode: 'INVALID_CANDLE_STORE_URL' });
    }
    if (url.protocol !== 'http:'
        || !LOOPBACK_HOSTS.has(url.hostname)
        || url.username !== ''
        || url.password !== ''
        || url.search !== ''
        || url.hash !== '') {
        return Object.freeze({ url: null, errorCode: 'CANDLE_STORE_NOT_LOOPBACK' });
    }
    return Object.freeze({ url, errorCode: null });
};

// The store answers floats; the exchange answers decimal text. Eight places
// and the trailing zeros trimmed is the exchange's own text for every tick
// size the desk has met, and a row the exchange would refuse — a negative, a
// high under its low — is refused here through the same normalizer.
const decimalOf = (value) => {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number < 0) fail('INVALID_STORE_ANSWER');
    const text = number.toFixed(8).replace(/\.?0+$/, '');
    return text === '' ? '0' : text;
};

const timestampOf = (value) => {
    if (value === null || value === undefined) return null;
    const time = Date.parse(String(value));
    if (!Number.isFinite(time)) fail('INVALID_STORE_ANSWER');
    return time;
};

// Whole minutes from one instant to the next, or null when they are not a
// whole number of minutes apart.
const minutesBetween = (start, end) => {
    const minutes = (end - start) / MINUTE_MS;
    return Number.isSafeInteger(minutes) ? minutes : null;
};

const tupleOf = (bar, intervalMs) => {
    if (!bar || typeof bar !== 'object' || !Number.isSafeInteger(bar.time) || bar.time <= 0) {
        fail('INVALID_STORE_ANSWER');
    }
    const openTime = bar.time * 1_000;
    return [
        openTime,
        decimalOf(bar.open),
        decimalOf(bar.high),
        decimalOf(bar.low),
        decimalOf(bar.close),
        decimalOf(bar.volume),
        openTime + intervalMs - 1,
        '0',
        0,
        '0',
        '0',
        '0',
    ];
};

const emitTiming = (onTiming, { phase, symbol, startedAt, now }, outcome, cache, code) => {
    try {
        onTiming(Object.freeze({
            phase,
            durationMs: Math.max(0, now() - startedAt),
            outcome,
            cache,
            code,
            symbol,
        }));
    } catch {
        // The record must never take the read down with it.
    }
};

const readBody = (response, bodyLimit) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
    };
    response.on('data', (chunk) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > bodyLimit) {
            response.destroy();
            rejectOnce(new FuturesWorkstationCandleStoreError('RESPONSE_BODY_TOO_LARGE'));
            return;
        }
        chunks.push(bytes);
    });
    response.once('aborted', () => rejectOnce(new FuturesWorkstationCandleStoreError('RESPONSE_ABORTED')));
    response.once('error', () => rejectOnce(new FuturesWorkstationCandleStoreError('RESPONSE_ABORTED')));
    response.once('end', () => {
        if (settled) return;
        settled = true;
        try {
            resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)));
        } catch {
            reject(new FuturesWorkstationCandleStoreError('INVALID_STORE_ANSWER'));
        }
    });
});

const loopbackGet = (url, { bodyLimit, signal }) => new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'GET', signal }, (response) => {
        if (response.statusCode !== 200) {
            response.resume();
            reject(new FuturesWorkstationCandleStoreError('HTTP_REJECTED'));
            return;
        }
        const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
        if (!contentType.startsWith('application/json')) {
            response.resume();
            reject(new FuturesWorkstationCandleStoreError('INVALID_CONTENT_TYPE'));
            return;
        }
        readBody(response, bodyLimit).then(resolve, reject);
    });
    request.once('error', (error) => {
        reject(error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
            ? error
            : new FuturesWorkstationCandleStoreError('STORE_UNREACHABLE'));
    });
    request.end();
});

const parseAnswer = (text) => {
    let answer;
    try {
        answer = JSON.parse(text);
    } catch {
        fail('INVALID_STORE_ANSWER');
    }
    if (!answer
        || typeof answer !== 'object'
        || answer.market !== 'usdm'
        || !Array.isArray(answer.bars)
        || answer.bars.length > FUTURES_CANDLE_STORE_MAX_ROWS
        || typeof answer.coverage_complete !== 'boolean'
        || !Number.isSafeInteger(answer.gap_count)
        || answer.gap_count < 0) {
        fail('INVALID_STORE_ANSWER');
    }
    return answer;
};

// A page: every minute of the span, and exactly the buckets asked for.
const servePage = (answer, rows, limit) => (
    answer.coverage_complete && answer.gap_count === 0 && rows.length === limit
        ? rows
        : null
);

// A window: the whole buckets between the first minute the store has of the
// span and the last, provided no minute between those two is missing. The
// store states where its minutes start and end (`actual_from`, `actual_to`,
// the end exclusive) and how many minutes of the span it lacks; the minutes
// it lacks are all outside that range exactly when the range has no hole. A
// bucket that starts before the first minute or ends after the last was built
// from part of itself and is not served.
const serveWindow = (answer, rows, { from, to, intervalMs }) => {
    if (rows.length === 0) return null;
    const actualFrom = timestampOf(answer.actual_from);
    const actualTo = timestampOf(answer.actual_to);
    if (actualFrom === null || actualTo === null) fail('INVALID_STORE_ANSWER');
    const headGap = minutesBetween(from, actualFrom);
    const tailGap = minutesBetween(actualTo, to);
    if (headGap === null || tailGap === null || headGap < 0 || tailGap < 0 || actualTo <= actualFrom) {
        fail('INVALID_STORE_ANSWER');
    }
    if (answer.gap_count !== headGap + tailGap) return null;
    let first = 0;
    while (first < rows.length && rows[first].openTime < actualFrom) first += 1;
    let end = rows.length;
    while (end > first && rows[end - 1].openTime + intervalMs > actualTo) end -= 1;
    if (end <= first) return null;
    return first === 0 && end === rows.length ? rows : Object.freeze(rows.slice(first, end));
};

// The whole store: reading it and remembering when it last failed.
export const createFuturesWorkstationCandleStore = ({
    onTiming = () => {},
    env = process.env,
    deadlineMs = FUTURES_CANDLE_STORE_DEADLINE_MS,
    cooldownMs = FUTURES_CANDLE_STORE_COOLDOWN_MS,
    now = () => Date.now(),
} = {}) => {
    if (typeof onTiming !== 'function') fail('INVALID_TIMING_REPORTER');
    const resolved = resolveFuturesCandleStoreUrl(env);
    let cooldownUntil = 0;
    let lastCode = null;

    const readCandles = async ({ symbol, interval, from, to, limit, mode, signal } = {}) => {
        if (resolved.url === null) return null;
        const intervalMs = FUTURES_CANDLE_STORE_INTERVAL_MS[interval];
        // A span that does not start and end on the interval's buckets would
        // be answered with a partial bucket at either end; it is not asked.
        if (typeof symbol !== 'string' || symbol.trim() === ''
            || intervalMs === undefined
            || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from
            || !isFuturesCandleStoreBucketAligned(from, interval)
            || !isFuturesCandleStoreBucketAligned(to, interval)
            || !Number.isSafeInteger(limit) || limit <= 0 || limit > FUTURES_CANDLE_STORE_MAX_ROWS
            || !MODES.has(mode)) {
            fail('INVALID_STORE_SELECTION');
        }
        const contract = symbol.trim();
        const line = { phase: `candle-store-${mode}`, symbol: contract, startedAt: now(), now };
        if (line.startedAt < cooldownUntil) {
            emitTiming(onTiming, line, 'skipped', null, lastCode);
            return null;
        }
        const url = new URL(`${STORE_PATH_PREFIX}${encodeURIComponent(contract)}`, resolved.url);
        url.search = new URLSearchParams({
            market: 'usdm',
            tf: interval,
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString(),
            limit: String(limit),
            topup: 'false',
        }).toString();
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), deadlineMs);
        const abortFromCaller = () => deadline.abort();
        if (signal?.aborted) abortFromCaller();
        else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
        try {
            const text = await loopbackGet(url, {
                bodyLimit: FUTURES_CANDLE_STORE_BODY_LIMIT_BYTES,
                signal: deadline.signal,
            });
            const answer = parseAnswer(text);
            const rows = normalizeFuturesWorkstationKlines(
                JSON.stringify(answer.bars.map(bar => tupleOf(bar, intervalMs))),
            );
            const served = mode === 'page'
                ? servePage(answer, rows, limit)
                : serveWindow(answer, rows, { from, to, intervalMs });
            if (served === null) {
                lastCode = 'NOT_COVERED';
                emitTiming(onTiming, line, 'ok', 'miss', 'NOT_COVERED');
                return null;
            }
            lastCode = null;
            emitTiming(onTiming, line, 'ok', 'hit', null);
            return served;
        } catch (error) {
            const callerAborted = signal?.aborted === true;
            const timedOut = !callerAborted && deadline.signal.aborted;
            const code = callerAborted
                ? 'REQUEST_ABORTED'
                : timedOut
                    ? 'REQUEST_DEADLINE_EXCEEDED'
                    : typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)
                        ? error.code
                        : 'STORE_UNREACHABLE';
            if (!callerAborted) {
                lastCode = code;
                cooldownUntil = now() + cooldownMs;
            }
            emitTiming(onTiming, line, callerAborted ? 'aborted' : 'error', null, code);
            return null;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', abortFromCaller);
        }
    };

    return Object.freeze({
        enabled: resolved.url !== null,
        errorCode: resolved.errorCode,
        readCandles,
    });
};

// What a window of the selected interval spans right now: it starts where the
// exchange's window will start, so the exchange's rows land as an append, and
// ends at the newest bucket that has had time to settle in the store.
export const futuresCandleStoreWindow = ({ interval, now, rows }) => {
    const intervalMs = FUTURES_CANDLE_STORE_INTERVAL_MS[interval];
    if (intervalMs === undefined || !Number.isSafeInteger(now) || !Number.isSafeInteger(rows) || rows <= 0) {
        return null;
    }
    const currentBucket = floorFuturesCandleStoreBucket(now, interval);
    const from = currentBucket - ((rows - 1) * intervalMs);
    const to = floorFuturesCandleStoreBucket(now - FUTURES_CANDLE_STORE_SETTLE_MS, interval);
    if (from <= 0 || to <= from) return null;
    return Object.freeze({ from, to, limit: rows });
};
