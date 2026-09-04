# A04 evidence — 2026-09-05

## Implemented decisions

- 64 MiB queued UTF-8 payload budget per renderer, also the single-frame maximum. The direct path avoids scanning small frames using a conservative three-bytes-per-code-unit upper bound; queued/large frames are measured once.
- Independent byte accounting survives diagnostic cooldown and is released on write/replacement/discard/disposal/overflow. Account priority, 4096 account / 1024 market count limits and protected paged resources remain intact.
- Only explicitly replaceable market frames may yield to byte pressure. Protected traffic that cannot fit closes the connection, not the application or real orders.
- One unref'ed timer bounds a continuously nonempty backlog to 30 seconds. Silence, partial drain and newer snapshots cannot renew it. Full drain/discard/dispose/close clears it. Abandoned queues cannot resume on a late drain.
- Main logs a bounded reason/byte/count envelope, no payload contents. Diagnostic callback failures cannot prevent queue cleanup or overflow closure.

## Verification

Production preceded tests. Added 21 cases; the targeted outbox/main/Futures-burst run passed **333 tests**. Includes UTF-8/direct-frame enforcement, exact ceiling, replacement growth/shrink and shifted index, mixed lanes, protected account/pages, deadlines without traffic, partial progress, full drain, disposal/close, callback failures and invalid developer limits.

Synthetic capacity case holds all **128 pages × 256 KiB = 32 MiB**, plus an account event; after drain the event arrives first, all pages remain and pending bytes reach zero. Strings are reused in the fixture: this validates serialized-byte accounting, not allocated heap/RSS.

Before/after local microbenchmark: 30 measured batches of 10000 sends of a reused 60 KiB frame after warmup, fake socket. Queued-superseding median batch-average cost 0.618 → 0.622 µs/send; p95 batch averages 0.722 → 0.721 µs. Direct medians 0.026 → 0.047 µs, p95 0.105 → 0.095 µs. These tiny synthetic averages are not end-to-end p95 latency, and do not establish a live performance improvement.

Final `npm run test:all`: **144 files / 3432 tests passed**, lint, renderer/main/preload build, dependency baseline and all architecture gates. Log: `/tmp/outbox-verified.log` (ephemeral). Gates: 316 cycle-free source files, 160 MOCK-free runtime modules, 24 Futures implementation files, 128 command-path modules. Strict OpenSpec validation and diff whitespace checks passed.

## Graph audit

Initial owner/file impact reported LOW with main import/caller path; an empty arrow-function walk was not treated as unused code. Common-name collisions (`write`, `flush`, `left`, `dispose`) produce false-positive graph paths, checked against source.

Refreshed index: 12855 nodes / 20454 edges. MCP all and compare/main: eight changed files / 73 changed nodes / 42 affected processes, **critical**, with no partial/truncated flags. Warning disclosed. Internal 20-node/file cap remains: exact-path counts are outbox 18, tests 9, main 216. Exact-path call/import walk and executed integration/burst suites supplement that cap; main's large test file remains omitted from indexing only.

## Not claimed

The bound is serialized outbox payload retention, not total process memory: JSON construction, strings shared across renderers, socket/kernel buffers and other application stores are separate. 64 MiB/30 seconds are explicit initial engineering choices, not live-calibrated percentiles. No live connection was deliberately slowed or closed. Operator normal-traffic/reconnect confirmation is pending, so this change is not archived.
