## ADDED Requirements

### Requirement: Restoring the private stream is not queued behind a review
The request that starts or restores the authenticated user-data stream SHALL be
admitted ahead of reads the operator merely asked to look at. Where both contend
for the same rate-limited admission queue, the desk SHALL NOT stay without its
authenticated stream for the length of a history fan-out.

The overtaking SHALL remain bounded, so a history read already under way still
finishes.

The keep-alive renewal of an existing key is not covered by this requirement: it
runs far enough inside the key's lifetime that queue order cannot expire it.

#### Scenario: The stream drops while the operator is reading their history
- **WHEN** the authenticated stream has to be rebuilt while a history fan-out is queued
- **THEN** the listen-key request is admitted ahead of the fan-out's remaining requests, and the fan-out still completes
