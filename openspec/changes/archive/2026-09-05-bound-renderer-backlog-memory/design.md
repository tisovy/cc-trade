## Context and scope

The outbox already owns account-first delivery, per-resource supersession, count ceilings and socket drain. The new limits belong here, not in separate trading workflows. Named impact misses its arrow-function caller, but exact-file graph and source confirm main construction/send and burst tests use it. Graph also confuses common names such as write/left; those paths are not accepted without source confirmation.

## Decisions

Use 64 MiB of queued UTF-8 text per renderer and the same maximum for one frame. This accommodates 128 pages at the existing workstation's 256 KiB per-event ceiling plus room for concurrent account data. It is a conservative initial engineering bound, not a measured live percentile. Existing 4096 account / 1024 market count limits remain.

Track bytes independently of diagnostic tallies, decrementing on write, supersede and discard. Admission considers the removed old version before charging a replacement. Drop only complete replaceable market frames to fit bytes, never account facts or catalog/history/status pages. If protected traffic cannot fit, close once and discard the connection's queued state; never resume sending after abandonment.

A single unref'ed 30-second timer starts on the first queued frame and is cleared when the backlog empties or the outbox is disposed/closed. Partial drain, added frames and supersession do not extend it. This bounds continuous backlog duration rather than each newest superseded frame's age, so a constantly refreshed book cannot keep a dead connection alive. The timer works without further input; no wall-clock comparison drives expiry.

Overflow reports contain only reason, queued byte/count totals, rejected frame bytes and the configured limits, never frame contents. Reporting must not prevent clearing the queue or closing. Main logs the bounded metadata. The existing renderer socket reconnect and account catch-up are used, not command replay or real order cancellation.

## Verification and remaining risk

Production before tests. Cover byte equality/overrun, UTF-8, single-frame direct path, combined lanes, replacement growth/shrink, safe eviction, protected pages, release on drain/dispose, silence/partial progress deadlines and callback failures. Run existing transport/main/burst regressions and complete gates, source/graph audit before main commit.

Local synthetic stress does not prove live heap/RSS or best timeout for every host. No running renderer is throttled intentionally. Live observation of normal traffic and reconnect remains operator acceptance; do not archive before it.
