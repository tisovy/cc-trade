## Why

Two requirements this desk already holds cannot both be satisfied, and the
operator hit the place where they meet on 2026-08-15 (runbook step 19).

- **Scrolling left loads older candles** ends: "When a response returns fewer
  candles than requested, the chart SHALL treat that as the start of the
  contract's history and SHALL stop requesting more." The renderer implements
  it as a latch — `exhausted: base.exhausted || exhausted || !deepened`
  (`src/hooks/useFuturesProductionWorkstation.js:142`) — and the chart's own
  gate reads `if (!range || historyExhausted) return`
  (`src/components/features/futures/FuturesWorkstationChart.jsx:709`). Once
  set, nothing in a session clears it.
- **A failed futures history read leaves history loadable** ends: the operator
  "SHALL be told at the chart, and told until a read succeeds". The renderer
  implements that too: `readFailed` is raised in one place and lowered in
  exactly one other — `applyCandleHistoryPage`, which runs only when a page
  actually arrives.

So on a chart that has stopped asking, the notice can never be cleared, and it
says `Older candles could not be loaded — scroll again to retry`. The operator
did scroll again, repeatedly, with the link restored:

> «Включил снова прокси — свечи не загрузились, начал двигать, скроллить
> пытаться что-то делать с графиком — свечи не грузятся, вижу сообщение —
> Older candles could not be loaded — scroll again to retry.»

The same sitting shows the desk doing it right on the other market. Step 21,
Spot, same outage, same scroll: «свечи не загрузились, но когда я начал двигать
график вправо-влево — сразу же подтянулись». Spot's history lives on a
different path and recovers. Futures does not.

This is not a rendering slip. A notice that instructs an action the desk has
already made impossible is worse than no notice: it tells the operator the
market data is theirs to recover when it is not, and it does so at the moment
they are trying to read the market.

## What Changes

- Exhaustion stops being concluded from a run that contains a failure. A short
  page is still the start of history; a page that never arrived is not.
- The notice stops outliving the only event that clears it. Where the chart can
  no longer ask, the operator is told that — not told to scroll.
- The retry the notice names becomes a retry the chart will actually issue.

## Impact

- `src/hooks/useFuturesProductionWorkstation.js` — the latch and `readFailed`
- `src/components/features/futures/FuturesWorkstationChart.jsx` — the gate
- `src/components/features/futures/FuturesWorkstationView.jsx` — the notice
- Spec: `futures-workstation-presentation`, two requirements that today
  contradict each other in the one case where both apply
