## ADDED Requirements

### Requirement: A candle-history request settles from the answer issued for it
A completed candle-history response SHALL be applied from the workstation event that carried that response, not re-read from a resource snapshot that a later status event may have rewritten. A rejection issued before a session can own and serve the history request SHALL be returned as an explicit unavailable workstation outcome carrying the subscription request identity and selection, without claiming a resource generation or revision. Either kind of answer SHALL release only the matching in-flight read; a failure SHALL leave loaded rows intact, SHALL NOT imply exhaustion, and SHALL allow the next scroll to retry.

#### Scenario: A served page and an outage arrive in one renderer cycle
- **WHEN** a complete live candle-history page is followed by an outage event before the renderer commits the page
- **THEN** the rows from the live page are applied and the later outage does not reclassify or discard that answer

#### Scenario: The workstation no longer owns the history request
- **WHEN** the backend refuses a candle-history command because its request, contract or interval is no longer owned
- **THEN** it emits a bounded unavailable history outcome naming that subscription request, contract, interval and end time so a matching renderer releases the read and may ask again

#### Scenario: An ownership refusal belongs to an abandoned selection
- **WHEN** an unavailable history answer names a request or selection the renderer no longer waits for
- **THEN** the renderer ignores it and does not release or alter the current selection's in-flight read
