# Futures Trading (Production spot-parity path)

Date: 2026-08-09

Futures and Spot share the same immediate `trade.*` command path but
authenticate with **separate credential pairs**. The old guarded Futures
subsystem and every runtime MOCK/fallback execution path are retired.

## Mandatory startup configuration

Each market has its own pair, so an API key carries only the permissions its
market needs:

| Market | API key | API secret |
|---|---|---|
| Spot | `BK` | `BS` |
| USDⓈ-M Futures | `BFK` | `BFS` |

Enable USDⓈ-M Futures permission on the **Futures** key only. Keep withdrawals
disabled on both keys and use an IP restriction where practical. Start the app
normally, for example:

```sh
BK=... BS=... BFK=... BFS=... npm run e
```

A market starts only when its own pair is complete. Neither pair is ever a
fallback for the other: the Futures adapter, the Futures user-data stream, and
the Futures workstation runtime are constructed from `BFK`/`BFS` alone, and the
Spot client and Spot trading adapter from `BK`/`BS` alone.

Per-market failure behavior:

- **One pair complete** — that market starts normally. The other market is
  disabled in the market switch, labeled with its missing variable names, and
  cannot be selected. Its adapter, stream, subscriptions, and workstation
  runtime are never constructed. A sliding alert names the market and the
  missing variables. There is no blocking screen.
- **Neither pair complete** — the app starts only its bounded local diagnostic
  transport, shows a sliding configuration alert plus a blocking restart
  screen, and creates no Binance client, authenticated adapter, REST request,
  exchange WebSocket, subscription, or synthetic execution acknowledgement.
- **Persisted workspace lost its credentials** — the neutral selector appears
  instead. The persisted value is retained, so fixing the environment restores
  that workspace on the next start.

**Migration from a single shared pair.** Before this change a single `BK`/`BS`
pair served both markets. After it, `BK`/`BS` serves Spot only. Provision a
Futures-permitted key, set it as `BFK`/`BFS`, and restart — otherwise Futures
appears disabled with `MISSING_CREDENTIALS` even though Spot works.

**Proxy and IP restriction.** Signed requests and streams for both markets use
the proxy from `https_proxy`/`HTTPS_PROXY`/`http_proxy`/`HTTP_PROXY`. When a
key is IP-restricted, the whitelist must contain the proxy's egress IP, and the
app must be launched from an environment where those variables are set —
otherwise traffic leaves from the direct IP and Binance answers `-2015`
(`Invalid API-key, IP, or permissions for action`) on every signed read.

There is no `USE_MOCK` mode and no Spot fallback. Old `FUTURES_TESTNET_*`,
`FUTURES_READ_*`, `FUTURES_PRODUCTION_*`, and `MOCK_WS_URL` names are not
credential alternatives; migrate operator launch configuration to the four
supported names and restart. Test fixtures and deterministic transports remain
isolated to automated verification and are not reachable from the Production
runtime graph. Safe-development and bounded-smoke entries clear all four
credential variables before preflight.

Two checks enforce that, and neither replaces the other. `npm run
check:runtime-mock` walks the production **source graph** from the real entry
points: it resolves relative, bare and aliased first-party specifiers, fails on
anything declared or called as a mock, fake, stub, synthetic, simulated or
dummy thing, fails on `Math.random()` outside a named allowlist of
identifier-minting files, and fails when the reachable module count drops below
a recorded floor — because a graph that silently stops being walked otherwise
reports success. `npm run check:electron-build-artifacts` inspects the **built
artifacts** instead. Source can be clean while a build pulls in a verification
composition, and a build can be clean while source drifts.

A third check guards the submission path itself. `npm run check:command-path`
fails if any renderer module outside `src/utils/tradingCommands.js` composes a
trading frame — a typed `trade.*`/`account.*` action, or one of the legacy
untyped `buyOrder`/`sellOrder`/`cancelOrder` requests. A second order-entry path
is how validation, command identity and the risk ceiling get bypassed, and an
unreachable one is no safer: the retired `buysell` helper in
`src/utils/operations.js` had no callers and still carried a local price-band
check the desk had deliberately delegated to Binance.

## Market activation and the local runtime

A market-scoped frame — a trading command, a subscription, an account refresh,
a workstation read — is accepted only while that market is the activated one.
Before `activate_market` there is no activated market, and after a switch the
market the operator left is not it; either way the frame is refused with
`MARKET_NOT_ACTIVE` and starts no work. `subscribeChannel` used to activate Spot
by itself, so a stray subscribe was enough to begin market work nobody asked
for.

Activation is acknowledged with its own envelope carrying a generation, and the
workspace mounts only after that acknowledgement names its market. A workspace's
children issue refreshes and subscriptions from their own effects; without the
acknowledgement, whether those reached the backend before their parent's
activation depended on effect scheduling and nothing else. Account reads carry
the activation generation they began under and are discarded if it has moved on,
so a Futures read already in flight cannot land on a desk that has switched
back to Spot. A market socket `connect` that resolves after its cleanup is
closed rather than adopted, so a torn-down connection is never revived.

The renderer's local transport address and session token are issued by the main
process, bound to the window before it is created, and never invented. A window
with no registered runtime receives **no runtime at all** and fails closed with
a stated reason. It used to receive `127.0.0.1:14477` with an empty token — a
real endpoint that answers `401` — so a window that could never authenticate
spent the session retrying every 500 ms and filling the log with
`invalid token`. That flood was this application's bootstrap race, not a Binance
failure.

An authentication failure is now terminal and distinguishable. A refused
handshake reaches the browser as an anonymous `1006`, indistinguishable from a
backend that has not started; the backend instead closes a wrong token with
close code `4401`, on a connection it accepts only in order to close. The
renderer stops, states the failure, and resumes only on an explicit operator
action or a fresh runtime (a reload). Ordinary transport losses keep retrying as
before — only authentication is terminal.

Retained verification uses `electron/env-setup.js` to pin the local transport
to port `14479`, distinct from a development instance, and a token belongs to
the runtime that minted it. A safe-development or bounded-smoke renderer
therefore cannot address a development backend.

## Workspace startup and switching

The app persists the last successfully selected `spot` or `futures-live`
workspace. On the next start it resolves that value before either market UI
mounts and loads that workspace first. The inactive workspace is code-split
and imported only when selected.

On a first run, unreadable storage, or an invalid stored value, the internal
state is `unselected`; the user sees the market selector and neither Spot nor
Futures starts. Switching markets tears down or generation-isolates the old
workspace's subscriptions, timers, pending requests, and updates. Previously
downloaded code may stay in the browser module cache, but its providers remain
unmounted.

## Account state, errors, and open orders

Futures account state is a versioned envelope with independent resources for
balances, positions, regular orders, ALGO orders, and the authenticated
user-data stream. Each resource reports `loading`, `ready`, `stale`, or
`error`, timestamps, a bounded sanitized error category, and retryability.
Last confirmed data remains visible during a failed refresh; a confirmed zero
USDT balance is therefore different from an unavailable balance.

Retryability is a statement, not a default. A permission failure (`-2014`,
`-2015`, 401, 403) and any other 4xx that is neither permission nor rate limit
are reported as non-retryable, because repeating the same request cannot
change the answer, and the ticket offers no Retry for them. Clock skew
(`-1021`), rate limiting (`-1003`, 429), network failures, and 5xx responses
stay retryable.

REST synchronization is account-wide:

- regular orders come from `/fapi/v1/openOrders`;
- conditional/strategy orders come from `/fapi/v1/openAlgoOrders`;
- balances and positions settle independently of either order source.

Regular and ALGO identities are source-qualified, so equal numeric IDs cannot
overwrite each other. User-stream failures mark confirmed order snapshots
stale until REST recovery. Regular LIMIT orders remain cancellable and
draggable. Unsupported ALGO interactions are explicitly display-only, while
their symbol, side, status, trigger price, and order kind remain visible in the
sidebar and on the chart.

`/fapi/v3/positionRisk` is only re-read on an account event, so open positions
are additionally marked to market from the public `<symbol>@markPrice@1s`
stream, subscribed for exactly the symbols currently holding a position. Mark,
size in USDT, unrealized PnL and return on margin follow that feed between
account snapshots; the feed is unauthenticated and costs no REST weight. The
subscription goes to the routed `/market/stream?streams=` path: the unrouted
`/ws` and `/stream` market paths were decommissioned on 2026-04-23 and answer
the handshake with a socket that stays open and never delivers a frame, which
on screen is indistinguishable from a market that is not moving. When the feed
disconnects, its marks are cleared rather than aged, and every row falls back
to the last account snapshot — the desk never shows a mark that has stopped
moving as if it were live. Silence is reported for the same reason: a socket
that opens and then delivers nothing for fifteen seconds is logged as stalled,
and its recovery is logged too. Position size is stated as a plain USDT
amount; direction is read from the side badge and the row accent.

### Position margin

Every position row states the margin committed to it, next to the ROE that is
measured against it. Both readings come from `describeFuturesPositionMargin`,
so the percentage and the amount it was divided by cannot disagree: the
isolated wallet the position holds, otherwise the initial margin the read
reports, otherwise — only for sources that still carry leverage, which
`/fapi/v3/positionRisk` does not — the notional divided by it. A read that
carries none of those shows no margin rather than a zero.

That read no longer reports `marginType` either, so the margin mode is taken
from the isolated wallet instead of inferred: isolating a position *is* walling
funds off behind it, and a cross position has none. The mode is then named in
words — `ISO` or `CROSS` on the row and in the position card, spelled out in the
panel — because the two are not two styles of one thing: only an isolated margin
can be moved at all.

Clicking the figure opens a panel at the cursor that adds margin to or removes
it from that one position, as `trade.adjustPositionMargin` →
`POST /fapi/v1/positionMargin`. It changes no notional, so the
`FUTURES_MAX_ORDER_USDT` ceiling deliberately has nothing to say about it —
capping a top-up could block the transfer that would have prevented a
liquidation. The panel refuses only what is a fact about the account: a
non-positive amount, an increase above the available USDT, a decrease above the
margin the position holds, a decrease that would take the position below its
maintenance requirement, and any adjustment to a cross position, which Binance
backs with the whole account and cannot assign to one row. Anything smaller than
that is Binance's to refuse, with its own code and text.

The panel draws the **liquidation floor** to scale: the maintenance requirement
the read reports, the margin standing above it, and a ghost segment for the
amount being typed. Every term is read from the exchange —
`marginBalance = margin + min(0, unrealizedPnl)`, and the buffer is that less
the maintenance requirement. Unrealized profit is excluded because it is not in
the wallet and cannot be withdrawn; unrealized loss is subtracted because it has
already been taken. The buffer moves by exactly the amount transferred: the
notional does not change, so neither does the requirement under it.

The amount is dragged on the order ticket's own size slider or typed. The two
directions are bounded by different facts, and the slider names which one it is
showing (`of 258426 available`, `of 2549 removable`): adding is bounded by the
wallet, removing by the buffer above the maintenance requirement. Capping a
top-up at the margin already committed made a wallet holding 258k offer the same
ceiling as a withdrawal, and an unnamed ceiling reads as a refusal. Typing past
the range stretches it.

Under the drawing the panel states the **liquidation price** and where the
transfer would put it — `54680.0 → 54180.0`, the projection coloured by whether
it helps or hurts. Margin does not change the size of a position, so every USDT
transferred buys exactly one contract's worth of price: `Δprice = amount ÷ size`,
away from the entry when adding and toward it when removing. It is labelled a
projection because the maintenance requirement is itself a share of the notional
at that price, which bends the answer by well under a percent of the move;
Binance sets the exact price. A position for which the exchange reports no
liquidation price falls back to stating the spare margin instead. The summary
also carries the **liquidation risk**, the maintenance requirement as a share of
the margin balance with liquidation at 100%, before and after.

That buffer is the point at which liquidation becomes *certain*, not the amount
Binance will release. The exchange's own limit is stricter — its leverage
brackets hold back more — and `/fapi/v3/positionRisk` reports no leverage to
reproduce it from. So the desk draws the floor, refuses anything past it, and
lets the exchange refuse the rest in its own words. A cross position gets no
buffer reading at all: that headroom belongs to the account, not to one row.

Pausing trading refuses a decrease and allows an increase: pausing exists to
stop risk being taken, and taking margin out takes risk. A transfer carries no
client order id the exchange would echo, so an unanswered one is reported as
unresolved and settled by re-reading the account, never by resending — a
repeated transfer moves the amount twice.

### Contract leverage

`/fapi/v3/positionRisk` reports neither leverage nor margin mode, so both are read
from `/fapi/v1/symbolConfig` (weight 5) and merged into the position rows by
symbol. The desk asks for the contract in hand whenever the contract changes
(`account.symbolConfig`), and for every symbol holding a position after each
account refresh, capped at eight. A leverage the exchange has not answered for is
absent, never `1×`: the badge reads `Lev` and the margin estimate states the full
notional, which overstates the cost rather than understating it.

The multiple is shown where it is decided, where it is carried, and where the
order goes: on the order ticket beside the contract, on each position row beside
its symbol, and — large, in the yellow the desk uses for liquidation readings —
on the confirmation panel, the last surface read before an order is sent. There
it is a reading and not a control (`LEV ?` where the exchange has reported no
multiple, never `1×`). The first two are the
control — clicking either opens a panel at the cursor with the stops Binance
offers (`1× … 125×`, filtered to the contract's own ceiling, which comes from
bracket 1 of `/fapi/v1/leverageBracket`), a slider, what the wallet can carry at
that multiple, the bracket's notional cap where the exchange reports one, and a
warning when a position on that contract is already open — raising leverage on an
open position moves the price it liquidates at. Applying sends `trade.setLeverage`
→ `POST /fapi/v1/leverage`; the panel then re-reads the config and the account,
because Binance lowers a setting a position is too large for rather than refusing
it, and the figure on screen must be the one it applied. Pausing trading refuses a
leverage change for the same reason it refuses a margin withdrawal.

**The desk's own default is 2× isolated.** A contract this desk has never traded
arrives carrying whatever Binance's account-wide setting left on it, which is how
an entry sized in USDT goes out at 20×. So when a contract's configuration is read
the desk brings it to `2×` and `ISOLATED` — `trade.setLeverage` and
`trade.setMarginType` (→ `POST /fapi/v1/marginType`) — under four rules:

- **Only downwards.** A contract at `1×` or `2×` is left alone; the desk never
  raises a multiple the operator did not ask it to raise, and the contract's own
  bracket ceiling still bounds it.
- **Never on an open position.** A contract carrying a position is untouched:
  changing its leverage moves the price it liquidates at.
- **Not the mode while an order rests.** Binance refuses a margin-mode change on
  a contract with working orders, so the desk does not ask; the multiple is still
  lowered, and the mode follows once the order is gone. Nothing is sent at all
  while trading is paused — a default applied then would arrive as refusals.
- **Not on a reading that is not current.** Nothing is sent unless the position
  resource is `ready`: a snapshot held from before a dropped connection is a
  reading, not a confirmation, and a contract that went into a position while the
  desk was disconnected would read as flat.
- **Once per contract per session.** Raising it back to `10×` afterwards is the
  operator's decision and stands, including after switching contracts and
  returning. Restarting the app is what re-arms the default.

Binance answers a mode the contract is already in with `-4046` ("no need to change
margin type"); that is the state the desk asked for, so it is reported as held,
not as a failure.

The order ticket states **Est. margin** for the draft — `notional ÷ leverage`,
what the entry actually holds out of the wallet. Order sizing itself is
deliberately still measured against the available balance rather than against
balance × leverage: the ticket's 100% is a position worth the wallet, not one
worth twenty of them.

### Closing a position

`Close` on a position row opens a panel at the cursor. `Close at market` sends the
whole position as a reduce-only MARKET order in one click. Size is dragged on a
slider in percent of the open position — quantised to the contract's step size,
held as integers so a 100% close is exactly the position and never a hair over
it — or typed as a quantity, and the two always agree. The summary states what the
exit settles: what is left holding, the value coming off the table, and the
estimated PnL at that price (`(exit − entry) × size`, signed by the leg), which
for a limit close is measured at the limit rather than at the mark. Fees are not
included and the panel says so.

Configuration, account-resource, stream, and command failures feed the sliding
notification system. Identical retries are deduplicated; recovery re-arms the
same alert for a later recurrence. The ticket retains detailed state and a
Retry action after a toast is dismissed.

## Execution outcomes

A trading command ends in one of three states, and the desk never blurs them.

**Accepted** and **refused** are what they sound like: Binance answered. A
refusal shows its own code and message alongside the local one.

**Unconfirmed** is the third. A request timeout, a socket reset mid-flight, or
an exchange-side 5xx means Binance never said whether the order executed —
Binance's own documentation states that an HTTP 503 *may* have succeeded. Such
an outcome is presented as unconfirmed, in amber, and never as a failure,
because a failure invites the resubmission that creates a second real order.
The desk then asks the exchange what actually happened, looking the order up by
the client identity the command carried, with bounded retries:

- the order exists → its execution report becomes the outcome and the account
  is re-read;
- Binance states the order does not exist → nothing executed, and it is
  reported as an ordinary refusal the operator may act on;
- the lookup itself keeps failing → the outcome stays unconfirmed, with **no
  retry control at all**. Check the order on Binance before acting.

A connection that never opened (`ECONNREFUSED`, DNS failure) is a plain
failure, not an unconfirmed outcome: nothing could have executed.

Every command carries one client identity per operator intent, sent to Binance
as the client order id on **both** markets — Spot used to drop it — so a
resubmission of the same intent is recognisable to the exchange. A command that
never left the renderer is held and resent as the same object, identity
included, rather than rebuilt.

Reconciliation after a trade cannot be lost. A refresh asked for while one is
running is queued rather than discarded, and every account snapshot carries the
mutation epoch it began under, so a read that started before a place, amend or
cancel is dropped instead of restoring the state that command replaced. This is
what used to make the panel need a Ctrl+R after editing an order.

Failed Spot placements and cancellations reach the operator as a pinned banner
that stays until dismissed. They previously reached only the application log.

## Readiness and order entry

The ticket derives one fail-closed readiness state from credential startup,
local transport, operator pause, the selected Production contract and exact
filters, balance freshness, available USDT, draft validity, and the optional
local order cap. This state drives the heading, labels, sizing controls,
buttons, gestures, feedback cards, and alerts.

The size slider represents order notional in USDT. Price and quantity are
snapped to Binance tick size, step size, quantity range, and minimum notional
before submission. Chart/order-book gestures submit immediately and always
show either an acknowledgement or a concrete `NOT sent` reason.

Local pre-validation stops at what makes an order submittable — tick size, step
size, quantity range, minimum notional — plus the risk ceiling. `minPrice`,
`maxPrice`, the percent-price band and the maximum open order count are
deliberately **not** evaluated locally: they are the exchange's filters, and
Binance applies them itself. A draft outside them is sent, and the refusal is
presented with the code and message Binance returned, so a band rejection reads
differently from a ceiling rejection. One evaluator
(`src/utils/futuresOrderDraft.js`) decides every submission, so the ticket, the
order editor, the chart drag and the position closer refuse the same draft for
the same stated reason.

Closing a position opens a draggable panel offering either an immediate
reduce-only MARKET order or a reduce-only LIMIT order at a chosen price, for
the whole position or a smaller size. The exit side is always derived from the
position's signed quantity, never from the size that was typed, and a size
larger than the open position is refused before anything is sent.

A confirmed execution report outranks an older account snapshot: Binance's
order snapshot is a separate, eventually consistent service, and the one
fetched immediately after an amendment can still describe the previous size.
Both carry the exchange's update time, so the newer of the two wins per order
and an amended size appears without a manual refresh.

Dragging a regular LIMIT order line with Ctrl/Alt **lifts the order off the
book**: the cancellation is sent when the drag begins, and the drag starts only
once Binance confirms it. A refused cancellation leaves the order working where
it was and states why; an unconfirmed one starts nothing and is presented as
unconfirmed, so the operator is never told the order is gone when it may not be.

From the confirmed cancellation the desk owes an order, and discharges that
obligation in exactly one of three ways:

- the drop places the replacement at the new price, through the placement path
  with its ceiling and filter checks;
- abandoning the drag — releasing the modifier, cancelling the pointer, dropping
  at the price it started from, or changing contract mid-drag — places it again
  at the price it was lifted from;
- neither could be placed, and an alert over the workspace names the order that
  is gone, gives the reason, and carries the control that places it again. An
  unresolved placement offers no such control: a second attempt on an unknown
  outcome is how two real orders end up resting.

The replacement carries what was still working (original quantity less what
filled) and the order's own `reduceOnly` and exchange `positionSide`. While it
is in flight the chart draws the level as uncovered — a dashed mark reading
`placing…` — rather than as an order that is not there yet.

This accepts a window with no order on the book, and accepts that an interrupted
session (a crash, a closed window) leaves the order cancelled. The operator chose
this shape knowing both; the mitigation is that the obligation is impossible to
miss, not that the window is hidden.

Repricing by **typing** still uses Binance's native amendment (`PUT
/fapi/v1/order`, typed action `trade.replaceOrder`, futures only): the amend
panel is one call, so a rejection leaves the order exactly where it was. That is
why the panel keeps the amendment and the drag does not.

Two lightweight backend protections remain:

- `FUTURES_MAX_ORDER_USDT=<positive number>` caps every exposure-increasing
  order on every path that can create one: a new order, an amendment from the
  order editor, the replacement a Ctrl/Alt drag places, and a limit close sent
  without `reduceOnly`. An amendment is measured against the notional it will
  *leave working* — its new price against the quantity it will carry — not the
  one it had. A drag is refused before it lifts anything when the order could
  not be placed again at the price it is already resting at: an order the desk
  could not put back is one it must not take off the book. The cap is broadcast to the UI and evaluated again in the main process
  on the command as received, so a frame that never passed through the
  interface is refused just the same. An oversized entry shows `RISK CAP`;
  sizing controls remain usable so the amount can be reduced, and reduce-only
  exits are exempt so a position can always be closed. Whether an amended order
  is reduce-only is read from the desk's own view of the book, not from the
  command.
- `Pause trading` blocks new Futures placements in memory until Resume.
  Cancels remain available, and an application restart clears the pause.

## Chart and bounded tape

The chart carries only what a decision needs: contract candles and volume, the
operator's drawings and alerts, the operator's orders, and the open position's
entry and liquidation prices. The MARK overlay, the INDEX overlay and price
line, the INDEX header field, and the price-axis marker for the working price
draft are all removed; mark price is still consumed by the header, positions,
and risk display.

Each order handle shows its leg (`LONG`/`SHORT`), its notional in USDT, and a
cancel control, coloured by side — BUY green, SELL red — because one-way
accounts report `positionSide: BOTH` for every order. The exact resting price
stays on the price axis. Dragging a handle with Ctrl/Alt lifts the order off the
book and places it again where it is dropped — while it is dragged it is drawn
once, at the pointer, with one faint unlabelled mark at the level it came from;
double-clicking it, double-clicking a row in the Orders tab, or clicking a
working-order row in the dock opens the same draggable editor for price and
USDT amount, which applies both as one amendment and closes on an outside click
or Escape. Exchange-managed conditional orders stay display-only everywhere.

The default interval is `15m`. The instrument rail lists contracts by recency,
then favourites, then alphabetically, and the workstation reopens on the last
traded contract. Recency is local state, so the rail lists the persisted recent
contracts — marked `recent` until the catalogue confirms them — from the first
frame after a restart, and says when the catalogue is still loading. Interface
scale is adjustable in the header (persisted), and `Ctrl +` / `Ctrl -` /
`Ctrl 0` zoom the whole window (persisted in `userData/window-zoom.json`).

The market header carries last price, 24h change/high/low/volume and funding
coloured by sign. Mark price and basis are not repeated there; mark price
remains in the position rows and the risk display.

The day's volume is the **quote** leg (`quoteVolume`, `q` on the stream),
abbreviated by magnitude and labelled in USDT: `641.1M`. The base leg is the
same day counted in contracts, and a USDT abbreviation over it overstates the
market by whatever the contract is priced at — BMT reads `19.9B` of BMT against
`571M` of USDT. Both legs stay in the cell's title, each with its unit named.

The order book is denominated in USDT: each row shows the level's value and the
cumulative value from the top of the book, computed with exact decimal
arithmetic. `Step` groups levels by a multiple of the contract's tick size —
bids round down to the boundary, asks round up — and 50 levels per side are
delivered so a coarse step still reaches deep. The row between the two sides is
the last print, coloured by the side that lifted it; `Spread` and the raw
`lastUpdateId` are gone. Under the book, a two-colour bar states the split
between resting buy and sell value (`B 63.21%` / `36.79% S`), measured in USDT
across exactly the levels on screen — so a coarser step widens the range the
reading covers — and hidden entirely when neither side has resting value.

Account-side prices — position entry, mark, liquidation, and history rows — are
rendered at the contract's tick precision, so an averaged entry price arrives as
`3.3450` instead of `3.3449999999999998`. Return on margin is derived from the
margin Binance reports (`initialMargin`, then `isolatedMargin`); when neither is
reported it reads `—` rather than `0.00%`. `/fapi/v3/positionRisk` returns
neither leverage nor margin mode, so both are read from `/fapi/v1/symbolConfig`
instead (see *Contract leverage*).

`Order history` and `Closed positions` in the dock read `/fapi/v1/allOrders` and
`/fapi/v1/userTrades` through the typed `account.history` command, bounded to the
most recent 100 rows per contract.

Both span the **account**, not the contract on screen: a session is reviewed
whole, and half of it was traded on pairs the operator has since switched away
from. Every USDⓈ-M history endpoint requires a symbol, so the backend first asks
which contracts were traded — `/fapi/v1/income?incomeType=REALIZED_PNL` over the
last seven days, the only read that answers without being told a contract — and
then fans out over at most eight of them: the contract on screen, then the ones
holding positions or working orders, then the rest by recency. Anything dropped
by that bound is logged. Each read is admitted by the futures limiter, one
contract failing removes only its own rows (the payload reports which contracts
it covers), and only a total failure is reported as an error. Every row names its
contract and is priced at that contract's own tick.

`Closed positions` reports finished round trips, not executions and not open ones.
`buildFuturesTradeRounds` folds the fills of each contract — separately, since one
contract's exposure says nothing about another's — into round trips: a position
opens when exposure is taken and closes when it returns to flat, so one market
close arriving as five fills is one row carrying the summed PnL and fees. Sizes
are held as integers, because `0.1 + 0.2 − 0.3` is `5.5e-17` in floating point and
a round that never reaches flat swallows every fill after it. A round still
running is excluded entirely: it has no exit and no result, and the live positions
table above is where it belongs. A round whose opening fills are older than the
window keeps its entry price all the same — the exchange's realized PnL states it
exactly (`entry = exit ∓ pnl/size`, realized PnL being reported before
commission), and the row says in its title that the entry was recovered rather
than read. The fee is stated in the PnL cell's title together with the net.

A failed history read is reported inside the history view only: positions,
working orders and balances are never disturbed by it.

The bounded tape filters and coalesces trades before renderer delivery. Its
component-lifetime settings survive symbol and interval changes:

- throttle: enabled by default;
- timeout: `250 ms` by default, accepted range `16..5000 ms`;
- minimum trade notional: `0 USDT` by default, meaning no filter.

Eligibility uses exact decimal `abs(price) × abs(quantity)` and includes a
trade equal to the threshold. Filtering happens on ingestion, so the bounded
buffer accumulates only trades at or above the threshold and a stream of small
prints cannot evict the large ones. Lowering the threshold therefore reveals
new eligible trades rather than restoring past ones. With
throttling enabled, the first changed bounded payload is emitted immediately
and the newest trailing state is emitted at most once per timeout window.
Raw-trade freshness still advances for filtered trades. Pending emissions are
generation-guarded and cleared on configuration changes, symbol changes,
resync/reconnect, unsubscribe, stop, and disposal. Disabling throttle does not
disable the USDT filter or the renderer row bound. Tape Pause/Resume remains
independent of these upstream settings.

## Security and troubleshooting

Renderer envelopes and logs contain bounded error codes/messages only. API
keys, secrets, signatures, signed query strings, and raw authenticated response
bodies must never be logged or sent to the renderer.

If Futures is not `READY`, use the displayed reason:

- `CONFIG`: set the complete Futures pair `BFK`/`BFS` and restart;
- `OFFLINE`: restore the local backend connection;
- `BALANCE`, `STALE`, or `SYNC`: inspect the resource card and Retry;
- `FUNDS`: Binance confirmed zero available USDT;
- `CONTRACT` or `METADATA`: wait for current Production `exchangeInfo` or pick
  an active USDⓈ-M perpetual;
- `RISK CAP`: reduce the USDT notional or deliberately change the operator cap;
- `PAUSED`: Resume when new placements are intended.

Command rejections carry the Binance error code and, where the fix is known, an
explicit remedy. In particular `-2015 Invalid API-key, IP, or permissions for
action` on a place/cancel/amend means the `BFK`/`BFS` key is refused for
*trading* even when account reads keep working: enable **Futures** on that key
in Binance API Management, and if the key is IP-restricted, whitelist the
machine's current outbound address.
