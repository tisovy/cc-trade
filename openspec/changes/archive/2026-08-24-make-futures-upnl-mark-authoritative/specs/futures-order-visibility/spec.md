## ADDED Requirements

### Requirement: An open position's unrealized PnL is mark-authoritative
Every primary surface that states Futures unrealized PnL, return on margin, position value, or an aggregate of those readings SHALL use the current exchange mark for that position. A last trade or any price extrapolated from trades SHALL NOT change those primary readings. When no current mark is available, a confirmed account-snapshot unrealized PnL MAY remain as a visibly qualified fallback; otherwise the reading SHALL be unknown rather than zero.

The last traded price MAY explain why the chart and the mark-based position disagree, or MAY support a separately named what-if reading, but that value SHALL NOT be labelled uPnL, included in the dock total, or used by margin, liquidation, or risk decisions.

#### Scenario: A trade prints between marks
- **WHEN** aggregate trades print after the latest mark and no new mark has arrived
- **THEN** primary uPnL, return on margin, position value, and aggregate uPnL do not change

#### Scenario: A mark changes
- **WHEN** a new valid mark arrives for an open position
- **THEN** every primary position valuation changes from that mark in one consistent direction and the aggregate is recomputed from the same readings

#### Scenario: A delayed or replayed mark arrives after an accepted mark
- **WHEN** an older, untimed, duplicate, or same-time conflicting mark frame arrives after a newer timed frame for the same contract
- **THEN** the accepted mark, other newer symbol readings, liveness proof, and the funding-settlement observation baseline do not change, and the next current frame does not create a false settlement event

#### Scenario: The exchange reschedules funding earlier
- **WHEN** a newer mark frame moves the next funding time earlier and a later frame advances it
- **THEN** the earlier time becomes the baseline without reporting a settlement, and the later advance triggers one reconciliation only after exchange event time has reached the held funding boundary

#### Scenario: A market activation keeps the same feed instance
- **WHEN** a new renderer market generation clears visible marks while the shared feed continues in the same epoch
- **THEN** the renderer preserves that epoch's revision admission, rejects revisions no newer than the last accepted frame, and accepts the next higher revision from the same feed

#### Scenario: An actual replacement feed restarts revisions
- **WHEN** a newer feed epoch publishes revision one after an older feed epoch
- **THEN** revision one opens the newer namespace and later non-empty or terminal frames from the older epoch are rejected

#### Scenario: The tape and mark straddle entry
- **WHEN** a short entered at `3.3450` has a mark of `3.36` and last trade of `3.30`
- **THEN** primary uPnL reports the loss implied by the mark, while any tape-based profit is explicitly secondary and non-additive

#### Scenario: No current mark exists
- **WHEN** an account snapshot contains a confirmed unrealized PnL but the live mark feed is unavailable
- **THEN** the snapshot value is retained with its snapshot age/source, and no aged mark is described as live

#### Scenario: Neither mark nor snapshot can value the position
- **WHEN** an open position lacks both a usable current mark and a confirmed snapshot uPnL
- **THEN** its primary valuation, any aggregate that requires it, and margin/removal calculations that depend on its uPnL are reported as incomplete rather than zero

#### Scenario: A complete aggregate contains an undated source
- **WHEN** every row has a complete valuation but at least one included reading has no trustworthy source time
- **THEN** the aggregate remains numerically complete while its aggregate source time is unknown

### Requirement: Live mark delivery is consumer-bound and backpressure-safe
The shared mark-price feed SHALL treat liveness as forward exchange-time progress for every tracked contract, not merely traffic from any contract. A replay SHALL NOT prove liveness. When any tracked contract fails its liveness window, all live marks SHALL be withdrawn before the combined stream reconnects so an aged reading is not presented as live.

The service SHALL stop the public mark socket, its reconnect/watchdog work, and settlement-triggered reads when no Futures renderer remains. Full mark frames SHALL be delivered only to Futures renderers on a superseding market-data lane so a slow renderer retains at most the newest complete frame and account events are not queued behind obsolete marks.

#### Scenario: One contract stalls while another continues
- **WHEN** BTC and ETH are tracked but only BTC makes forward exchange-time progress through the liveness window
- **THEN** the full live mark set is cleared and the combined mark stream reconnects instead of continuing to call the old ETH reading live

#### Scenario: A contract only replays its last frame
- **WHEN** a tracked contract repeatedly delivers the same exchange event time without forward progress
- **THEN** those frames are ignored for value, funding, and liveness, and the watchdog withdraws the live mark set

#### Scenario: The final Futures renderer disconnects
- **WHEN** the last renderer consuming Futures data closes while mark, reconnect, settlement debounce, confirmation, or settled-income work is pending
- **THEN** the public feed and timers stop, pending work is invalidated, and no later reconnect or income read starts without a new Futures consumer

#### Scenario: A retired private socket delivers a buffered frame
- **WHEN** a Futures private socket emits a message or error after its generation and socket identity have been retired
- **THEN** the frame causes no account fold, renderer publication, reconnect, deferred account read, or settled-income read

#### Scenario: Rate-limited keep-alive resumes after retirement
- **WHEN** a private-stream keep-alive is already queued behind the REST limiter, the final Futures consumer retires that stream, and the queued job later resumes or rejects after a replacement activation exists
- **THEN** the retired job performs no signed renewal and cannot fault, stale, or otherwise mutate the replacement activation

#### Scenario: A renderer is backpressured
- **WHEN** many complete mark revisions arrive while a Futures renderer cannot drain and an account event also arrives
- **THEN** only the newest mark revision remains queued on the market lane, the account event is not delayed behind obsolete marks, and Spot-only renderers receive no Futures mark frame

#### Scenario: A backpressured renderer leaves Futures
- **WHEN** a renderer has an undelivered position-mark frame and activates another market
- **THEN** the retired Futures frame is removed or superseded before that renderer can drain it after the activation boundary

### Requirement: Position-reducing actions are proved against the current account leg
A close action SHALL derive its order side from the explicit position leg before falling back to signed one-way quantity. Presentation-only valuation fields SHALL NOT be accepted as an account snapshot or command target. Before a renderer-declared reduce-only order bypasses exposure controls, the main process SHALL verify that its side, leg, and size reduce a currently confirmed position; an unproved or contradictory reduction SHALL be rejected without an exchange request.

#### Scenario: A hedge short has a positive internal quantity
- **WHEN** Market Close is requested for an explicit SHORT leg whose internal quantity is positive
- **THEN** the command buys that SHORT leg, never sells into it, and the main process proves the requested size does not exceed the current leg before treating it as reduction

#### Scenario: Ticket submits entry intent in either position mode
- **WHEN** the operator submits a LONG or SHORT Ticket entry while the account may be one-way or hedge mode
- **THEN** the renderer does not forge a raw account leg, and the adapter resolves the order's position side from the actual account mode

#### Scenario: Ticket exits a signed one-way position
- **WHEN** the operator submits a Ticket exit for a positive or negative position whose current raw account leg is `BOTH`
- **THEN** the renderer preserves `BOTH` on the reduce-only command while deriving SELL for the positive position and BUY for the negative position

#### Scenario: Ticket exit has no current raw account leg
- **WHEN** the visible semantic exit cannot be resolved to a current confirmed raw position row
- **THEN** the Ticket does not send the order, and the backend remains independently fail-closed

#### Scenario: Balanced hedge legs are not an empty exit target
- **WHEN** equal LONG and SHORT hedge legs make net exposure zero and the operator stages an exit for one named leg
- **THEN** confirmation shows the selected leg being reduced, projects the resulting net exposure, and does not claim that there is nothing to close

#### Scenario: Selected contract changes under a staged order
- **WHEN** an order is staged for one contract and the Ticket receives another selected contract before confirmation
- **THEN** confirmation synchronously withdraws the staged order, sends nothing, and cannot substitute the new contract into the old price, quantity, or position proof

#### Scenario: A forged or stale reduce-only command arrives
- **WHEN** a reduce-only command names the wrong side, a missing leg, or more quantity than the currently confirmed position
- **THEN** it is rejected locally and cannot bypass the exposure cap or reach Binance as an exposure-increasing order

#### Scenario: Position proof is loading or belongs to a retired activation
- **WHEN** a reduce-only command arrives while the positions resource is loading or its last successful snapshot was admitted under an earlier Futures activation
- **THEN** that snapshot is not reduction authority and the command is rejected without an exchange request

## REMOVED Requirements

### Requirement: An open position's value moves with the market between marks
**Reason**: Carrying a mark forward with independent tape movement creates a synthetic third price that is neither Binance mark nor last trade and contradicts the later mark-authoritative requirement.
**Migration**: Primary uPnL moves only on mark updates; optional tape what-if output is separately named and excluded from totals and risk.

### Requirement: An estimated reading says that it is estimated
**Reason**: The requirement legitimizes a tape-derived primary PnL estimate, which can reverse the sign of the exchange's mark-based uPnL.
**Migration**: Preserve tape/mark disagreement as explanatory secondary detail under the new mark-authoritative requirement.
