## 1. Re-verify the defect

- [x] 1.1 Reproduced. Driving `readFuturesPositionMarks` +
  `mergeFuturesPositionMarks` + `describeFuturesPosition` at `e6718d0` with one
  `BEATUSDT` short (`quantity: '-2873'`, `entryPrice: '3.3449999999999998'`) and
  one market state (`markPrice: '3.36'`, `lastPrice: '3.30'` — the tape below the
  entry, so the position is in profit), varying only which stamp is newer:

  | newer stamp | `valuationPrice` | `valuationEstimated` | uPnL shown | tone |
  |---|---|---|---|---|
  | trade | `3.30` | `true` | `+129.28` | positive |
  | mark | `3.36` | `false` | `-43.10` | negative |

  Same position, same market, opposite signs. Also confirmed the reverse pairing
  (mark `3.30` / tape `3.29`, both below entry) stays positive in both orders, so
  the reversal needs the two series to straddle the entry — which is what a fast
  move produces.
- [x] 1.2 Confirmed. Driving `createFuturesMarkPriceFeed()` with a stub socket:
  `track(['BMTUSDT'])` + one mark broadcasts
  `{"BMTUSDT":{"markPrice":"0.0360","updatedAt":1700000000000}}`; the very next
  `track(['BMTUSDT','BEATUSDT'])` broadcasts `{}` — `BMTUSDT`'s live mark is gone
  because a *different* contract opened a position. Two sockets built, the first
  closed. Its row then values off the account snapshot until the rebuilt socket
  delivers.
- [x] 1.3 Blast radius by grep (GitNexus MCP is absent in this environment; see
  the `gitnexus-tooling-status` note). `valuationPrice` has one production
  consumer — `FuturesPositionCloser.jsx:99`, which reads it through `Number()`
  and is unchanged. `unrealizedPnl`/`markUnrealizedPnl` are read by
  `describeFuturesPosition` and `describeFuturesPositionMargin` only, both of
  which keep reading the same fields. `track()` has two production call sites,
  `binance-connection.js:1822` and `:2416`, both passing a position list and
  ignoring the return. No signature changed.

## 2. Spec

- [x] 2.1 Wrote three MODIFIED requirements — "An open position's value moves
  with the market between marks" (`futures-order-visibility`), "Position rows are
  valued at the live mark price" (`futures-workstation-presentation`), "Open
  positions are marked to the live market" (`futures-live-readiness`) — each
  carrying across every scenario the live spec still has, plus one ADDED
  requirement, "A position row that disagrees with the chart says why". Names
  verified against the live specs by grep.
- [x] 2.2 `OPENSPEC_TELEMETRY=0 openspec validate hold-the-position-value-to-one-price --strict` — valid.

## 3. Code — the estimate is an extrapolation of the mark

- [x] 3.1 `futures-mark-price-feed.js`: each `markPriceUpdate` records the held
  `lastPrice` as `anchorPrice`, `null` when no print has been seen yet.
- [x] 3.2 `readFuturesPositionMarks` carries `anchorPrice` under the same
  positive-price validation `lastPrice` gets.
- [x] 3.3 `mergeFuturesPositionMarks` values an estimated position at
  `markPrice + (lastPrice − anchorPrice)`, falls back to the mark with no usable
  anchor or when the carry lands at or below zero, and keeps the exchange's own
  `markPrice` string as `valuationPrice` whenever the mark stands.
  `markUnrealizedPnl` is untouched.

## 4. Code — a set change keeps the marks that survive it

- [x] 4.1 `disconnect({ retain })` takes the surviving symbol set; `track()`
  passes the new set so `retainMarks` drops only what left. `retain` defaults to
  `null`, which is the clear-everything behaviour every other caller keeps.
- [x] 4.2 Read every clearing path: the `close` handler calls `clearMarks()`
  directly, `restart()` (the stall) and `stop()` call `disconnect()` with no
  argument, and the error handler clears nothing and never did. `track()` is the
  only caller that passes `retain`.
- [x] 4.3 Found a hole and closed it. `armStallCheck` was only reached from the
  socket's `open` handler, so a rebuild whose socket never opened would have left
  retained marks with nothing measuring their age. `track()` now arms the check
  itself after reconnecting (a second call on `open` is a no-op), and the stall
  callback clears the marks when it fires with no socket to blame — previously it
  returned without clearing. Covered by "clears retained marks when the rebuilt
  socket never delivers".

## 5. Proof

- [x] 5.1 The straddle test bites. `does not reverse a position because a print
  outran the mark` fails against `e6718d0` with
  `AssertionError: expected 129.28500000000108 to be less than 0` — the pre-change
  code reports the short as a **profit** when the print is newest and a **loss**
  when the mark is newest, which is the operator's report exactly. After the fix
  both readings are losses differing by 1.44 USDT, which is only what the tape
  moved since the mark was taken.
- [x] 5.2 The surviving-symbol tests bite. Against `e6718d0`,
  `keeps the marks of the contracts that stayed in the set` fails because the
  broadcast is emptied, and `drops the marks of the contracts that left it` and
  `clears retained marks when the rebuilt socket never delivers` fail with it.
  Six feed tests fail pre-change in total.
- [x] 5.3 Continuity test kept: `is unchanged by a mark arriving while the tape
  stands still` — with a still tape the estimated and the confirmed readings are
  the same number. Fails pre-change.
- [x] 5.4 `npx vitest run src/utils/futuresPositionMarks.test.js
  src/utils/futuresOrderPresentation.test.js
  electron/services/futures-mark-price-feed.test.js
  src/components/features/futures/` — 456/456 passed across 14 files, covering the
  dock, the ticket, the closer, the chart and the production workstation.
  Full-suite run: 2169 passed, and the only failures are two in
  `scripts/read-desk-record.test.mjs`, which is another session's uncommitted
  work in this shared tree (it passes at `e6718d0` and is untouched by this
  change).
- [x] 5.5 `npx eslint` on all nine touched source and test files — clean.
- [ ] 5.6 Operator reads a Positions row against the Binance app on a live
  fast-moving position: the sign must agree with the app, the figure must agree
  with it at each mark tick, and the row must no longer jump between two values
  once a second. Add to `openspec/live-verification-ledger.md`.
- [ ] 5.7 Operator confirms the second half of the report — that the uPnL lags —
  is gone while working more than one contract, which is when the mark feed used
  to blank every row.
- [ ] 5.8 Operator confirms the chart-vs-row explanation reads usefully when the
  tape and the mark straddle an entry, rather than as noise.

## 6. Guards, not regressions

Named per `tests-must-bite`: these pass against the pre-change code and are kept
as guards rather than as proof of this change.

- `says nothing about the tape when it agrees with the mark` (dock) — the
  pre-change code has no note at all, so its absence is not evidence.
- The `null` and exactly-on-entry branches inside `states the tape's own reading
  and whether it disagrees with the mark` — only the disagreeing branch bites.

## 7. Carried forward

- The stale ROE denominator after a partial close, named in the proposal's
  "Out of scope, found while tracing". Not fixed here; needs its own change.
- The operator's report may predate `refresh-entry-annotations-on-a-flip`
  (implemented, not yet archived), which left an `ENTRY SHORT` plate over a
  flipped long. If the live check in 5.6 still shows a mislabelled entry line,
  that is the one to look at rather than this change.
