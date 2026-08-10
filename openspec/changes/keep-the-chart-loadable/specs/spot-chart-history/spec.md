## MODIFIED Requirements

### Requirement: Loaded depth survives a restart
A closed candle already held as history SHALL NOT be read from the exchange
twice across runs. Every delivered history page SHALL be written to the local
store together with the run it joined, the stored run SHALL be bounded per pair
and interval, and a store that is unavailable SHALL degrade to reading from the
exchange rather than fail the chart. The live bootstrap window that opens a pair
SHALL be read on every start, because only the exchange can say what the current
candle is; it is the one read this requirement does not eliminate.

#### Scenario: The pair is reopened after a restart
- **WHEN** depth for a pair and interval was loaded in an earlier run
- **THEN** it is presented on open from the local store with no history request issued

#### Scenario: The stored run no longer reaches the live window
- **WHEN** the app was closed long enough that the stored run and the live window do not touch
- **THEN** the run that reaches the present is kept and no hole is presented as continuous data

#### Scenario: The local store cannot be read
- **WHEN** IndexedDB is unavailable
- **THEN** the chart opens on its live window and history is read from the exchange as usual

#### Scenario: A cold start opens a stored pair
- **WHEN** a pair with stored depth is opened in a new run
- **THEN** the live bootstrap window is read once and joined to the stored depth, and no history page already stored is requested again

## ADDED Requirements

### Requirement: A failed history read leaves history loadable
A history read that cannot be served SHALL produce a failure answer naming the
request it answers. The requester SHALL release its in-flight lock on that
answer, so the next scroll issues a new read, and SHALL tell the operator that
older candles could not be loaded — once per failure, not once per scroll.

#### Scenario: The exchange read fails
- **WHEN** a history read fails at the exchange or in transport
- **THEN** the operator is told, and scrolling left again issues a fresh read

#### Scenario: Repeated scrolling during a failure
- **WHEN** the operator keeps scrolling while reads are failing
- **THEN** the failure is stated once per failed read rather than once per scroll event, and reads remain bounded to one in flight

### Requirement: The series ceiling is enforced wherever the series grows
The per-pair, per-interval candle ceiling SHALL be enforced on every path that
adds rows — the merge of history, the prepend of an older page and the append of
a live candle. The newest rows SHALL be the ones kept.

#### Scenario: A long live session
- **WHEN** live candles are appended past the ceiling
- **THEN** the oldest rows are dropped and the series stays at the ceiling

#### Scenario: History paged in
- **WHEN** older pages are prepended past the ceiling
- **THEN** the series stays at the ceiling and the live end is never dropped

### Requirement: Calendar intervals are compared by calendar step
Continuity between two runs of candles SHALL be decided using the interval's own
step. An interval whose length varies by calendar — a month above all — SHALL
NOT be compared against a fixed millisecond constant.

#### Scenario: Consecutive monthly candles of unequal length
- **WHEN** a 31-day month follows a 28-day month
- **THEN** the two candles are continuous and neither run is discarded

#### Scenario: A genuine gap between monthly candles
- **WHEN** a month is missing between two monthly candles
- **THEN** the gap is detected and no hole is presented as continuous data
