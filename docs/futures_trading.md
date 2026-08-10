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
runtime graph. Safe, smoke, and end-to-end entry points clear all four
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

A verification run is its own runtime: `electron/env-setup.js` pins the local
transport to port `14479`, distinct from a development instance, and a token
belongs to the runtime that minted it. A parallel end-to-end run therefore
cannot address a development backend.

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
funds off behind it, and a cross position has none.

Clicking the figure opens a panel at the cursor that adds margin to or removes
it from that one position, as `trade.adjustPositionMargin` →
`POST /fapi/v1/positionMargin`. It changes no notional, so the
`FUTURES_MAX_ORDER_USDT` ceiling deliberately has nothing to say about it —
capping a top-up could block the transfer that would have prevented a
liquidation. The panel refuses only what is a fact about the account: a
non-positive amount, an increase above the available USDT, a decrease above the
margin the position holds, and any adjustment to a cross position, which
Binance backs with the whole account and cannot assign to one row. The exact
removable amount is Binance's to decide — it is smaller than the committed
margin by the maintenance requirement — and its refusal is shown with its own
code and text.

Pausing trading refuses a decrease and allows an increase: pausing exists to
stop risk being taken, and taking margin out takes risk. A transfer carries no
client order id the exchange would echo, so an unanswered one is reported as
unresolved and settled by re-reading the account, never by resending — a
repeated transfer moves the amount twice.

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

Dragging a regular LIMIT order line with Ctrl/Alt reprices it through Binance's
native amendment (`PUT /fapi/v1/order`, typed action `trade.replaceOrder`,
futures only). The amendment keeps the original quantity and is a single call:
a rejected move leaves the order untouched at its previous price, and the
account state is resynchronized so the chart line snaps back. Moves are never
composed from a cancel plus a re-place, which could cancel successfully and
then fail to re-place, leaving the trader unintentionally flat.

Two lightweight backend protections remain:

- `FUTURES_MAX_ORDER_USDT=<positive number>` caps every exposure-increasing
  order on every path that can create one: a new order, an amendment from the
  order editor, a Ctrl/Alt drag on the chart, and a limit close sent without
  `reduceOnly`. An amendment is measured against the notional it will *leave
  working* — its new price against the quantity it will carry — not the one it
  had. The cap is broadcast to the UI and evaluated again in the main process
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
stays on the price axis. Dragging a handle with Ctrl/Alt reprices the order;
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
neither leverage nor margin mode, so neither is displayed.

`Order history` and `Trades (PnL)` in the dock read `/fapi/v1/allOrders` and
`/fapi/v1/userTrades` for the selected contract through the typed
`account.history` command, bounded to the most recent 100 rows. Trades show the
fee and the signed realized PnL. A failed history read is reported inside the
history view only: positions, working orders and balances are never disturbed
by it, and history is discarded when the contract changes.

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
