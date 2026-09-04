## ADDED Requirements

### Requirement: Only the current chart selection may finish opening

Each opening of a Spot pair and interval SHALL supersede every previous opening,
including an earlier opening of the same pair and interval. An abandoned cache
read SHALL NOT change the chart, loading indicators, or detail subscription.
While the current opening awaits its cache, the chart SHALL contain no rows or
queued updates from the previous selection. Detail frames for the abandoned
selection SHALL NOT enter the current view or its cache.

#### Scenario: Cache reads finish in reverse order
- **WHEN** ETHUSDT is selected, then SOLUSDT, and ETHUSDT's cache finishes last
- **THEN** SOLUSDT remains selected, drawn, and subscribed, with its loading state unchanged by ETHUSDT

#### Scenario: An interval or repeated selection supersedes an opening
- **WHEN** the operator changes interval or selects A, then B, then A before the first A read finishes
- **THEN** only the latest opening may publish its cached rows and detail subscription

#### Scenario: Old live data arrives while the cache is pending
- **WHEN** a previous selection's detail frame or queued chart update arrives before the new cache finishes
- **THEN** no previous-selection candle, trade or depth enters the new view

#### Scenario: The current cache read fails
- **WHEN** the current selection's cache read rejects or returns no candles
- **THEN** the chart remains empty until the live data arrives and the current live subscription is still requested

#### Scenario: Spot is disabled or unmounted during a read
- **WHEN** a cache read completes after Spot is disabled or its provider is unmounted
- **THEN** it does not publish a chart or subscription, and re-enabling Spot opens the latest selection rather than an abandoned one

#### Scenario: A panel preference changes while the cache is pending
- **WHEN** a non-selection panel setting changes before the current cache read completes
- **THEN** the subscribed panel retains that newer setting
