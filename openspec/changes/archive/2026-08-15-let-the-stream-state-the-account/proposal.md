## Why

The operator asks why the desk reads the account over REST at all when the
authenticated stream already reports it, and answers the question themselves:
REST is for a break, a failure, or something the desk did not expect.

They are right about what the desk does. The working orders were moved onto the
stream already — an execution report is folded straight into the held set. The
wallet and the positions were not. Every `ACCOUNT_UPDATE` is used as a *signal*
that something changed and then thrown away, and the desk asks Binance over REST
for the very numbers the event just carried:

- `ACCOUNT_UPDATE` → read balances and positions (weight 10)
- an execution report reporting a fill → read balances and positions again
  (weight 10), for a change the `ACCOUNT_UPDATE` that accompanies the same fill
  already stated

So a single fill costs two passes and four signed requests, and — this is the
part the operator feels — the position on screen does not move until the second
of them answers. The desk's own record puts one signed read at 340–800 ms
through the operator's proxy. The exchange said what happened in a frame that
arrived in single-digit milliseconds, and the desk showed it most of a second
later.

## What the stream cannot say

`ACCOUNT_UPDATE` carries the wallet balance, and per position the size, the
entry price, the margin mode and the isolated wallet. It does not carry the
**liquidation price**, the margin a position commits, or the **free margin** an
order is sized against. Binance publishes none of those on a socket.

They could be computed — liquidation from the maintenance-margin brackets, free
margin from the wallet less every position's and every resting order's initial
margin. This change does not compute them. A liquidation line drawn from the
desk's own arithmetic is wrong in exactly the conditions that matter, and it is
wrong silently. They are read from the exchange instead — but only those, only
when the fold moved something they depend on, and coalesced so a burst costs one
read.

There is a second gap in the same place: placing or cancelling an order locks or
releases margin, which changes the free margin, and the exchange sends no
`ACCOUNT_UPDATE` for it. Since the previous change stopped reading the account
back after a command, the sizing budget has been able to drift. The same
coalesced read closes it, at weight 5 instead of 90.

## What Changes

- **An `ACCOUNT_UPDATE` is folded, not used as a doorbell.** The wallet balance
  it states and each position's size, entry, margin mode and isolated wallet are
  applied as the frame arrives. A position it reports at zero leaves the set.
  The screen moves with the exchange's frame, not with a read that follows it.
- **A fill issues no read of its own.** The `ACCOUNT_UPDATE` for the same fill is
  what carries the wallet and the position.
- **Only the unstated values are read back, and only when they moved.** A
  position whose size changed needs its liquidation price and margins; an order
  placed or cancelled needs the free margin; a funding fee that only moves the
  wallet needs nothing. The reads are coalesced into one pass a few hundred
  milliseconds later, and the held reading stays usable throughout.
- **Every account read states its reason, and the record keeps it.** The
  reason was already required by `futures-order-visibility`; now the code carries
  it and the day's summary reports how many reads went out, for what, and at what
  weight — which is how the operator can check that this change did what it says.

## Trade-offs this accepts

- A position that opens is on screen before its liquidation price is. The LIQ
  line appears when the backfill answers rather than with the row. Drawing it
  from a locally computed number would put it there immediately and sometimes
  wrongly; an absent line is honest and a wrong one is not.
- The desk now trusts a frame it cannot re-verify for up to thirty seconds. It
  already does exactly this for working orders, and the periodic beat is what
  corrects a frame that was missed.
- A command is once again followed by a read — of the balances alone, weight 5,
  coalesced, and never gating the screen. This is a deliberate step back from
  "no read after a command": free margin moves when an order locks margin, and
  nothing states it but a read.

## Capabilities

### Added Capabilities

- `futures-live-readiness`: the account moves with the stream that reports it,
  and only what the stream cannot state is read back.
- `desk-diagnostic-record`: an account read is recorded with its reason and its
  weight.

## Impact

- `electron/services/futures-trading-adapter.js` — `ACCOUNT_UPDATE` is read into
  a shape the desk can fold, instead of into a boolean.
- `electron/services/futures-account-state.js` — folding it, and naming what it
  could not state.
- `electron/services/binance-connection.js` — the fold, the coalesced backfill,
  and the reason every read now carries.
- `electron/services/desk-diagnostic-record.js`, `scripts/read-desk-record.mjs`
  — the `read` event and how the summary reports it.
