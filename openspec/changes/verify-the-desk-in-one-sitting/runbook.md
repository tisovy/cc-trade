# The operator verification pass

One sitting, front to back. Roughly forty minutes. Read this page once before
starting so nothing is a surprise.

## What you need

- The desk running on the live Production account (`npm run e`).
- A note somewhere to write one line per step. The line is the point of the pass:
  a step nobody wrote down did not happen.
- A liquid contract you are willing to trade at the exchange minimum. BTCUSDT is
  the safe default because its minimum notional is small relative to its
  liquidity.
- Access to the local proxy (`127.0.0.1:1080`). Stopping it is how the pass cuts
  the desk off from Binance without touching anything else — the desk's own
  internal socket keeps running, so the application stays alive and honest.

## What it will cost

Steps 1 to 9 place nothing and cost nothing. Steps 10 to 13 place real orders at
the exchange minimum; two of them are meant to be cancelled unfilled, one is
meant to fill. Expect a few cents of fees. Every step that touches money says so
in its own first line.

## How to record a step

For each step write one of:

- `PASS` — you saw what the step says you should see.
- `FAIL — <what you saw instead>` — write the actual reading, not a judgement.
- `NOT OBSERVABLE — <why>` — the situation would not arise.

At the end, hand the whole list back to the session working on this repository.
It goes into the live-verification ledger, and the confirmation items in the
eight changes are checked from that record.

---

## Part 1 — Startup, read-only

### Step 1. The desk comes up on Futures

Start the desk. Select the Futures workspace.

**Look at:** the ticket's account state — balances, positions, working orders,
ALGO orders, and the user-data stream.

**Should be:** all five reach a ready state. Nothing says "not read" after a few
seconds.

**If one does not:** write down the exact code shown (for example `-2015`). A
code on *all* of them means credentials, key permission or the IP restriction on
the key. A code on ALGO orders alone means the ALGO endpoint or its permission —
that distinction is the main thing this step is for.

*Closes:* `verify-live-futures-account-read` 1.2 and 1.3.

### Step 2. The workstation is alive

**Look at:** the chart draws candles, the order book fills both sides, the tape
prints trades.

**Should be:** all three moving. This is the fix from 2026-08-10 — every
workstation request was being rejected as malformed, and these three panels
stayed empty.

**If empty:** the desk is broken again; stop the pass and say so.

*Closes:* `isolate-markets-and-runtime` 8.6 confirmation.

### Step 3. Switching markets does not start a storm

Switch Spot → Futures → Spot → Futures, without waiting between switches.

**Look at:** the terminal the desk was started from.

**Should be:** a handful of lines. No wall of repeating `[market-gate] Refused …
generation N is superseded by N+1`, and no growing number.

**And:** the workspace you land on works — chart and book fill again.

*Closes:* `isolate-markets-and-runtime` 8.5 and 8.8 confirmation.

### Step 4. Orders on other contracts stay listed

Have at least one working order on a contract other than the one on screen (if
you have none, this step is done after step 10 — come back to it).

Switch the selected contract.

**Should be:** the order on the other contract is still in the working orders
list. The list is the account's, not the contract's.

*Closes:* `verify-live-futures-account-read` 1.4.

### Step 5. The dock says what it does not know

Open the portfolio dock's history views once (`ORDER HISTORY`, then `CLOSED
POSITIONS`).

**Look at:** what is shown before the rows arrive, and what the counts say.

**Should be:** while nothing has been read, the panel says it has not read the
account — not "0 open" or "No open positions". A count it does not know shows as
`—`.

**Note also, for the record:** how long each tab takes to load, and whether
switching between them reloads from scratch. This is the defect
`hold-the-history-the-desk-has-read` is about; you are recording the "before",
not testing a fix.

*Closes:* `say-which-readings-are-stale` 5.2, first half.

---

## Part 2 — With the exchange cut off

These steps stop the local proxy so the desk cannot reach Binance. The desk
itself keeps running. Nothing is placed and nothing is at risk; the only
consequence is that the desk cannot read the account until the proxy is back.

**Before you start:** make sure you have no position you would need to close in
the next two minutes.

### Step 6. Cut the exchange off

Stop the proxy on `127.0.0.1:1080`.

Wait about thirty seconds, watching the desk.

### Step 7. A frozen price is not presented as the market

**Look at:** the mark price and the unrealized PnL on any open position, and the
terminal.

**Should be:** the terminal reports that the mark price stream delivered nothing
for 15s. Position values fall back to the last account reading rather than
sitting on a mark that stopped moving. Nothing on screen claims a current market
price it does not have.

*Closes:* `say-which-readings-are-stale` 5.2, second half.

### Step 8. The account read fails out loud

**Look at:** the ticket and the dock.

**Should be:** the account resources say they failed — with a code — rather than
showing their last values as current. The order-size control refuses to size and
says why.

**Write down:** the exact wording of the refusal. It should name the reason, not
just refuse.

### Step 9. A failed history read does not lock the chart

Still cut off, scroll the chart to the left until it asks for older candles.

**Should be:** a message that older candles could not be loaded.

Now restore the proxy. Wait for the account to be read again (a few seconds).

Scroll left again.

**Should be:** it loads. Before the fix, one failed read disabled scrolling left
for the rest of the session.

**Note:** this is the Spot chart. The Futures chart has the same defect and is
not fixed yet — if you are on Futures, do this step on the Spot workspace.

*Closes:* `keep-the-chart-loadable` 6.2.

---

## Part 3 — With real orders

From here the desk places real orders. Each step says what it exposes.

### Step 10. What was confirmed is what is sent

*Exposure: one limit order at the exchange minimum, far from the market, meant
not to fill. You cancel it at the end of the step.*

1. Choose a size on the ticket.
2. Start an order and read the confirmation panel. **Write down the quantity and
   the price it shows.**
3. Leave the panel open for ten to fifteen seconds — long enough for at least one
   account refresh to land underneath it.
4. Confirm.

**Should be:** the order that appears in the working orders list has exactly the
quantity you wrote down. Not a recalculated one.

5. Cancel the order.

*Closes:* `send-only-the-confirmed-order` 5.2, first half.

### Step 11. A panel that could not send stays open

*Exposure: none. The command deliberately does not reach the exchange.*

1. Place a limit order far from the market, as in step 10, and leave it working.
2. Stop the proxy again.
3. Open the amend panel on that order, change the price, submit.

**Should be:** the panel **stays open** and says the order was not changed. It
must not close — a panel that vanishes reads as "done".

4. Restore the proxy, close the panel, cancel the order.

*Closes:* `send-only-the-confirmed-order` 5.2, second half.

### Step 12. Cancel all clears the conditional book too

*Exposure: one limit order and one stop order at the exchange minimum, both
cancelled within the step.*

1. Place a limit order far from the market.
2. Place a stop (conditional) order, also far from the market.
3. Confirm both appear in the working orders list.
4. Press `Cancel all`.

**Should be:** both disappear from the desk.

5. **Now check Binance's own screen** — the web or the app, open orders for that
   contract.

**Should be:** nothing there either. Before the fix the desk cancelled only the
regular book, so the stop stayed live on the exchange under an empty list on
screen. This is the step that matters most in the whole pass.

*Closes:* `answer-the-command-that-asked` 4.2, second half.

### Step 13. An order that fills, read end to end

*Exposure: one market order at the exchange minimum that will fill, and its
close. This is the only step that intentionally takes a position. Cost is the
fees on two fills.*

1. Place a market order at the exchange minimum.
2. Let it fill; confirm a position appears.
3. Close it.
4. Open `CLOSED POSITIONS`.

**Should be:** one row for the round you just did, with an entry, an exit and a
realized PnL. Not two rows, not a half-empty one.

5. Open `ORDER HISTORY`.

**Look at it and write down, honestly, whether you can tell what happened to each
order without scrolling sideways.** This is the "before" reading for
`make-the-order-history-readable`.

---

## What this pass cannot settle

Write these down as `COVERED BY TEST ONLY` — they are real guarantees, but the
situation cannot be staged safely by hand:

- **An unresolved outcome surviving unrelated traffic**
  (`answer-the-command-that-asked` 4.2, first half). It needs Binance to accept a
  command and fail to answer — a timeout mid-placement. You cannot cause that on
  purpose, and simulating it would mean shipping a switch that fakes exchange
  failures on a live desk, which is a worse risk than the one it verifies.
- **Sizing blocked between a transport reconnect and the first account answer**
  (`say-which-readings-are-stale` 1.4). This is the desk's *internal* socket
  dropping, not Binance. Reloading the window makes a new socket but also a new
  state, so there is nothing held to observe.

## What is not ready to verify yet

Do not attempt these — the work is not done:

- `reach-the-desk-without-a-mouse` — the dock still disappears on a narrow window
  and order rows still cannot be edited from the keyboard.
- `stop-rebuilding-the-desk-on-every-tick` — the responsiveness work has not
  started.
- `keep-the-history-read-out-of-the-way`, `hold-the-history-the-desk-has-read`,
  `make-the-order-history-readable` — all three are planned, none is built.
- `keep-the-chart-loadable` beyond step 9 — the ceiling, the calendar month and
  the interior-candle resync are not fixed, and the Futures chart's history lock
  is not released.
