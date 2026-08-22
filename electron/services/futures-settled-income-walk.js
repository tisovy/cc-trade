import {
    DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
    FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
    MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE,
    canonicalFuturesIncomeRow,
    canonicalFuturesIncomeRowIdentity,
    cloneFuturesSettledIncomeLane,
    createFuturesSettledIncomeLane,
    createFuturesSettledIncomeResource,
    finalizeFuturesSettledIncomeResource,
    sanitizeFuturesSettledIncomeError,
} from '../../src/utils/futuresSettledIncomeResource.js';

// How the desk reads what its positions have already settled.
//
// `/fapi/v1/income` is ordered oldest-first and its `page` parameter indexes
// that order. A bounded walk forward from the window's far edge therefore
// returns the oldest rows there are — which, on 2026-08-20, was four thousand
// rows of a single day on an account whose operator was looking at the two days
// after it. The read fired, the exchange answered, the frame reached the screen,
// and the column was empty anyway. Nothing on the path was broken except its
// direction.
//
// So this walks the other way: the tail since the last pass first, then
// backwards towards the window's start with whatever budget is left. Two
// properties hold it together.
//
// **What is claimed as covered is always contiguous, ending at a known
// instant.** A full page is the oldest thousand rows of the range asked for and
// says nothing about the rest of it, so the range is not claimed until the part
// behind that page has been read too.
//
// **Coverage is stated, never implied.** The walk answers the oldest instant it
// actually reached. Everything downstream decides completeness against that, so
// a reading that covered a day of a week can no longer report the figures built
// from it as whole.
//
// Extracted from the connection rather than left inside it because the defect
// was in the walk and a walk inside a websocket service is not something a test
// can drive. It takes a `readPage` and returns state; that is the whole of its
// contact with the exchange.

// Binance states `tranId` is unique only within one income type, so neither
// field identifies a row on its own.
//
// And the exchange does not always give one this desk can use. `tranId` arrives
// as a JSON integer, and one past 2^53 has already lost digits by the time it is
// parsed, so the adapter refuses it rather than page from a rounded identity —
// which leaves the row with no identity at all. Every such row then keyed to
// `FUNDING_FEE:`, and a Map keeps one value per key: on 2026-08-20 the desk held
// **one** funding charge out of the twenty an open position had been charged,
// and the column beside it printed that position's commission exactly and its
// funding not at all.
//
// So a row the exchange named is keyed by that name, and a row it did not is
// keyed by what it is: the fill it was charged on, and failing that the
// contract, kind, instant and amount.
//
// The fill is in that key because without it the fallback collides on ordinary
// data. Every fill is charged commission, an account working one contract fills
// many times a second, and two fills of the same size at the same price in the
// same millisecond pay the same fee to the tenth decimal — one row of the two
// then survives, and the position's commission is stated short by the other.
// That is the same defect as the funding one above wearing different clothes:
// there it took a `tranId` past 2^53 to trigger, here it takes only a busy
// second. `tradeId` is per contract and small enough to survive JSON, so a row
// the exchange attached to a fill is distinguishable by it; funding and
// insurance clearance are attached to no fill and need no more than the four
// fields, since a contract is charged funding once per settlement.
export const futuresIncomeRowKey = (row) => {
    const identity = canonicalFuturesIncomeRowIdentity(row);
    if (identity !== null) return identity;
    // Compatibility only for malformed legacy rows already in memory. New
    // lane reads reject such rows instead of letting them enter the resource.
    return `legacy:${row?.incomeType ?? ''}:${row?.symbol ?? ''}:${row?.time ?? ''}`
        + `:${row?.income ?? ''}:${row?.tradeId ?? ''}`;
};

export const FUTURES_SETTLED_WALK = Object.freeze({
    // A page is one read per kind of flow the caller asks for — six, since the
    // desk stopped asking for the whole record — so four pages is up to
    // twenty-four requests at weight 30. Only ever spent in full while coverage
    // is still being extended, and on the shape this now reads it is never spent
    // at all: forty-five funding rows in a week fit one page, so the first one
    // covers the window and the walk is done.
    MAX_REQUESTS: 4,
    // A floor, not a starting width. The walk starts at half the window — see
    // below — and this is only what a caller with no window to speak of gets.
    SLICE_START_MS: 24 * 60 * 60 * 1000,
    SLICE_MIN_MS: 60 * 1000,
    // The whole of the desk's window. Narrower was right when a day of this
    // account's income was four thousand rows and a page held a thousand; asking
    // for one kind of flow changed the density by two orders of magnitude, and a
    // ceiling below the window then costs a page per chunk to cover a week that
    // one page answers. What the account demonstrates still overrides it in
    // either direction.
    SLICE_MAX_MS: 7 * 24 * 60 * 60 * 1000,
    // A ceiling on what is held, so an account that trades all week cannot grow
    // this without bound. Reached before the window's start is, it stops the
    // backward walk — and because coverage is stated rather than implied, the
    // figures built from it say what they reach.
    MAX_ROWS: MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE,
    // How far behind the last pass's edge the next one starts reading.
    //
    // The exchange announces a funding charge on two sockets at the instant it
    // makes it, and writes the row into `/fapi/v1/income` some time after that.
    // A pass triggered by the announcement therefore reads a record that does
    // not have it yet — and, worse, moves its own edge past the charge's
    // instant, so every later pass starts after the row and the charge is
    // missed for good. Measured on the operator's account 2026-08-20: the
    // 20:00:00 settlement was read at 20:00:04 with no row for it, the edge
    // moved to 20:00:04, and the column stood still through every pass after.
    //
    // Re-reading the tail end costs nothing — the range still ends at `now`, so
    // it is the same page — and the row key absorbs everything already held. It
    // is the difference between a reading that heals itself and one that needs
    // the desk restarted.
    TAIL_OVERLAP_MS: 30 * 60 * 1000,
});

export const emptyFuturesSettledState = () => Object.freeze({
    rows: new Map(),
    from: null,
    to: null,
    // What the account taught the last pass about how wide a slice it can answer
    // in one page, and the chunk that pass was part-way through. Both are carried
    // so that a pass resumes the walk rather than restarting it.
    slice: null,
    gap: null,
});

const newestTimeIn = (answered, floor) => (answered.rows ?? []).reduce(
    (latest, row) => (Number.isFinite(row?.time) && row.time > latest ? row.time : latest),
    floor,
);

// How far a full page lets the cursor move.
//
// With one kind of flow asked for, that is the newest row the page returned: the
// page is the oldest thousand rows of the range, so everything up to its newest
// row is now held.
//
// With several, it is not. A page here is the merge of one read per kind, and
// they fill independently — a thousand commission rows covering three days
// beside nine funding rows covering the whole week. The merged newest row then
// belongs to the kind that came back *short*, and advancing to it steps over
// every commission row between the two. So a reader that merges kinds states
// the point itself, as the oldest newest-row among the kinds that filled, and
// this only falls back to the merged rows when it does not.
const pageNewest = (answered, floor) => (Number.isFinite(answered?.newest)
    ? answered.newest
    : newestTimeIn(answered, floor));

/**
 * Extends a held reading of the income record towards now and towards the
 * window's start.
 *
 * `readPage` is given `{startTime, endTime}` and answers `{rows, full}` — and
 * optionally `newest`, the instant a full page lets the walk advance to, which a
 * reader merging several kinds of flow into one page has to state because the
 * merged rows no longer say it.
 *
 * Or `null` when the read was refused or overtaken — the difference between
 * "there is nothing there" and "nobody asked" is the difference between a
 * position that settled nothing and one whose charges were never read.
 *
 * Answers the new state plus what the pass cost and how it ended. The held rows
 * are never discarded on a failure: rows in hand are money the desk can account
 * for, and dropping them because one slice timed out replaces a partial reading
 * that says so with no reading at all.
 */
export const walkFuturesSettledIncome = async ({
    readPage,
    now,
    windowFrom,
    held = emptyFuturesSettledState(),
    keepRow = () => true,
    isCurrent = () => true,
    limits = FUTURES_SETTLED_WALK,
}) => {
    const rows = new Map(held.rows);
    let from = held.from;
    let to = held.to;
    // Where a walk with nothing learned yet starts: half the window.
    //
    // The right width is a property of the account and of what is being asked
    // for, not of the desk, and one page is enough to measure it — so what the
    // account answers replaces this immediately, and is carried between passes.
    // Re-deriving it from a constant every pass is how a read that needed
    // seventeen requests took a hundred.
    //
    // Half, rather than a day or the whole thing, because the two failures are
    // not symmetrical. Too narrow costs a page per chunk to cover a week that one
    // page answers — which is what a day-wide start cost once the read was
    // narrowed to one kind of flow and the density fell by two orders of
    // magnitude. Too wide costs the *recency* of a partial reading: a full page
    // is the oldest rows of the range asked for, so a chunk spanning the whole
    // window hands back the far end of it first, which is the defect this walk
    // was written to fix. Half covers a sparse window in two pages and still
    // starts a dense one near the present.
    let slice = Number.isFinite(held.slice) && held.slice > 0
        ? held.slice
        : Math.min(
            limits.SLICE_MAX_MS,
            Math.max(limits.SLICE_MIN_MS, Number.isFinite(windowFrom) && now > windowFrom
                ? Math.floor((now - windowFrom) / 2)
                : limits.SLICE_START_MS),
        );
    // A backward chunk this walk committed to and has not finished reading.
    // Carried between passes: abandoning it would re-ask the pages already paid
    // for, which is the whole of what made the read slow.
    let gap = held.gap ?? null;
    let requests = 0;
    let failed = false;

    const ask = async (startTime, endTime) => {
        if (!isCurrent()) return null;
        const answered = await readPage({ startTime, endTime });
        if (answered === null || answered === undefined) {
            failed = true;
            return null;
        }
        requests += 1;
        return answered;
    };
    const keep = (answered) => {
        for (const row of answered.rows ?? []) {
            if (!keepRow(row)) continue;
            rows.set(futuresIncomeRowKey(row), row);
        }
    };

    // The tail first: everything since the last pass covered. This is the whole
    // cost of a pass once the window is covered, and it is what makes spending
    // the budget below on coverage affordable.
    //
    // Forward is the cheap direction — a full page is the oldest rows of the
    // range, so continuing from the last one leaves no gap. The edge instant is
    // re-asked rather than stepped past: a row sharing that millisecond would
    // otherwise be skipped, and the key above absorbs the repeat.
    if (to !== null) {
        const covered = to;
        // Behind the edge, not at it. A row the exchange wrote after this walk
        // last passed its instant is otherwise behind the cursor for good.
        let cursor = Math.max(
            windowFrom,
            Number.isFinite(from) ? Math.min(from, covered) : covered,
            covered - limits.TAIL_OVERLAP_MS,
        );
        while (requests < limits.MAX_REQUESTS && cursor < now) {
            const answered = await ask(cursor, now);
            if (answered === null) break;
            keep(answered);
            if (!answered.full) {
                cursor = now;
                break;
            }
            const newest = pageNewest(answered, cursor);
            // A full page whose rows all share the cursor instant cannot be
            // advanced past without losing them. Stop rather than spin.
            if (newest <= cursor) break;
            cursor = newest;
        }
        // Never backwards: the overlap re-reads what was already covered, it
        // does not un-cover it.
        to = Math.max(covered, cursor);
    } else if (isCurrent()) {
        // Nothing held at all. The newest instant is now, and the walk below
        // works backwards from it.
        to = now;
        from = now;
    }

    // Backwards, one chunk at a time.
    //
    // A full page used to be treated as a refusal: the slice was quartered and
    // re-asked from scratch, and the thousand rows it had just paid for were
    // thrown away. On the operator's account that spent about a hundred requests
    // on a reading that needed fourteen, and left every figure on the screen
    // built from a partial window for six and a half minutes after every start.
    //
    // A full page is not a refusal. It is the *oldest* thousand rows of the
    // chunk, so it covers the chunk's start up to its own newest row, and what
    // is still unread is the part above that. Reading it forward closes the
    // chunk from below, keeps every row, and cannot loop: each page either ends
    // the chunk or moves the cursor past its own newest row. Nothing is asked
    // twice, and the chunk is claimed as covered only once its last page comes
    // back short.
    while (requests < limits.MAX_REQUESTS
        && from !== null
        && from > windowFrom
        && rows.size < limits.MAX_ROWS) {
        if (gap === null) {
            const target = Math.max(windowFrom, from - slice);
            gap = { target, cursor: target, spent: 0 };
        }
        const answered = await ask(gap.cursor, from);
        if (answered === null) break;
        keep(answered);
        gap.spent += 1;
        if (!answered.full) {
            // The chunk is read end to end: everything from its target up to the
            // coverage it was walking down from is now held.
            from = gap.target;
            // What the account just said about its own density. A chunk that took
            // one page can afford to be wider; one that took several was too wide
            // by about that factor.
            slice = gap.spent <= 1
                ? Math.min(limits.SLICE_MAX_MS, slice * 2)
                : Math.max(limits.SLICE_MIN_MS, Math.floor(slice / gap.spent));
            gap = null;
            continue;
        }
        const newest = pageNewest(answered, gap.cursor);
        // More than a page of rows sharing one millisecond across the whole
        // account is not something the exchange produces; stepping past it is
        // still better than asking the same page until the budget is gone.
        if (newest <= gap.cursor) {
            gap.cursor += 1;
            continue;
        }
        // How wide a range this account actually answers in one page, measured
        // right here rather than assumed. A chunk only claims coverage once its
        // last page comes back short, so a chunk far too wide for the account
        // reports nothing at all while it is being filled — on an account
        // trading once a second, a day-long chunk is eighty-six pages and many
        // passes of silence. Measured once, it is one page of silence.
        const answeredSpan = Math.max(1, newest - gap.cursor);
        slice = Math.max(limits.SLICE_MIN_MS, Math.min(limits.SLICE_MAX_MS, answeredSpan));
        if (from - gap.target > limits.MAX_REQUESTS * answeredSpan) {
            // Far too wide to finish. The rows it returned are kept — they were
            // paid for and they are real — but the chunk itself is abandoned for
            // one sized to what the account just demonstrated.
            gap = null;
            continue;
        }
        gap.cursor = newest;
    }

    // Anything older than the window is no longer the desk's to state, and
    // holding it would let the ceiling above be reached by rows nothing asks for.
    for (const [key, row] of rows) {
        if (Number.isFinite(row?.time) && row.time < windowFrom) rows.delete(key);
    }
    if (from !== null && from < windowFrom) from = windowFrom;
    // A window that has been reached has no chunk left to finish. The window
    // slides forward with `now`, so a chunk held past that point would be re-read
    // against a boundary it no longer touches.
    if (from !== null && from <= windowFrom) gap = null;

    return {
        rows,
        from,
        to,
        slice,
        gap,
        requests,
        failed,
        // Whether the reading reaches the window's start. Not whether the walk
        // ran out of budget: a pass that spent nothing because everything was
        // already held is complete, and one that spent every page it had and is
        // still three days short is not.
        complete: from !== null && from <= windowFrom,
    };
};

// Lossless lane walker used by the v2 resource integration. The legacy walker
// above remains exported while its current callers migrate.
export const FUTURES_SETTLED_LANE_WALK = Object.freeze({
    PAGE_LIMIT: 1000,
    MAX_PAGES_PER_LANE: 4,
    // A per-pass budget only delays a checkpoint. Bound the total explicit page
    // numbers one frozen target may consume as well, otherwise an endpoint that
    // repeats a full duplicate page can keep that checkpoint alive forever. At
    // the production page size, 24 unique full pages already reach MAX_ROWS; one
    // extra page permits a short terminal proof when page boundaries duplicated
    // some identities without opening an unbounded continuation.
    MAX_PAGES_PER_TARGET: 25,
    // A page cap bounds one admission turn, not the checkpoint carried into the
    // next turn. Keep the same audited ceiling as the legacy walker, per lane,
    // so a dense filtered type cannot grow the persisted resource indefinitely.
    MAX_ROWS_PER_LANE: FUTURES_SETTLED_WALK.MAX_ROWS,
    TAIL_OVERLAP_MS: FUTURES_SETTLED_WALK.TAIL_OVERLAP_MS,
});

export const futuresSettledLaneNeedsAutomaticCooldown = (lane) => {
    if (lane?.error?.code === 'ROW_LIMIT_REACHED'
        || lane?.error?.code === 'PAGE_LIMIT_REACHED') return true;
    const status = Number(lane?.error?.status);
    return status >= 400 && status <= 499
        && status !== 408
        && status !== 418
        && status !== 429;
};

const laneHasConfirmedReading = lane => (
    lane.successfulAt !== null
    || lane.coveredFrom !== null
    || lane.rows.size > 0
);

const incomePageError = (code, message) => Object.assign(new Error(message), { code });

const narrowedPositiveLimit = (value, maximum) => (
    Number.isSafeInteger(value) && value > 0
        ? Math.min(value, maximum)
        : maximum
);

const narrowedNonNegativeLimit = (value, maximum) => (
    Number.isSafeInteger(value) && value >= 0
        ? Math.min(value, maximum)
        : maximum
);

const sameCanonicalIncomeRow = (left, right) => (
    left?.identity === right?.identity
    && left?.incomeType === right?.incomeType
    && left?.symbol === right?.symbol
    && left?.income === right?.income
    && left?.asset === right?.asset
    && left?.time === right?.time
    && left?.tranId === right?.tranId
    && left?.tradeId === right?.tradeId
);

const failedLane = (lane, { attemptedAt, targetTo, error }) => createFuturesSettledIncomeLane(
    lane.incomeType,
    {
        ...lane,
        targetTo,
        nextPage: 1,
        status: laneHasConfirmedReading(lane) ? 'stale' : 'error',
        // Retain the last confirmed rows/bounds, but do not publish the failed
        // lane as complete. Consumers already fail closed on status; keeping
        // `complete:true` beside `stale/error` made the serialized resource
        // contradict itself and invited future callers to trust the wrong bit.
        complete: false,
        attemptedAt,
        error: sanitizeFuturesSettledIncomeError(error),
        // A failed enumeration is not a checkpoint. Starting its frozen window
        // at page one again is what prevents a changing page boundary from
        // turning an uncommitted prefix into a permanent hole.
        pending: null,
    },
);

const rowLimitedLane = (lane, {
    candidateRows,
    targetTo,
    windowFrom,
    attemptedAt,
    maxRows,
}) => {
    const byIdentity = new Map(lane.rows);
    for (const [identity, row] of candidateRows) byIdentity.set(identity, row);
    const rows = new Map([...byIdentity.values()]
        .filter(row => row.time >= windowFrom && row.time <= targetTo)
        .sort((left, right) => (
            right.time - left.time || left.identity.localeCompare(right.identity)
        ))
        .slice(0, maxRows)
        .map(row => [row.identity, row]));
    return createFuturesSettledIncomeLane(lane.incomeType, {
        ...lane,
        rows,
        // The retained rows are real evidence, but the enumerated window was not
        // completed and may have lost rows at either edge. No old coverage claim
        // can describe the now-bounded union truthfully.
        coveredFrom: null,
        coveredTo: null,
        targetTo,
        nextPage: 1,
        status: laneHasConfirmedReading(lane) ? 'stale' : 'error',
        complete: false,
        attemptedAt,
        error: {
            code: 'ROW_LIMIT_REACHED',
            message: `Income history lane exceeded its ${maxRows}-row retention limit`,
        },
        // An over-limit frozen target is terminal local state. Retaining a page
        // checkpoint here would schedule the same unbounded continuation again.
        pending: null,
    });
};

const commitLaneWindow = (lane, {
    rows: answeredRows,
    targetFrom,
    targetTo,
    requiredTo,
    windowFrom,
    overlapMs,
    attemptedAt,
}) => {
    const hasCoverage = lane.coveredFrom !== null && lane.coveredTo !== null;
    const touchesCoverage = hasCoverage
        && targetFrom <= lane.coveredTo + 1
        && targetTo >= lane.coveredFrom - 1;
    const rows = touchesCoverage ? new Map(lane.rows) : new Map();

    // Within the enumerated window the exchange has spoken both by rows and by
    // silence. Remove the old answer there before committing the new one.
    for (const [identity, row] of rows) {
        if (row.time >= targetFrom && row.time <= targetTo) rows.delete(identity);
    }
    for (const [identity, row] of answeredRows) rows.set(identity, row);
    for (const [identity, row] of rows) {
        if (row.time < windowFrom || row.time > targetTo) rows.delete(identity);
    }

    const coveredFrom = touchesCoverage
        ? Math.min(lane.coveredFrom, targetFrom)
        : targetFrom;
    const coveredTo = touchesCoverage
        ? Math.max(lane.coveredTo, targetTo)
        : targetTo;
    return createFuturesSettledIncomeLane(lane.incomeType, {
        ...lane,
        rows,
        coveredFrom,
        coveredTo,
        targetTo: requiredTo,
        nextPage: 1,
        status: coveredTo >= requiredTo ? 'ready' : 'loading',
        attemptedAt,
        successfulAt: attemptedAt,
        complete: coveredFrom <= windowFrom && coveredTo >= requiredTo,
        error: null,
        pending: coveredTo >= requiredTo ? null : {
            targetFrom: Math.max(windowFrom, coveredTo - overlapMs),
            targetTo: requiredTo,
            nextPage: 1,
            rows: new Map(),
        },
    });
};

/**
 * Enumerates one frozen inclusive `[startTime, endTime]` window per income
 * type. `page` is explicit and starts at one. No cursor is derived from row
 * timestamps and no ordering of a response is assumed.
 *
 * A lane becomes confirmed only after its terminal page. Hitting the local page
 * budget records an uncommitted checkpoint under `lane.pending`; a refusal
 * discards that checkpoint and leaves the last confirmed rows and coverage
 * untouched. Other lanes can still succeed and commit in the same pass.
 */
export const walkFuturesSettledIncomeLanes = async ({
    readPage,
    now,
    windowFrom,
    held = null,
    incomeTypes = DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
    refreshIncomeTypes = incomeTypes,
    // A periodic verification re-enumerates the whole retained window. Tail
    // overlap heals recent late rows, but cannot find an exchange correction
    // posted hours behind an already-confirmed edge.
    verifyFullWindow = false,
    keepRow = () => true,
    isCurrent = () => true,
    limits = FUTURES_SETTLED_LANE_WALK,
}) => {
    if (typeof readPage !== 'function') throw new TypeError('readPage must be a function');
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(windowFrom) || windowFrom > now) {
        throw new RangeError('walk window must be safe integer milliseconds with windowFrom <= now');
    }
    const maxRowsPerLane = narrowedPositiveLimit(
        limits?.MAX_ROWS_PER_LANE,
        FUTURES_SETTLED_LANE_WALK.MAX_ROWS_PER_LANE,
    );
    const maxPagesPerTarget = narrowedPositiveLimit(
        limits?.MAX_PAGES_PER_TARGET,
        FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_TARGET,
    );
    const maxPagesPerLane = narrowedPositiveLimit(
        limits?.MAX_PAGES_PER_LANE,
        FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_LANE,
    );
    const pageLimit = narrowedPositiveLimit(
        limits?.PAGE_LIMIT,
        FUTURES_SETTLED_LANE_WALK.PAGE_LIMIT,
    );
    const tailOverlapMs = narrowedNonNegativeLimit(
        limits?.TAIL_OVERLAP_MS,
        FUTURES_SETTLED_LANE_WALK.TAIL_OVERLAP_MS,
    );

    const previous = held?.version === FUTURES_SETTLED_INCOME_RESOURCE_VERSION
        && held?.lanes
        ? held
        : createFuturesSettledIncomeResource({ incomeTypes });
    const requested = new Set(refreshIncomeTypes.map(value => String(value).toUpperCase()));
    const lanes = {};
    for (const incomeType of incomeTypes) {
        const type = String(incomeType).toUpperCase();
        lanes[type] = previous.lanes?.[type]
            ? cloneFuturesSettledIncomeLane(previous.lanes[type])
            : createFuturesSettledIncomeLane(type);
    }

    let requests = 0;
    let failed = false;
    let queued = false;
    const attemptsByType = {};

    for (const type of Object.keys(lanes)) {
        if (!requested.has(type)) continue;
        const before = lanes[type];
        const pending = verifyFullWindow ? null : before.pending;
        const targetFrom = verifyFullWindow ? windowFrom : pending?.targetFrom ?? (
            before.coveredTo === null
                ? windowFrom
                : Math.max(windowFrom, before.coveredTo - tailOverlapMs)
        );
        const targetTo = verifyFullWindow ? now : pending?.targetTo ?? now;
        let page = pending?.nextPage ?? 1;
        const candidateRows = new Map();
        if (pending?.rows instanceof Map) {
            for (const [identity, row] of pending.rows) {
                if (candidateRows.size >= maxRowsPerLane) break;
                candidateRows.set(identity, row);
            }
        }
        let laneRequests = 0;
        let terminal = false;
        let refusal = null;
        // A resumed checkpoint already at the ceiling must not buy one more page
        // merely to discover that it cannot retain another unique row.
        let rowLimited = pending !== null && candidateRows.size >= maxRowsPerLane;
        let pageLimited = page > maxPagesPerTarget;

        while (laneRequests < maxPagesPerLane
            && !terminal
            && !rowLimited
            && !pageLimited) {
            if (!isCurrent()) {
                refusal = Object.assign(new Error('Income history read was overtaken'), {
                    code: 'READ_OVERTAKEN',
                });
                break;
            }

            let answered;
            laneRequests += 1;
            requests += 1;
            try {
                answered = await readPage({
                    incomeType: type,
                    startTime: targetFrom,
                    endTime: targetTo,
                    page,
                    limit: pageLimit,
                });
            } catch (error) {
                refusal = error;
                break;
            }
            if (answered === null || answered === undefined) {
                refusal = Object.assign(new Error('Income history page was not answered'), {
                    code: 'EMPTY_ANSWER',
                });
                break;
            }
            if (!Array.isArray(answered.rows)) {
                refusal = Object.assign(new Error('Income history page was not answered'), {
                    code: 'INVALID_INCOME_PAGE',
                });
                break;
            }
            if (answered.rows.length > pageLimit) {
                refusal = incomePageError(
                    'OVERSIZED_INCOME_PAGE',
                    'Income history page exceeded its requested row limit',
                );
                break;
            }

            try {
                for (const raw of answered.rows) {
                    const row = canonicalFuturesIncomeRow(raw);
                    if (row === null) {
                        refusal = incomePageError(
                            'INVALID_INCOME_ROW',
                            'Income history page contained a malformed or assetless row',
                        );
                        break;
                    }
                    if (row.incomeType !== type) {
                        refusal = incomePageError(
                            'INCOME_TYPE_MISMATCH',
                            `Income history page for ${type} contained ${row.incomeType}`,
                        );
                        break;
                    }
                    if (row.time < targetFrom || row.time > targetTo) {
                        refusal = incomePageError(
                            'OUT_OF_WINDOW_RESPONSE',
                            `Income history page contained a row outside ${targetFrom}..${targetTo}`,
                        );
                        break;
                    }
                    const previousRow = candidateRows.get(row.identity);
                    if (previousRow !== undefined
                        && !sameCanonicalIncomeRow(previousRow, row)) {
                        refusal = incomePageError(
                            'CONFLICTING_INCOME_IDENTITY',
                            `Income history identity ${row.identity} carried conflicting content`,
                        );
                        break;
                    }
                    if (!keepRow(row)) continue;
                    if (!candidateRows.has(row.identity)
                        && candidateRows.size >= maxRowsPerLane) {
                        rowLimited = true;
                        continue;
                    }
                    candidateRows.set(row.identity, row);
                }
            } catch (error) {
                refusal = error;
                break;
            }
            if (refusal !== null) break;

            // Even if an adapter calls a limit-sized page "not full", one more
            // explicit page is needed to prove that no timestamp peer follows.
            const full = answered.rows.length >= pageLimit;
            terminal = !full;
            if (!terminal && candidateRows.size >= maxRowsPerLane) rowLimited = true;
            if (!terminal && !rowLimited && page >= maxPagesPerTarget) pageLimited = true;
            if (!terminal && !rowLimited && !pageLimited) page += 1;
        }

        attemptsByType[type] = laneRequests;
        if (refusal !== null) {
            failed = true;
            lanes[type] = failedLane(before, {
                attemptedAt: now,
                targetTo: now,
                error: refusal,
            });
            continue;
        }
        if (rowLimited) {
            failed = true;
            lanes[type] = rowLimitedLane(before, {
                candidateRows,
                targetTo,
                windowFrom,
                attemptedAt: now,
                maxRows: maxRowsPerLane,
            });
            continue;
        }
        if (pageLimited) {
            failed = true;
            lanes[type] = failedLane(before, {
                attemptedAt: now,
                targetTo,
                error: incomePageError(
                    'PAGE_LIMIT_REACHED',
                    `Income history lane reached its ${maxPagesPerTarget}-page target limit`,
                ),
            });
            continue;
        }
        if (!terminal) {
            queued = true;
            lanes[type] = createFuturesSettledIncomeLane(type, {
                ...before,
                targetTo: now,
                nextPage: page,
                status: 'loading',
                attemptedAt: now,
                error: null,
                pending: {
                    targetFrom,
                    targetTo,
                    nextPage: page,
                    rows: candidateRows,
                },
            });
            continue;
        }
        const committed = commitLaneWindow(before, {
            rows: candidateRows,
            targetFrom,
            targetTo,
            requiredTo: now,
            windowFrom,
            overlapMs: tailOverlapMs,
            attemptedAt: now,
        });
        if (committed.rows.size > maxRowsPerLane) {
            failed = true;
            lanes[type] = rowLimitedLane(before, {
                candidateRows: committed.rows,
                targetTo,
                windowFrom,
                attemptedAt: now,
                maxRows: maxRowsPerLane,
            });
        } else {
            lanes[type] = committed;
        }
        if (lanes[type].pending !== null) queued = true;
    }

    const resource = finalizeFuturesSettledIncomeResource({ lanes, previous });
    return {
        ...resource,
        resource,
        requests,
        attemptsByType,
        failed,
        queued,
        queuedIncomeTypes: Object.values(resource.lanes)
            .filter(lane => lane.pending !== null)
            .map(lane => lane.incomeType),
    };
};

export default walkFuturesSettledIncome;
