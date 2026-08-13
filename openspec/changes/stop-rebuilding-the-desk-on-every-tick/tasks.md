## 1. The Trade Stream Does Not Cancel History

- [x] 1.1 Narrow the Spot chart history effect's dependencies to the selection and the series bounds it reads, so a trade does not recreate it. *(Split rather than narrowed: drawing the series and reading the visible range were one effect, and only the first of them has anything to do with the rows. The range subscription now depends on the chart and the selection, and reads the rows through a ref.)*
- [x] 1.2 Keep the debounce, and prove by test that a continuous trade stream still lets a history request be issued. *(It was worse than a delay: the effect's cleanup cancelled the settle timer the operator's scroll had started, and the next print cancelled the next one, so on any contract printing faster than the 50 ms timer — which is any contract worth scrolling back on — the request was **never issued at all** and the chart stayed at the 500 bars it opened with. Proven against the pre-change component in a scratch checkout, where the test fails.)*

## 2. A Live Trade Costs One Candle

- [x] 2.1 Update the last candle in place on the chart's series instead of re-running `setData`, the volume series and the SMA pass on every trade.
- [x] 2.2 ~~Avoid copying the whole candle array in `applyTradeToChart` when only the last candle changes.~~ Measured before building: the copy is 0.0069 ms at the five thousand bars this chart accumulates, against 0.68 ms for the moving average and 0.097 ms for the volume histogram that the same print used to rebuild. Removing it means either mutating state React is holding or moving the live candle out of the series every reader reads, and both are a large change for seven microseconds. What was worth taking on that side is one line: **a print that moves nothing answers with the series already showing.** A liquid contract prints at one tick again and again, and every one of those prints used to hand every reader of the context a new array to redraw for.
- [x] 2.3 Prove by test that a trade that only moves the last candle produces no full-series work. Counted per series, through the writes each one takes: a print writes one bar to the candles, one to the histogram and one to the moving average, and redraws none of them. Proven against the pre-change component, where it redraws all three.
- [x] 2.4 Redraw the whole series for a candle settling behind the last one. *(Discovered while deciding what a print may be answered with: the close of the candle just past — its true high, low and volume — reaches the chart through the same series a tick does, and comparing only the last bar would have left it undrawn. What changed is decided by identity across the rows, which the writers preserve for every row they did not touch, so a settled row is never mistaken for a tick. The scan costs 0.0026 ms at five thousand bars, less than the array copy it sits beside.)*
- [x] 2.5 Draw the RSI pane's line incrementally, or state why it stays. *(Discovered by measuring what a print still costs: the section named three passes and there is a fourth. The RSI pane recomputed over every bar and redrew its line whole on every print — 0.133 ms at five thousand bars. First stated as left, because Wilder's smoothing is recursive from the first bar and a carry that is wrong does not fail, it drifts an indicator the operator reads. Then taken, because that risk is exactly what a test can remove: the line now carries the smoothed averages standing behind its last point, and both readings go through the same two operations in the same order, so an incremental point is the arithmetic a full pass would have done rather than something close to it. Proven against the whole calculation over three hundred bars of ticking and opening, each point compared exactly, and at the boundary where the divisor goes to zero.)*
- [x] 2.6 Forget what was drawn when the chart is built again. *(Found auditing 2.1 rather than by a failing test, and it would have reached the operator: React mounts, tears down and mounts again on the first mount in development, which is how this desk is run. The component keeps its refs across that; the chart does not — the second mount builds new, empty series. A record of what was drawn that outlived the series it described had the whole chart taken for already drawn, and the next print written onto nothing. The first test written for it did not bite, because a fresh `render` gets fresh refs and is not what React does here; it is proven under `StrictMode`, where the pre-fix code draws the candles once for two mounts.)*
- [x] 2.7 Draw the moving average from the same arithmetic both ways. *(Found auditing 2.1, by asking whether the one point written for a print is the number a full pass writes — the code said it was and it was not. `technicalindicators` carries a running sum from the first bar, so what it answers for a bar depends on how many bars came before it: a point computed on its own differed from the same point inside a full pass on 4838 of 4921 windows, by up to 6.5e-13 at five thousand bars. Far below anything the chart draws, and still two answers to one question in a line the operator reads against price — and the comment claiming they agreed was the actual defect. The average is now a window's mean, computed in one place for both paths, which is exact by construction and also 0.339 ms against 0.668 ms over the whole series. It leaves `technicalindicators` with no caller in the renderer; the dependency is left in `package.json` rather than removed in a change about redraw cost.)*
- [x] 2.8 Subscribe the visible range to the chart that exists, not to the one the state still names. *(Found auditing 1.1. The subscription effect is keyed on the chart instance held in state, which is correct as a trigger and wrong as a value: the state lands a render after the chart is built, so on a rebuild the effect ran while the state still named the chart just disposed — subscribing to it, then unsubscribing from it after its removal. Unreachable today, since the only thing that rebuilds the chart is a colour prop nothing passes, and repaired rather than argued about: the effect takes the ref, which is always the chart that exists.)*

## 3. A Frame Redraws Only Its Own Panel

- [x] 3.1 ~~Coalesce futures depth deliveries to at most one book per animation interval, with the newest frame replacing a pending one.~~ Measured before building: the exchange sends `@depth@100ms` ten times a second, the tape is throttled to four, the klines about four and the mark once — around twenty renderer events a second against the sixty an animation interval allows. There is nothing to coalesce at the exchange's cadence, and the burst case the section was written for is already collapsed in the transport by `carry-execution-ahead-of-market-data`, where an undelivered book is replaced by the newer one. Building it would have bought nothing and made every hook test asynchronous.
- [x] 3.2 ~~Keep the delivered book complete — coalescing drops intermediate frames, never levels.~~ Nothing is coalesced, so nothing is dropped.
- [x] 3.3 Redraw the book only for a frame that changed the book, and the tape only for a frame that changed the tape. *(Discovered by measuring where the burst actually cost anything. The chart, the ticket, the history panel and the portfolio dock are memoized; the two panels the operator reads fastest are not — the ladders and the tape rows are built in the view's own body, so every frame of either kind rebuilt both. On a twenty-four-level book, 152 of the 175 number formats one print cost belonged to a book that had not moved, and 78 of the 251 a book update cost belonged to a tape that had not printed.)*
- [x] 3.4 Hold the two panels by element identity rather than splitting them into components. *(Discovered: React skips a subtree whose element is the one it already has, so a `useMemo` per panel buys the same saving as a memoized child without plumbing twenty props through a new boundary — and leaves the markup where a reader of this file already expects it. It needs the handlers and the depth scale to be stable, which cost one `useCallback`.)*
- [x] 3.5 Prove by test that a print costs the same whatever the book on screen is worth, and a book update the same whatever the tape holds — measured through the formatter every row calls, at two panel sizes, so what did not change contributes nothing to the difference. Proven against the pre-change view in a scratch checkout: it fails there at 175 against 23, and 251 against 173.

## 4. No State Updates During Render

- [x] 4.1 Derive the last-tick direction without calling `setLastTick` in the render body of `FuturesWorkstationView`.
- [x] 4.2 Prove by test that a price tick renders the workstation once — and state what still costs two. A tick that keeps going the same way, and a price that did not move, each cost one pass; a **turn** costs two, because a direction is a comparison with what was on screen before and nothing in the props carries that. It used to be two on every tick. Counted through the one helper the view calls once per render pass.
- [x] 4.3 Keep the direction on the frame the turn happened. *(Discovered: deciding it after the commit is what removes the second pass, but an ordinary effect runs after the browser paints, so a turn would have been drawn a frame late — a red price shown green for one frame, on the surface the operator reads fastest. It is decided in a layout effect, before the paint.)*
- [x] 4.4 Do not read what was on screen before during the render. *(Discovered: holding the previous price in a ref and reading it in the render body is the obvious shape and the lint rule refuses it, correctly — a render that reads mutable state outside React is not a pure render. The previous price is written after the commit and read only there.)*

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test` (1693 passed, 106 files), `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data that the desk stays responsive on a liquid contract with deep history loaded — step 12, «Быстрый контракт: стакан и лента идут ровно», in `verify-the-desk-in-one-sitting/runbook.md` for the Futures workstation, and step 13 for the Spot chart, which is where the deep history and the RSI live. Both are free to run, so both sit in part 1.
- [x] 5.3 Correct the runbook's "not ready to verify" list, which still said this change's responsiveness work had not been started. *(It was written before §1–§4 landed and was never revisited; an operator reading it would have skipped steps 12 and 13 as premature.)*

### Measured

What one Spot print costs the chart in its own arithmetic, at the five thousand
bars the operator can accumulate on one pair and interval. Each part driven
through its own code on the same clock; the drawing the library does on top of
this is not in these numbers, and is four whole series before against four single
points after.

| per print, 5000 bars | before | after |
| --- | --- | --- |
| Volume histogram | 0.0965 ms | **0 ms** — one bar |
| Moving average | 0.6785 ms | **0.0002 ms** — one point |
| RSI line | 0.1327 ms | **0.0002 ms** — one point, from the tail |
| Deciding what changed | — | 0.0046 ms |
| Copying the series in `applyTradeToChart` | 0.0069 ms | 0.0069 ms, or **0** when the print does not move the candle |
| **Total** | **0.915 ms** | **0.012 ms** |

Seventy-six times less arithmetic per print, on a chart the operator has scrolled
back through. The full draw got cheaper too, and not by design: the moving
average over the whole series is 0.339 ms against the library's 0.668 ms, because
what 2.7 needed for correctness happens to be the faster arithmetic as well.

And the cost that was not a cost but a failure: at the exchange's cadence on a
liquid pair, the request for older candles was issued **never** before this and
is issued on the scroll after it.
