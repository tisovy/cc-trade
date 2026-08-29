## ADDED Requirements

### Requirement: A fault of the book costs the book, not the session

When reading a stream frame raises the order book's own refusal — a crossed
book, an update the book's rules reject — the workstation SHALL rebuild the
book and nothing else, under the refusal's own code, whatever stream the frame
arrived on and however its name is spelled. A depth-stream frame the desk
cannot read SHALL likewise cost only the book, and the stream's name SHALL be
read in the exchange's own spelling, so a unicode listing's depth frames are
depth frames. Only an unreadable frame from the traded streams — price,
candles, tape — is worth the whole session.

Classified by an ASCII name instead, a unicode listing's every crossed book
became a full resynchronization: on 2026-08-28 the workspace on 龙虾USDT left
`live` every 20 to 60 seconds while the pair pumped, ~90 weight a round, for a
fault the book had already contained.

#### Scenario: The book crosses on a unicode listing

- **WHEN** a depth diff leaves the book crossed on a contract whose ticker the exchange spells outside ASCII
- **THEN** the book recovers under `CROSSED_ORDER_BOOK`, and the session neither resynchronizes nor leaves `live`

#### Scenario: A depth frame for a unicode listing cannot be read

- **WHEN** a frame from the listing's depth stream is refused by the parser
- **THEN** the book recovers under `MALFORMED_DEPTH_FRAME`, exactly as it would for an ASCII contract

#### Scenario: A traded stream's frame cannot be read

- **WHEN** a frame that is not from the depth stream cannot be read
- **THEN** the session resynchronizes under `MALFORMED_STREAM_FRAME`, exactly as before this change
