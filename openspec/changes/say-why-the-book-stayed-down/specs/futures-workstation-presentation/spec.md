## MODIFIED Requirements

### Requirement: A fault the desk recovered from is written down
Every internal fault the desk absorbs — a bootstrap that could not bridge, a
book recovery, a rejected stream frame, a history read that failed — SHALL reach
the operator's log naming the phase it happened in and the reason code, in the
operator's own build and not only under test. The line SHALL carry the code and
nothing from the market payload. Reasons that differ SHALL NOT share a code.

A rebuild of the book SHALL be asked for under the name of what happened. A
live chain that broke, a diff arriving on a book that is already down, and a
bootstrap buffer that overflowed before a snapshot bridged are three different
conditions, and the code the record carries decides where the reader looks —
at the stream, or at the snapshot that would not bridge. A book that stays down
while its recoveries fail SHALL NOT be recorded as a fresh sequence break on
every diff that lands on it.

An attempt inside a recovery that read its snapshot and could not bridge it
SHALL state the same bridging reason the initial bootstrap states — the
snapshot could not be tied to the stream, or the buffered diffs had a hole in
them — rather than moving to the next attempt without a word. A recovery that
leaves the book down having said only why it started has told the reader where
it was standing, not why it stayed there.

#### Scenario: A bootstrap cannot bridge its snapshot
- **WHEN** the book fails to bridge because no snapshot could be bridged, or because the buffer had a hole in it
- **THEN** the log names the phase and a reason code distinct to each of the two

#### Scenario: The desk is running the operator's own build
- **WHEN** any of these faults happens outside a test
- **THEN** it is logged, rather than being reported to a reporter nothing was wired to

#### Scenario: A live book's chain breaks
- **WHEN** a diff arrives that does not continue the live book's sequence
- **THEN** the rebuild it asks for is recorded as a sequence gap

#### Scenario: Diffs keep landing on a book already down
- **WHEN** the book is down awaiting a rebuild and the stream keeps delivering
- **THEN** a rebuild a further diff asks for is recorded as the book being down, not as another sequence gap

#### Scenario: A recovery reads a snapshot it cannot bridge
- **WHEN** an attempt inside a recovery reads its snapshot and fails to bridge it
- **THEN** the record carries that attempt's bridging reason, under the same code the initial bootstrap would state
