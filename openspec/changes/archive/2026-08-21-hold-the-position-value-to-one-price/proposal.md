## Why

The operator reports that on a large, fast-moving position the unrealized PnL
carries the wrong sign — price below an `ENTRY SHORT` line while the Positions
row and the partial-close panel both read negative — and that the number lags
the market. Tracing it found two independent defects, and the first produces
exactly that sign reversal.

**The headline valuation alternates between two incomparable prices.**
`mergeFuturesPositionMarks` (`src/utils/futuresPositionMarks.js:60-72`) values a
position at the last traded price whenever the newest `aggTrade` is stamped
after the newest `markPriceUpdate`, and at the mark otherwise. Both readings
arrive in the same 200 ms batch, so which one wins is decided by how two streams
happen to interleave, not by the market. The mark is an index average carried on
a smoothing basis; the tape is what printed. On a fast move they sit on opposite
sides of the entry, and the row then reverses sign every time a mark tick beats a
trade tick. Run against a real `BEATUSDT` short (`-2873` at `3.3450`) with the
tape at `3.30` — below the entry, so the position is in profit:

| mark | tape | which wins | uPnL shown |
|------|------|-----------|-----------|
| `3.36` | `3.30` | trade newer | **+129.28** |
| `3.36` | `3.30` | mark newer  | **−43.10** |

Same market, same position, same second — one number is a profit and the other a
loss. That is the reported bug, and it is also the reported lag: whenever the
mark tick wins, the reading snaps back to a price up to a second old and
smoothed away from the tape.

The spec sentence that blesses this — "When a mark arrives, the confirmed
mark-based figure SHALL replace the estimate" — was written by the change that
wrote the code. It never asked what happens when the figure being replaced is on
the other side of zero.

**Every change to the open-symbol set clears every symbol's marks.**
`createFuturesMarkPriceFeed().track()`
(`electron/services/futures-mark-price-feed.js:299-306`) reacts to any change in
the tracked set by calling `disconnect()`, which calls `clearMarks()`, which
broadcasts an empty map. Opening or fully closing *one* position therefore drops
the live marks of *every other* open position, and each of those rows falls back
to the account snapshot — a mark and a PnL from an earlier read — until a new
socket delivers. That is at best one second, and a failed connect puts it behind
the 5 s reconnect delay. An operator working several contracts hits this on every
entry and every exit, which is the "uPnL freezes and trails" half of the report.

## What Changes

- **The between-marks estimate becomes an extrapolation of the mark rather than
  a substitute for it.** Each mark records the traded price known at the moment
  it was taken (its anchor); between marks the position is valued at
  `mark + (last traded price − anchor)`. The estimate is then continuous with
  the mark by construction: with a still tape it *equals* the mark, so a mark
  tick can no longer move the number by itself and can no longer reverse its
  sign. With a moving tape it tracks the tape tick for tick, which is what the
  estimate exists for. Where no trade is known from the moment the mark was
  taken there is nothing to carry it forward by, and the position is valued at
  the mark.
- **Reconciling the tracked symbol set keeps the marks of the symbols that stay
  in it.** Only symbols that left are dropped. The socket is still rebuilt — the
  stream list lives in the URL — but a mark at most a second old survives that
  rebuild instead of being thrown away. Every other path that clears marks is
  untouched: a close, an error, a stall and a stop all still clear, so a feed
  that has actually stopped delivering still falls the desk back to the account
  snapshot. The retained marks are bounded by the same stall window, so a rebuild
  that never delivers clears them exactly as a dead socket does today.
- **A row that disagrees with the chart says why.** Fixing the arithmetic does
  not make the two prices agree: the chart is drawn from the tape and the row is
  valued on the mark, so on a fast move the operator can still see price past
  their own `ENTRY SHORT` line while the row states a loss. Both figures are
  right, and without a word on the row the only available conclusion is the one
  that was reported — that the desk cannot do arithmetic. So when the tape and
  the mark put a position on opposite sides of its entry, the row states the
  price the contract last traded at, what the position would be worth there, and
  that the mark has not crossed the entry and is what settles. One shared
  reading, so the dock and the ticket cannot say it two different ways. The
  chart is untouched: "The chart does not draw a MARK overlay" holds, and the
  explanation belongs on the number being questioned.
- **ADDS** to `futures-order-visibility`: "A position row that disagrees with the
  chart says why".
- **MODIFIES** `futures-order-visibility` → "An open position's value moves with
  the market between marks", replacing the substitution rule with the
  carry-forward rule and the continuity it guarantees.
- **MODIFIES** `futures-workstation-presentation` → "Position rows are valued at
  the live mark price", which states the PnL derivation and currently names only
  the mark.
- **MODIFIES** `futures-live-readiness` → "Open positions are marked to the live
  market", whose "on disconnect the system SHALL clear the marks" sentence is
  what a set change currently rides on.

Not changed: the confirmed `markUnrealizedPnl` and everything measured from it —
liquidation price, liquidation distance, margin balance, withdrawable margin —
remain the mark's own arithmetic, untouched by the estimate. The estimate is
still labelled as an estimate and still names the confirmed figure beside it.

## Impact

- `src/utils/futuresPositionMarks.js` — the valuation branch in
  `mergeFuturesPositionMarks`, and carrying `anchorPrice` through
  `readFuturesPositionMarks`.
- `electron/services/futures-mark-price-feed.js` — record the anchor on each
  mark; retain surviving symbols' marks across a set reconcile.
- `src/utils/futuresOrderPresentation.js` — `describeFuturesPosition` derives the
  tape's own reading and whether it disagrees with the mark; a new
  `futuresPnlReadingNote` writes the sentence once for every surface.
- `FuturesPortfolioDock.jsx` and `FuturesTradingTicket.jsx` — both PnL titles now
  come from that one helper. `FuturesPositionCloser.jsx:99` is unchanged and
  reads the same `valuationPrice` it reads today.
- Tests: `src/utils/futuresPositionMarks.test.js`,
  `electron/services/futures-mark-price-feed.test.js` — a biting regression for
  each defect (the straddle case above; a set change that must not blank a
  surviving symbol).

## Out of scope, found while tracing

`foldedFuturesPosition` (`electron/services/futures-account-state.js:609-619`)
carries `markPrice`, `notional`, `initialMargin` and `liquidationPrice` over from
the held row, so immediately after a partial close the ROE percentage beside the
uPnL is computed against the pre-close margin. It self-corrects on the unstated
read that the same fold triggers (340–800 ms through the operator's proxy), it is
a percentage rather than the money figure the operator reported, and fixing it
means changing what a fold may carry — its own change, not this one.
