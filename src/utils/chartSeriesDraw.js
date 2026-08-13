// Both charts ask the same question of every new series they are handed: what
// actually changed, and therefore how much has to be redrawn. The answer used
// to live beside the Spot history helpers and was reimplemented — differently,
// and wrongly — for Futures, so it is stated once here for both.
//
// Two things vary between the markets and nothing else does. Spot carries open
// time in seconds under `time`, Futures in milliseconds under `openTime`; and
// Spot rows survive a frame by identity, while a Futures frame is parsed off
// the wire and hands back new objects for the rows it re-sent unchanged. Both
// are passed in rather than guessed.

const identical = (left, right) => left === right;
const rowTime = row => row?.time;

const sharesEveryRowBefore = (drawn, next, count, sameRow) => {
    for (let index = 0; index < count; index += 1) {
        if (!sameRow(drawn[index], next[index])) return false;
    }
    return true;
};

/**
 * What the chart has to redraw to show `next`, given the rows it is drawing now.
 *
 * A live trade moves the last candle and leaves every other one as it was, so
 * the question is answered by comparing the rows behind it — and a row settled
 * behind the last one is not mistaken for a tick. It is asked at all because
 * the alternative is redrawing three series, a moving average over every bar
 * and the whole volume histogram for one bar's news, on a chart that
 * accumulates thousands of them.
 *
 * `sameRow` defaults to identity, which is what a caller whose writers copy the
 * array and keep the untouched rows themselves should use: it is one pointer
 * comparison per row. A caller re-parsing its rows every frame states its own
 * comparison instead — identity first, so only the rows that really are new
 * objects are read field by field.
 */
export const planSeriesDraw = (drawn, next, { timeOf = rowTime, sameRow = identical } = {}) => {
    const rows = Array.isArray(next) ? next : [];
    if (rows.length === 0) return 'none';
    const previous = Array.isArray(drawn) ? drawn : [];
    if (previous.length === 0) return 'full';

    // The last bar moved and no other did.
    if (rows.length === previous.length) {
        if (timeOf(rows.at(-1)) !== timeOf(previous.at(-1))) return 'full';
        return sharesEveryRowBefore(previous, rows, rows.length - 1, sameRow) ? 'tick' : 'full';
    }

    // A bar opened after the last one drawn. Anything else that changes the
    // length is a merge — a history page in front, a window rejoined — and a
    // merge is redrawn whole.
    if (rows.length === previous.length + 1
        && timeOf(rows.at(-1)) > timeOf(previous.at(-1))) {
        return sharesEveryRowBefore(previous, rows, previous.length, sameRow) ? 'append' : 'full';
    }

    return 'full';
};

// Older candles arriving in front shift every bar's index, so the chart has to
// know how many before it can hold the viewport still.
//
// A row whose open time cannot be read is not counted. It looks like a detail
// and is not: an accessor answers a row it cannot read with `null`, `Number`
// reads that as the epoch, and the epoch is in front of every candle there has
// ever been — one malformed row at the front would move the operator's viewport
// by a bar that is not on the chart.
export const countPrependedRows = (previousFirstTime, next, { timeOf = rowTime } = {}) => {
    if (!Number.isFinite(previousFirstTime)) return 0;
    const rows = Array.isArray(next) ? next : [];
    let count = 0;
    while (count < rows.length) {
        const time = Number(timeOf(rows[count]) ?? NaN);
        if (!Number.isFinite(time) || time >= previousFirstTime) break;
        count += 1;
    }
    return count;
};
