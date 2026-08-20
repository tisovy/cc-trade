## 0. The base has moved

- [ ] 0.1 `src/utils/futuresTradeRounds.js` was changed on 2026-08-20 by the
  session auditing the 2026-08-19 fix series (b6581c77): the edge-round gates
  moved — an increasing fill with `realizedPnl \u2260 0` now finishes a round,
  the reclosing split applies only at `pnl = 0`, and a restarted open round is
  published from `heldAtoms`/`heldEntry`. Re-read the fold and re-run 1.1 against
  it before changing anything; the reproduction below predates that edit.

## 1. Establish the ground truth

- [ ] 1.1 Re-run the mismatch rather than reading about it: take one closed
  position the operator can see in the Binance app, drive `foldFuturesTradeRounds`
  over its real fills, print the whole round object, and record the desk's figure
  against the app's — with the app screen named.
- [ ] 1.2 Confirm the column's source. The row renders `round.realizedPnl`
  (`FuturesHistoryPanel.jsx`), and the fold sums per-fill `realizedPnl`
  (`futuresTradeRounds.js`) with `netPnl = realizedPnl − fee` computed but not
  shown.
- [ ] 1.3 Confirm the mixed-currency fee sum: `round.fee` accumulates
  `fill.commission` with no `commissionAsset` check, while the field is carried
  end to end (`futures-trading-adapter.js`, `futuresHeldHistory.js`).
- [ ] 1.4 Settle which Binance screen is the target, and what it nets. Ask the
  operator which screen the comparison was made on before fixing arithmetic to
  match a screen they were not looking at.
- [x] 1.5 Confirmed from Binance's OpenAPI: a `userTrades` fill carries
  `realizedPnl` and `commission` and no funding of any kind, and `/fapi/v1/income`
  is where `FUNDING_FEE` lives. Recorded in full under
  `state-what-an-open-position-has-already-paid` tasks 1.2, which also settles the
  sign convention and the absent `positionSide` this change depends on.
- [ ] 1.6 Blast radius by grep for `foldFuturesTradeRounds`, `realizedPnl`,
  `netPnl` and `round.fee`.

## 2. Spec

- [ ] 2.1 Write the MODIFIED "Executions are reported as the positions they
  formed" carrying across every scenario the live spec still has, and verify the
  requirement name by grep.
- [ ] 2.2 `OPENSPEC_TELEMETRY=0 openspec validate close-a-round-at-what-reached-the-wallet --strict`.

## 3. Code

- [ ] 3.1 Accumulate commission per asset in the fold; keep the split fill's
  share arithmetic exactly as it is.
- [ ] 3.2 Attribute funding and insurance clearance to a round from the income
  rows, matched on contract and the span between open and close — not on leg,
  which an income row does not state (see `state-what-an-open-position-has-already-paid`
  tasks 1.2). Boundary rule stated and tested: a charge stamped exactly at the
  close belongs to the round.
- [ ] 3.3 Report the round's result as realized less the fill record's unsigned
  commission plus the income record's already-signed funding and insurance
  clearance, keeping the pre-fee realized PnL and each component available. Prove
  the sign convention with a test that would pass if a fee were counted twice in
  one direction and fail in the other.
- [ ] 3.4 Carry whether the income read reaches the round's open, and state it on
  the row where it does not.
- [ ] 3.5 Render the result in the PnL cell, and decompose it in the title.

## 4. Proof

- [ ] 4.1 Every new test bites: run against the pre-change fold in a copy of the
  tree and record the failures before keeping the tests.
- [ ] 4.2 Fold tests: funding inside a round, a BNB commission, a round older than
  the income window, a round with no funding at all, and the exact-close-time
  boundary.
- [ ] 4.3 Panel test: the cell states the result, the title decomposes it, and the
  incomplete-funding qualification appears only when it applies.
- [ ] 4.4 `npx vitest run src/utils/futuresTradeRounds.test.js
  src/components/features/futures/FuturesHistoryPanel.test.jsx` and every other
  touched test file; `npx eslint` on the touched sources.
- [ ] 4.5 Operator re-checks the same closed position from 1.1 against the same
  Binance screen and confirms the figures now agree. Record in
  `openspec/live-verification-ledger.md`, naming the screen.
