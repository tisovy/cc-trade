## Context

See `proposal.md` for motivation. Current folds use symbol-level open settlement and attach each overlapping funding/insurance row to every round. Fill commissions are unsigned costs, income commission credits are signed ledger movements, and multiple assets can appear. A single `fundingComplete` flag currently qualifies a headline that also depends on missing trades and commissions.

This change follows `make-futures-rounds-leg-and-window-correct`, which supplies stable `{symbol, leg}` and round identities.

## Goals / Non-Goals

**Goals:**

- Build additive open/closed results from a canonical ledger with explicit ownership.
- Preserve un-attributable money without duplicating or hiding it.
- Make completeness and asset denomination part of the value, not tooltip prose.

**Non-Goals:**

- Inventing a hedge-leg split when Binance supplies no leg identity.
- Converting BNB or other assets to historical USDT without a specified price source.
- Adding a Closed Positions grand total before conservation is proven.

## Decisions

### 1. Use canonical signed ledger components

Represent money as entries with exact identity, signed amount string/fixed decimal, asset, component (`realized`, `grossCommission`, `commissionCredit`, `funding`, `insurance`), source, time, symbol, optional leg, optional trade identity, and coverage lane. Gross fill commission becomes a negative ledger component exactly once; underivable income commission remains a signed credit/debit and is never conflated with the gross fee.

### 2. Separate ownership from display overlap

Resolve each entry to one of `roundOwned`, `legOwned`, `contractShared`, or `accountShared`. Reliable fill/trade identity wins, then explicit leg identity, then contract scope; time overlap alone cannot create multiple owners. Timestamp-boundary ties use fill ordering only when it proves one owner; otherwise the entry stays shared.

An entry may be mentioned as non-additive context on more than one row, but only its owner/shared bucket contains it numerically. This preserves explanatory UX without violating conservation.

### 3. Model component quality independently

Each aggregate carries `tradeCoverage`, `commissionCoverage`, `incomeCoverageByLane`, `assets`, and `additive`. `walletNet` exists only for a single asset with complete required coverage. Otherwise expose `visibleNet` plus structured qualifications and shared buckets. Consumers do not infer completeness from row count.

### 4. Enforce conservation in the domain layer

For a selected account/contract interval, create a reconciliation result listing canonical input identities, owner assignments, duplicates rejected, unallocated entries, and per-asset sums. Assert that the union of owner/shared identity sets equals the canonical input set and that sets are disjoint. UI totals consume this result rather than recomputing ad hoc sums.

### 5. Present shared and multi-asset values as first-class rows

Group contract-shared adjustments with the relevant contract and account-shared credits in a separate group. Render compact per-asset chips/readings and a focusable qualification control. `Closed volume` and `Position size` are distinct fields; empty/partial scope remains visible.

## Risks / Trade-offs

- **[More visible shared/unknown values initially]** → This is honest; add attribution only when backed by identity evidence and measure live rebate fields before tightening.
- **[Existing tests expect duplicated funding]** → Replace those expectations only after the production ownership model lands, then add ledger-conservation fixtures.
- **[Exact decimal aggregation complicates formatting]** → Keep fixed decimal in domain state and convert only at the presentation boundary.
- **[Trade IDs may be absent on rebates]** → Preserve the credit in the narrowest truthful shared scope; never discard it.

## Migration Plan

1. Introduce canonical ledger entries/ownership result alongside current round fields.
2. Switch production open and closed consumers to owned/shared buckets and structured completeness.
3. Add accessible shared/multi-asset UI and precise measure labels.
4. Remove legacy per-round duplicated `fundingPnl`/`insuranceClearPnl` aggregation.
5. After implementation, replace old tests with conservation, hedge overlap, boundary tie, rebate, partial, and accessibility cases.
6. Validate per-asset totals against the probe and live Binance transaction rows before archive. Rollback can keep the canonical ledger while restoring the old presentation; no exchange data is mutated.
