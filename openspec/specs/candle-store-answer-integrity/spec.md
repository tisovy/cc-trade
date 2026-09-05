# candle-store-answer-integrity Specification

## Purpose

Accept stored candle history only when its identity, requested range and contiguous bucket geometry match the chart request.

## Requirements

### Requirement: Store answers identify the exact requested chart range

The desk SHALL accept a local candle-store response only if market, canonical symbol, timeframe and timezone-qualified echoed requested bounds match the request. A missing or mismatched identity SHALL produce no chart/cache rows and SHALL use the existing controlled exchange fallback.

#### Scenario: Another contract or timeframe answers

- **WHEN** a BTCUSDT/1m request receives ETHUSDT/1h or missing identity metadata
- **THEN** the response is rejected before any cache hit or renderer delivery

#### Scenario: Another range answers with the same number of bars

- **WHEN** echoed bounds or actual page timestamps describe an earlier/later range
- **THEN** row count alone does not permit accepting that page

### Requirement: A store hit proves contiguous whole buckets

The desk SHALL validate numeric bar shape, bucket alignment, increasing order, uniqueness and requested-range containment before normalization. A full page SHALL cover exactly every requested bucket with matching actual coverage. A window SHALL contain every whole bucket inside its stated actual minute coverage after partial edges are removed. Invalid geometry SHALL not reach chart/cache.

#### Scenario: Duplicate, skipped or shifted bucket

- **WHEN** a claimed covered page contains a duplicate, missing, reordered, off-grid or out-of-range bucket
- **THEN** the desk returns no store rows and records a safe failure reason

#### Scenario: A valid partially held window

- **WHEN** missing minutes are only at the window edges and every remaining whole bucket exists
- **THEN** those contiguous whole buckets may be shown under loading while the exchange read continues

#### Scenario: Short page without listing proof

- **WHEN** a page is short or declared incomplete
- **THEN** it remains a store miss and does not terminate chart history

#### Scenario: Malformed price or volume

- **WHEN** an OHLCV value is null, boolean, non-finite or contradicts the high/low bounds
- **THEN** the response is rejected rather than coercing it into a candle
