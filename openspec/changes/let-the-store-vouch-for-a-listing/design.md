# Design

## D1 — The listing minute travels with the read, the store stays pure

`readStorePage(session, request)` passes `listedAt: session.contract?.onboardDate ?? null`
into `store.readCandles({ …, mode: 'page', listedAt })`. The store client
knows nothing of sessions or catalogues; it receives one integer (ms) or
`null` and validates it like every other input (`null` or a safe positive
integer, else `INVALID_STORE_SELECTION`). The window mode ignores it.

## D2 — The rule, in the store's own terms

Let `first = ceilMinute(listedAt)`. `servePage(answer, rows, limit, { from, to, intervalMs, listedAt })`
returns the rows when either

- the existing rule holds: `coverage_complete && gap_count === 0 && rows.length === limit`; or
- the vouch holds, all of:
  - `listedAt !== null` and `from < first` (the page reaches before the listing);
  - `timestampOf(answer.actual_from) === first` (the store's first minute is the
    listing minute, not a later minute it happened to start collecting at);
  - `answer.gap_count === minutesBetween(from, first)` (every missing minute
    lies before the listing; nothing is missing between the listing and `to`);
  - `rows.length >= 1`, `rows[0].openTime === floorBucket(first, interval)`, and
    the rows are contiguous at `intervalMs` up to `to` (the exchange's first
    kline opens on the bucket that contains the listing minute, built from the
    minutes after it — the same minutes the store's `time_bucket` has).

`actual_to` must still reach `to` (the store's tail is past the page's end);
otherwise the answer is a miss as before. A vouched page is shorter than
`limit` by construction; the renderer marks the contract's history exhausted
on it, exactly as on the exchange's short page.

## D3 — Why `onboardDate` and not the store's `actual_from` alone

`actual_from` alone says where the store's minutes begin. For USELESSUSDT that
is 2026-07-16 17:57Z, the fill boundary, while the contract has traded since
2025-08-15 — a vouch on `actual_from` alone would end its history eleven months
early. The exchange's `onboardDate` is the one statement of where the
contract's history begins, and `hunter`'s collector catches a new contract up
from that same value, which is why the two agree to the minute.

## D4 — The catalogue keeps a number it already validates

`EXCHANGE_SYMBOL_OPTIONAL_KEYS` already admits `onboardDate`; the contract
object now carries `onboardDate: Number.isSafeInteger(symbol.onboardDate) ? symbol.onboardDate : null`.
No other reader of the catalogue changes.

## D5 — What is not changed

- The renderer's `selectCandleHistoryPage` keeps "exactly the page or nothing":
  the renderer has no listing minute, and a short page from the store costs 20 ms.
- `serveWindow` is untouched: a window already tolerates a head gap.
- The summary block counts a vouched page as a store hit; no new code.

## Residuals

- A contract relisted under the same symbol, or one whose `onboardDate` the
  exchange later restates, would vouch on the new value; the desk reads the
  catalogue on every session start and follows it.
- A store whose first minute is one minute later than the listing (a collector
  that missed the listing minute) is refused, and the exchange serves the page;
  the collector's catch-up starts at `ceil(onboardDate)`, so this has not been
  seen.
