## 1. Production presentation

- [x] 1.1 Add a translucent dark background to the existing interval
      progress layer, keeping the spinner above it and `pointer-events: none`;
      verify the stylesheet limits the veil to that switching-only layer.
- [x] 1.2 Keep the held series drawn while the local link is down after a
      switch the link's failure ended, under the link's state and without the
      veil; a series at another interval on a live link outside a switch stays
      undrawn. **Audit 2026-09-03**: found by a probe render — the view drew
      no candles behind «DISCONNECTED · No candle has arrived for this
      contract yet» while the canon promised that the retained chart states
      the failure.

## 2. Regression coverage

- [x] 2.1 After the production CSS is in place, extend the workstation
      presentation test to prove the veil has a translucent dark background,
      remains pointer-through, and disappears with the progress state; verify
      the focused Futures workstation tests pass.
- [x] 2.2 Run eslint, the production build, and the relevant architecture
      guards; run `openspec validate veil-the-chart-during-interval-switch`.
- [x] 2.3 Two view tests bite on the pre-fix tree (no rows drawn on a local
      close or error after a switch); a third pins the live-link rule as a
      guard. View, chart and container suites 203/203; full suite on a HEAD
      copy 3 028/3 028 before the fix and re-run after it; eslint, the four
      guards and the build green.
- [x] 2.4 Rewrite the canon requirement «The chart opens on enough history to
      read the market», which the interval-switch archive left contradicting
      the held series (cleared before paint, no frame with the previous
      interval's candles); the delta here carries both requirements.

## 3. Operator verification

- [ ] 3.1 Confirm in the running desk that the chart is visibly darkened while
      the interval spinner turns, remains readable and interactive, and returns
      to its normal background when the replacement series arrives.
- [ ] 3.2 Save any `electron/**` file while a switch is waiting (the main
      process restarts and the local link closes): the chart keeps its last
      series under `DISCONNECTED chart`, no veil, no «No candle has arrived»
      notice, and comes back on the selected interval when the desk
      subscribes again.
