## MODIFIED Requirements

### Requirement: Executions are reported as the positions they formed
The trade history SHALL report closed round trips rather than fills: a position opens when exposure is taken and closes when that same position key returns to flat. A position key SHALL be `{symbol, LONG}` or `{symbol, SHORT}` for hedge-mode fills and `{symbol, BOTH}` for one-way fills. Each round SHALL be reported with its contract, position leg, side, closed size, average entry and exit, and exchange-reported realized PnL. Realized PnL SHALL be reported as the exchange reports it, with fees and the qualified net stated on the element rather than as a column of their own.

The size SHALL be stated in USDT, valued at the price the round was entered at, because that is what every other size on this desk is stated in and a contract count cannot be compared across contracts. The count of contracts SHALL remain available on the element.

A position that is proven not to have returned to flat SHALL NOT appear in this history. A position whose opening boundary has not been read SHALL be unresolved until older fills or the current account position prove its state; an unresolved sequence SHALL NOT be invented as either a closed round or an opposite open position. A recovered entry MAY be shown only when exchange-reported realized PnL determines it unambiguously, and SHALL be labelled recovered.

#### Scenario: One close arrives as several fills
- **WHEN** one position leg is closed by an order that fills in several parts
- **THEN** the tab shows one row for that position leg, carrying the summed PnL and fees of every fill in it

#### Scenario: The position is still open
- **WHEN** the fills and current snapshot prove that a position key has not returned to flat
- **THEN** no row is shown for it in the closed-position history

#### Scenario: The position was opened before the window
- **WHEN** the oldest fills reduce a position whose opening boundary has not yet been read
- **THEN** the sequence remains unresolved until backfill or unambiguous exchange evidence establishes its round

#### Scenario: A fill flips the position
- **WHEN** a `BOTH` fill reduces more than the signed exposure holds and opens the opposite side
- **THEN** the closed side is reported with the realized PnL made on the way out, and the leftover opens a distinct live round

#### Scenario: Two contracts were traded in the same window
- **WHEN** the window holds fills on more than one contract
- **THEN** each contract's position keys are folded independently, and a fill on one never changes another

#### Scenario: Both hedge legs are open
- **WHEN** a contract has simultaneous `LONG` and `SHORT` fills
- **THEN** neither leg closes, reduces, or changes the round state of the other

#### Scenario: A closed round is sized
- **WHEN** the closed-position history lists a resolved round
- **THEN** its size is what the position was worth in USDT at its entry, and the contract count is on the element

## ADDED Requirements

### Requirement: A closed position is proven per leg and coverage window
Each position key SHALL carry the oldest and newest fill instants actually covered, whether a flat boundary was proven, and whether the current terminal exposure agrees with the account snapshot. A full response at the exchange page limit SHALL be treated as potentially truncated. The system SHALL read older bounded fill windows only for keys that need a boundary, stopping when it proves flat or reaches an explicit retention or request bound. If proof cannot be obtained, the result SHALL remain unresolved and SHALL state why.

Reported-PnL consistency checks SHALL use exact decimal values and contract precision. A percentage of notional SHALL NOT be treated as rounding tolerance, and a zero-realized fill SHALL NOT by itself prove whether it opened or closed exposure.

#### Scenario: Latest page contains exactly the limit
- **WHEN** the newest account-trade response contains 1000 fills for a contract and no flat boundary is present
- **THEN** the key is marked potentially truncated and older fills are requested within the bound before any exact round is shown

#### Scenario: Backfill reaches flat
- **WHEN** progressive older windows reach a fill after which the position key is known flat
- **THEN** the subsequent fills are folded as resolved rounds without reading older history

#### Scenario: Backfill reaches retention without flat
- **WHEN** the available retention ends before a flat boundary is proven
- **THEN** the affected sequence remains unresolved and no exact wallet result is claimed

#### Scenario: A break-even close starts the visible window
- **WHEN** the first visible fill realizes zero while closing exposure opened before the window
- **THEN** it is not presented as an opposite opening merely because its realized PnL is zero

#### Scenario: Ordinary PnL differs by less than one percent of notional
- **WHEN** a possible reversal's reported PnL differs from the tentative round by an amount larger than contract precision but smaller than one percent of notional
- **THEN** the difference is not dismissed as rounding and the tentative reversal is not accepted on that basis

#### Scenario: Reconstructed exposure disagrees with snapshot
- **WHEN** a supposedly complete round set implies a different leg, signed quantity, or entry basis from the current account position
- **THEN** that key becomes unresolved and the stale persisted round is not attached to the current position

### Requirement: Current position settlement does not depend on opening History
For every currently open position key, the desk SHALL acquire and maintain the minimum fill basis needed to state its realized PnL and commission since opening. Persisted fills SHALL be reused, new execution reports SHALL be folded idempotently, and any detected gap SHALL schedule one coalesced targeted read. Opening an order-history or Closed Positions view SHALL NOT be required to update current position settlement.

#### Scenario: Fresh profile starts with an open position
- **WHEN** the app starts without held fills and the account reports an open position
- **THEN** a targeted basis read begins for that position key without the operator opening History

#### Scenario: A partial close executes
- **WHEN** an execution report partially closes an open position
- **THEN** its realized PnL and gross commission update once without a history-tab action

#### Scenario: Execution delivery has a gap
- **WHEN** execution identity shows that one or more fills were missed
- **THEN** one coalesced targeted gap read reconciles the key and duplicate stream/REST fills do not double count

#### Scenario: Old and current positions reuse a symbol
- **WHEN** a persisted open round belongs to an older position but the current snapshot has a different leg, quantity, or entry basis
- **THEN** the old round is not used as the settlement start for the current position

## REMOVED Requirements

### Requirement: A closed position is what was actually closed
**Reason**: The requirement asks heuristics over an incomplete left boundary to invent exact round state and tolerates up to one percent of notional as rounding, which can create phantom reversals and opposite positions.
**Migration**: Replace heuristic certainty with per-leg coverage, bounded backfill, precision-derived comparisons, snapshot reconciliation, and an explicit unresolved state.
