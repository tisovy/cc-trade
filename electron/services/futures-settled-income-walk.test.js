import { describe, expect, it } from 'vitest';
import {
    FUTURES_SETTLED_LANE_WALK,
    FUTURES_SETTLED_WALK,
    emptyFuturesSettledState,
    walkFuturesSettledIncome,
    walkFuturesSettledIncomeLanes,
} from './futures-settled-income-walk.js';
import {
    createFuturesSettledIncomeLane,
    createFuturesSettledIncomeResource,
} from '../../src/utils/futuresSettledIncomeResource.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-08-20T14:00:00.000Z');
const WINDOW_FROM = NOW - 7 * DAY;

// An account whose income record is dense enough that no single request can
// return a day of it — the operator's, which produced over four thousand rows in
// the oldest part of one week. `rows` are laid out one per `spacingMs`, so a
// range's row count is a property of its width and the exchange's page limit
// bites exactly where a real one would.
const createExchange = ({ spacingMs, limit = 1000, from = WINDOW_FROM - DAY }) => {
    const asked = [];
    return {
        asked,
        readPage: async ({ startTime, endTime }) => {
            asked.push({ startTime, endTime });
            const first = Math.max(startTime, from);
            const rows = [];
            for (let time = Math.ceil(first / spacingMs) * spacingMs;
                time <= endTime && rows.length < limit;
                time += spacingMs) {
                rows.push({
                    symbol: 'BTWUSDT',
                    incomeType: 'FUNDING_FEE',
                    income: '-1',
                    asset: 'USDT',
                    time,
                    tranId: String(time),
                });
            }
            return { rows, full: rows.length >= limit };
        },
    };
};

describe('walkFuturesSettledIncome', () => {
    // A page is one read per kind of flow now that the desk asks for the kinds it
    // cannot derive instead of for all of them, and the kinds fill independently:
    // a thousand commission rows covering three days beside nine funding rows
    // covering the whole week. The merged newest row then belongs to the kind
    // that came back short, and a walk stepping to it steps over every row of the
    // kind that filled. So the reader states the point itself and the walk uses
    // it in place of what its own rows say.
    it('advances a full page only as far as the reader says every kind was read', async () => {
        const asked = [];
        const walked = await walkFuturesSettledIncome({
            readPage: async ({ startTime, endTime }) => {
                asked.push({ startTime, endTime });
                if (asked.length > 3) return { rows: [], full: false };
                return {
                    rows: [
                        // The kind that filled, read only as far as here.
                        { symbol: 'BTWUSDT', incomeType: 'COMMISSION', income: '-1', time: startTime + HOUR, tranId: `c${asked.length}` },
                        // The kind that came back short, whose rows reach the
                        // whole range asked for.
                        { symbol: 'BTWUSDT', incomeType: 'FUNDING_FEE', income: '-2', time: endTime - 1, tranId: `f${asked.length}` },
                    ],
                    full: true,
                    newest: startTime + HOUR,
                };
            },
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: { ...emptyFuturesSettledState(), from: NOW - DAY, to: NOW - DAY },
        });

        // The second ask resumes at the stated point, not at the newest row the
        // merged page happened to carry.
        expect(asked[1].startTime).toBe(asked[0].startTime + HOUR);
        expect(walked.rows.size).toBeGreaterThan(0);
    });

    // The defect of 2026-08-20. Reading forward from the window's far edge spends
    // the whole budget on the oldest rows there are, and every figure the
    // operator was looking at sat behind the last page.
    it('reads the newest end of the window, not the oldest', async () => {
        const exchange = createExchange({ spacingMs: 30_000 });
        const walked = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
        });
        const times = [...walked.rows.values()].map(row => row.time);
        expect(times.length).toBeGreaterThan(0);
        // Every row kept is recent, and the newest reaches the present.
        expect(Math.max(...times)).toBeGreaterThan(NOW - HOUR);
        // Nothing from the far end of the window, which is all the old walk had.
        expect(Math.min(...times)).toBeGreaterThan(WINDOW_FROM + DAY);
        // And it says so rather than claiming the window.
        expect(walked.complete).toBe(false);
        expect(walked.from).toBeGreaterThan(WINDOW_FROM);
        expect(walked.to).toBe(NOW);
    });

    // A full page is not a refusal. It is the oldest thousand rows of the chunk
    // asked for, so it covers that chunk's start up to its own newest row and the
    // rest is read forward from there. Quartering the chunk and re-asking it
    // threw those thousand rows away: on the operator's account that spent about
    // a hundred requests on a reading that needed seventeen, and left every
    // figure on screen built from a partial window for six and a half minutes
    // after every start.
    //
    // Ten thousand rows across the week is eleven pages of rows. Anything that
    // discards pages cannot read them in fourteen requests, and the page-count
    // this asserts is the whole difference between the two walks.
    it('reads a dense week in about the number of pages it holds', async () => {
        const exchange = createExchange({ spacingMs: 60 * 1000 });
        const walked = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
            limits: { ...FUTURES_SETTLED_WALK, MAX_REQUESTS: 20 },
        });
        expect(walked.complete).toBe(true);
        expect(exchange.asked.length).toBeLessThanOrEqual(15);
        // Every page it paid for is still held — a week at a row a minute.
        expect(walked.rows.size).toBeGreaterThanOrEqual(10_000);
        // And no range was ever asked for twice.
        const seen = new Set();
        for (const ask of exchange.asked) {
            const key = `${ask.startTime}:${ask.endTime}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        }
    });

    // What is claimed as covered has to be whole. Rows below the claim are held
    // — they are real money and cost real requests — but the claim itself stops
    // at the last instant the walk read end to end.
    it('claims only the span it read end to end', async () => {
        const exchange = createExchange({ spacingMs: 1000 });
        const walked = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
        });
        const covered = [...walked.rows.values()]
            .map(row => row.time)
            .filter(time => time >= walked.from)
            .sort((a, b) => a - b);
        expect(covered.length).toBeGreaterThan(0);
        expect(covered.at(-1)).toBeGreaterThan(NOW - 2 * 1000);
        for (let index = 1; index < covered.length; index += 1) {
            expect(covered[index] - covered[index - 1]).toBeLessThanOrEqual(1000);
        }
    });

    // The account's density is a fact about the account, not about the pass that
    // measured it. Re-deriving it from the starting guess every pass is what made
    // each pass spend most of its budget learning what the last one already knew.
    it('carries what it learned about the account into the next pass', async () => {
        const exchange = createExchange({ spacingMs: 20 * 1000 });
        const first = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
        });
        expect(first.complete).toBe(false);
        expect(first.slice).toBeLessThan(FUTURES_SETTLED_WALK.SLICE_START_MS);
        const spent = exchange.asked.length;
        const later = NOW + 30 * 1000;
        const second = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: later,
            windowFrom: later - 7 * DAY,
            held: first,
        });
        // The second pass resumes at the width the first one measured rather than
        // restarting at the guess, and reaches further back for the same budget.
        const resumed = exchange.asked.slice(spent)
            .filter(ask => ask.endTime <= first.from);
        expect(resumed.length).toBeGreaterThan(0);
        expect(resumed[0].endTime - resumed[0].startTime)
            .toBeLessThan(FUTURES_SETTLED_WALK.SLICE_START_MS);
        expect(second.from).toBeLessThan(first.from);
    });

    // The defect that made the fix pointless. Binance hands `tranId` back as a
    // JSON integer, and one past 2^53 has lost digits before it is parsed, so the
    // adapter refuses it — leaving the row with no identity. Keyed by identity
    // alone, twenty funding charges became `FUNDING_FEE:` twenty times over and a
    // Map kept one. The desk held a single funding row out of twenty and printed
    // an open position's commission as everything it had settled.
    it('holds every row the exchange gave no usable identity to', async () => {
        const charged = [
            ['2026-08-19T20:00:00.000Z', '-32.9282'],
            ['2026-08-20T00:00:00.000Z', '-34.8880'],
            ['2026-08-20T04:00:00.000Z', '-10.8291'],
            ['2026-08-20T08:00:00.000Z', '-11.7660'],
        ].map(([at, income]) => ({
            symbol: 'BEATUSDT',
            incomeType: 'FUNDING_FEE',
            income,
            asset: 'USDT',
            time: Date.parse(at),
            // What the adapter produces for an identity it cannot carry.
            tranId: null,
        }));
        const walked = await walkFuturesSettledIncome({
            now: NOW,
            windowFrom: WINDOW_FROM,
            readPage: async () => ({ rows: charged, full: false }),
        });
        const held = [...walked.rows.values()].filter(row => row.incomeType === 'FUNDING_FEE');
        expect(held).toHaveLength(charged.length);
        const total = held.reduce((sum, row) => sum + Number(row.income), 0);
        expect(total).toBeCloseTo(-90.4113, 4);
        // And the same page read twice still counts each charge once.
        const again = await walkFuturesSettledIncome({
            now: NOW + 1000,
            windowFrom: WINDOW_FROM,
            held: walked,
            readPage: async () => ({ rows: charged, full: false }),
        });
        expect([...again.rows.values()].filter(row => row.incomeType === 'FUNDING_FEE'))
            .toHaveLength(charged.length);
    });

    // The same absent identity on the rows there are thousands of. Funding is
    // charged six times a day and cannot collide with itself; commission is
    // charged on every fill, and an account working one contract fills the same
    // size at the same price more than once in a millisecond all day. Keyed by
    // contract, kind, instant and amount alone, the second charge reads as a
    // repeat of the first — the position's commission is then stated short by
    // however many the account paid, which is money it really paid.
    it('holds two identical charges the exchange made on two different fills', async () => {
        const millisecond = Date.parse('2026-08-20T09:14:22.418Z');
        const charged = [11_884_301, 11_884_302, 11_884_303].map(tradeId => ({
            symbol: 'BEATUSDT',
            incomeType: 'COMMISSION',
            income: '-0.0141',
            asset: 'USDT',
            time: millisecond,
            tranId: null,
            tradeId: String(tradeId),
        }));
        const walked = await walkFuturesSettledIncome({
            now: NOW,
            windowFrom: WINDOW_FROM,
            readPage: async () => ({ rows: charged, full: false }),
        });
        const held = [...walked.rows.values()].filter(row => row.incomeType === 'COMMISSION');
        expect(held).toHaveLength(3);
        expect(held.reduce((sum, row) => sum + Number(row.income), 0)).toBeCloseTo(-0.0423, 4);
        // And the page read again still counts each of the three once.
        const again = await walkFuturesSettledIncome({
            now: NOW + 1000,
            windowFrom: WINDOW_FROM,
            held: walked,
            readPage: async () => ({ rows: charged, full: false }),
        });
        expect([...again.rows.values()].filter(row => row.incomeType === 'COMMISSION'))
            .toHaveLength(3);
    });

    // A quiet account must not be charged a request per hour of a dormant week.
    it('reaches the window start on a quiet account and says it is complete', async () => {
        const exchange = createExchange({ spacingMs: 6 * HOUR });
        const walked = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
        });
        expect(walked.complete).toBe(true);
        expect(walked.from).toBe(WINDOW_FROM);
        expect(walked.requests).toBeLessThanOrEqual(FUTURES_SETTLED_WALK.MAX_REQUESTS);
        // Nothing older than the window survives the pass.
        for (const row of walked.rows.values()) expect(row.time).toBeGreaterThanOrEqual(WINDOW_FROM);
    });

    // Re-reading a held span on every pass is what spends the budget that should
    // be extending coverage. It is why a busy account stayed permanently short of
    // the rows on its own screen.
    it('reads the tail and a run-up behind it, and nothing further back', async () => {
        const exchange = createExchange({ spacingMs: 6 * HOUR });
        const first = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
        });
        const spent = exchange.asked.length;
        const later = NOW + 5 * 60 * 1000;
        const second = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: later,
            windowFrom: later - 7 * DAY,
            held: first,
        });
        // Still one request: the range ends at `now` either way, so starting it
        // behind the edge is the same page.
        expect(exchange.asked.length - spent).toBe(1);
        // Behind the edge by the overlap, not at it. A charge the exchange
        // writes into its record after this walk has passed the charge's own
        // instant is otherwise behind the cursor for good.
        expect(exchange.asked.at(-1).startTime)
            .toBe(NOW - FUTURES_SETTLED_WALK.TAIL_OVERLAP_MS);
        // And no further back than that: the overlap is a run-up, not a re-walk.
        expect(exchange.asked.at(-1).startTime).toBeGreaterThan(first.from);
        expect(second.to).toBe(later);
        // Everything held before is still held, plus whatever the tail added.
        expect(second.rows.size).toBeGreaterThanOrEqual(first.rows.size);
    });

    // The defect this overlap exists for, driven end to end.
    //
    // On the operator's account on 2026-08-20 the funding charge of 20:00:00 was
    // read at 20:00:04 — four seconds after the exchange announced it on two
    // sockets — and the record did not carry it yet. The edge moved to 20:00:04,
    // every later pass started after the charge, and the column stood still
    // through all of them. The money was never coming back without a restart.
    it('finds a row the exchange wrote after the walk had passed its instant', async () => {
        const settledAt = NOW - 30 * 1000;
        let published = false;
        const asked = [];
        const readPage = async ({ startTime, endTime }) => {
            asked.push({ startTime, endTime });
            const rows = published && settledAt >= startTime && settledAt <= endTime
                ? [{
                    symbol: 'BEATUSDT',
                    incomeType: 'FUNDING_FEE',
                    income: '19.09',
                    time: settledAt,
                    tranId: 'late-row',
                }]
                : [];
            return { rows, full: false };
        };
        // The pass the announcement triggers: the charge has happened, the
        // record does not state it yet.
        const first = await walkFuturesSettledIncome({
            readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
        });
        expect(first.rows.size).toBe(0);
        expect(first.to).toBeGreaterThan(settledAt);

        // The record catches up, and the next pass asks again.
        published = true;
        const second = await walkFuturesSettledIncome({
            readPage,
            now: NOW + 2 * 60 * 1000,
            windowFrom: WINDOW_FROM + 2 * 60 * 1000,
            held: first,
        });
        expect([...second.rows.values()].map(row => row.tranId)).toEqual(['late-row']);
    });

    // Rows in hand are money the desk can account for. Dropping them because one
    // slice was refused replaces a partial reading that says so with no reading.
    it('keeps what it has when a slice is refused', async () => {
        let calls = 0;
        const exchange = createExchange({ spacingMs: 6 * HOUR });
        const walked = await walkFuturesSettledIncome({
            now: NOW,
            windowFrom: WINDOW_FROM,
            // A sparse week is two chunks now that the first one is half the
            // window, so the refusal has to land on the second page to be a
            // refusal at all.
            readPage: async (range) => {
                calls += 1;
                return calls > 1 ? null : exchange.readPage(range);
            },
        });
        expect(walked.failed).toBe(true);
        expect(walked.rows.size).toBeGreaterThan(0);
        expect(walked.complete).toBe(false);
        // The coverage it claims is the coverage it reached, not the one it was
        // walking towards.
        expect(walked.from).toBeGreaterThan(WINDOW_FROM);
    });

    // A newer activation owns the account. Nothing read for the old one may be
    // presented against the new one's positions.
    it('stops when the activation it started on is gone', async () => {
        const exchange = createExchange({ spacingMs: 6 * HOUR });
        const walked = await walkFuturesSettledIncome({
            readPage: exchange.readPage,
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: emptyFuturesSettledState(),
            isCurrent: () => false,
        });
        expect(exchange.asked).toHaveLength(0);
        expect(walked.requests).toBe(0);
        expect(walked.rows.size).toBe(0);
    });
});

describe('walkFuturesSettledIncomeLanes', () => {
    it('retains a confirmed lane after refusal but no longer calls it complete', async () => {
        const row = {
            symbol: 'BTCUSDT',
            incomeType: 'FUNDING_FEE',
            income: '-1.25',
            asset: 'USDT',
            time: NOW - HOUR,
            tranId: '700000000000000001',
        };
        const held = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    rows: [row],
                    coveredFrom: WINDOW_FROM,
                    coveredTo: NOW - 1,
                    targetTo: NOW - 1,
                    status: 'ready',
                    attemptedAt: NOW - 1,
                    successfulAt: NOW - 1,
                    complete: true,
                }),
            },
            generation: 7,
        });
        const refusal = Object.assign(new Error('credentials rejected'), {
            code: '-2015',
            response: { status: 400 },
        });

        const walked = await walkFuturesSettledIncomeLanes({
            readPage: async () => { throw refusal; },
            now: NOW,
            windowFrom: WINDOW_FROM,
            held,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
        });

        const lane = walked.resource.lanes.FUNDING_FEE;
        expect(walked).toMatchObject({
            failed: true,
            queued: false,
            attemptsByType: { FUNDING_FEE: 1 },
        });
        expect([...lane.rows.values()]).toEqual([expect.objectContaining({
            tranId: '700000000000000001',
        })]);
        expect(lane).toMatchObject({
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW - 1,
            targetTo: NOW,
            status: 'stale',
            attemptedAt: NOW,
            successfulAt: NOW - 1,
            complete: false,
            pending: null,
            error: { code: '-2015', status: 400 },
        });
        expect(walked.resource.completeByType.FUNDING_FEE).toBe(false);
        expect(walked.resource.complete).toBe(false);
    });

    it.each([
        [
            'transport silence',
            () => ({ answer: null, expectedCode: 'EMPTY_ANSWER', rowReads: () => 0 }),
        ],
        [
            'an answered non-array container',
            () => ({
                answer: { rows: { length: 0 } },
                expectedCode: 'INVALID_INCOME_PAGE',
                rowReads: () => 0,
            }),
        ],
        [
            'an over-requested page',
            () => {
                let reads = 0;
                const unreadableRow = {};
                Object.defineProperty(unreadableRow, 'incomeType', {
                    enumerable: true,
                    get: () => {
                        reads += 1;
                        throw new Error('over-limit rows must not be normalized');
                    },
                });
                return {
                    answer: { rows: [unreadableRow, unreadableRow] },
                    expectedCode: 'OVERSIZED_INCOME_PAGE',
                    rowReads: () => reads,
                };
            },
        ],
    ])('retains confirmed evidence atomically after %s', async (_case, makePage) => {
        const row = {
            symbol: 'BTCUSDT',
            incomeType: 'FUNDING_FEE',
            income: '-1.25',
            asset: 'USDT',
            time: NOW - HOUR,
            tranId: '700000000000000002',
        };
        const held = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    rows: [row],
                    coveredFrom: WINDOW_FROM,
                    coveredTo: NOW - 1,
                    targetTo: NOW - 1,
                    status: 'ready',
                    attemptedAt: NOW - 1,
                    successfulAt: NOW - 1,
                    complete: true,
                }),
            },
            generation: 8,
        });
        const page = makePage();

        const walked = await walkFuturesSettledIncomeLanes({
            readPage: async () => page.answer,
            now: NOW,
            windowFrom: WINDOW_FROM,
            held,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
            limits: { PAGE_LIMIT: 1 },
        });

        const lane = walked.resource.lanes.FUNDING_FEE;
        expect(walked).toMatchObject({
            failed: true,
            queued: false,
            attemptsByType: { FUNDING_FEE: 1 },
        });
        expect([...lane.rows.values()]).toEqual([expect.objectContaining({
            tranId: '700000000000000002',
        })]);
        expect(lane).toMatchObject({
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW - 1,
            targetTo: NOW,
            status: 'stale',
            attemptedAt: NOW,
            successfulAt: NOW - 1,
            complete: false,
            pending: null,
            error: { code: page.expectedCode },
        });
        expect(page.rowReads()).toBe(0);
        expect(walked.resource.completeByType.FUNDING_FEE).toBe(false);
        expect(walked.resource.complete).toBe(false);
    });

    it('keeps independent production defaults when only PAGE_LIMIT is narrowed', async () => {
        const asked = [];
        const walked = await walkFuturesSettledIncomeLanes({
            readPage: async (request) => {
                asked.push(request);
                return request.page === 1
                    ? {
                        rows: [
                            {
                                symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', income: '-1',
                                asset: 'USDT', time: WINDOW_FROM, tranId: '710000000000000001',
                            },
                            {
                                symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', income: '-2',
                                asset: 'USDT', time: WINDOW_FROM + 1, tranId: '710000000000000002',
                            },
                        ],
                    }
                    : { rows: [] };
            },
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
            limits: { PAGE_LIMIT: 2 },
        });

        expect(asked.map(({ page, limit }) => ({ page, limit }))).toEqual([
            { page: 1, limit: 2 },
            { page: 2, limit: 2 },
        ]);
        expect(walked).toMatchObject({
            requests: 2,
            failed: false,
            queued: false,
            attemptsByType: { FUNDING_FEE: 2 },
        });
        expect(walked.resource.lanes.FUNDING_FEE).toMatchObject({
            status: 'ready',
            complete: true,
            pending: null,
        });
    });

    it('clamps every oversized injected lane limit to the production ceiling', async () => {
        const oversizedLimits = {
            PAGE_LIMIT: Number.MAX_SAFE_INTEGER,
            MAX_PAGES_PER_LANE: Number.MAX_SAFE_INTEGER,
            MAX_PAGES_PER_TARGET: Number.MAX_SAFE_INTEGER,
            MAX_ROWS_PER_LANE: Number.MAX_SAFE_INTEGER,
            TAIL_OVERLAP_MS: Number.MAX_SAFE_INTEGER,
        };
        const repeatedRow = {
            symbol: 'BTCUSDT',
            incomeType: 'FUNDING_FEE',
            income: '-1',
            asset: 'USDT',
            time: WINDOW_FROM,
            tranId: '720000000000000001',
        };
        const fullPage = Array(FUTURES_SETTLED_LANE_WALK.PAGE_LIMIT).fill(repeatedRow);

        const passRequests = [];
        const boundedPass = await walkFuturesSettledIncomeLanes({
            readPage: async (request) => {
                passRequests.push(request);
                return { rows: fullPage };
            },
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
            limits: oversizedLimits,
        });
        expect(passRequests).toHaveLength(FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_LANE);
        expect(passRequests.map(request => request.limit)).toEqual(
            Array(FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_LANE)
                .fill(FUTURES_SETTLED_LANE_WALK.PAGE_LIMIT),
        );
        expect(boundedPass).toMatchObject({
            queued: true,
            attemptsByType: {
                FUNDING_FEE: FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_LANE,
            },
        });

        const targetLimit = FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_TARGET;
        const targetHeld = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    targetTo: NOW,
                    nextPage: targetLimit,
                    status: 'loading',
                    attemptedAt: NOW - 1,
                    pending: {
                        targetFrom: WINDOW_FROM,
                        targetTo: NOW,
                        nextPage: targetLimit,
                        rows: [],
                    },
                }),
            },
        });
        const targetRequests = [];
        const boundedTarget = await walkFuturesSettledIncomeLanes({
            readPage: async (request) => {
                targetRequests.push(request);
                return { rows: fullPage };
            },
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: targetHeld,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
            limits: oversizedLimits,
        });
        expect(targetRequests).toEqual([expect.objectContaining({
            page: targetLimit,
            limit: FUTURES_SETTLED_LANE_WALK.PAGE_LIMIT,
        })]);
        expect(boundedTarget.resource.lanes.FUNDING_FEE.error)
            .toMatchObject({ code: 'PAGE_LIMIT_REACHED' });

        const coveredTo = NOW - 1;
        const tailHeld = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    rows: [{ ...repeatedRow, time: coveredTo }],
                    coveredFrom: WINDOW_FROM,
                    coveredTo,
                    targetTo: coveredTo,
                    status: 'ready',
                    attemptedAt: coveredTo,
                    successfulAt: coveredTo,
                    complete: true,
                }),
            },
        });
        const tailRequests = [];
        await walkFuturesSettledIncomeLanes({
            readPage: async (request) => {
                tailRequests.push(request);
                return { rows: [] };
            },
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: tailHeld,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
            limits: oversizedLimits,
        });
        expect(tailRequests[0].startTime).toBe(
            coveredTo - FUTURES_SETTLED_LANE_WALK.TAIL_OVERLAP_MS,
        );

        const saturatedRows = Array.from(
            { length: FUTURES_SETTLED_LANE_WALK.MAX_ROWS_PER_LANE },
            (_, index) => ({
                symbol: 'BTCUSDT',
                incomeType: 'FUNDING_FEE',
                income: '-1',
                asset: 'USDT',
                time: WINDOW_FROM,
                tranId: String(730000000000000000n + BigInt(index)),
            }),
        );
        const rowHeld = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    targetTo: NOW,
                    nextPage: 1,
                    status: 'loading',
                    attemptedAt: NOW - 1,
                    pending: {
                        targetFrom: WINDOW_FROM,
                        targetTo: NOW,
                        nextPage: 1,
                        rows: saturatedRows,
                    },
                }),
            },
        });
        let rowLimitRequests = 0;
        const boundedRows = await walkFuturesSettledIncomeLanes({
            readPage: async () => {
                rowLimitRequests += 1;
                return { rows: [] };
            },
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: rowHeld,
            incomeTypes: ['FUNDING_FEE'],
            refreshIncomeTypes: ['FUNDING_FEE'],
            limits: oversizedLimits,
        });
        expect(rowLimitRequests).toBe(0);
        expect(boundedRows.attemptsByType.FUNDING_FEE).toBe(0);
        expect(boundedRows.resource.lanes.FUNDING_FEE).toMatchObject({
            complete: false,
            pending: null,
            error: { code: 'ROW_LIMIT_REACHED' },
        });
        expect(boundedRows.resource.lanes.FUNDING_FEE.rows.size)
            .toBe(FUTURES_SETTLED_LANE_WALK.MAX_ROWS_PER_LANE);
    });
});
