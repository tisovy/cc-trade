# Confirm a fill burst once

## Why

The operator, 2026-09-03: «после филла у нас идёт таймаут — 10 секунд на
переподтверждение через REST у биржи. Если идут новые филлы — этот таймаут
ресетится и стартует заново. Таким образом мы не будем жечь лимит и
бесполезно долбиться».

What the desk does today (`useFuturesTrading.js:1068`,
`HISTORY_GAP_READ_DELAY_MS` 1 200): every fill arms a per-contract timer of
1.2 s that is *not* restarted by the next fill, so a scalp with a fill every
few seconds sends one `account.history` gap read per 1.2-second window per
contract. Each read walks the trades of every open position not yet
vouched, at weight 5 a page, and a read that finds coverage incomplete
re-arms the backend's continuation walker (`FUTURES_HISTORY_REACQUISITION_CONTINUE_MS`
5 000, up to 8 pages a round). Measured on 2026-09-02 (`desk-2026-09-02-000.jsonl`):

| Minute (UTC) | Fills | Weight-5 ordinary reads | Weight-30 reads |
|---|---:|---:|---:|
| 21:42 | 5 | 73 | 8 |
| 21:43 | 6 | 77 | 8 |
| 21:46 | 3 | 86 | 5 |
| 21:47 | 0 | 94 | 0 |
| 21:48 | 0 | 107 | 4 |

The fill itself already carries the price, the quantity, the commission and
the realized PnL; the read proves no sibling execution was missed and
replaces the stream's row with the exchange's canonical one. That proof is
worth one read per burst, ten seconds after the burst ended — not one per
fill while it is still going.

## What Changes

- **One timer for the burst.** A fill starts a ten-second timer; every
  further fill restarts it; when it expires, one gap read goes out for
  each contract the burst touched. No ceiling on the restart: the operator
  has never seen a burst last a minute, and a ceiling was ruled excessive.
- Nothing else changes: the backend's bounded continuation walker, the
  income credit-confirm (already one read per burst, two minutes after its
  newest fill), the periodic beat.

## Impact

- Specs: `futures-order-visibility` («Trade-history activity requires fill
  evidence» — the burst timer stated).
- Code: `src/hooks/useFuturesTrading.js` (`scheduleHistoryGapRead`,
  `HISTORY_GAP_READ_DELAY_MS`), its tests.
- Not touched: `electron/**`.
