## Why

In the same 2026-08-22 window that `say-why-the-book-stayed-down` reads, the
recovery could not succeed — the exchange was serving depth snapshots behind
its own stream — and the desk asked hardest exactly then. A recovery round is
up to three snapshot reads, and rounds recur on a flat five-second cooldown per
contract for as long as the condition lasts: the journal holds seven to eight
rounds a minute across the held contracts, for thirteen minutes, each read
answering in 445–1513ms. Every one of those reads bought nothing, spent weight
from the same minute budget the operator's commands ride on, and was aimed at
an exchange that was answering trading commands `-1008` "server overloaded".

A flat cooldown never widens, whatever it learns. Around a hundred rounds stood
in the record for that window; a cooldown that doubled while rounds kept
failing would have run about sixteen, and the book would have come back within
a minute of the exchange recovering either way — a diff is always waiting to
ask.

## What Changes

- The cooldown between failed rebuild rounds doubles from its five-second floor
  up to a one-minute ceiling. One bridged snapshot returns it to the floor.
- A round abandoned because the contract is being released or the session is
  resynchronizing counts as neither failure nor success.
- Unchanged: the three attempts inside a round and their growing bridge delays,
  and the exemption for buying a deeper page of a live book, which is not a
  recovery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: "A book that cannot be built costs the
  book, not the desk" — the background cooldown the book is rebuilt on widens
  while rebuilds keep failing, bounded by a stated ceiling.

## Impact

`electron/services/futures-production-workstation-service.js` only: one ceiling
beside the existing recovery constants, one per-session count of consecutive
failed rounds, and the arithmetic of `recoverBook`'s cooldown gate. Builds on
the same function `say-why-the-book-stayed-down` touches and lands after it.
The renderer, the protocol and the record are untouched; the book is stale
while it is down and says so, exactly as before.
