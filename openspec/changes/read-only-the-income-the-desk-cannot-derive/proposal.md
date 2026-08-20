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

- **The settled read asks for `FUNDING_FEE` and nothing else.** Forty-five rows a
  week is one page, so the read reaches `complete` on its **first** request
  instead of its ninth pass. `INSURANCE_CLEAR` is read on its own only when
  something the desk already sees — a margin call, an ADL, a liquidation-shaped
  position change — says a clearance could exist.
- **Realized PnL and commission for an open position come from the fills**, from
  the same fold that already states them for every closed round. One record, one
  number, no second opinion to disagree with.
- **The read is scheduled by funding, not by a clock.** The stream says when a
  settlement landed; the mark frame says when the next one is due. A thirty-second
  tick against a number that moves six times a day is 2 880 requests to observe
  six events.
- **What has been read is kept on disk** and extended rather than rebuilt, under
  `app.getPath('userData')` beside the diagnostic journal.

Projected cost, on the same account:

| | now | after |
|---|---|---|
| cold start | ~2010 weight, 3.5 min | **30 weight, one request** |
| steady state | 60 weight/min | **~0.25 weight/min** (6 settlements/day) |
| with the ledger on disk | — | a restart costs the tail, not the week |

## The one thing that must be measured before it lands

Income `COMMISSION` is the **net** charge: `COMMISSION_REBATE`,
`REFERRAL_KICKBACK`, `API_REBATE` and `FEE_RETURN` are separate rows the desk
already folds into the same component. A fill's `commission` is the **gross**.
On an account that receives any rebate the two differ, and moving commission to
the fills would quietly overstate what the position cost.

This is not a judgement call to make from here: one probe run says whether this
account has a single rebate row in seven days. If it does, the rebate types stay
on the income read — they are rare rows, one page, weight 30, read at the same
cadence as funding — and the gross still comes from the fills.

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

- `electron/services/binance-connection.js` — the read's `incomeType`, its
  schedule, and the ledger's persistence.
- `electron/services/futures-settled-income-walk.js` — a walk over forty-five
  rows is a different shape from a walk over thirteen thousand.
- `electron/services/futures-mark-price-feed.js` — carry `T`.
- `src/utils/futuresSettledMoney.js`, `src/hooks/useFuturesTrading.js` — realized
  and commission from the fills fold.
- `scripts/probe-futures-settled.mjs` — count rebate rows.
