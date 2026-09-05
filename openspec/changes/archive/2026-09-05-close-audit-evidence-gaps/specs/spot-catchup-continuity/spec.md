## Purpose

Complete a current Spot account baseline when private events supersede in-flight reads.

## ADDED Requirements

### Requirement: Superseded Spot account reads retain catch-up demand

When a Spot account read is discarded because a private event or mutation superseded its epoch, the active renderer's existing refresh owner SHALL coalesce demand for a fresh pass. The stale result SHALL NOT be emitted. The replacement SHALL remain rate-limited and SHALL NOT send trading mutations or revive a retired renderer or market.

#### Scenario: A private balance delta arrives during initial REST catch-up

- **WHEN** the delta invalidates the pending full account read
- **THEN** the old full snapshot is discarded and a current full snapshot is requested so balances and PnL can become ready

#### Scenario: Several events supersede one account pass

- **WHEN** multiple private events arrive before that pass completes
- **THEN** replacement demand is coalesced through the existing single-flight owner

#### Scenario: Catch-up invalidates an explicit symbol history refresh

- **WHEN** a private event supersedes a symbol-scoped refresh or a newer symbol refresh is already queued
- **THEN** generic catch-up demand preserves the explicit history symbol instead of silently removing the history read

#### Scenario: The renderer leaves before a stale read completes

- **WHEN** Spot is deactivated or the renderer closes before completion
- **THEN** completion does not emit the stale state or restart account activity
