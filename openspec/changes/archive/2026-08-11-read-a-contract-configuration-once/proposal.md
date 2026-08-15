## Why

Every account refresh re-reads the leverage and margin mode of every contract
the account holds a position on. `refreshFuturesPositionConfigs`
(`binance-connection.js:1070`) maps each position's symbol to
`readFuturesSymbolConfig`, which always issues the REST read — the
`futuresSymbolConfigs` map it writes into is never consulted before asking.

At weight 5 per contract, bounded to eight, that is **up to 40 weight added to
every refresh pass**, on top of the pass's own 90. The account limiter allows
800 a minute, so a desk in eight positions spends a third of its minute
re-reading numbers that did not change.

And they do not change on their own. A contract's leverage and margin mode
change when somebody sets them: the operator on this desk, which the desk
already knows about because it sent the command, or the operator in Binance's
own app, which no stream reports. An `ACCOUNT_UPDATE` carries balances and
positions and says nothing about leverage. So a read on every refresh is not
keeping up with anything — it is asking the same question at whatever rate the
account happens to be busy.

## What Changes

- **A configuration already held is not re-read.** The desk reads a contract's
  leverage, margin mode and ceiling when it first needs them, and reuses what it
  holds afterwards.
- **It is re-read when something could have changed it**: the desk selects the
  contract, the desk itself changed it, or a position appears on a contract
  nothing is held for. An automatic refresh — the 30-second beat, a fill, an
  `ACCOUNT_UPDATE` — reuses what is held.
- **What is held has a shelf life.** Past it, the next refresh reads it again, so
  a leverage changed in Binance's own app is picked up on its own. The
  renderer's beat and the operator's refresh are the same command, so time held
  is what separates them — and it is the better separator anyway: the operator
  should not have to know to press anything.
- **A configuration is dropped when it can no longer be trusted**: the market is
  deactivated, the credentials change, or the operator's own refresh replaces it.

## Trade-offs this accepts

- **A leverage changed in Binance's app is picked up within the shelf life, not
  at once.** That is the honest cost of not asking constantly, and selecting the
  contract still reads it immediately. The alternative — the present one — is
  paying 40 weight on every automatic pass for a number that changes a few times
  a day.
- **The desk keeps a small per-contract cache in the main process.** It is
  already there (`futuresSymbolConfigs`); this change gives it the one job it
  was written for.

## Capabilities

### Modified Capabilities

- `futures-contract-leverage`: a contract's configuration is read when it could
  have changed, not on every account refresh.

## Impact

- `electron/services/binance-connection.js` — `readFuturesSymbolConfig` serves
  what is held unless the caller asks for a fresh read;
  `refreshFuturesPositionConfigs` reads only the contracts nothing is held for.
- No renderer change: the panel is given the same configurations, from the same
  broadcast.
