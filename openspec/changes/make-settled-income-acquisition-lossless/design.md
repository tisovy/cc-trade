## Context

See `proposal.md` for motivation. Binance Income History documents inclusive time bounds, `page`, a limit of 1000, IP weight 30, and roughly three months of retained data, but does not document response ordering. The current implementation always asks for page 1, infers direction from returned rows, advances millisecond cursors, and queries six filtered types for every trigger.

This change depends on the truthful resource/coverage frame from `make-settled-income-resource-truthful` and on per-attempt weight accounting from `charge-every-binance-retry-weight` for final budget assertions.

## Goals / Non-Goals

**Goals:**

- Enumerate a fixed income window without timestamp-peer loss or ordering assumptions.
- Track and refresh required income types independently.
- Reduce event-triggered weight while preserving eventual verification.

**Non-Goals:**

- Reading derivable `REALIZED_PNL` and gross `COMMISSION` as substitutes for fills.
- Promising attribution for rebate rows until their live `symbol`/`tradeId` shape is measured.
- Exceeding documented retention to synthesize old coverage.

## Decisions

### 1. Give each income type an independent lane

Each required type owns `{coveredFrom, coveredTo, targetTo, nextPage, status, successfulAt, error}` and its canonical row map. Aggregate resource completeness is the conjunction only of lanes required by the consumer. Store records lane state so one failure cannot advance or erase another.

### 2. Page a frozen inclusive target window

At walk start, freeze `[startTime, endTime]` and request `page=1..N` with the documented maximum limit for one income type. Continue until a short/empty page, explicit bound, or failure. Normalize/deduplicate every page, then sort canonical rows locally. Never move either time bound merely because a page is full.

Freezing `endTime` prevents new later events from shifting the target during the walk. Periodic verification handles late-posted rows whose event time falls inside an already-read window.

### 3. Do not infer coverage from row order

Coverage comes from successfully enumerating the requested pages for the fixed window. Ascending/descending observations remain diagnostics only. If enumeration is bounded before a terminal page, the lane is partial against its unchanged target.

### 4. Map triggers to lanes and coalesce confirmations

- `FUNDING_FEE` user event: immediate funding tail plus one funding confirmation.
- Any execution: coalesced delayed reads for the four underivable commission-credit lanes, including zero-realized opening fills.
- Insurance/liquidation evidence: insurance tail.
- Startup/manual refresh: stale/missing lanes required for current surfaces.
- Periodic verification: rotate/reconcile every required lane within the declared interval.

One unfiltered all-income request was considered because its weight is also 30, but dense derivable realized/commission rows can consume the 1000-row pages and make sparse underivable coverage ambiguous. Filtered per-lane reads are retained, narrowed by reason.

### 5. Make request budgets executable assertions

Define budgets in physical request weight, not logical pages. At minimum record event reason, lanes, pages, attempts, charged weight, coverage gained, and deferred work. Funding's one-page immediate read is 30 rather than 180; confirmations and verification have separate caps. Admission may defer low-priority verification but never label it complete.

### 6. Measure rebate shape before tightening ownership

Extend the existing probe to report bounded counts of symbol/trade-identity presence per rebate type without logging sensitive rows. The ownership change consumes those facts but remains truthful when fields are absent.

## Risks / Trade-offs

- **[Page contents shift because Binance posts a late row inside the frozen window]** → Canonical dedup plus periodic overlap verification; never claim immutable exchange history.
- **[Many pages in one lane starve commands]** → One page per admission turn, bounded pass, and existing fairness/command priority.
- **[Lane store increases state size]** → Rows are still canonical/deduplicated and retained only inside the supported window.
- **[Rare credit appears later than the coalesced confirmation]** → Hourly/periodic verification remains the eventual reconciliation backstop.

## Migration Plan

1. Add lane state to the production store/resource while reading the old union as unverified input.
2. Implement the fixed-window page-number walker and switch one lane at a time, starting with funding.
3. Replace all-six trigger mapping with reason-specific invalidation and coalescing.
4. Add production budget diagnostics and the rebate-shape probe.
5. After implementation, add timestamp-peer, descending-order, partial-lane, burst-coalescing, and physical-weight tests.
6. Compare request weight and row counts over live funding/verification cycles before archive. Rollback restores the previous scheduler but invalidates incomplete lane cursors.
