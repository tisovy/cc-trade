## Context

See `proposal.md` for the reason the desk needs evidence before it can consider
removing any account read. The implementation already has one signed
`/fapi/v1/leverageBracket` read for a contract's leverage ceiling, a held
`symbolConfig` map, a public mark-price feed, and a reconciled account resource
set. Today the adapter reduces the bracket answer to one integer, the mark feed
publishes only to renderers, and the account refresh path applies each resource
as its request completes.

The comparison must therefore join readings that already exist without adding
a REST request, changing the renderer contract, or letting a derived amount
enter order sizing. It must also preserve the account replica's race guards: a
read superseded by a mutation or market deactivation is still discarded before
it can be compared or recorded.

## Goals / Non-Goals

**Goals:**

- Retain the complete maintenance-margin bracket table from the leverage-ceiling
  request already made for a contract and expire it on the symbol-config clock.
- Compute position and wallet estimates in a pure module from an explicit,
  immutable reading, with absence as the only answer to incomplete inputs.
- Compare an accepted positions or balances response with estimates made from
  the account state and market inputs held at that point in the refresh pass.
- Emit only bounded basis-point deviations and counters to the diagnostic
  record, then aggregate those facts in the offline daily summary.

**Non-Goals:**

- Replacing, suppressing, or rescheduling any exchange account read.
- Showing a computed amount, putting it in a renderer envelope, or using it for
  validation, order sizing, admission, liquidation warnings, or trading.
- Opening another REST or market-data subscription for the calculator.
- Treating a missing input, an exchange zero for which basis points are
  undefined, or an invalid decimal as zero or as agreement.

## Decisions

### 1. The leverage-bracket adapter answer carries the table and its ceiling

The trading adapter will normalize the matching symbol entry from the existing
`/fapi/v1/leverageBracket` response into a frozen object containing the symbol,
the full ordered table (`notionalFloor`, `notionalCap`, `maintMarginRatio`,
`cum`, and `initialLeverage`), and the maximum initial leverage derived from
that same table. The existing ceiling helper remains a projection of this
normalizer so callers and tests that need only the ceiling keep their narrow
contract.

The entry's optional `notionalCoef` is retained as well. Binance documents it
as a user-specific multiplier relative to the default brackets but does not
state, in the endpoint contract, which returned monetary fields have already
been adjusted. Applying it again or ignoring it would each be a guess. A
non-default or malformed coefficient therefore leaves the exchange-derived
leverage ceiling usable but marks the table unavailable to the diagnostic
calculator. The same applies when any returned bracket row is malformed: valid
rows may still state the ceiling, but a partial table cannot state maintenance
margin.

`binance-connection` will retain the table in a map beside
`futuresSymbolConfigs`. A successful table read replaces that symbol's table; a
failed or superseded read leaves a previously held table intact. The table map
is cleared wherever the config and config-read-clock maps are cleared. Position
config refresh will include a held-position symbol with no table in the same
bounded set used for missing/stale config reads, and will ask the existing
ceiling read to return the table rather than issue a diagnostic-only request.

Alternative considered: fetch brackets from the calculator when needed. That
would hide network I/O inside arithmetic and add weight specifically for
diagnostics, so it is rejected.

### 2. Arithmetic is pure, strict, and private to the main process

A new `futures-account-margin` module will accept positions, the USDT wallet,
resting regular and algo orders, a mark snapshot, symbol configs, and bracket
tables. It will return position estimates keyed by symbol and position side plus
an account free-margin estimate. The returned object is used only long enough
to build comparison facts and is never merged into `futuresAccountResources`.

For every non-zero position the calculator requires a valid mark, leverage,
margin mode, and a bracket containing its notional. It also requires an isolated
wallet for an isolated position and a cross wallet for cross liquidation/free
margin. If any dependency of an estimate is missing or malformed, that estimate
is absent; no default bracket, leverage, mode, mark, wallet, or zero is supplied.
In particular, a position missing any of bracket, mark, leverage, or margin mode
produces no partial position estimates.

The formulas are:

- `notional = abs(quantity) * mark`
- `maintenance = notional * maintMarginRatio - cum`
- `initial = notional / leverage` in both margin modes; `isolatedWallet` is
  required separately as collateral for isolated liquidation
- cross unrealized PnL is recomputed as `quantity * (mark - entryPrice)`
- free margin is cross wallet plus cross unrealized PnL, less cross-position
  initial margin and resting-order initial margin
- liquidation uses the proposal's Binance formula, with other cross positions'
  maintenance and unrealized PnL included for a cross leg and excluded for an
  isolated leg

Resting-order margin uses remaining quantity and its stated limit/trigger price,
divided by that contract's stated leverage. Reduce-only orders contribute
nothing. BUY and SELL commitments are summed separately per contract and only
the larger side is charged. An order whose quantity, price, leverage, mode, or
mark dependency cannot be established makes free margin unavailable rather
than partially understating commitment.

An algo's `actualOrderId` is matched to a regular order only within the same
contract because exchange order identities are symbol-scoped. An executed
quantity greater than the original quantity is malformed and also makes free
margin unavailable; it is not clamped to a fully filled order.

Input money remains decimal text at the integration boundary. The pure module
converts validated finite values to JavaScript numbers for arithmetic and never
formats them for display. Double precision is many orders finer than the final
whole-basis-point observation; non-finite or unsafe results are absent. This
avoids a new numeric dependency while keeping rounding policy confined to the
comparison boundary.

Alternative considered: reuse REST `notional`, margin, or mark fields as
calculator inputs. Those are the exchange answer being evaluated and would make
the comparison circular, so the calculator uses the public held mark and the
folded size/entry/wallet instead.

### 3. The existing mark feed exposes a read-only snapshot

The mark-price feed will expose a snapshot of the mark map it already maintains.
Reading the snapshot opens no socket, performs no REST call, and does not alter
the renderer broadcast. A mark is absent while the feed has not produced one or
after its existing disconnect/stall clearing path; the calculator then returns
absence as required.

Alternative considered: cache marks from renderer envelopes in the connection
layer. That duplicates ownership and risks retaining a mark after the feed has
declared it stale, so the feed remains the single owner.

### 4. Comparison happens only after a read survives reconciliation guards

Within `runFuturesAccountRefreshPass`, an operation first passes the existing
mutation/activation checks and is reconciled into the held account state. At
that point the connection captures the current account resources, mark snapshot,
configs, and bracket tables and invokes the pure calculator synchronously.

A positions response produces comparison events for notional, initial margin,
maintenance margin, and liquidation price. A balances response produces the
free-margin event. A full pass therefore produces all five; a balances-only
pass does not pretend that an old positions response was read again. Exchange
fields remain the comparison side and remain the only values stored in account
resources and broadcast to renderers.

The comparison normalizes only representation, not value: the signed exchange
notional of a short is compared by magnitude with `abs(size) * mark`, and
computed position initial margin is compared with the exchange's
`positionInitialMargin`. The broader `initialMargin` field is not substituted
when that position-only field is absent because it can include open-order
margin.

The comparison groups rows by value. Each event states the number compared, the
number unavailable, the greatest absolute deviation in whole basis points of
the exchange value, and the symbol of that greatest deviation. A zero or invalid
exchange denominator cannot define basis points and is counted unavailable.
Ties are resolved by stable symbol/position-side order so fixtures and summaries
are deterministic.

Alternative considered: compare after all concurrent operations finish. That
would delay the UI path and combine payloads admitted at different times while
discarding the exact accepted state beside each answer. The synchronous
per-resource comparison preserves current delivery semantics and keeps each
observation attached to the resource that actually answered.

### 5. The record schema makes monetary leakage structurally impossible

The diagnostic record gains one `estimate` kind with a closed value vocabulary,
non-negative safe-integer `compared` and `unavailable` counters, an optional
symbol, and an optional non-negative whole `deviationBps` capped by a fixed
upper bound. All fields are mandatory at the schema level (nullable where no
comparison exists), and unknown or malformed fields refuse the entire event.
No estimated amount, exchange amount, quantity, price, wallet, or free-form
message is accepted.

The connection hands only the aggregate comparison facts to `record`; it never
hands the calculator result to the record and relies on the record to strip it.
This makes the privacy boundary true at both the call site and the whitelist.

Alternative considered: write one event per position. The worst-case tail and
unavailable count are the operator's decision inputs, while per-row output would
grow the bounded record and repeat contract activity without improving the
safety decision.

### 6. The daily reader aggregates estimate events by value

`read-desk-record.mjs` will accumulate, for each of the five values, compared
passes, compared rows, unavailable passes/rows, and the worst observed
deviation with its symbol and time. Formatting adds a comparison section only
when estimate events exist, preserving the current output for old record files.
Malformed hand-edited lines remain governed by the reader's existing tolerant
parsing and cannot be interpreted as agreement.

## Risks / Trade-offs

- [A mark can move between the signed REST snapshot and comparison] → Capture
  the feed snapshot exactly once per comparison, keep the observation
  diagnostic-only, and let the evidence window reveal the resulting tail.
- [Concurrent resource requests can describe slightly different instants] →
  Compare only the resource that just answered against the accepted held state;
  never claim an unrequested resource was sampled in that pass.
- [A missing/failed bracket read reduces sample coverage] → Retain the last
  successful table on failure and record unavailable counts instead of filling
  gaps with a default.
- [Floating-point arithmetic may add sub-basis-point noise] → Round only the
  final relative deviation to whole basis points and keep all computed amounts
  out of user/trading paths.
- [Algo and regular order views may briefly overlap during a trigger] → Use the
  reconciled held working sets and deterministic, symbol-scoped identity
  de-duplication where an algo names its spawned regular order; if identity is
  insufficient, make free margin unavailable rather than knowingly
  double-counting.
- [A user-specific bracket multiplier has ambiguous application semantics] →
  Preserve it, keep the exchange ceiling available, and record estimates as
  unavailable instead of either ignoring or applying it speculatively.
- [The diagnostic line rate rises by up to five events per full read] → Keep one
  aggregate line per value and retain the record's existing byte/day bounds.

## Migration Plan

1. Deploy the adapter/table retention, pure calculator, comparison record kind,
   integration, and reader summary together; there is no persisted schema that
   runtime code must migrate.
2. Run the existing account, stream, mark-feed, record, and reader suites plus
   focused fixtures for bracket bands, both margin modes, hedge legs, resting
   orders, and missing inputs.
3. Confirm on live data that renderer values, account read count, and request
   weight are unchanged, then retain the bounded records for the evidence
   window.
4. Roll back by reverting this change. Old readers ignore no required runtime
   state, and new readers remain compatible with record days that contain no
   `estimate` events.
