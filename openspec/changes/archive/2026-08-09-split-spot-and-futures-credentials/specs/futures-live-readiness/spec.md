## Purpose

Refines the startup credential contract so Spot and USDⓈ-M Futures authenticate with independent key pairs and fail closed independently.

## MODIFIED Requirements

### Requirement: Startup credential preflight fails closed
Before initializing market or account functionality for a market, the system SHALL validate the complete credential pair belonging to that market: `BK` and `BS` for Spot, `BFK` and `BFS` for USDⓈ-M Futures. A complete pair SHALL permit production initialization of that market only. A missing or partial pair SHALL produce a market-scoped `CONFIG_ERROR`, emit a sliding error alert naming the market and its missing variable names, and stop all Binance market/account initialization for that market. Credentials belonging to one market SHALL NOT be substituted for the other. When neither market is configured, the system SHALL additionally render a blocking configuration-error screen and start no exchange path at all. The application shell and local diagnostic path MAY remain available solely to present and recover from the error. No credential value SHALL appear in any envelope, alert, or log.

#### Scenario: Both pairs complete
- **WHEN** `BK`, `BS`, `BFK`, and `BFS` are all present
- **THEN** credential preflight reports both markets ready and the application may initialize the persisted production market workspace

#### Scenario: Spot pair only
- **WHEN** `BK` and `BS` are present and the Futures pair is absent
- **THEN** Spot initializes normally, Futures reports a configuration error naming `BFK` and `BFS`, no Futures adapter, user-data stream, or workstation runtime is constructed, and no blocking screen is shown

#### Scenario: Futures pair only
- **WHEN** `BFK` and `BFS` are present and the Spot pair is absent
- **THEN** Futures initializes normally, Spot reports a configuration error naming `BK` and `BS`, no Spot client or Spot trading adapter is constructed, and no blocking screen is shown

#### Scenario: Partial pair fails closed for its market
- **WHEN** exactly one value of a market's pair is present
- **THEN** that market fails closed and identifies its missing configuration field without exposing any secret value, while the other market is unaffected

#### Scenario: Neither pair present
- **WHEN** no complete pair exists for either market
- **THEN** the system shows a sliding missing-credentials alert and a blocking configuration-error screen and starts no Spot or Futures market/account connection, subscription, refresh, or trading command path

#### Scenario: Retired credentials are diagnosed
- **WHEN** retired futures credential names are present but no supported pair is complete
- **THEN** the system stops initialization and presents a migration diagnostic naming the supported configuration fields without logging credential contents

#### Scenario: Credentials are not shared between markets
- **WHEN** only one market's pair is configured
- **THEN** the other market's adapter is never constructed from the configured pair, and no request is signed for the unconfigured market

## ADDED Requirements

### Requirement: Command rejection is market-scoped
A trading, workstation, or market-activation command addressed to a market without a complete credential pair SHALL be rejected with a stable, bounded reason identifying the market and the missing configuration, and SHALL NOT be served by another market's authenticated adapter. Commands addressed to a configured market SHALL be unaffected by the other market's configuration state.

#### Scenario: Activating an unconfigured market
- **WHEN** the renderer requests activation of a market whose credentials are incomplete
- **THEN** the request is rejected with a named configuration reason and no subscription, refresh, timer, or stream starts for that market

#### Scenario: Trading command for an unconfigured market
- **WHEN** a validated trading command targets a market without an authenticated adapter
- **THEN** the command is explicitly rejected, no synthetic acknowledgement is emitted, and the other market remains able to trade

#### Scenario: Verification launches carry no production capability
- **WHEN** the application starts under a safe, smoke, or end-to-end verification entry point
- **THEN** both credential pairs are cleared before preflight and no production trading capability exists in that process
