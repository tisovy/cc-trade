## Why

Three readings of the same panel, one screenshot.

**The last price stands still while the book runs.** The row between the two
sides reads `liveTrades[0]` — the first row of the *tape*. The tape is not a
price feed: the service filters it on ingestion by the operator's
`minNotionalUsdt` and only arms its throttle timer when an **eligible** print
arrives. With the desk set to `≥ 400 USDT / 250 ms`, a contract whose flow is
mostly small prints emits no tape frame at all — for seconds, or for minutes.
Meanwhile depth arrives at `@depth@100ms`, klines at 250 ms and the ticker at
500 ms, all unfiltered. So the chart moves, the book empties and refills, and
the number between them is frozen. It is not lag. It is the operator's display
filter being read as if it were the market.

**The rows that matter are the ones clipped off.** `.futures-workstation-depth`
is a stretched grid item ~430 px tall; its content wants ~578 px. The two book
sides are flex items with `max-height: 200px` and `overflow: hidden`, so the
shortfall is taken out of them by flex shrink: each renders fourteen rows into
about 122 px of box and hides the last five. On the bid side that drops the far
levels. On the **ask** side the rows are reversed — index 0 is the *farthest*
ask — so the five hidden rows are the five **best asks**, the side of the book
closest to the price about to trade. The panel shows the least useful half of
the sell side and cuts the sixth row in half to say so.

**There is no way to look deeper without coarsening.** The only depth control
is the grouping step, and a step is a trade: to see further the operator gives
up resolution. Binance solves this with a display mode — combined, bids only,
asks only — which gives one side the whole panel and roughly twice the levels
at the same step.

## What Changes

- The last-print row reads the **close of the newest live candle**, falling back
  to the ticker's `lastPrice` and only then to the tape. That is the same number
  the chart is drawing, at the same 250 ms cadence, and no tape setting can
  filter it. The market header's `Last`, the step-share readout and the pressure
  reach reference are sourced from it too, so one price is on screen, not three.
- The row is tinted by the **direction of the change** rather than by the maker
  flag of whatever print happened to be first in a filtered tape, and carries an
  arrow so direction is not conveyed by colour alone.
- The book renders **as many whole rows as the panel can hold** and no more,
  measured from the panel rather than assumed. Nothing is half-drawn and nothing
  is clipped; the asks sit against the last-price row so the best asks are the
  ones on screen.
- Row height follows the interface scale, which it did not: at 150% the type
  grew and the 14 px row did not.
- A three-way **side control** — both, buy only, sell only — sits on the same
  line as the step, reclaiming the row it costs. One side alone gets the whole
  panel, so the same step reaches about twice as far.
- The buy/sell split keeps being measured over a **symmetric window**: both
  sides, at the row count the visible side shows. In one-sided mode that window
  is deeper, and the `±X%` beside it is what says so.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the last traded price has a source the
  tape cannot filter; the book renders whole rows only, sized to the panel; the
  book can be read one side at a time.

## Impact

- Renderer only: `src/components/features/futures/FuturesWorkstationView.jsx`,
  `src/components/features/futures/FuturesWorkstation.css`.
- No protocol change, no new stream, no additional exchange traffic: every
  number the panel now reads was already being delivered and thrown away.
- The measurement is one `ResizeObserver` on the book body. Where it is
  unavailable — jsdom, a panel that has not been laid out — the fourteen-row
  default stands, so the panel degrades to today's behaviour rather than to an
  empty book.
