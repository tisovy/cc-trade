## ADDED Requirements

### Requirement: Spot reads reserve the weight of their actual query scope

Spot account refresh SHALL declare weight 20 for balances, 80 for all-symbol open orders and 20 for symbol trade history without orderId. Public detail bootstrap SHALL declare exchangeInfo weight 20 and recent trades weight 25. Correcting weights SHALL NOT narrow the account snapshot or change renderer payloads.

#### Scenario: Refresh a selected symbol's account information

- **WHEN** balances, all-symbol open orders and selected-symbol trades are requested
- **THEN** their declared weights total 120 and the open-orders request still omits symbol

#### Scenario: Catch up a private subscription without a selected symbol

- **WHEN** balances and all-symbol open orders are requested
- **THEN** their declared weights total 100 and no trade-history request is invented

#### Scenario: Bootstrap public detail data

- **WHEN** exchange info, 100 recent trades, limit-100 depth and klines are requested
- **THEN** their declared weights are 20, 25, 5 and 2 respectively

### Requirement: Every legacy retry takes its own admission

In non-physical mode, RateLimiter SHALL reserve capacity and spacing before every attempt. Failed attempted requests SHALL keep their charges. A retry SHALL NOT run before its own admission succeeds. Cancellation SHALL prevent unadmitted retries. Futures physical-mode accounting and existing retry counts SHALL remain unchanged.

#### Scenario: A read succeeds on its second attempt

- **WHEN** a weight-30 read fails with a retryable network error and the retry succeeds
- **THEN** two admissions reserve total weight 60

#### Scenario: A retry cannot fit in the current window

- **WHEN** the first attempt consumed the remaining capacity
- **THEN** the retry waits for capacity instead of reusing the first reservation

#### Scenario: Cancel while the retry waits

- **WHEN** the caller aborts before retry admission
- **THEN** no retry is invoked or charged and the first attempt's charge remains

#### Scenario: Futures transport retries

- **WHEN** physical-mode execution retries a transport operation
- **THEN** only the transport's physical admissions charge weight with no extra legacy reservation
