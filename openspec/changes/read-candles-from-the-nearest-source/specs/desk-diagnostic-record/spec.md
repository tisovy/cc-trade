## ADDED Requirements

### Requirement: A candle read names its source
Every read of candles from the local candle store SHALL leave one timing line
naming the read (`candle-store-window` or `candle-store-page`), the contract,
how long it took, whether the store served the whole span (`hit`), had less
than the whole (`miss`, with the code), failed (with the transport's code),
was abandoned by the session that asked (`aborted`) or was skipped inside the
cooldown after a failure. A store that is off or whose address was refused
SHALL be stated once per session with its code. No price, size or row SHALL
enter these lines.

The day's summary SHALL count candle windows and pages by source — store,
exchange — and SHALL state the exchange weight the store's pages did not
spend, so that a day can be asked what the store saved and whether it was
there. A read the session abandoned SHALL be counted apart from the store's
failures.

#### Scenario: A page from the store
- **WHEN** a history page is served by the store
- **THEN** the record carries a `candle-store-page` line with `hit`, and no `candle-history` line for that page

#### Scenario: The store falls short
- **WHEN** the store holds less than the whole span asked for
- **THEN** the record carries the line with `miss` and the code, followed by the exchange's own line for the read that took its place

#### Scenario: The store is unreachable
- **WHEN** the store does not answer
- **THEN** the record carries the line with the failure's code, and the reads inside the cooldown that follows are recorded as skipped

#### Scenario: The summary is read
- **WHEN** the operator reads the day's summary
- **THEN** it states windows and pages from the store and from the exchange, and the weight not spent
