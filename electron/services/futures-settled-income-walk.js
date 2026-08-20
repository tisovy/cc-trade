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
    const identity = row?.tranId;
    if (identity !== null && identity !== undefined && identity !== '') {
        return `${row?.incomeType ?? ''}:${identity}`;
    }
    return `${row?.incomeType ?? ''}:${row?.symbol ?? ''}:${row?.time ?? ''}`
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
    MAX_ROWS: 24000,
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
        let cursor = to;
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
        to = cursor;
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

export default walkFuturesSettledIncome;
