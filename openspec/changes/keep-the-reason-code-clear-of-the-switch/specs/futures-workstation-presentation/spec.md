## MODIFIED Requirements

### Requirement: Chrome states only what the desk reads
The market header SHALL NOT repeat mark price or basis, SHALL colour funding by
its sign, and the trading rail header SHALL NOT repeat the market identity or
the selected symbol shown elsewhere. Direction controls SHALL be coloured by
direction. Account funds in the ticket — the available balance and the value of
the working orders — SHALL be shown in whole USDT: at six and seven figures the
cents never change a decision and cost a glance on every read.

The workstation identity bar SHALL be the single routine state location. While
the workstation market state is live and any authenticated Futures account
resource is initially synchronizing or refreshing, its state pill SHALL read
`SYNC` in place of `LIVE`; it SHALL return to `LIVE` when synchronization is no
longer in progress. The contract section and trading ticket SHALL NOT repeat a
routine market, readiness, `READY`, or `SYNC` badge. A non-routine disconnected,
stale, or unavailable market state and its reason SHALL remain disclosed, and
this consolidation SHALL NOT suppress an actionable account or command failure.

A disclosed reason SHALL be readable in full: at desktop widths the market-mode
switch overlay SHALL NOT cover any part of the reason code, and the identity bar
SHALL give the reason room below the switch's extent rather than flowing it
through the centre span the switch hangs over.

#### Scenario: Funding is negative
- **WHEN** the funding rate is negative
- **THEN** it is rendered in the negative colour, and positive funding in the positive colour

#### Scenario: Operator reaches for a direction
- **WHEN** the long and short controls are displayed
- **THEN** long controls carry the positive colour and short controls the negative colour, so direction is readable without reading the label

#### Scenario: Balance carries exchange precision
- **WHEN** the exchange reports an available balance such as `245228.33961912`
- **THEN** the snapshot keeps that value exactly, and the ticket shows `245228 USDT` — rounded rather than truncated — as it shows the value of the working orders

#### Scenario: Account refresh begins on a live workstation
- **WHEN** one or more authenticated Futures account resources enter their synchronization state while the workstation market state remains live
- **THEN** the identity state changes from `LIVE` to `SYNC`, and no second routine synchronization badge appears in the contract section or ticket

#### Scenario: Account refresh settles
- **WHEN** no authenticated Futures account resource remains in its synchronization state and the workstation market state is live
- **THEN** the identity state returns from `SYNC` to `LIVE`

#### Scenario: Market state is not routine
- **WHEN** the workstation becomes disconnected, stale, or unavailable
- **THEN** the identity bar discloses that non-routine market state and its reason rather than replacing it with `LIVE`

#### Scenario: The desk degrades at a mid-width window
- **WHEN** the workspace is 1366px wide and a degradation reason is shown
- **THEN** the mode switch does not cover any part of the reason code, which sits fully visible below the switch's extent
