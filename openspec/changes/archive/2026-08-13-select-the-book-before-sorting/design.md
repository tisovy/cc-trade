## Context

`toRendererView` delegates both sides to `formatSide`. Today `formatSide` calls
`sortedByPrice`, which parses every retained decimal price into an exact BigInt
coefficient, aligns all prices to a common scale, and fully sorts the side before
the range/floor/limit loop discards the unread suffix. The same full-order helper
also serves `trimSide`, where ordering the retained side is correctness-critical.

The retained side and renderer ceiling are both 1,000 levels. A realistic panel
range is expected to deliver roughly 220 levels per side, but that ratio and both
bounded/unbounded timings must be re-measured on the exact starting ref before an
algorithm is accepted. See `proposal.md` for motivation and the delta spec for
the compatibility contract.

## Goals / Non-Goals

**Goals:**

- Reduce comparison and sorting work in the measured bounded path by fully
  ordering only the levels the existing formatter would return.
- Establish byte-for-byte equivalence to the pre-change formatter across both
  sides, range modes, insertion orders, decimal scales, and wide magnitudes.
- Isolate delivery selection from retention trimming and preserve the existing
  unbounded path unless measurements justify otherwise.

**Non-Goals:**

- Changing retained depth, snapshot/diff processing, band coverage, range
  validation, payload shape, protocol version, or renderer behavior.
- Replacing workstation decimal strings with binary numbers or changing their
  normalization.
- Treating a timing threshold as the correctness proof.

## Decisions

### Add a delivery-only selection path

`sortedByPrice` remains the full-order authority for `trimSide` and for delivery
when there is no usable bound. A new delivery-only path is invoked from
`formatSide` only for a valid positive range. This boundary keeps the retained
book's existing nearest-level proof independent from the optimization.

Changing `sortedByPrice` into a partially ordered helper was rejected because
its two callers need different guarantees: delivery can discard a suffix, while
retention must identify every level beyond the retained ceiling exactly.

### Use exact aligned integer keys for selection and final order

The bounded path parses each price as the existing workstation decimal model,
aligns prices and the range to a common decimal scale, and represents both the
price and inclusive range edge as BigInt keys. Bid membership is `price >= edge`;
ask membership is `price <= edge`. Directional ordering compares those same
keys and returns only comparator signs, never a numeric price.

This proves equivalence for mixed scales and magnitudes beyond `2^53`: multiplying
an integer coefficient by a power of ten is exact, and aligning both operands to
the maximum scale preserves equality and order. `Number(price)`, `parseFloat`,
subtraction comparators, and floating tolerances are forbidden.

Reusing lexical order was rejected because normalized decimal strings can have
different integer and fractional widths. Repeatedly calling a string-level
decimal comparator was also rejected for the hot path because it reparses the
same edge for every level.

### Choose filter-plus-bounded selection only after the baseline confirms the shape

The candidate algorithm makes one exact pass to find the best key and inclusive
edge, collects every level within the edge, and then:

- sorts that collected subset when its count is between the floor and limit;
- adds only the nearest missing out-of-range levels through a bounded worst-first
  heap when the range contains fewer levels than the floor;
- selects only the nearest `limit` levels if a caller can provide more in-range
  candidates than the limit;
- sorts the full keyed set when the valid range actually covers the full side.

This combines O(n) filtering with O(k log k) final ordering for the expected
`k << n` case and avoids heap work entirely for the realistic range. A heap over
all retained levels was rejected as unnecessary O(n log k) work for that common
case; quickselect was rejected because its mutation and pivot behavior make the
small fixed ceiling harder to audit without a measured advantage.

The choice is accepted only after the starting-ref benchmark confirms a
materially smaller delivered subset. The identical benchmark on the exact
staged tree must then show a bounded improvement without a noticeable unbounded
regression; otherwise the implementation and test hunks are reverted and the
measured rejection remains recorded in `tasks.md`.

### Compare against a frozen full-sort reference

Tests build a reference that reproduces the pre-change sequence: full exact
ordering, best-price edge calculation, inclusive range break after the floor,
and limit truncation. They compare the complete renderer view, including spread,
not merely price sets.

At least one regression test instruments `Array.prototype.sort` only around a
bounded `toRendererView` call on a 1,000-level side. It permits exact sorting of
the selected subset but rejects sorting an array as long as the retained side.
The test is copied into an archive of the starting ref and must fail there for
that reason. Equivalence cases that already pass on the starting ref are guards,
not regression findings.

### Benchmark isolated immutable trees

The baseline is materialized from the exact starting commit with `git archive`.
The after measurement and all final verification use a tree written from a
temporary Git index containing only owned paths over the then-current HEAD. Both
trees symlink the same `node_modules` and run the Node version pinned by `.nvmrc`.
Warm-up, iterations, median, p95, delivered side sizes, ref/tree identity, and
commands are recorded in `tasks.md`.

## Risks / Trade-offs

- [A second ordering implementation can drift from the full reference] → Use
  the same parsed decimal representation, exhaustive table-driven equivalence
  cases, and full-view comparisons.
- [The floor needs levels outside the price edge] → Select only the nearest
  missing levels with an exact bounded heap, then apply the same final order.
- [A wide valid range erases the expected gain] → Fall through to exact full
  ordering when every retained level is part of the output; do not claim a gain
  for work the payload still requires.
- [Instrumentation could pollute unrelated tests] → Patch
  `Array.prototype.sort` only inside `try/finally` around one synchronous call.
- [Shared-worktree edits can contaminate measurements or commits] → Build
  archive trees from an explicit commit or temporary index and stage/commit only
  the owned paths.

## Migration Plan

No state or wire migration is required. Deploy the order-book implementation
with its focused tests; payloads remain protocol-compatible. Rollback is the
revert of the delivery-only helper and its call site, after which `formatSide`
again uses the unchanged full-order helper for every range.
