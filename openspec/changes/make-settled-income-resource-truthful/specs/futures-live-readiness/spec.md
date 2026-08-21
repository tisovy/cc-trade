## MODIFIED Requirements

### Requirement: Account synchronization is observable per resource
The system SHALL expose synchronization state independently for balances, positions, regular open orders, algorithmic open orders, settled income, and the futures user-data stream. Each resource state SHALL distinguish at least loading, ready, stale, and error, include the time of the last successful update when available, and retain the last confirmed data during a retry failure rather than replacing it with an empty snapshot. An attempted time SHALL NOT replace or masquerade as a successful time.

#### Scenario: Initial account synchronization succeeds
- **WHEN** all required signed account resources return valid responses
- **THEN** each resource becomes ready and exposes its successful update time

#### Scenario: Initial balance synchronization fails
- **WHEN** the signed balance request fails before any balance snapshot exists
- **THEN** balances enter error state, available USDT remains unavailable rather than zero, and the ticket displays a sanitized actionable reason

#### Scenario: Refresh fails after a successful snapshot
- **WHEN** a resource refresh fails after that resource previously became ready
- **THEN** the system retains the last confirmed snapshot, marks it stale, and exposes the refresh failure and last-success time

#### Scenario: Zero balance is valid data
- **WHEN** a successful balance response reports zero available USDT
- **THEN** the system reports a ready balance resource with zero funds and does not misclassify it as a synchronization failure

#### Scenario: Initial settled-income synchronization fails
- **WHEN** the first settled-income request fails before any confirmed reading exists
- **THEN** settled income enters error state and is not represented as a ready empty ledger

#### Scenario: Settled-income verification fails
- **WHEN** settled income was previously ready and a verification attempt fails
- **THEN** its last confirmed rows and successful time remain visible, the resource becomes stale, and the failure is independently retryable
