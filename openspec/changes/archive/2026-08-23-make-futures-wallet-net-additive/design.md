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

A canonical `fsi:v2:tran:*` identity retains the exchange transaction's reliability. A content-derived `fsi:v2:row:*` identity is useful for deterministic deduplication but remains explicitly unreliable: the same values can describe two real rows, so its affected scope cannot claim exact additive ownership merely because the shared resource supplied a non-empty key.

### 2. Separate ownership from display overlap

Resolve each entry to one of `roundOwned`, `legOwned`, `contractShared`, or `accountShared`. Reliable fill/trade identity wins, then explicit leg identity, then contract scope; time overlap alone cannot create multiple owners. Timestamp-boundary ties use fill ordering only when it proves one owner; otherwise the entry stays shared.

Interval ownership requires a canonical symbol. A symbol-less row cannot use timestamp overlap to search every contract; it remains account-shared unless a reliable fill identity proves a narrower owner. This is also a defense-in-depth rule for direct ledger callers if malformed contract-scoped evidence bypasses the canonical resource.

Build a deterministic interval index by symbol and leg once per reconciliation. Candidate lookup narrows by canonical symbol first and preserves every overlapping round, inclusive close/open boundaries, simultaneous hedge legs, and open-ended live intervals. It SHALL NOT rescan the complete round collection for every income entry; input ordering does not affect the candidate set.

Broad commission-credit qualification uses the same bounded principle. A credit without a unique fill owner records one compact `{symbol, optional leg, posted-at cutoff}` affected scope; reconciliation combines cutoffs per account/contract/leg and evaluates them once while aggregating rounds. It does not expand every credit into every historical round identifier or rescan the full round collection per credit. Presentation-home selection uses precomputed scope summaries.

An entry may be mentioned as non-additive context on more than one row, but only its owner/shared bucket contains it numerically. This preserves explanatory UX without violating conservation.

Open/closed shared presentation scope is a separate evidence projection over that one additive owner. A shared assignment reaches a scope only when its `matchedRoundIds` contains a round in that scope. Partial or unresolved closed rounds with valid interval evidence remain eligible Closed matches; an empty match set remains global and never falls back to the first open or newest resolved round with the same symbol/leg. Account-shared entries without interval evidence follow the same global-only rule.

Commission credits need a second, conservative affected-scope projection because Binance may post a rebate after the fill has already closed its interval. A reliable trade identity that names a reversal fill SHALL preserve the complete set of round owners of that fill; posting time must not silently select only the newly opened round. Without a unique reliable fill owner, posting-time overlap is not commission ownership evidence: the credit remains one global shared amount and every causally compatible symbol/leg round that opened no later than the credit is qualified until ownership is proven. This also covers a delayed credit whose timestamp has already entered the next open interval, without poisoning a future round that did not yet exist.

Every canonical shared adjustment receives one presentation home. If its affected set reaches any closed round, Closed/account reconciliation owns the one shared display; otherwise the open-position shared group owns it. A reversal credit or boundary funding/insurance entry that reaches both scopes is therefore not rendered twice under two simultaneous surfaces even though every affected position row remains honestly qualified. The audit exposes open/closed projection disjointness separately from canonical owner disjointness so a presentation regression cannot hide behind a conserved domain assignment.

### 3. Model component quality independently

Each aggregate carries `tradeCoverage`, `commissionCoverage`, `incomeCoverageByLane`, `assets`, and `additive`. `walletNet` exists only for a single asset with complete required coverage. Otherwise expose `visibleNet` plus structured qualifications and shared buckets. Consumers do not infer completeness from row count.

The renderer treats the validated settled-income `{accountFingerprint, generation, digest}` tuple as the wallet-content revision. Same-generation/same-digest observation frames are already required to have byte-equivalent canonical lane content, so they update read/success clocks and resource presentation without rerunning decimal normalization, interval ownership, or round remapping. Legacy/unversioned resources retain object-identity invalidation. The settled-window projection is memoized separately by the resource frame so unrelated order, balance, or history state does not replace every open-row prop.

The account position snapshot participates in the round-fold cache through a canonical sorted tuple sequence of `{symbol, leg, quantity, entryPrice}`. Exchange array order is presentation noise: reordering otherwise identical positions must preserve the round index, reconciliation, and downstream row identities. Any tuple value change still invalidates the fold.

Asset cardinality is computed from non-zero net balances, while preserving a zero settlement-asset total when it is the sole/result denomination. Exact opposite auxiliary-asset movements therefore remain separate canonical entries and conservation evidence but do not manufacture a `MULTI_ASSET` qualification after they cancel.

### 4. Enforce conservation in the domain layer

For a selected account/contract interval, create a reconciliation result listing canonical input identities, owner assignments, duplicates rejected, unallocated entries, and per-asset sums. Assert that the union of owner/shared identity sets equals the canonical input set and that sets are disjoint. UI totals consume this result rather than recomputing ad hoc sums.

When one reliable identity arrives with contradictory payloads, exact ownership is impossible but qualified visible evidence must still be deterministic. Select a canonical representative by a stable complete entry tuple (or quarantine it from numeric totals); never let delivery order choose the displayed amount. Preserve every conflicting scope for qualification and expose the conflict in audit.

Conflict evidence is a set of distinct complete entry signatures, not a log of delivery attempts. Repeated copies of an already-seen contradictory signature do not add another audit conflict or retain another payload. The audit exposes one stable conflict record per canonical identity, and qualification considers every distinct signature once. This keeps conflict output and retained work invariant under permutations such as `[A, B, B]` and `[B, B, A]`.

If the deterministic representative of a conflicting reliable identity lands in a shared bucket, that bucket carries a bounded `IDENTITY_CONFLICT` qualification in addition to remaining non-additive. The qualification is derived from the canonical conflicted-identity set, not input order or a renderer scan. Open and Closed presentation label the amount as conflicted representative evidence rather than ordinary Shared money while preserving it once for reconciliation.

Before round aggregates enter the wallet ledger, the trade-round fold also performs an independent source-allocation audit. It records each deduplicated canonical fill quantity and every exact integer quantity atom assigned while closing or opening a round. A fill is conserved only when its assigned atoms equal its canonical atoms exactly, with no missing or unknown identity. This audit uses the canonical source set rather than the already-aggregated round values, so a duplicated, omitted, under-allocated, or over-allocated fill cannot validate itself. Any failed position fold is retained as unresolved evidence, with its affected rounds prevented from advertising exact wallet Net.

### 5. Present shared and multi-asset values as first-class rows

Group contract-shared adjustments with the relevant contract and account-shared credits in a separate group. Render compact per-asset chips/readings and a focusable qualification control. `Closed volume` and `Position size` are distinct fields; empty/partial scope remains visible.

React row identity for a shared adjustment is a compact, collision-safe tuple of its presentation kind, owner, symbol, and leg. It does not serialize, sort, or otherwise include every member `entryId`: adding a newly discovered entry to the same bucket updates the existing DOM row instead of remounting it and dropping keyboard focus. Distinct simultaneous buckets remain distinct even if they share a visible label.

The canonical bucket also carries a sorted, deduplicated component-kind summary computed once while its entries are aggregated. Open and Closed presentation consume that bounded summary rather than mapping/filtering the full member list on every React render. Both surfaces visibly state whether the bucket is shared or unattributed, which movement kinds it contains, and every structured qualification such as `IDENTITY_UNRELIABLE`; focus/ARIA text mirrors the visible facts.

A bucket qualified `IDENTITY_CONFLICT` uses an explicit conflict state in both visible and accessible text. Its selected canonical amount is evidence for deterministic reconciliation, not an exact or ordinary shared adjustment.

Settled-read reach is a contract-level fact even though owned readings are keyed by `{symbol, leg}`. Presentation therefore counts unique symbols and retains the symbol set needed to say that money was read for the same contract but could not be assigned to this hedge leg. It never labels LONG and SHORT on one symbol as two other contracts.

The domain result also retains global `legOwned`, `contractShared`, and `accountShared` buckets. Entries without fill/interval scope evidence stay there for audit and account-level presentation; open/closed selectors must not relabel them merely to force them onto a position row. A global commission credit is nevertheless rendered once in its deterministic Closed/account or open shared group because hiding real wallet money would make the visible result falsely exact.

### 6. Denominate realized PnL by the round's proven settlement asset

The round supplies its exchange-reported settlement asset. Realized PnL and a fill fee whose own asset is absent use that per-round asset. Income rows never inherit an account-level or round default: Binance supplies their denomination directly, so an absent/blank income asset is malformed evidence and locally disqualifies every round scope it could affect. The account-level default remains only a deterministic display-order preference. A missing or conflicting round asset is a local qualification and cannot be repaired by guessing USDT, by inspecting the symbol suffix, or by borrowing `commissionAsset`.

Closed presentation rounds the bounded exchange realized-PnL text directly to cents for the single `PnL` cell, except that a non-zero sub-cent value which would appear as zero keeps its exact glance text, and keeps the unchanged exact decimal plus proven round asset on that element; it never round-trips through a JavaScript `Number` or a USDT-only formatter. The element's wallet detail follows the canonical ledger's exact single-asset result even when that sole non-zero asset differs from the round settlement asset. Therefore `+10 realized -1 commission -2 funding` on a USDC round remains exact `+7 USDC` detail, while a zero-USDT round whose only wallet movement is `-0.003 BNB` remains exact `-0.003 BNB` evidence rather than a relabelled USDT value or a false partial.

### 7. Bound exact-decimal and temporal evidence at ingestion

Reject external decimal coefficients, scales, and exponents outside a generous fixed safety domain before constructing or exponentiating `BigInt` values. Valid in-domain values remain exact; an out-of-domain amount is recorded as malformed input and makes only its possible owner scope inexact. Null, blank, object, or non-finite times are invalid evidence rather than JavaScript's numeric zero. A round without both usable boundaries and an income row without a usable timestamp cannot establish exact interval coverage or ownership.

### 8. Keep the maintained probe on the canonical ledger

The read-only settlement probe feeds canonical fills, including Binance's `marginAsset`, through `buildFuturesTradeRoundIndex` and gives `legacyRounds` only to `reconcileFuturesWalletLedger` as unresolved ownership barriers. It never supplies income to `buildFuturesTradeRounds` or reads `round.funding`/`round.netPnl`, because that compatibility path copies time-overlapping funding and insurance into more than one round.

Probe output states every canonical visible total with its own asset, separates round-owned and shared buckets, and prints the ledger's conservation, disjointness, invalid-input, conflict, and qualification evidence. That explicit operator-invoked wallet comparison is allowed to print money because comparing those values is its purpose; the production diagnostic record and the probe's acquisition-shape summary remain count-only and never print raw rows, identities, signed material, credentials, headers, exchange messages, or money. The probe preserves a numeric reverse-flat boundary exactly instead of reducing it to a boolean and contains no legacy income-attached/open-position arithmetic or commentary. A live run may record aggregate counts of absent symbol/trade attribution, but code-level verification uses deterministic fixtures and does not mark the operator-only live comparison complete.

### 9. Keep open settled evidence exact at the last boundary

The canonical wallet ledger already owns exact decimal strings, so open-position projection groups those strings and adds them with the ledger's bounded decimal arithmetic. The Dock uses local decimal-string formatting: the compact cell rounds to two decimals for the operator's glance, except that a non-zero sub-cent movement that would appear as zero keeps its exact text; its accessible title always preserves every significant digit of the exact total and component breakdown. Neither path converts through JavaScript `Number`. This does not modify the global USDT formatter used by unrelated order, margin, and PnL flows, and it never converts an auxiliary asset into the settlement asset.

`visibleNet` deliberately omits zero balances when deciding whether a ledger result has one or several non-zero assets. The open-position projection therefore derives each displayed asset total from its exact owned components, not from `visibleNet`: cancelling components remain a proven zero in their own asset, while an asset with no owned component remains absent.

## Risks / Trade-offs

- **[More visible shared/unknown values initially]** → This is honest; add attribution only when backed by identity evidence and measure live rebate fields before tightening.
- **[Existing tests expect duplicated funding]** → Replace those expectations only after the production ownership model lands, then add ledger-conservation fixtures.
- **[Exact decimal aggregation complicates formatting]** → Keep fixed decimal in domain state and convert only at the presentation boundary.
- **[Trade IDs may be absent on rebates]** → Preserve the credit in the narrowest truthful shared scope; never discard it.
- **[Older cached fills do not contain margin asset]** → Keep their ledger bucket partial until the round-acquisition change performs a bounded REST reacquisition.
- **[A malformed exchange payload is rejected]** → Keep the safety domain far above Binance monetary precision, record the invalid component, and fail the affected result closed instead of risking an unbounded allocation or epoch misattribution.
- **[An adjustment lands outside every known interval]** → Preserve it globally and visibly in the reconciliation/audit result; do not guess a position scope from symbol or input order.
- **[Opposite auxiliary-asset entries cancel]** → Retain both identities and exact per-entry audit evidence while excluding the zero balance from multi-asset qualification.
- **[Income omits its denomination]** → Record malformed evidence, add no guessed monetary entry, and fail only its possible owner scope closed.
- **[Busy same-contract histories still overlap heavily]** → The interval index bounds unrelated-contract work and uses sorted starts to stop before the entry time; truly concurrent candidates remain explicit shared evidence rather than being dropped for speed.
- **[Many unattributed credits can plausibly affect long histories]** → Store compact causal cutoffs and qualify rounds in one pass instead of retaining a credit-by-round Cartesian product.
- **[One identity carries contradictory amounts]** → Keep the result qualified and choose or quarantine deterministically so reversing delivery cannot change visible money.
- **[One contradictory payload is delivered repeatedly]** → Retain each complete signature once and report one stable conflict identity rather than growing audit state with delivery count.
- **[One shared bucket contains a lane-sized history]** → Key the row from its fixed scope tuple so render-time identity work stays constant-size and refreshes preserve focus.
- **[Observation clocks advance on a lane-sized resource]** → Reuse the validated content revision for wallet reconciliation and update only the independently memoized resource window.
- **[A shared bucket hides why it is not additive]** → Carry bounded component metadata from the ledger and render kind, movement types, and qualifications visibly on both surfaces.
- **[Two hedge legs share one contract]** → Count unique symbols and describe same-contract leg attribution separately from other-contract coverage.

## Migration Plan

1. Introduce canonical ledger entries/ownership result alongside current round fields.
2. Switch production open and closed consumers to owned/shared buckets and structured completeness.
3. Add accessible shared/multi-asset UI and precise measure labels.
4. Remove legacy per-round duplicated `fundingPnl`/`insuranceClearPnl` aggregation.
5. After implementation, replace old tests with conservation, hedge overlap, boundary tie, rebate, partial, and accessibility cases.
6. Migrate the maintained probe to the canonical round index and wallet ledger, preserving `marginAsset` and removing its legacy income-attached round totals.
7. Validate USDT, USDC, and separate-fee-asset totals against the probe and live Binance transaction rows before archive. Rollback can keep the canonical ledger while restoring the old presentation; no exchange data is mutated.
