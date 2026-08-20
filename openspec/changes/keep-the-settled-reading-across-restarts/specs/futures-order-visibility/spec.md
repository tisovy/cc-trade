## ADDED Requirements

### Requirement: A kept reading is verified against the exchange, not trusted
A reading kept on disk SHALL be re-read whole from the exchange on a cadence the
desk can afford, and what is held SHALL be replaced by what the exchange
answers wherever the two disagree. The disagreement SHALL be recorded.

This is the condition that makes keeping anything safe. A recomputed reading
that is wrong is wrong until the next pass; a kept one is wrong until someone
notices. Where the read has been narrowed enough that a whole window costs one
request per kind of flow, there is no reason to hold a total the desk has not
checked, and the check SHALL therefore not be deferred to a cadence chosen for
cost when cost is no longer the constraint.

A kept reading SHALL never be preferred to the exchange, and SHALL never be the
answer to a question the exchange was not asked.

#### Scenario: The kept reading is verified
- **WHEN** the verification interval passes with a reading loaded from disk
- **THEN** the window is read again from nothing and compared, and the exchange's answer stands wherever they differ

#### Scenario: The kept reading holds a row the exchange no longer states
- **WHEN** a whole-window re-read does not return a row the file holds, inside the span the re-read covered
- **THEN** the row is dropped and the disagreement is recorded, rather than kept because it was once read

### Requirement: A kept reading names the account it was read from
A reading kept across restarts SHALL be stored under a fingerprint of the
credential it was read with, derived so that the credential cannot be recovered
from it, and SHALL be used only when the desk starts against a credential with
the same fingerprint.

The credential itself SHALL NOT be written to the store, to the desk's record, or
to any log.

#### Scenario: The desk restarts against the same account
- **WHEN** the fingerprint of the running credential matches the stored one
- **THEN** the kept reading is loaded and only the span since it ends is read

#### Scenario: The desk starts against another account
- **WHEN** the fingerprints differ
- **THEN** the kept reading is discarded and the window is read from nothing

#### Scenario: The store is read by anyone
- **WHEN** the stored file is inspected
- **THEN** it contains no API key and no secret, in whole or in part
