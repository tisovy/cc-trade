# Tasks

## 1. Spec

- [x] 1.1 Remove the mark-authoritative requirement from
      `futures-order-visibility` with its reason and migration, and add "An open
      position is read at the newer of its two exchange prices" in its place —
      keeping the mark as the sole input to notional, margin, liquidation and
      every risk decision, and requiring the mark's own figure on every row.
- [x] 1.2 Add "The price feed carries both prices for every open position" to
      the same capability: one combined public stream, a print never without a
      live mark beside it, and trades that do not answer the stall watchdog.
- [x] 1.3 Add "A position row states which price it is read at, and what the
      exchange holds it at" to `futures-workstation-presentation`.
- [x] 1.4 Withdraw the superseded `futures-workstation-presentation` delta from
      `value-the-watched-position-at-the-price-on-the-chart` and retire its
      operator gate, so a contradicted requirement cannot reach canon.

## 2. Code

- [x] 2.1 Subscribe `<symbol>@aggTrade` alongside `<symbol>@markPrice@1s` for
      the feed's tracked symbol set, hold prints in their own map, and publish
      them by walking the marks so a print is never published without one.
      Withdraw prints wherever marks are withdrawn.
- [x] 2.2 Decide the basis in one place — `readFuturesPositionPriceBasis` — and
      set `FUTURES_LAST_PRICE_GRACE_MS` from the measurement, stating it there.
- [x] 2.3 Read uPnL, ROE and the aggregate at the basis price; keep notional,
      margin and everything the margin ladder reads on the mark; carry
      `markScenario` beside every live reading.
- [x] 2.4 Rewrite the store's notification predicates around the basis, so the
      money channel fires when the basis price changes — including when it
      changes because a clock alone handed the reading back to the mark — and
      stays quiet when a mark moves under a contract that is still printing.
- [x] 2.5 State both figures on the ticket's position card and both prices in
      its list; state the basis and the mark's figure in the dock row's and the
      total's own account of themselves.
- [x] 2.6 Remove `useFuturesWatchedTape`, the store's `noteTape` entry point and
      the workstation wiring: one source for every position, not two.

## 3. Proof

- [x] 3.1 Tests that bite, each verified failing against the pre-change file it
      covers: a print between marks moves the row, the ROE and the total; the
      mark's figure and the notional stay put under it; a clock alone hands the
      reading back past the window; an untimed price is not preferred; the
      margin ladder still reads the mark's figure; the close preview follows the
      price the exit would fetch; the card states both and drops the second when
      there is nothing to state twice.
- [x] 3.2 Feed tests: both streams on the routed path; a print published beside
      its mark and alone triggering a publication; a print held for an unmarked
      contract and delivered with its first mark; a print that does not answer
      the stall watchdog.
- [x] 3.3 Two tests are guards rather than biters and are named as such: "does
      not redraw money for a mark clock that only advances" and "refuses a price
      for a contract with no mark, and a print that arrives late" both passed
      against the pre-change file. They hold behaviour that already existed and
      that this change could easily have broken.
- [x] 3.4 Measured live through the operator's proxy, 180 s, four contracts on
      one combined stream, and recorded in the proposal: mark cadence (178
      frames/180 s, p50 1000 ms, worst 1272 ms), print rate (2.0–25.5/s, gap p95
      196–1609 ms), roam from the standing mark inside one mark second (p50
      0.68–1.99 bps, worst 3.59–6.99), transit (p50 210–336 ms), total frame
      rate (50.5/s).
- [x] 3.5 Full suite 2934/2934 across 128 files, eslint clean on every touched
      file, all four guard scripts pass. Card measured in Chromium: the mark
      line is 11 px in `#93a6b7` under a 17 px position-toned headline, and the
      added `Last` row costs no height — the card's list is a two-column grid
      that was already three rows deep with an empty cell.

## 4. Operator gate

- [x] 4.1 Operator watches open positions through a fast move, including at
      least one contract they are not looking at: every row moves with its own
      contract rather than once a second, the mark's figure is reachable on each
      and is the one the Binance app agrees with, and a contract that goes quiet
      falls back to its mark instead of holding a stale price. Record in
      `openspec/live-verification-ledger.md`.
