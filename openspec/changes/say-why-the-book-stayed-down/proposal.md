## Why

On 2026-08-22, between 05:11Z and 05:24Z, Binance futures ran a degradation
window: order commands came back `-1008` "server overloaded", and REST depth
snapshots were served behind the live diff stream, so no book could bridge. The
desk's journal for those thirteen minutes says `book-recovery
DEPTH_SEQUENCE_GAP`, over and over — 122 for the day against 3–35 on an
ordinary one. But the stream broke once per book. Every line after the first is
the same downed book being relabeled: a diff arriving on a book that is waiting
for a rebuild answers `resync`, and the depth branch of `handleStreamFrame`
maps every `resync` to `DEPTH_SEQUENCE_GAP`, whichever of three different
conditions produced it.

And the reason the book stayed down was never written at all. `recoverBook`
reads a snapshot, tries to bridge it, and on failure moves to the next attempt
with `if (!session.orderBook.bootstrap(snapshot).live) continue;` — dropping
the reason the order book just stated. The two bridging failures already have
codes (`DEPTH_BOOTSTRAP_NOT_BRIDGED`: the snapshot could not be tied to the
stream, which is what an exchange serving stale snapshots looks like;
`DEPTH_BOOTSTRAP_BUFFER_GAP`: the desk's own buffer had a hole), but only the
initial bootstrap path writes them. Today's four cold bootstraps were the only
lines in the record naming the real condition; the diagnosis needed the service
code read beside the journal. The spec already promises "Reasons that differ
SHALL NOT share a code", and the recovery path does not keep it.

## What Changes

- A rebuild is asked for under the name of what happened. A broken live chain
  stays `DEPTH_SEQUENCE_GAP`. A diff landing on a book that is already down
  becomes `DEPTH_BOOK_DOWN`. A bootstrap buffer that overflowed before a
  snapshot bridged becomes `DEPTH_BUFFER_OVERFLOW`.
- A recovery attempt whose snapshot fails to bridge writes the same bootstrap
  code the initial path writes, one line per failed attempt, instead of failing
  without a word.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: the requirement "A fault the desk
  recovered from is written down" now holds on the recovery path as it already
  does on the initial bootstrap.

## Impact

`electron/services/futures-production-workstation-service.js` only: the depth
branch of `handleStreamFrame` and the attempt loop of `recoverBook`. The
diagnostic record accepts codes by shape, so nothing changes in the record, the
protocol, or the renderer. A code the journal has carried until now keeps its
meaning — after this change `DEPTH_SEQUENCE_GAP` is always a live chain that
broke, which is what it has always read as.
