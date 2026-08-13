## 1. Preconditions And Planning

- [x] 1.1 Verify the primary checkout is on `master`, record the exact starting HEAD, inspect the shared worktree, and confirm both owned production/test files are clean.
- [x] 1.2 Create proposal, design, and delta spec for delivery-only bounded selection without assigning implementation to the earlier change.
- [x] 1.3 Strictly validate `select-the-book-before-sorting` before production work.
- [x] 1.4 Run GitNexus upstream impact for every existing production symbol that will change, record direct callers/processes/risk, and warn before editing if any result is HIGH or CRITICAL.

## 2. Starting-Ref Baseline And Algorithm Gate

- [x] 2.1 Materialize the exact starting ref with `git archive`, symlink `node_modules`, and run the Node version pinned by `.nvmrc`.
- [x] 2.2 Benchmark bounded and unbounded `toRendererView` on 1,000 levels per side with warm-up and repeated samples; record command, parameters, median, p95, and delivered side sizes below.
- [x] 2.3 Use the measured retained/delivered ratio to accept or reject filter-plus-bounded selection, and record the exact aligned-BigInt ordering proof before implementation.

## 3. Production Implementation

- [x] 3.1 Add a delivery-only exact keyed selection path for valid bounded ranges, fully ordering only the selected levels needed by range, floor, and limit.
- [x] 3.2 Keep `sortedByPrice` as the unchanged full-order path for `trimSide` and unbounded delivery, with no payload, protocol, renderer, or numeric-price coercion change.
- [x] 3.3 Re-read the production diff and prove bids, asks, inclusive edge, floor, limit, spread, and immutable output remain equivalent to the starting-ref formatter.

## 4. Tests Written After Production

- [x] 4.1 Add a full-sort reference and compare complete bounded views for bids and asks across mixed decimal scales, values wider than `Number.MAX_SAFE_INTEGER`, and different insertion orders.
- [x] 4.2 Cover a narrow range with the floor, a realistic range, a range wider than the book, and null/invalid/non-positive/unbounded ranges.
- [x] 4.3 Prove retained trimming still keeps the exact nearest levels on both sides after the retention ceiling is exceeded.
- [x] 4.4 Add a deterministic sort-interception regression proving bounded `toRendererView('220')` does not sort an array as long as the 1,000-level retained side while the selected subset is exactly ordered.
- [x] 4.5 Copy the changed test into an archive of the starting ref, run it there with the shared dependencies, record the expected biting failure, and classify every case that passes there as a guard.

## 5. Measured Acceptance

- [x] 5.1 Build an exact temporary-index staged tree containing only owned paths over the current HEAD and repeat the identical benchmark there.
- [x] 5.2 Accept the production/test diff only if bounded median and p95 improve outside observed noise with no noticeable unbounded regression; otherwise revert only this change's uncommitted code/test hunks and record the rejected task with numbers and reason.

## 6. Isolated Verification

- [x] 6.1 In the temporary-index archive with pinned Node and shared `node_modules`, run the focused order-book Vitest suite.
- [x] 6.2 In the same staged tree, run `npm run lint` and `npm run test:all`.
- [x] 6.3 Strictly validate `select-the-book-before-sorting` again and keep the change active for operator review rather than archiving it.

## 7. Audit And Commit

- [x] 7.1 Audit exact output equivalence, absence of price `Number` coercion, unchanged retention semantics, and absence of edits in forbidden files.
- [x] 7.2 Run `git diff --check`, reconcile every checkbox and measurement with facts, and run GitNexus `detect_changes` for the owned staged scope through a temporary index.
- [x] 7.3 Re-read `master`, HEAD, and status; if HEAD advanced, rebuild and reverify the owned staged tree over the new HEAD.
- [x] 7.4 Commit only the owned production, test, new-change, and permitted planning-debt paths directly to `master`, then report the verified commit without archiving either active change.

## 8. Post-Commit Audit And Archive

- [x] 8.1 Differentially compare the committed formatter with an independent exact-decimal full-sort oracle across randomized sizes, insertion orders, valid/invalid range modes, and retained-state immutability.
- [x] 8.2 Repair the test oracle's intermediate decimal-string overflow and add a biting range-length-boundary regression after confirming production already satisfies the specified floor and ceiling behavior.
- [ ] 8.3 Rebuild an owned staged tree on the current `master`, run focused/full verification, strict validation, diff audit, and GitNexus `detect_changes`, then commit the audit correction alone.
- [ ] 8.4 Sync the verified delta spec into the main capability spec, archive the completed change, validate the archive result, and commit only the sync/archive paths.

## Measurement Record

### GitNexus Impact Record

- Index ref: `93bef70e5b0ae436b69649ab0fe529196c1f64c9` (rebuilt without embeddings).
- `sortedByPrice`: CRITICAL; 2 direct callers (`trimSide`, `formatSide`), 11
  upstream symbols, 7 affected process groups. Decision: leave the symbol
  unchanged so retained trimming keeps its existing full-order authority.
- `formatSide`: CRITICAL; 1 direct caller (`toRendererView`), 10 upstream
  symbols, 8 affected process groups spanning configured, startup, stream,
  recovery, and freshness delivery paths. The operator was warned before code
  edits; full-view equivalence and isolated staged-tree verification are gates.

### Starting Ref

- Ref: `93bef70e5b0ae436b69649ab0fe529196c1f64c9`.
- Archive: `/tmp/select-book-baseline.yjUJwP`, materialized with
  `git archive 93bef70e5b0ae436b69649ab0fe529196c1f64c9 | tar -x -C /tmp/select-book-baseline.yjUJwP`;
  the production-file SHA-256 matched `git show` (`bf214a52...d21091a`).
- Node: `v24.11.0`, selected from `.nvmrc` with `fnm`.
- Command: `SELECT_BOOK_BENCH_WARMUP=3000 SELECT_BOOK_BENCH_SAMPLES=12000 fnm exec --using 24.11.0 node --expose-gc /tmp/select-book-benchmark.mjs`.
- Book: 1,000 bids from `1.5500` down by `0.0001` and 1,000 asks from
  `1.5501` up by `0.0001`, with deterministic insertion order
  `(index * 37) % 1000` and varying normalized quantities.
- Range: `0.0220`.
- Warm-up / samples: 3,000 / 12,000 independently for each path; reported
  percentiles are over all timed calls, not a single elapsed run.

| Path | Delivered bids / asks | Median | p95 |
| --- | ---: | ---: | ---: |
| Baseline bounded | 221 / 221 | 0.699656 ms | 0.822378 ms |
| Baseline unbounded | 1000 / 1000 | 0.7200115 ms | 0.835257 ms |
| Staged bounded | 221 / 221 | 0.423314 ms | 0.515505 ms |
| Staged unbounded | 1000 / 1000 | 0.728827 ms | 0.758297 ms |

The after run used temporary index `/tmp/select-book-staged.vh1ZwG/index`
over HEAD `f3e135e152fc7bc6c7c9189348123860f2e950a8`, tree
`1e758130ad04ee1f016b09a34eb153b9d15ddfe2`, and the identical benchmark
command/Node/data above. Bounded median improved 39.5% and p95 improved 37.3%.
Unbounded median moved +1.2% (within run noise) while unbounded p95 improved;
there is no noticeable unbounded regression, so the implementation is accepted.

### Algorithm Decision And Exactness Proof

Filter-plus-bounded selection is accepted for implementation: the valid range
delivered 221/1,000 levels (22.1%) per side, yet bounded median and p95 remained
within 3% of unbounded because both paths fully sorted all 1,000 retained prices.

For every parsed decimal `(coefficient, scale)`, choose `S` as the maximum scale
of all side prices and the range, then define the exact integer key as
`coefficient * 10n ** BigInt(S - scale)`. Multiplication by a positive power of
ten is order-preserving, so key equality/order is exactly decimal equality/order
for mixed scales and arbitrary magnitudes. The bid best/edge are `maxKey` and
`maxKey - rangeKey`; the ask best/edge are `minKey` and `minKey + rangeKey`, with
inclusive membership matching the old comparisons. If `m` entries are inside
the edge, the old loop returns the first `min(sideSize, limit, max(floor, m))`
entries of the full exact order (the production constants have `floor <= limit`).
Filtering all in-range entries, selecting only the nearest missing floor/limit
entries, and exact-sorting that selected set therefore returns the identical
prefix without converting a price to `Number`.

### Regression Classification

- Biting tests: 2 (`sorts only the selected subset for a bounded 1000-level side`
  and `keeps exact floor and ceiling output at the accepted range-length
  boundary`).
- Guard tests: 5 new equivalence/retention cases; they pass on the starting ref
  and therefore describe preserved behavior rather than discovered regressions.
- Starting-ref command: `fnm exec --using 24.11.0 ./node_modules/.bin/vitest run electron/services/futures-workstation-order-book.test.js`
  in `/tmp/select-book-baseline.yjUJwP` after copying only the changed test file.
- Starting-ref result after the post-commit audit: expected failure, 49/51
  passed. One biting assertion saw sort lengths `[1000, 1000]` from the old
  formatter instead of `[221, 221]`; the other exposed its intermediate
  edge-string overflow as
  `FuturesWorkstationDecimalError:INVALID_FUTURES_WORKSTATION_DECIMAL` for an
  accepted 64-character range. The same file passes 51/51 with the production
  implementation.

### Staged Verification

- Rebuilt after `master` advanced: base
  `d7ca75caa336934073fd0b085eba2f5e5e225664`, temporary tree
  `3afec9cbea030d396aa26110ae483fa6cb3560fe`, archive
  `/tmp/select-book-staged.vh1ZwG/verify-d7ca`, Node `v24.11.0`.
- Focused order-book Vitest: 50/50 passed.
- `npm run lint`: passed (only the existing stale
  `baseline-browser-mapping` data notice).
- `npm run test:all`: the sandboxed attempt reached 1791/1792 and failed only
  because loopback `listen` returned `EPERM`; the required unsandboxed rerun
  passed 109/109 files and 1792/1792 tests, then passed lint, renderer/Electron
  builds, circular-import, runtime-mock, production-boundary, and command-path
  checks.
- Strict OpenSpec validation: valid. The change remains active and unarchived.

### Final Audit

- Whole-view JSON byte comparisons passed for both sides across mixed decimal
  scales, prices wider than `Number.MAX_SAFE_INTEGER`, three insertion orders,
  floor/range/ceiling cases, and the realistic 221-of-1,000 case. The biting
  sort-interception case also proves the selected 221-entry subsets are the only
  arrays ordered by bounded delivery.
- The production hunk adds no `Number` price conversion: price and range order
  use parsed coefficients aligned to exact `BigInt` keys. `sortedByPrice` and
  `trimSide` have no changed hunk; the retention regression independently
  verifies the nearest 1,000 levels on bids and asks.
- `git diff --check` passed for the owned worktree paths and for the isolated
  staged scope. That scope contains exactly the nine owned production, test,
  new-change, and permitted planning-debt paths, with no renderer, protocol,
  connection, account, chart, dock, view, CSS, runbook, or forbidden-change
  edit.
- GitNexus `detect_changes({ scope: "staged" })`, run with
  `GIT_INDEX_FILE=/tmp/select-book-staged.vh1ZwG/index`, reported 9 changed
  files, 37 indexed symbols, 10 affected execution flows, and HIGH risk. Its
  mapping is file-granular and therefore listed unchanged symbols including
  `sortedByPrice` and `trimSide`; the actual production diff above is limited to
  the new delivery helpers and `formatSide`.
- Final pre-commit reread still found `master` at
  `d7ca75caa336934073fd0b085eba2f5e5e225664`. The owned staged tree had already
  been rebuilt and fully verified on that base after the earlier HEAD advance;
  shared unrelated work remains outside the temporary index.

### Post-Commit Differential Audit

- An independent temporary oracle compared 180 deterministic books and 3,240
  renderer calls across empty, floor-adjacent, realistic, and 1,000-level side
  sizes; mixed decimal scales; wide prices; shuffled insertion orders; and
  absent, invalid, non-positive, tiny, edge-aligned, wider-than-book, and
  maximum-length positive ranges. Every current view matched the mathematical
  full-sort JSON bytes, repeated calls were deterministic, retained Maps were
  unchanged, and every observed sort length equalled the corresponding
  delivered side length.
- Every successful parent-formatter result also matched. In 320 extreme-scale
  cases the parent did not produce bytes: it constructed an exact edge string
  longer than the input parser's 64-character boundary and then rejected that
  internal value. The bounded implementation already avoids that round trip,
  so the correction is confined to the test oracle and permanent regression
  coverage; no production hunk was required.
- `fullSortSideReference` upstream impact after refreshing GitNexus on the
  post-commit HEAD is LOW: one direct caller, two upstream symbols, one affected
  module, and zero execution flows.
- `coversRange` and `rangeShortfall` retain the same pre-existing internal-edge
  limitation for protocol-boundary ranges. Band coverage is an explicit
  non-goal of this delivery-selection change, so it is recorded rather than
  folded into the archive under a false ownership claim.

### Post-Commit Staged Verification

- Base: `cb5e455b45f50f68383cc4c2ce9b483c64b36050`; temporary index
  `/tmp/select-book-audit-stage.bvNs2n/index`; tree
  `3c5980627e22e9f93881d4a0fb877112d88dd8a2`; archive
  `/tmp/select-book-audit-tree.8u9eIl`; Node `v24.11.0`. Production, test, and
  tasks hashes matched the workspace inputs, and the isolated diff contained
  only the order-book test and this tasks file.
- Focused order-book Vitest: 51/51 passed. `npm run test:all`: 109/109 files and
  1,793/1,793 tests passed, followed by lint, renderer/Electron builds,
  circular-import, runtime-mock, Futures production-boundary, and command-path
  checks. Strict OpenSpec validation and both owned diff checks passed.
- GitNexus `detect_changes({ scope: "staged" })` through the temporary index
  reported LOW risk, 2 files, 32 conservatively file-mapped symbols, zero
  affected execution flows, and no production-file change.
