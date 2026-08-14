## ADDED Requirements

### Requirement: A market too quiet to bridge still opens its book
The desk bridges a depth snapshot to the diff stream by finding the buffered
diff that spans the snapshot's update id. Where no diff has been published at
all — the contract's book has not changed since the snapshot was taken — the
snapshot IS the current book, and the desk SHALL go live on it rather than
treating the absence as a failure. The bridge is then owed to the first diff
that arrives: it SHALL be accepted if it continues from the snapshot's update id
or spans it, and a diff that begins beyond the snapshot proves updates were
missed and SHALL be treated as the sequence gap it is. A snapshot that a
buffered diff proves stale SHALL still be refused.

#### Scenario: A contract nobody is trading is opened
- **WHEN** a snapshot is read and no depth diff has been delivered for the contract at all
- **THEN** the book goes live on that snapshot and the panel draws it, rather than the snapshot being read again

#### Scenario: The market moves after a quiet start
- **WHEN** the first diff arrives after a book went live on an unbridged snapshot, continuing from or spanning its update id
- **THEN** it is applied, and the book carries on from it

#### Scenario: Updates were missed before the first diff
- **WHEN** the first diff after such a snapshot begins beyond the snapshot's update id
- **THEN** the book is rebuilt from a fresh snapshot rather than applying it

#### Scenario: A buffered diff proves the snapshot stale
- **WHEN** a diff already buffered begins beyond the snapshot's update id
- **THEN** the snapshot is refused and read again, as it is today

### Requirement: A book that cannot be built costs the book, not the desk
A depth bootstrap that cannot be bridged SHALL NOT resynchronize the session.
The desk SHALL come live without the book — chart, candles, header and tape
delivering — with the book marked stale and rebuilt in the background on its own
cooldown, exactly as a live book already answers a sequence gap. The aggregate
timing SHALL distinguish a session that reached live with its book from one that
reached live without it.

#### Scenario: The book cannot be bridged at startup
- **WHEN** every snapshot attempt of a bootstrap fails to bridge
- **THEN** the session reports `live`, the header, candles and tape keep being delivered, and the book is reported stale rather than the workspace going to `RESYNCHRONIZING`

#### Scenario: The book is rebuilt afterwards
- **WHEN** a later recovery bridges a snapshot for a session that came live without its book
- **THEN** the book is delivered live to the panel without the session having been rebuilt

#### Scenario: The timing log is read afterwards
- **WHEN** a session comes live without its book
- **THEN** its aggregate timing says so, distinctly from a session that came live with one and from one that failed

### Requirement: A fault the desk recovered from is written down
Every internal fault the desk absorbs — a bootstrap that could not bridge, a
book recovery, a rejected stream frame, a history read that failed — SHALL reach
the operator's log naming the phase it happened in and the reason code, in the
operator's own build and not only under test. The line SHALL carry the code and
nothing from the market payload. Reasons that differ SHALL NOT share a code.

#### Scenario: A bootstrap cannot bridge its snapshot
- **WHEN** the book fails to bridge because no snapshot could be bridged, or because the buffer had a hole in it
- **THEN** the log names the phase and a reason code distinct to each of the two

#### Scenario: The desk is running the operator's own build
- **WHEN** any of these faults happens outside a test
- **THEN** it is logged, rather than being reported to a reporter nothing was wired to
