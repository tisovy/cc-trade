## Context

The production order book retains and proves up to 1,000 levels per side, while
the renderer normally reads only the distance described by its visible row count
and grouping step. The delivered view is built by `toRendererView(range)` from
the retained maps; the service supplies the current range at every delivery site
and requests another view immediately when that range changes. See `proposal.md`
for the transport and per-frame cost motivating the change, and the delta spec
for the observable contract.

The main process and renderer already share protocol ceilings for depth levels,
frame bytes, and validation nodes. Decimal prices and quantities remain strings
through the delivery path so grouping and spread calculations keep their exact
semantics.

## Goals / Non-Goals

**Goals:**

- Bound only the view sent to the renderer while preserving the complete,
  bridged retained book in the main process.
- Make a stated range sufficient for every visible grouped row, including a
  sparse ungrouped book.
- Preserve a safe full-depth fallback until the panel has stated a valid range.
- Remove work and bytes that have no renderer consumer without weakening the
  protocol's widest-frame proof.

**Non-Goals:**

- Changing snapshot depth, retained depth, diff bounds, band coverage, or
  resynchronization rules.
- Changing grouping, visible rows, price precision, quantities, spread, or any
  trading decision.
- Optimizing how the retained side is ordered before the bounded view is
  formatted; that follow-up remains separate from this delivered change.

## Decisions

### Bound formatting by the panel's range, with a shared level floor and ceiling

`formatSide` orders each retained side nearest-first, derives the price edge from
the best level and the stated range, and stops after it crosses that edge. It does
not stop before the shared minimum delivered level count, and it never emits more
than the shared protocol ceiling.

The floor covers sparse ungrouped books, where rows count resting levels but a
range measures price distance. The ceiling keeps the producer and validator on
the same contract. The alternative of applying only the range would make sparse
books visibly short; applying only a fixed level count would retain most of the
unread transport cost at coarse grouping steps.

### Keep the trim at the delivery boundary

`toRendererView` builds a bounded immutable payload from the retained maps but
does not mutate them. Snapshot coverage, diff bridging, retention trimming, and
band checks continue to operate on the complete retained book. When the range
widens, the service asks the same book for a new view immediately instead of
waiting for market traffic or buying another snapshot solely for delivery.

Mutating the retained maps to match the current view was rejected because a
later wider view could not be answered on a quiet contract and because discarded
levels would no longer participate in the book's existing proof.

### Treat an absent or unreadable range as unbounded delivery

`toRendererView` uses a bound only when the input is a positive workstation
decimal. `null`, invalid strings, zero, and negative values fall back to the
protocol ceiling. This preserves the first-frame behavior before configuration
and keeps malformed session state from suppressing the book.

Throwing on an unreadable range was rejected because range configuration is a
delivery hint, not authority to stop market-data delivery.

### Deliver only price and resting quantity

Each delivered level contains `price` and `quantity`. The renderer derives the
displayed cumulative value after grouping, so a raw-level running total would be
both semantically unusable and redundant. The protocol version was advanced with
the shape change so mismatched main and renderer processes reject one another.

Keeping the old field for compatibility was rejected because it would preserve
the decimal additions, validation work, and payload bytes this change removes.

### Preserve the widest legal transport proof

The frame byte ceiling, validation node budget, and maximum levels per side stay
unchanged. Tests continue to exercise a ceiling-sized frame even though normal
configured sessions send fewer levels. This keeps bounded delivery an
optimization within the existing protocol envelope rather than a weaker
envelope.

## Risks / Trade-offs

- [A range can underdescribe sparse raw levels] → Always deliver at least the
  renderer's shared maximum row count per side.
- [A quiet contract may not produce a diff after the operator widens the view]
  → Redeliver immediately from the retained book when configuration changes.
- [Main and renderer can disagree about the level shape during rollout] →
  Gate the shape with the protocol version and deploy the paired processes
  together.
- [Normal bounded benchmarks can hide a broken ceiling path] → Retain tests
  for unbounded delivery, maximum frame bytes, parsing, and validation.
- [Formatting still fully sorts both retained sides] → Keep that cost visible
  as follow-up work rather than changing shared ordering and retention behavior
  inside this payload change.

## Migration Plan

1. Deploy the paired main-process and renderer protocol update together.
2. Allow sessions without a stated range to use the existing ceiling fallback.
3. Once the panel configures its range, deliver the bounded view and redeliver on
   later range changes.
4. Verify row values, cumulative values, sparse 1× grouping, and quiet-contract
   step changes on live data before archiving the change.

Rollback is the paired revert of the producer, validator, protocol version, and
renderer fixtures; retained order-book state requires no migration.
