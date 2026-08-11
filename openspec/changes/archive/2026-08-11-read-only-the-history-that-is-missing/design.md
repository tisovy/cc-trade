## Context

See `proposal.md` for the cost and operator motivation. The implementation is
split across two processes: IndexedDB and the held review live in the renderer,
while income discovery, the authenticated user-data stream, the REST limiter,
and the Binance adapter live in Electron's backend. Consequently, the backend
cannot inspect the persisted store directly, and the renderer cannot decide
whether the authenticated stream stayed connected. The typed history command is
the boundary where those two pieces of knowledge have to meet.

The existing store already records terminal rows per contract with `readAt`,
`orderCursor`, and `tradeCursor`. The adapter already accepts digit-string
`fromOrderId` / `fromTradeId` identities. The remaining work must compose those
pieces without changing the account limiter's 150 ms admission spacing or the
twelve-contract fan-out bound.

## Goals / Non-Goals

**Goals:**

- Carry bounded, validated per-contract coverage from the held renderer review
  to the backend and return enough read metadata to merge gap reads correctly.
- Let a continuously connected authenticated stream vouch for unchanged
  contracts, while stream activity and reconnects invalidate only the trust
  they actually invalidate.
- Re-read one otherwise skipped contract per incremental refresh, so every
  contract in the twelve-contract fan-out is proved again within at most twelve
  such refreshes.
- Use fresh persisted coverage as discovery after a restart and expose a
  separate, explicit full re-read that bypasses every cache and cursor.
- Keep empty-but-covered contracts useful: "no terminal rows" is still a read
  result and still names a contract for persisted discovery.

**Non-Goals:**

- Changing the 150 ms limiter spacing, the 800/minute local bucket, endpoint
  weights, or the twelve-contract fan-out.
- Persisting mutable working orders or trusting renderer-provided stream state.
- Removing the existing bounded income walk or making an incremental gap
  unbounded in memory; the store's existing row bounds remain authoritative.
- Treating automated checks as the live-data confirmation in task 5.2, or
  archiving the change before the operator supplies that confirmation.

## Decisions

### 1. Make coverage an optional, bounded wire contract

`account.history` carries `coverage`, keyed by uppercase contract, with a safe
integer `readAt` and optional digit-string order/trade cursors, plus a boolean
`full`. Command validation accepts at most the store's 24 contracts, strips
unusable entries, and never coerces an exchange identity through `Number`.

The renderer sends the coverage it is currently presenting. The backend returns
`readFrom` per successfully read contract and endpoint. A non-null origin means
the returned page is a gap to merge with held rows; a null origin means that
endpoint was read in full and replaces the held rows for that endpoint and
contract. This per-endpoint distinction is necessary because a contract may
have an order cursor but no trade cursor (or the reverse).

Alternatives considered:

- Sending stored rows to Electron would duplicate a potentially large account
  review across a command and make the backend another store owner.
- A single payload-level `incremental` flag cannot represent mixed cursor/no-
  cursor endpoints or newly discovered contracts in the same fan-out.

### 2. Derive renderer coverage from reads, never from stream-folded rows

For each successfully read contract, the held review advances cursors from the
rows returned by REST and stamps that contract with the receive time. Gap reads
merge into older held rows; full reads replace only the endpoint and contract
they actually covered. Skipped and failed contracts retain their rows and their
older coverage. The review-wide `readAt` remains the oldest per-contract stamp,
so rotating one contract cannot make the whole review look freshly proved.

Stream-folded rows remain visibly "added since" and do not advance a REST
cursor until a REST gap returns them. This preserves the distinction between an
event observed and a range proved. The IndexedDB writer continues to derive its
cursors from the terminal rows it actually stores. It receives the same
per-endpoint `readFrom`: cursor-origin rows merge into the stored endpoint, while
null-origin rows replace it, so a full read cannot discard a row on screen and
then resurrect it from storage after restart. The held review and store share
the same per-contract bounds (200 orders and 1,000 trades), including rows folded
from the stream.

An IndexedDB record with no rows is restored as a ready, empty reading rather
than discarded. Its coverage is still the useful answer that the contract was
read and had no terminal history at that point.

Alternatives considered:

- Advancing a cursor from a stream event could skip an exchange row if the
  event and REST representations differ or an event was missed.
- Stamping every payload with `Date.now()` would falsely refresh contracts the
  backend deliberately skipped.

### 3. Keep stream trust in the backend as an epoch plus activity revisions

Electron owns a stream-connected flag, an invalidation epoch, a per-contract
activity revision, and the revision/epoch last proved by a successful history
read. Any order/execution event advances that contract's activity revision.
Loading, failure, close, replacement, or deactivation of the authenticated
stream ends the connected interval; a subsequent history refresh therefore
reads every covered contract. A successful read is marked vouched only if the
same connected epoch and activity revision still hold when both endpoint reads
finish, preventing an in-flight stream event from being cleared accidentally.
The proof also records the resulting order/trade cursors. A contract is skipped
only when the requesting renderer supplies those same cursors; this prevents a
new or second renderer with an older local reading from borrowing another
renderer's newer proof and leaving its own gap unread.

Every history command is also bound to both the shared Futures activation and
the requesting renderer's market activation. Deactivation stops further REST
admissions and suppresses the obsolete answer. Closing the last renderer
advances the shared activation before clearing discovery, so a request already
in flight cannot repopulate the cache after teardown.

For an ordinary refresh, contracts with no coverage, an unvouched epoch, or new
activity are read from their supplied cursors. From the remaining skipped set,
one round-robin contract is also read. With a fan-out of at most twelve, a stable
skipped contract is re-read within twelve refreshes. The rotation slot advances
past already-dirty contracts rather than spending its proof on work that was
already required.

Alternatives considered:

- Renderer connection state describes the local WebSocket, not Binance's
  authenticated stream, and therefore cannot vouch for exchange events.
- A boolean dirty set cleared after a read loses an event that arrives while
  the REST request is in flight; revisions make the race explicit.

### 4. Page forward only when a cursor proves there is a gap

For a non-null cursor, each endpoint is read forward until a page is short,
deduplicating the inclusive cursor row and advancing with digit-string identity
comparison. A no-progress page stops defensively. A null cursor keeps the
existing newest-page/full-window behavior; it is not paged backwards, because
the Binance endpoint does not provide that traversal and the existing bounded
review deliberately keeps only its configured depth. While a large gap is
traversed, Electron retains only the newest configured endpoint depth, so the
number of pages does not become an unbounded in-memory payload.

The adapter projects safe numeric JSON identities and already-string identities
to digit strings before they enter the pager. A numeric value that has already
exceeded JavaScript's safe-integer range is discarded rather than promoted into
a rounded cursor that could skip a real exchange row.

Alternatives considered:

- Adding one to an opaque exchange identity is unnecessary and risks encoding
  assumptions about identity width; reusing the last identity is supported by
  the inclusive endpoint and deduplication guarantees progress.

### 5. Treat fresh store coverage as persisted discovery

Coverage entries whose `readAt` is inside the seven-day review window are
ordered newest-first and used as the persisted discovery answer. Stale entries
are excluded: every row they could have proved predates the moving window. If at
least one fresh entry remains, Electron combines it with the current selected
contract, live positions/orders, and stream-dirty contracts and issues no
income request. The answer remains `discoveryComplete: false`, because a bounded
store cannot claim it names every contract the account traded.

If no fresh coverage exists, the existing recent-day-then-rest-of-week income
walk runs. The backend's ten-minute in-memory discovery remains the first cache
inside a run. `full: true` bypasses both caches, walks the complete bounded
window, and reads every selected fan-out contract without cursors.

Each income half-window keeps its inclusive `startTime`/`endTime` fixed and
advances Binance's numbered `page`. Advancing `startTime` from the last row is
not safe: a full page may end in the middle of several income rows sharing one
millisecond, and moving beyond it would silently omit the remaining contracts.
A short numbered page still proves completion; a full fourth page keeps the
existing bounded walk and reports discovery as incomplete.

Fresh coverage is still unioned into an in-memory discovery answer. Coverage can
grow after that answer was created when a stream event names a newly closed
contract; omitting that union would hide the new contract from rotation and from
the mandatory all-contract read after reconnect until the ten-minute hold ended.

The store hydration effect always settles a `historyStoreReady` state. The
workstation waits for it before its opening decision: no stored reading triggers
the existing opening read, while a stored reading (including a covered empty
one) is presented without an automatic history request. The normal ↻ remains
the cheap incremental refresh; a separate visible Full control sends
`full: true`.

Alternatives considered:

- Resetting a persisted record's age merely because it was sent in a command
  would let obsolete discovery live forever.
- Making ↻ itself full would preserve the current cost and contradict the
  session's latency goal.

### 6. Keep cost bounds explicit in tests

One idle rotation reads two endpoints at weight 5: 10 weight and two 150 ms
admissions. The stated worst full read remains eight income pages at weight 30
plus two reads for twelve contracts at weight 5: 360 weight and 32 admissions.
The idle refresh is therefore 1/36 of that weight (about 2.8%) without changing
either operational limit.

### 7. Filter cancelled orders only at the presentation boundary

`FuturesHistoryPanel` derives its visible order rows from the held reading and
omits normalized `CANCELED` and `CANCELLED` statuses. The hook, held review,
IndexedDB store, and backend payload remain unchanged. Keeping cancelled rows
underneath the panel preserves the greatest order identity as the next cursor
and prevents a cosmetic preference from making the next gap read start too far
back or claim incomplete coverage.

Filtering both spellings accepts Binance's canonical `CANCELED` value and older
or normalized payloads that use `CANCELLED`. The visible reach statement is
derived from the visible rows, while contract coverage continues to describe
the unmodified exchange reading.

### 8. Stress the aggregate App ingress without weakening per-frame bounds

The stress proof renders `App` with its real Gateway, Futures workspace,
workstation hook, protocol parser, and visible workstation view. It generates
valid depth events below the existing 256 KiB per-event ceiling until each
synthetic 100 ms market cycle carries at least 2 MiB in aggregate. Consecutive
cycles advance generation/revision identities exactly as production events do.

After every cycle, React is allowed to settle and the proof requires the newest
book identity to be visible, the workstation to remain live, and an operator
control to answer. Reaching the newest event at each boundary is also the
observable proof that the renderer has no growing event backlog. The fixture
counts UTF-8 bytes from the serialized frames rather than estimating object
size, and keeps both the cycle count and row counts fixed so the full suite
remains deterministic.

A single 2 MiB event is deliberately not used: production events have a 256 KiB
defensive limit. Disabling that protection for a load test would test a wire
shape the application is designed to refuse rather than real aggregate load.

## Risks / Trade-offs

- [A very large gap can require several forward pages] → Stop on a short or
  no-progress page, keep identities as strings, and retain the store's bounded
  rows; targeted tests cover multi-page progress and cursor deduplication.
- [A stream event races a history read] → Only vouch the read when its captured
  epoch and per-contract activity revision are unchanged at completion.
- [Persisted discovery is necessarily incomplete] → Keep
  `discoveryComplete: false`, retain explicit full discovery, and rotate every
  candidate within twelve refreshes.
- [One contract or endpoint fails] → Preserve its previous rows/coverage and
  report a total failure only when no selected contract could be read, matching
  the existing partial-fan-out behavior.
- [Old renderer/backend versions meet] → New command and payload fields are
  optional; absent coverage follows the existing full read, and absent
  `readFrom` is interpreted as replacement/full semantics.
- [A presentation filter could corrupt pagination state] → Filter only the
  panel's derived rows and retain every terminal order in held/persisted state.
- [A wall-clock benchmark can be flaky across machines] → Simulate the 100 ms
  cadence with fixed observed times, assert the newest cycle is fully applied at
  every boundary, and record exact serialized byte volume instead of imposing a
  machine-speed threshold.

## Migration Plan

No IndexedDB schema migration or dependency is required; database version 1
already contains every persisted field. Deploy renderer and Electron changes
together, then run targeted protocol/store/history tests, the complete lint and
test/build/production command checks, and OpenSpec validation. Rollback is the
single change commit: old code ignores the existing records and resumes full
reads, while the bounded database can remain on disk harmlessly.

Archiving is deliberately deferred until task 5.2 is confirmed against live
Binance data by the operator.
