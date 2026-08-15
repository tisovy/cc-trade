## Why

The operator reports the desk unusable for real trading: orders refused with
`LONG entry NOT sent — Loading Futures account state`, the sizing panel flashing,
a `SYNC` badge that will not settle, and orders taking seconds to appear.

The desk's own record names the mechanism. Every trading command ends with
`await refreshFuturesAccountState()` — four signed reads (balances, regular
orders, algo orders, positions), ninety of the minute's eight hundred weight,
admitted one at a time with 150 ms of spacing between them. The record's own
timings put a single Binance read at 340–800 ms median through the operator's
proxy, so a pass is one and a half to two and a half seconds. For all of it,
every account resource is marked `loading`.

`loading` is what the readiness gate treats as "no balance", and what the ticket
treats as "cannot size". So for one to two seconds after every order the desk
refuses the next one, blanks the size, and shows `SYNC` — for a balance it is
holding the whole time and that has not changed.

Then the weight runs out. Ninety a command is eight commands a minute; the ninth
read waits for the oldest to fall out of the window, which the limiter implements
as a wait of up to a full minute. The operator issued ten commands in eighty
seconds on the recorded run.

None of that reading was needed. The user-data stream reports the order within
milliseconds and `foldFuturesWorkingOrder` puts it straight into the held set —
that is what it exists for, and `futures-order-visibility` already requires an
account-wide order read to be issued only for a stated reason: the first
snapshot, a stream connect, an operator refresh, or the periodic beat. A command
is not on that list. The wallet and the position a fill moves arrive as their own
`ACCOUNT_UPDATE`, which already asks for those two resources and nothing else.

The record also cannot answer the question this raised. It stamps a command when
it is issued and never states when it was answered, so "the desk is slow" cannot
be told apart from "the exchange is slow".

## What Changes

- **A command that the stream reports is followed by no account read.** With the
  authenticated stream up, the order arrives on it; the wallet and position
  arrive on `ACCOUNT_UPDATE`. With no stream there is nothing else to learn it
  from, so the whole read stands. A cancel-all still reads the algorithmic orders
  back, because no stream reports those.
- **A reading being refreshed is still a reading.** Readiness and sizing require
  a *confirmed* balance, not an idle read. A balance that has answered once stays
  usable while the next read is in flight. `stale` and `error` still block, for
  the reasons they always did.
- **The record states when a command was answered, and how long it took.**

## Trade-offs this accepts

- A command whose effect the stream fails to report is now corrected by the
  periodic reconciliation rather than immediately. That is the same bet the desk
  already makes for every fill, and the beat is measured in tens of seconds.
- Sizing may use a balance that a read in flight is about to change. It already
  did: between reads the balance is up to thirty seconds old, and blocking only
  during the read blocked precisely when the number was freshest.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: a refresh over a confirmed balance does not withdraw
  readiness.
- `futures-order-visibility`: a command is a reason to read the account only when
  no stream can report it.

### Added Capabilities

- `desk-diagnostic-record`: a command's answer and its duration are recorded.

## Impact

- `electron/services/binance-connection.js` — what a command owes the account,
  and the answer line.
- `src/utils/futuresReadiness.js`, `src/components/features/futures/FuturesTradingTicket.jsx`
  — a confirmed balance is one that has answered, not one that is idle.
- `electron/services/desk-diagnostic-record.js`, `scripts/read-desk-record.mjs`
  — the `answer` event and how the summary reports it.
