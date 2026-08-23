## ADDED Requirements

### Requirement: Every Futures wallet flow has one additive owner
Each canonical realized-PnL, fill-commission, funding, insurance-clear, or underivable commission-credit entry SHALL contribute to at most one additive owner. Fill-derived realized PnL and gross commission SHALL belong to the position leg and round named by the fill. An income entry with a reliable trade identity SHALL belong to the matching fill/round. Funding, insurance, or credit that cannot be reliably attributed to one leg/round SHALL remain in one contract-level or account-level shared bucket and SHALL NOT be copied into multiple row totals. Membership in an open or closed presentation scope SHALL require fill or interval evidence; symbol or leg equality alone SHALL NOT assign a shared entry to an arbitrary open or closed round.

Timestamp interval ownership SHALL require a canonical symbol and SHALL first restrict candidates to that contract and optional leg. Reconciliation SHALL build and reuse a bounded interval index rather than scanning every account round for every income entry, while preserving all overlapping candidates, inclusive boundary ties, open-ended live intervals, and input-order independence.

Wallet reconciliation SHALL admit interval timestamps only as non-negative safe integers or digit-only strings that parse exactly into that domain, and multiple aliases supplied for one coverage boundary SHALL agree. Symbols SHALL match the canonical Futures trade-evidence symbol domain, assets SHALL match its asset domain, and position legs SHALL be only `BOTH`, `LONG`, or `SHORT`. Malformed, contradictory, or non-canonical temporal/identity evidence SHALL fail closed and SHALL NOT prove ownership, denomination, or exact wallet Net.

#### Scenario: Funding lands on a boundary between sequential rounds
- **WHEN** one funding entry shares the close/open timestamp of two sequential one-way rounds
- **THEN** it contributes once to a deterministic owner or one shared contract bucket, never to both round totals

#### Scenario: Both hedge legs overlap funding
- **WHEN** LONG and SHORT are simultaneously open for a contract when one funding entry occurs and the entry names no leg
- **THEN** the entry remains contract-shared and is not included in full in either leg-owned total

#### Scenario: A rebate names a trade
- **WHEN** an underivable commission credit carries a reliable trade identity matching one round
- **THEN** its signed amount is included once in that round's commission adjustment

#### Scenario: A rebate cannot be attributed
- **WHEN** an underivable commission credit lacks a reliable leg/round identity
- **THEN** it remains visible in a shared bucket rather than being discarded or guessed

#### Scenario: A rebate is posted after its possible round closed
- **WHEN** a symbol-scoped commission credit has no trade identity and its posting timestamp lies after every compatible round interval
- **THEN** it remains one global shared amount, every compatible round is qualified instead of claiming exact wallet Net, and the amount is not discarded from the Closed/account reconciliation

#### Scenario: A delayed rebate timestamp enters the next round
- **WHEN** a commission credit has no reliable fill owner and its posting timestamp overlaps a newer open round after a compatible round closed
- **THEN** timestamp alone does not assign it to the newer round, both compatible scopes remain qualified, and the canonical credit stays one shared amount

#### Scenario: A round opens after an unattributed credit
- **WHEN** a compatible contract round opens strictly after a commission credit with no reliable fill owner was posted
- **THEN** causality excludes that future round from the credit's affected set and the earlier credit does not remove its exact wallet Net

#### Scenario: A rebate names a reversal fill
- **WHEN** a reliable trade identity names one reversal fill that closes one round and opens another
- **THEN** the credit remains shared across the complete fill-owner set, contributes to the ledger once, is rendered in one deterministic presentation scope, and neither affected round claims an exact wallet Net from posting-time ownership

#### Scenario: A contract adjustment matches no round interval
- **WHEN** a canonical contract or leg adjustment lies outside every known round interval and has no reliable fill owner
- **THEN** it remains once in the global shared ledger and audit, and neither open nor closed scope claims it merely because a round has the same symbol or leg

#### Scenario: Position-scoped income has no contract identity
- **WHEN** malformed funding or insurance evidence reaches reconciliation without a canonical symbol
- **THEN** timestamp overlap does not assign it to any round, it remains account-shared and qualified, and no contract row claims exact Net from it

#### Scenario: A busy account reconciles many intervals
- **WHEN** the ledger contains many rounds and many income rows across one or more contracts
- **THEN** ownership candidates come from the reusable symbol/leg interval index without a full account-round scan per income row and all genuine overlaps remain represented

#### Scenario: Many unattributed credits affect a long contract history
- **WHEN** many no-fill-owner credits can qualify many earlier rounds of one contract
- **THEN** reconciliation stores compact causal affected scopes and evaluates them in one round pass rather than materializing or scanning the credit-by-round Cartesian product

#### Scenario: Shared income matches unresolved closed intervals
- **WHEN** one shared adjustment falls inside overlapping closed round intervals that remain partial or unresolved
- **THEN** the qualified Closed shared scope includes it once using those interval matches, even though no exact round owner can be selected

#### Scenario: The same income row is read twice
- **WHEN** stream, tail read, and verification deliver the same canonical income identity
- **THEN** the ledger and every aggregate include it once

#### Scenario: Canonical income has only a content-derived fallback identity
- **WHEN** an income row has no reliable exchange transaction identity and its canonical key is derived from amount, asset, time, scope, and optional trade fields
- **THEN** the key MAY deduplicate identical delivery, but remains identity-unreliable and cannot promote an affected round to exact wallet Net

#### Scenario: Conflicting income payloads reuse one reliable identity
- **WHEN** two different income payloads carry the same reliable canonical identity and their attribution evidence can affect different round scopes
- **THEN** the audit records an identity conflict, retains the identity once, and every round scope reachable from either payload remains qualified without an exact wallet Net

#### Scenario: Conflicting identity delivery order reverses
- **WHEN** the same contradictory reliable-identity payloads arrive in opposite orders
- **THEN** canonical and visible per-asset money plus conflict audit remain identical and delivery order cannot select the displayed amount

#### Scenario: A reliable identity conflict selects one shared representative
- **WHEN** contradictory payloads with one reliable canonical identity resolve to a deterministic representative in a contract-shared or account-shared bucket
- **THEN** the bucket remains non-additive, exposes a deterministic `IDENTITY_CONFLICT` qualification, and the selected amount is not represented as ordinary Shared money

#### Scenario: A conflicting payload is delivered repeatedly
- **WHEN** one canonical identity receives distinct payloads `A` and `B` and any delivery path repeats either complete payload signature
- **THEN** reconciliation retains each distinct signature once, emits one stable conflict record for the identity, and permutations such as `[A, B, B]` and `[B, B, A]` produce the same conflict audit and affected scope

#### Scenario: A monetary payload exceeds the exact-decimal safety bound
- **WHEN** a round or income amount contains an exponent, scale, or coefficient too large for the bounded canonical decimal domain
- **THEN** the value is rejected without unbounded integer expansion and every potentially affected result remains qualified rather than presenting an exact wallet Net

#### Scenario: Temporal evidence is absent or inverted
- **WHEN** a round boundary or income timestamp is null, blank, non-finite, or a close precedes its open
- **THEN** it is not coerced to the Unix epoch and cannot prove interval ownership or complete wallet Net

#### Scenario: Temporal evidence is outside the canonical integer domain
- **WHEN** a round boundary or income timestamp is fractional, negative, outside JavaScript's safe-integer range, or a non-digit numeric string
- **THEN** it is rejected while an equivalent non-negative safe integer or digit-only string remains admissible

#### Scenario: Coverage aliases contradict one another
- **WHEN** one optimistic coverage record supplies different canonical times for two aliases of the same boundary
- **THEN** the coverage is partial and cannot promote the affected interval to exact wallet Net

#### Scenario: Wallet scope identity is outside the canonical evidence domain
- **WHEN** a round or income row supplies a punctuated/oversized symbol, a punctuated/oversized asset, or a leg outside `BOTH`, `LONG`, and `SHORT`
- **THEN** that field is rejected and cannot prove contract, asset, or leg ownership even when optimistic coverage metadata accompanies it

### Requirement: Wallet Net states component completeness
A per-position or per-round value SHALL be called wallet Net only when its trade, gross commission, and relevant income coverage are each complete for the stated interval and asset. Otherwise the surface SHALL report a qualified visible net or unknown result and SHALL identify the missing components. In Closed Positions that outcome and its qualification SHALL remain detail on the same single `PnL` element or in one shared-adjustment group, not a second money column. A non-USDT component SHALL remain denominated in its own asset and SHALL NOT be silently included in a USDT total.

Validated settled-income frames with the same account fingerprint, content generation, and digest SHALL reuse the existing canonical wallet reconciliation when only observation clocks advance. A resource metadata update SHALL remain observable, but it SHALL NOT repeat exact-decimal parsing, ownership folding, or round remapping for byte-equivalent money. A changed generation/digest or legacy resource identity SHALL still invalidate the fold.

Position-snapshot cache identity SHALL be independent of exchange array order. It SHALL be derived from a canonical sorted sequence of semantic `{symbol, leg, quantity, entryPrice}` tuples, so an otherwise identical permutation preserves the trade-round index and wallet reconciliation identity while a tuple value change invalidates them.

Round-owned realized PnL SHALL use the consistent settlement asset proven by that round's fills. A commission without its own asset MAY fall back only to that proven round asset. An income entry without its own settlement asset SHALL be rejected as malformed evidence and SHALL NOT inherit an account-wide default or the matched round's asset. An account-wide default, contract suffix, or another component's asset SHALL NOT override missing/conflicting round evidence.

#### Scenario: Opening commission is outside the fill window
- **WHEN** a closed round has a visible closing commission but its opening fill/commission is not covered
- **THEN** the row does not call the partial result the amount that reached the wallet and identifies trade/commission coverage as incomplete

#### Scenario: Income coverage stops before close
- **WHEN** a round closes after the newest fully covered income instant
- **THEN** its income component and wallet Net remain incomplete

#### Scenario: All components are covered
- **WHEN** trade, gross commission, and relevant income cover the entire resolved round in one asset
- **THEN** the row may state an exact wallet Net equal to those signed components

#### Scenario: Commission is paid in BNB
- **WHEN** a round has a BNB commission component and USDT realized PnL
- **THEN** USDT Net excludes the BNB amount and the BNB amount remains explicitly visible in its own denomination

#### Scenario: The sole non-zero exact result is an auxiliary asset
- **WHEN** complete canonical ownership contains zero settlement-asset movement and one non-zero auxiliary-asset total
- **THEN** that ledger total remains the round's exact single-asset Wallet Net even though its asset differs from the round settlement asset

#### Scenario: A USDC round reaches the wallet
- **WHEN** one proven USDC round realizes `+10 USDC`, pays `-1 USDC` commission, and has `-2 USDC` funding with complete coverage
- **THEN** its exact wallet Net is `+7 USDC` and no fictitious USDT component is created

#### Scenario: A round has no proven settlement asset
- **WHEN** realized PnL belongs to a round whose fills omit or conflict on settlement asset
- **THEN** the realized component is not assigned to a guessed asset and the row cannot claim exact wallet Net

#### Scenario: An income entry has no settlement asset
- **WHEN** funding, insurance, or a commission credit omits or blanks its asset
- **THEN** the malformed entry is not assigned guessed USDT money, its possible round scope remains qualified, and no affected row claims exact wallet Net

#### Scenario: An auxiliary asset nets exactly to zero
- **WHEN** complete owned BNB commission and BNB credit entries cancel exactly while the settlement-asset component remains non-zero
- **THEN** the underlying BNB entries remain in the canonical ledger and audit, but the result is not qualified `MULTI_ASSET` solely because of the zero BNB balance

#### Scenario: Verification advances only observation clocks
- **WHEN** a valid same-generation/same-digest settled-income frame advances read or success times without changing canonical lane money or state
- **THEN** resource timestamps update while the wallet ledger, enriched round collection, Closed rows, and open settled-money objects retain their prior reconciliation identity

#### Scenario: The maintained probe reconciles a closed round
- **WHEN** the read-only settlement probe receives canonical fills and settled-income rows for a round
- **THEN** it preserves each fill's `marginAsset` and numeric reverse-flat boundary, derives rounds with the production trade-round index, reports the production wallet ledger's owned and shared sums per asset, and does not attach funding or insurance through legacy overlapping-time or open-position arithmetic

#### Scenario: Exchange reorders an unchanged position snapshot
- **WHEN** a position frame contains the same semantic position tuples as the preceding frame in a different array order
- **THEN** the existing trade-round index, wallet reconciliation, Closed rows, and open settled-money identities are reused rather than refolded

### Requirement: Displayed Futures money conserves the canonical ledger
For any selected account scope and covered interval, the sum of leg/round-owned components plus each shared bucket exactly once SHALL equal the canonical ledger for that scope, asset, and interval. The application SHALL test this invariant independently of presentation order, timestamp ties, hedge overlap, and duplicate delivery.

#### Scenario: Two rounds share one contract adjustment
- **WHEN** two resolved rounds and one unallocated contract adjustment are displayed
- **THEN** the two owned results plus the adjustment equal the ledger and summing visible additive figures does not duplicate the adjustment

#### Scenario: Open and closed ownership meet at a boundary
- **WHEN** a position closes and another opens at the same timestamp
- **THEN** every fill and income identity belongs to exactly one owned/shared component across the boundary

#### Scenario: Shared income matches no resolved round
- **WHEN** a canonical contract or leg adjustment interval-matches a partial or unresolved round in the requested open/closed scope but no resolved round can own it
- **THEN** it remains in one qualified shared bucket for that evidence-backed scope and is not omitted from both open and closed scope results

#### Scenario: A delayed global credit is visible once
- **WHEN** a canonical commission credit has no unique fill or interval owner but can affect known rounds of its contract
- **THEN** the account/Closed reconciliation renders that global shared identity once, the audit remains additive, and all compatible rows remain qualified

#### Scenario: One shared identity reaches open and closed rounds
- **WHEN** a funding, insurance, or commission-credit assignment affects at least one open and one closed round
- **THEN** its canonical owner remains singular, its open and closed presentation projections are disjoint, and the audit reports no projected identity twice

### Requirement: Canonical fill quantities are conserved before round exactness
The trade-round index SHALL audit every deduplicated canonical fill against the exact integer quantity atoms assigned to round contributions before those aggregates reach wallet reconciliation. For each canonical fill identity, assigned atoms SHALL equal source atoms exactly, every assignment SHALL name a canonical source, and duplicate delivery SHALL contribute one canonical source quantity independent of input order. The audit SHALL be derived from the canonical fill set rather than from already-aggregated round totals. A missing, unknown, under-allocated, over-allocated, or otherwise invalid assignment SHALL fail the affected position fold closed, retain its rounds as unresolved evidence, and prevent those rounds from claiming exact wallet Net.

#### Scenario: A reversal fill is split across two rounds
- **WHEN** one canonical fill of six quantity atoms closes four atoms of one round and opens two atoms of the next round
- **THEN** the two exact assignments conserve the single canonical fill and both round contributions may remain eligible for exact reconciliation

#### Scenario: A canonical fill is under-allocated or omitted
- **WHEN** a canonical fill's assigned atoms total less than its source atoms, including no assignment at all
- **THEN** the fill-conservation audit fails and every round in the affected position fold remains unresolved without an exact wallet Net

#### Scenario: A canonical fill is over-allocated or unknown
- **WHEN** assigned atoms exceed the matching source quantity or an assignment names no canonical fill
- **THEN** the fill-conservation audit fails closed and reports the affected fill and round identities for diagnosis

#### Scenario: Duplicate fill delivery is order-independent
- **WHEN** REST, bootstrap, and stream copies of one fill arrive in any order
- **THEN** canonicalization contributes one source quantity, assignments conserve against it once, and the audit result is invariant to delivery order
