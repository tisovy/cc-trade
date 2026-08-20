# Read only the income the desk cannot derive

## Why

The settled read is the most expensive thing the desk does per unit of
information, and the operator is right that it is too dear. Measured on their own
account from `~/.config/cc-trade/diagnostics/desk-2026-08-20-000.jsonl`, not
estimated:

| | measured |
|---|---|
| `/fapi/v1/income` | weight **30** per request |
| steady state | **60 weight/min** — one page per 30 s tick |
| cold start | **~9 passes, ~67 pages, ~2010 weight, ~3.5 minutes** |
| one afternoon (2 h 54 m, 281 passes) | 863 pages, **25 890 weight** |

And here is what that bought. In seven days the account produced **13 330**
income rows across nine contracts. **Forty-five** of them are funding. The other
13 285 are `REALIZED_PNL` and `COMMISSION` — one or two per fill — and the desk
**already holds every one of them**, from `/fapi/v1/userTrades`, which it reads
anyway at weight 5 per contract to draw the history panel. The expensive read is
paging through thirteen thousand rows of a record it is duplicating in order to
find forty-five it cannot get anywhere else.

Nothing forced that. `/fapi/v1/income` takes an `incomeType`, and the endpoint's
own note says why the desk gets everything: *"If incomeType is not sent, all
kinds of flow will be returned."* The whole record is being asked for by
omission, never by need.

Three things the desk already has and does not use:

- **`ACCOUNT_UPDATE` with `m: FUNDING_FEE`.** The private stream pushes it the
  moment funding settles, and `scheduleFuturesSettledRead('funding')` already
  fires on it (`electron/services/binance-connection.js:2688`). On a crossed
  position the event carries only the balance `B` and no position `P` — which is
  exactly why the income record is still needed to say *which* contract was
  charged — but it says **when**, precisely, for free.
- **The next funding time.** `markPriceUpdate` carries `T`; the parser reads `p`
  and `E` and drops the rest (`futures-mark-price-feed.js:57`). The desk can know
  the schedule of the only event that moves this number without asking anything.
- **The open round.** `buildFuturesTradeRounds` already folds the open position's
  realized PnL and its commission out of the fills. The settled column recomputes
  both from the income record.

## What Changes

- **The settled read asks for the kinds no other record states, one at a time.**
  `FUNDING_FEE`, `INSURANCE_CLEAR`, and the four rebate kinds — six reads a page.
  Forty-five funding rows a week fit one page, so the reading reaches `complete`
  on its **first pass** instead of its ninth.
- **Realized PnL and commission for an open position come from the fills**, from
  the same fold that already states them for every closed round. One record, one
  number, no second opinion to disagree with — and the stream's execution report
  is folded straight into the held trade record, so the figure now moves on the
  frame itself rather than a debounce and a round trip after it.
- **The read is scheduled by funding, not by a clock.** The private stream says
  when a settlement landed; the public mark frame's countdown steps forward when
  one has been made. Two independent witnesses, neither costing a request. A
  thirty-second tick against a number that moves six times a day is 2 880
  requests to observe six events.

Cost, measured through the walk itself against a week shaped like this account
rather than projected:

| | before | after |
|---|---|---|
| cold start | ~2 010 weight, 67 pages, 3.5 min, nine passes | **360 weight, 12 reads, one pass** |
| a pass in the steady state | 30 weight × the account tick | **180 weight, 6 reads** |
| what that comes to | **60 weight/min** | **~3.75 weight/min** (6 settlements + hourly reconciliation) |

## The rebate question, and why it is no longer a gate

Income `COMMISSION` may be the **gross** charge a fill also states, or it may be
**net** of `COMMISSION_REBATE`, `REFERRAL_KICKBACK`, `API_REBATE` and
`FEE_RETURN`, which arrive as rows of their own. The documentation does not say
and this account has not been measured for it.

It does not need to be, because the rebate kinds are read either way. Commission
comes from the fills, gross; the credits come from the income record; and the sum
is what the position cost under **both** readings — if the income row was gross,
nothing changed, and if it was already net, the old reading was adding the credit
twice and this one stops. The measurement would settle a question about the
exchange's bookkeeping, not about what the desk should do.

## What is deliberately not built

**The ledger on disk.** It was proposed against a cold start of 2 010 weight and
three and a half minutes. That start is now 360 weight and one pass — complete
before the operator could read the first frame. A file would save that, and would
hold a total that is wrong forever if anything about it is wrong once. The
requirement it was filed under says the desk *may* keep a reading and lists five
conditions for keeping one; those conditions stand, unbuilt against, for whoever
finds a reading worth keeping.

## Ready-made solutions: there is no drop-in, and here is what was checked

- **`daisy613/accountData`** — PowerShell, pulls all Binance/Bybit income into
  SQLite every ten minutes. The same idea as persistence, in the wrong shape for
  an Electron desk, and it polls the whole record, which is the expensive part
  being removed here.
- **`ccxt.fetchFundingHistory`**, the official `binance-futures-connector-*`
  clients — thin wrappers over this same endpoint at this same weight. No cache,
  no incremental cursor, nothing to inherit.
- **`binance/binance-public-data`** — market data dumps, not account records.
- **Freqtrade** — tracks funding for its own trades and stores the *public*
  funding rate series, not the account's income rows. Worth reading for one
  finding only, and it is one that applies here: Binance funding is no longer
  always eight-hourly (freqtrade#12583). This account's BEATUSDT settles every
  **four** hours, which is why an eight-hour assumption anywhere would be wrong.

What the ecosystem is worth here is the two facts above, not code.

## Impact

- `electron/services/binance-connection.js` — the read's `incomeType` and its
  schedule.
- `electron/services/futures-settled-income-walk.js` — a walk over forty-five
  rows is a different shape from a walk over thirteen thousand.
- `electron/services/futures-mark-price-feed.js` — carry `T`.
- `src/utils/futuresSettledMoney.js`, `src/hooks/useFuturesTrading.js` — realized
  and commission from the fills fold.
- `scripts/probe-futures-settled.mjs` — count rebate rows.
