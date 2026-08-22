## 1. Dependency and impact gates

- [x] 1.1 Confirm `make-futures-rounds-leg-and-window-correct` is implemented for canonical leg/round identity, or explicitly keep this change blocked and verify no symbol-only ownership code is added
- [x] 1.2 Run GitNexus upstream impact for income normalization, open settlement, round income attachment, dock/history consumers, and probe paths; record effective money-flow risk before editing

## 2. Canonical ledger production path

- [x] 2.1 Introduce exact signed canonical ledger components and one ownership result (`roundOwned`, `legOwned`, `contractShared`, `accountShared`) in production code, then verify every input identity appears in exactly one owner set with a local probe
- [x] 2.2 Attribute realized PnL/gross fill commission by fill leg and reliable commission credits by trade identity, then verify the `120 - 4 + 0.4` rebate example yields `116.4` once
- [x] 2.3 Replace overlapping-time duplication with deterministic single ownership or shared buckets for funding/insurance/unattributed credits, then verify the two-round `10 + 10 - 3` example reconciles to `17`
- [x] 2.4 Add independent trade/commission/income coverage and per-asset aggregate state, then verify exact wallet Net is absent when an opening fee or newest income edge is uncovered
- [x] 2.5 Switch open-position and Closed Positions production selectors to the canonical reconciliation result and remove legacy duplicated per-round arithmetic, then verify per-asset conservation over the held ledger
- [x] 2.6 Denominate round-owned realized PnL and missing-asset fee fallback with the round's proven settlement asset, then verify `+10 -1 -2` produces one exact `+7 USDC` bucket
- [x] 2.7 Derive open/closed shared scope only from reliable fill/interval matches, include interval-matched partial or unresolved closed rounds, and retain fully unmatched contract/leg/account entries only in global shared/audit buckets without order-dependent fallback ownership
- [x] 2.8 Bound exact-decimal parsing before `BigInt` expansion and reject absent/blank/non-finite/inverted temporal evidence, then verify malformed input cannot consume unbounded resources, become epoch time, or produce exact wallet Net
- [x] 2.9 Exclude exactly zero auxiliary-asset balances from aggregate asset cardinality while retaining their canonical entries and conservation evidence
- [x] 2.10 Reject assetless income at the ledger boundary and qualify every interval/symbol scope it could affect without inventing USDT
- [x] 2.11 Preserve unreliable status for canonical content-derived income identities while keeping exact exchange transaction identities reliable
- [x] 2.12 Require canonical symbol evidence for interval ownership and replace per-income full round scans with a reusable symbol/leg interval index that preserves overlaps and boundary ambiguity
- [x] 2.13 Preserve the full round-owner set for reversal-fill credits and quarantine unmatched delayed credits as one global amount while qualifying every compatible round
- [x] 2.14 Treat no-unique-fill commission credits as globally shared even when posting time overlaps the next round, and assign every non-round shared entry one deterministic presentation scope
- [x] 2.15 Replace expanded credit-by-round affected IDs with compact indexed causal scopes and make conflicting-identity numeric evidence deterministic across input order
- [x] 2.16 Audit canonical source-fill atoms against exact round assignments in the trade-round index and fail a compromised position fold closed before wallet reconciliation, without changing the ledger or hook API
- [x] 2.17 Deduplicate conflicting entry evidence by complete signature, retain one stable conflict record per identity, and keep qualification/order-independent canonical money bounded under repeated conflicting delivery
- [x] 2.18 Emit one bounded deduplicated component-kind summary from every canonical shared bucket so renderers never derive its label by rescanning member entries
- [x] 2.19 Mark a reliable-identity shared bucket with deterministic `IDENTITY_CONFLICT` evidence whenever its canonical representative conflicts, keeping it non-additive without hiding the selected amount
- [x] 2.20 Migrate `scripts/probe-futures-settled.mjs` to preserve `marginAsset`, build the canonical trade-round index, and report `reconcileFuturesWalletLedger` owned/shared per-asset totals and audit evidence without legacy income-attached round arithmetic
- [x] 2.21 Restrict wallet timestamps, symbols, assets, and legs to the canonical Futures trade-evidence domains so malformed direct-call evidence cannot prove ownership or exact Net
- [x] 2.22 Trust the ledger's exact single-asset Wallet Net regardless of whether its sole non-zero asset matches the round settlement asset, without relabelling that amount
- [x] 2.23 Preserve numeric reverse-flat proof and remove obsolete legacy arithmetic/commentary from the canonical read-only probe while keeping explicit wallet comparison separate from sanitized acquisition diagnostics

## 3. Truthful presentation production path

- [x] 3.1 Render contract/account-shared adjustments once and expose partial/shared qualifications to keyboard and touch, then verify no explanation is hover-only
- [x] 3.2 Render non-USDT components visibly without converting them into USDT and verify a BNB-only reading is not a bare dash
- [x] 3.3 State per-contract history reach in empty and non-empty reviews and rename cumulative turnover to `Closed volume`, then verify incomplete discovery cannot read as proven empty
- [x] 3.4 Make day-heading behavior locale-robust and verify both `07/14` and `14.07` formats retain valid accessible headings
- [x] 3.5 Render Gross and exact/qualified NET with their actual asset and verify a USDC amount is not passed through a USDT formatter
- [x] 3.20 Render every per-asset open-position settled amount plus a visible/focusable partial qualification instead of hiding auxiliary assets and completeness in `title`
- [x] 3.23 Key open and Closed shared-adjustment rows by stable owner/entry identity rather than presentation index
- [x] 3.24 Render a global unattributed commission credit once in the Closed/account reconciliation without assigning it to an arbitrary position row
- [x] 3.25 Prevent any funding, insurance, or credit entry that reaches open and closed scopes from rendering in both simultaneous shared-adjustment groups
- [x] 3.26 Replace membership-sized shared-adjustment React keys with one compact collision-safe presentation kind/owner/symbol/leg identity in both open and Closed consumers
- [x] 3.27 Show shared/unattributed kind, movement components, and structured qualifications visibly and accessibly for open shared adjustments
- [x] 3.28 Key wallet reconciliation to the validated settled-income content revision and memoize the settled window separately so observation-only and unrelated state updates preserve heavy fold/row identities
- [x] 3.29 Count settled-income reach by unique contract symbols and distinguish an unassigned hedge leg of the same contract from a genuinely different contract
- [x] 3.30 Canonically sort semantic position tuples in the round-fold signature so exchange array reordering preserves round, wallet, and row identities
- [x] 3.31 Render an identity-conflicted shared representative as an explicit visible/focusable conflict state in open and Closed surfaces rather than ordinary Shared money
- [x] 3.32 Render Gross from bounded exact realized-PnL text with the proven asset instead of `Number` plus a two-decimal USDT formatter
- [x] 3.33 Fail the Closed presentation seam closed when a non-ready settled-income resource is paired with contradictory exact precomputed money

## 4. Tests after implementation

- [x] 4.1 Replace duplicated-funding expectations with conservation tests for sequential boundaries, hedge overlap, identical duplicate delivery, conflicting reliable identities across round scopes, and shared buckets; run the focused ledger/round suites
- [x] 4.2 Add rebate tests with/without trade identity, opening-fill credits, BNB commission, insurance, and multi-asset totals; run the focused settled-money suite
- [x] 4.3 Add component/accessibility tests for partial-empty, shared funding, BNB-only, per-contract scope, Closed volume, and locale-independent headings; run the history/dock suites
- [ ] 4.4 Run the settled-income probe against canonical per-asset sums, record any live rows whose attribution evidence is absent, and measure commission-rebate posting delay against the two-minute confirmation-debt horizon
- [x] 4.5 Add USDC round, missing/conflicting settlement asset, per-round fee fallback, unmatched-global, and interval-matched unresolved-Closed shared-scope regression tests
- [x] 4.6 Add oversized exponent/coefficient, absent round/income timestamp, and inverted interval regressions, including scoped fail-closed behavior
- [x] 4.7 Add order-invariant scope regressions and a zero-sum auxiliary-asset case proving no false `MULTI_ASSET` qualification while audit conservation remains exact
- [x] 4.8 Add assetless funding/insurance/credit regressions proving no default asset enters money and affected rounds lose exact NET locally
- [x] 4.9 Add canonical `fsi:v2:row` versus `fsi:v2:tran` regressions proving fallback dedup keys cannot promote exact NET
- [x] 4.20 Add dock regressions for a settlement-asset total plus auxiliary asset and for a partial reading whose qualification is available without hover
- [x] 4.23 Add open/Closed shared-adjustment reorder regressions proving each existing DOM row retains its monetary identity
- [x] 4.24 Add blank/cross-contract ownership regressions and a 10k-round by 10k-income same-symbol stress assertion proving bounded indexed candidate lookup
- [x] 4.25 Add post-close no-trade-id and reversal-trade-id rebate regressions proving the credit remains visible/conserved once and every plausible round loses false exact NET
- [x] 4.26 Add delayed-credit-inside-next-open, future-round causality, reversal, and boundary funding/insurance regressions proving plausible rows are qualified while open/closed projections remain disjoint
- [x] 4.27 Add reversed-conflict output invariance and many-credit/long-history stress regressions proving bounded compact qualification without a Cartesian assignment graph
- [x] 4.28 Add production-backed fill-allocation regressions for a conserved `4 + 2` reversal, under/over/unknown assignment, duplicate delivery, and reversed input order
- [x] 4.29 Add `[A, B, B]` permutation/conflict-cardinality regressions plus lane-sized shared-key and rerender-focus regressions, verifying constant-size identity and no collision between simultaneous buckets
- [x] 4.30 Add hook identity regressions proving observation-only frames do not refold/rebuild wallet results and unrelated state changes preserve the settled-window object
- [x] 4.31 Add ledger/open/Closed regressions for precomputed component summaries, visible unreliable-identity/type metadata, and zero member-entry scans on a lane-sized rerender
- [x] 4.32 Add a hedge-leg empty-reading regression proving same-symbol LONG/SHORT are one contract and the missing leg is explained without an `other contract` claim
- [x] 4.33 Add ledger/open/Closed regressions proving a conflicted reliable shared identity exposes deterministic conflict qualification and is never presented as ordinary Shared money
- [x] 4.34 Add a hook regression proving a position-array permutation does not rebuild the round index or replace the wallet reconciliation identity
- [x] 4.35 Add a deterministic probe-report regression proving USDC denomination, per-asset conservation, and one shared funding identity without calling Binance; leave the live probe task 4.4 operator-gated
- [x] 4.36 Add direct-ledger regressions proving safe integer/digit-string times and canonical symbol/asset/leg values remain accepted while fractional, negative, unsafe, contradictory-alias, punctuated, oversized, or arbitrary values fail closed
- [x] 4.37 Add hook-to-Closed regressions proving a complete BNB-only round remains exact and is never relabelled as settlement-asset money
- [x] 4.38 Add Closed regressions for sub-cent, signed-zero, and beyond-safe-integer realized PnL plus non-ready-resource exactness defense
- [x] 4.39 Extend the deterministic probe regression with a numeric flat boundary and count-only acquisition-shape output while retaining explicit per-asset wallet comparison

## 5. Verification and operator gate

- [x] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-futures-wallet-net-additive --strict` and verify it passes
- [x] 5.2 Run GitNexus `detect_changes` against `main`, confirm only expected ledger/open/closed/UI flows are affected, and resolve unexpected symbols before commit
- [ ] 5.3 Compare four representative live Closed Positions, including one USDC-settled round, plus simultaneous hedge-leg open settlement with Binance income/fill rows per asset; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after operator confirmation and carry any rebate-shape unknown into an explicit follow-up change
