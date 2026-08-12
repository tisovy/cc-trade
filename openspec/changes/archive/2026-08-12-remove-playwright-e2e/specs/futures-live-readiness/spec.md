## MODIFIED Requirements

### Requirement: Command rejection is market-scoped
A trading, workstation, or market-activation command addressed to a market without a complete credential pair SHALL be rejected with a stable, bounded reason identifying the market and the missing configuration, and SHALL NOT be served by another market's authenticated adapter. Commands addressed to a configured market SHALL be unaffected by the other market's configuration state.

#### Scenario: Activating an unconfigured market
- **WHEN** the renderer requests activation of a market whose credentials are incomplete
- **THEN** the request is rejected with a named configuration reason and no subscription, refresh, timer, or stream starts for that market

#### Scenario: Trading command for an unconfigured market
- **WHEN** a validated trading command targets a market without an authenticated adapter
- **THEN** the command is explicitly rejected, no synthetic acknowledgement is emitted, and the other market remains able to trade

#### Scenario: Verification launches carry no production capability
- **WHEN** the application starts under the retained safe-development or bounded-smoke verification entry
- **THEN** both credential pairs are cleared before preflight and no production trading capability exists in that process
