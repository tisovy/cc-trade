## Why

When the market data resynchronizes, the desk stops letting the operator trade
— and the exchange had nothing to do with it.

Order entry does not depend on the market-data path at all. Commands travel the
local transport to the main process and reach Binance through the trading
adapter; the workstation service is display-only. Yet the renderer disarms the
operator whenever the display is not live:

- `onTradingGesture`, `onOrderLift` and `onPricePick` are handed to the chart
  only while `candlesState === 'live'`
  (`src/components/features/futures/FuturesWorkstationView.jsx:768`);
- every order-book level is `disabled={depthState !== 'live'}` (`:844`, `:882`);
- a resync marks every resource of the session non-live, so all of the above go
  dead together.

So a burst of market data — the exact condition in which a position needs
managing — takes away the price-picking, the chart gestures and the book
clicks, while the ticket's own buttons and the cancel controls keep working.
The operator loses the fast paths and keeps the slow ones, at the worst moment,
because of a display state.

A resync is the rare trigger. The 2026-08-12 verification pass found the common
one: **a quiet market**. On TBTUSDT the chart went `STALE` about ten seconds in
and stayed there for as long as the operator watched. Nothing had failed — the
socket was up, the book was live, the header was live. Nobody had traded, so the
kline stream had nothing to send, and `CANDLES_MS` is a flat `5_000`
(`electron/services/futures-production-workstation-service.js:40`). A market
with no prints is indistinguishable, to that check, from a feed that died.

That makes this the ordinary resting state of every thin contract on the desk,
not an edge case during a burst — and it is precisely on thin contracts that
picking the exact level matters most. The desk currently answers "is this
reading current?" and then uses the answer to decide "may the operator act?".
Those are two different questions, and only the first one is a display's to
answer.

The gate is not wrong in spirit: acting on a price that is no longer real is
how an operator fills at a level that has moved. It is wrong in mechanism.
A stale chart still shows the price it last had, and the operator can see how
old it is; a desk that refuses the click is deciding for them, and deciding
badly, because the alternative it leaves them is a typed price against the same
stale reading.

## What Changes

- **A market-data state never disarms order entry.** Picking a price, the chart
  gestures and the book's own levels stay available while the data is stale,
  disconnected or resynchronizing.
- **What is not live says so where it is acted on.** A price taken from a
  non-live reading is marked as such on the way in — on the ticket's price
  field and on the confirmation panel — so the operator confirms a price they
  know the age of, rather than one that merely looks current.
- **Only genuinely unusable readings refuse.** A chart or book that has never
  received data has no price to pick, and that is the only case where the
  control has nothing to act on.
- **The confirmation states the age.** The panel already carries what the order
  is and what it does to the position; it gains how old the price it was taken
  from is, counted up while the panel is open rather than frozen at staging.
- **A quiet market is called quiet.** When the transport is still proven live
  and only one stream has gone silent, nothing has failed and the desk says so.
  `STALE` is kept for a reading the desk cannot vouch for.
- **The chart is not hidden by the state it is in.** A reading that is merely
  old is stated in the corner with its age; the full-cover overlay is kept for
  the one case that genuinely has nothing to show — a chart with no candle on
  it at all.

## Trade-offs this accepts

- The operator can act on a stale price. That is the point: they can already
  type one, and the desk should tell them what it knows rather than take the
  control away. The mitigation is that the age is stated at the moment of
  confirmation, not that the action is blocked.
- "Quiet" is inferred, not reported by the exchange: it means this desk's
  transport is proven live while one stream is silent. That is the strongest
  statement available from the renderer, and it is weaker than a heartbeat the
  exchange does not send. It is stated as what it is — a reading with an age —
  and never as a promise that the price is current.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: a market-data outage no longer disarms
  the operator.

## Impact

- `src/components/features/futures/FuturesWorkstationView.jsx` — the gates on
  gestures, price picking and book levels, and the overlay that covers the
  chart.
- `src/utils/futuresPriceReading.js` (new) — what a picked price remembers about
  where it came from, and how an age is read.
- `src/components/features/futures/FuturesProductionWorkstation.jsx` — carries
  the reading beside the draft price it already carries.
- `src/components/features/futures/FuturesTradingTicket.jsx`,
  `src/components/features/futures/FuturesOrderConfirmation.jsx` and
  `src/utils/futuresOrderConfirmation.js` — the age of the price a submission
  carries.
- Nothing in `electron/` changes: the freshness windows stay where they are, and
  the renderer stops treating them as permission.
- Related: `hold-the-book-through-a-spike` removes much of *why* the desk
  resynchronizes; this change removes what it costs when it still does. Neither
  replaces the other.
