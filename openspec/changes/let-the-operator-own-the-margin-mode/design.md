## Context

See `proposal.md` for motivation and for the journal evidence.

The Futures desk reads a contract's leverage, margin mode and bracket ceiling from
`GET /fapi/v1/symbolConfig` (`futures-trading-adapter.js:1298`), because
`/fapi/v3/positionRisk` reports neither of the first two any more. The backend holds the
answer in `futuresSymbolConfigs` with a read timestamp in `futuresSymbolConfigReadAt` and
a ten-minute hold (`binance-connection.js:1308`), and broadcasts it per contract. The
renderer merges those broadcasts into `state.symbolConfigs` (`useFuturesTrading.js:653`).

Three things then diverge from what an operator would expect.

The hold-based re-read runs from `refreshFuturesPositionConfigs`
(`binance-connection.js:1720`), whose symbol set is built from open positions and working
orders. The contract the operator is looking at, if it is flat, is read once when it is
selected (`FuturesProductionWorkstation.jsx:276-280`) and never again.

`applyFuturesLeverageFromStream` (`binance-connection.js:1385`) restarts the hold at
`:1392` for the whole entry, although `ACCOUNT_CONFIG_UPDATE` carries only a pair's
leverage and the account's Multi-Assets switch — verified against the exchange's own
documentation, and already recorded in `normalizeFuturesAccountConfigUpdate`
(`futures-trading-adapter.js:774-797`).

`forgetFuturesSymbolConfigs` (`binance-connection.js:1426`, called at `:2686`) clears the
backend's memory when the market is deactivated or the credentials change. The renderer's
copy is merge-only and survives.

Separately, `planFuturesContractDefaults` (`futuresContractDefaults.js:92`) rewrites any
non-isolated mode on a flat contract, and `useFuturesContractDefaults` applies it once per
contract per session — a window that a restart reopens.

## Goals / Non-Goals

**Goals:**

- Put the margin mode on the surfaces where the terms of an entry are read, and make the
  ticket's reading the control that changes it.
- Stop the desk from deciding the margin mode at all.
- Lower the automatic leverage default to 1× without loosening any guard around it.
- Guarantee the startup reading of both fields for the contract the desk starts on, and
  retry it rather than abandoning it.

**Non-Goals:**

- Changing what the automatic default does to leverage beyond its target multiple.
- Adjusting isolated margin on an open position — `FuturesPositionMarginEditor` already
  owns that and is a different operation.
- Multi-Assets mode. `ai.j` arrives on the same frame and is account-wide; nothing here
  reads or sets it.
- Detecting a leverage or margin-mode change made in the exchange's app while the desk is
  running. The operator's working rule is not to make one; the desk states what it read
  and does not claim to be current between reads.
- Mining `mt` out of `ACCOUNT_UPDATE` into the held configuration (see Decision 5).

## Decisions

### 1. Remove the automatic margin-mode change

Decided by the operator: the desk does not choose the margin mode.

The alternative considered was keeping the forced `ISOLATED` and persisting an explicit
per-contract choice across restarts so the new control's result survives. It would not
have worked. The desk cannot tell an inherited mode from a chosen one — the exchange
reports a mode, not its provenance — so the persisted set would start empty and be built
only from choices made *on this desk*, leaving every mode set in Binance's own app to be
reverted exactly as it is today. The risk argument does not carry it either: cross is not
more risk than isolated, it is the same position carried against a different pool.
Lowering an inherited 20× removes risk nobody chose; flipping cross to isolated
substitutes one operator's decision for another.

`FUTURES_DEFAULT_MARGIN_TYPE` goes with it. A constant naming a default the desk no longer
applies is a default waiting to be reintroduced.

### 2. One toggle, stated where the multiple is stated

The mode chip sits on the order ticket beside the leverage chip and reads `ISO` or
`CROSS`. Acting on it sends the other mode for the named contract. A two-button group was
rejected: there are exactly two modes, the current one is shown, and a group would put a
control for the state already held next to the state not held.

The confirmation panel states the mode beside the multiple and is not a control there,
which the existing requirement already establishes for leverage.

### 3. Refuse locally what the exchange would refuse anyway

Binance answers a margin-mode change with `-4048 THERE_EXISTS_QUANTITY` when a position is
open on the contract and `-4047 THERE_EXISTS_OPEN_ORDERS` when an order rests. The desk
already holds both readings. Sending anyway and rendering the exchange's refusal would put
a red card on the surface that reports real ones for a state the desk could have named,
and would spend a signed request to learn it. The control states the reason instead.

`-4046 NO_NEED_TO_CHANGE_MARGIN_TYPE` stays where it is, handled in the backend as the
desired state rather than a failure (`binance-connection.js:4407-4412`): it is the answer
to a race, not to a state the desk could have checked.

### 4. Stop stamping freshness from the leverage frame

`applyFuturesLeverageFromStream` no longer writes `futuresSymbolConfigReadAt`. Splitting
the stamp into one per field was considered and rejected as machinery for a case that
does not need it: the desk's own leverage change re-reads the configuration immediately
afterwards (`handleFuturesSetLeverage`), and that read stamps through
`readFuturesSymbolConfig` (`binance-connection.js:1477`). So the echo the current comment
is defending against is already covered by the read behind it, and dropping the write
leaves the hold measuring exactly what it claims to measure: time since the desk last
asked the exchange.

Under the operator's rule this is no longer load-bearing — nothing changes the mode
mid-session for the stamp to hide. It stays in scope because it is the deletion of one
line that currently records a read that did not happen, and because the hold it corrupts
is what Decision 6 relies on to retry a failed startup read.

### 5. Do not take the mode from `ACCOUNT_UPDATE` in this change

The exchange pushes `ACCOUNT_UPDATE` with `m: MARGIN_TYPE_CHANGE` and, per its
documentation, the `BOTH` position of the affected symbol — and the adapter already parses
`mt` off those rows (`futures-trading-adapter.js:727`), where it reaches `positions` and
stops. Folding it into the held configuration would be the most direct fix for a mode
changed elsewhere, and it is deliberately out of scope here: for a flat contract the row
arrives with `pa` at zero, which the position fold drops, so whether the signal survives
at all is a claim about the wire that has not been measured on this account. The re-read
in Decision 6 does not depend on it. If it is later confirmed on the wire, it becomes an
addition to this capability rather than a correction of it.

### 6. Make the startup read one that cannot be silently skipped

The read exists today (`FuturesProductionWorkstation.jsx:276-280` sends
`account.symbolConfig` for the restored contract), and two things can swallow it. A
command sent before the local backend socket is open returns `false` and is only
remembered for a manual retry (`useFuturesTrading.js:980-993`, `retryUnsentCommand`) —
today it is re-sent only as a side effect of `sendCommand`'s identity changing when the
socket opens, which is accidental rather than designed. And a read that reaches the
exchange but fails or is superseded returns `null`, broadcasts nothing, and is never
issued again.

The fix reuses machinery that already exists rather than adding a timer: the backend
remembers the contract last asked for through `account.symbolConfig` and includes it in
the symbol set `refreshFuturesPositionConfigs` builds. A contract with no held
configuration is already in that function's `unread` list, so a failed startup read is
retried on the next account pass at no new cost, and the renderer's re-send on socket
open becomes a deliberate effect rather than a coincidence.

Two consequences follow from reusing the hold. A configuration that *was* read is skipped
until the hold expires, which is the behaviour the position contracts already have. And
once it does expire, the selected contract is read again — roughly one extra weight-5
request per ten minutes. That is kept: it costs almost nothing, and it is the only thing
in the design that would notice a mode changed outside the desk. It is not offered as
drift detection, because between two reads the desk states what it read, and the
operator's rule is what makes that safe.

The alternative — a timer in the renderer re-issuing `loadSymbolConfig` — was rejected
because the renderer does not know when the hold expires, so it would either re-read on
every account beat or guess a cadence that drifts from the backend's.

### 7. Default to 1×

`FUTURES_DEFAULT_LEVERAGE` becomes 1. `FUTURES_DEFAULT_MARGIN_TYPE` is removed along with
the mode half of the planner. Every other rule in `planFuturesContractDefaults` stands:
never raise, never touch a contract with a position, once per contract per session, and
never before the positions have been read or while trading is paused.

Two consequences worth stating rather than discovering. The leverage panel's `Max
position` is available margin times the multiple, so at 1× it equals the wallet — that is
arithmetic, not a regression. And `-4161 ISOLATED_LEVERAGE_REJECT_WITH_POSITION` — the
exchange refuses to *lower* leverage on an isolated contract that holds a position — is
already avoided by the guard that leaves any contract with a position alone.

The working-order carve-out disappears from the default entirely: it existed only to keep
the mode change away from a contract with a resting order, and the default no longer
changes the mode. The exchange permits a leverage change with orders resting.
