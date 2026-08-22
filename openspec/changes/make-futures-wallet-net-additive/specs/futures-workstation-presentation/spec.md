## ADDED Requirements

### Requirement: Shared and multi-asset Futures money is visible without hover
The positions and Closed Positions surfaces SHALL present leg-owned amounts separately from contract/account-shared adjustments. Partial, shared, or non-USDT components SHALL be visible in the rendered row/group and accessible by keyboard and touch; a `title` attribute or dotted underline alone SHALL NOT carry the qualification. An empty partial reading SHALL NOT be described as proof that nothing settled.

#### Scenario: A contract has shared funding
- **WHEN** funding cannot be attributed between overlapping hedge legs
- **THEN** the contract group shows the funding once as shared and neither leg row claims it as its own wallet Net

#### Scenario: The only component is BNB
- **WHEN** complete additive ownership leaves `-0.003 BNB` as the only non-zero settled component of a round whose trade settlement asset is USDT
- **THEN** the visible surface states exact Wallet Net `-0.003 BNB` instead of a bare dash, a relabelled USDT amount, or a false partial qualification

#### Scenario: An open position has settlement and auxiliary assets
- **WHEN** an open position has a settlement-asset total plus a commission or credit in another asset
- **THEN** every asset amount and any partial qualification remain visible and keyboard-accessible in the position row rather than existing only in its hover title

#### Scenario: A closed round settles in USDC
- **WHEN** Closed Positions renders a round whose proven settlement asset is USDC
- **THEN** Gross and NET show USDC explicitly and neither value is labelled or formatted as USDT

#### Scenario: Exchange realized PnL has sub-cent or large exact precision
- **WHEN** a closed round carries a bounded exact realized-PnL decimal that would round, become signed zero, or lose integer precision as a JavaScript `Number`
- **THEN** the Gross cell renders that exact signed decimal with the proven asset and does not pass it through a fixed two-decimal USDT formatter

#### Scenario: Retained money is shown during a non-ready resource state
- **WHEN** a loading, stale, error, or idle settled-income resource is paired with contradictory precomputed exact wallet money
- **THEN** Closed Positions retains the visible amount but qualifies it and does not label it Wallet Net until the resource is ready

#### Scenario: A partial read contains no rows
- **WHEN** a bounded income read has no rows but does not completely cover the interval
- **THEN** the surface states that the result is partial rather than `Nothing settled`

#### Scenario: Unresolved closed intervals contain shared income
- **WHEN** shared income interval-matches only partial or unresolved closed rounds
- **THEN** Closed Positions can present it once as qualified shared money rather than omitting it or assigning it to one arbitrary row

#### Scenario: Shared income has no open or closed interval evidence
- **WHEN** a shared entry matches no known round interval or reliable fill
- **THEN** it remains global/account audit information, the Closed/account reconciliation may render it once as unattributed money, and no position row labels it as owned merely from symbol equality

#### Scenario: A delayed credit cannot be assigned to one Closed row
- **WHEN** a real commission credit posts outside every known round interval and has no reliable trade identity
- **THEN** Closed Positions shows the shared amount once with an unattributed qualification and every plausible row avoids an exact NET claim

#### Scenario: One shared adjustment reaches open and closed scopes
- **WHEN** funding, insurance, or a commission credit can affect both a closed round and the next open round while Dock and Closed Positions are simultaneously rendered
- **THEN** the canonical amount appears in exactly one shared-adjustment group, all affected position rows remain qualified, and neither surface claims a second copy

#### Scenario: Qualification receives keyboard focus
- **WHEN** a keyboard or touch operator reaches a partial/shared result
- **THEN** the missing coverage or ownership explanation is available without hover

#### Scenario: Shared adjustments reorder after reconciliation
- **WHEN** a refreshed canonical ledger changes the order of already rendered shared adjustment buckets
- **THEN** each row keeps its stable entry identity so keyboard focus is not silently reassigned to a different monetary adjustment

#### Scenario: A large shared bucket gains another entry
- **WHEN** a shared adjustment contains up to the admitted lane-sized history and refresh adds or reorders member entries without changing its presentation kind, owner, symbol, or leg
- **THEN** its React identity remains one compact collision-safe scope key, no render sorts or serializes the complete member identity list, and the focused DOM row is updated rather than remounted

#### Scenario: Simultaneous shared buckets have similar labels
- **WHEN** open or Closed presentation contains multiple shared buckets whose visible labels overlap
- **THEN** presentation kind, owner, symbol, and leg distinguish their compact row identities without falling back to list index or member identities

#### Scenario: Open shared credit has unreliable identity
- **WHEN** an open-position shared bucket contains an unattributed commission credit whose canonical identity is content-derived
- **THEN** the visible and focusable row states that it is unattributed, names commission credit as the movement type, and exposes the `IDENTITY_UNRELIABLE` qualification instead of showing only a generic Shared label

#### Scenario: A shared representative has a reliable identity conflict
- **WHEN** an open or Closed shared bucket contains the deterministic representative of contradictory payloads that reuse one reliable identity
- **THEN** visible and focusable text identifies an identity conflict, and the selected amount is not labelled as ordinary Shared money or exact wallet Net

#### Scenario: Lane-sized shared bucket rerenders
- **WHEN** a canonical shared bucket contains a lane-sized member list and an unrelated React update rerenders its surface
- **THEN** the row reads the ledger's bounded component summary and does not rescan, map, filter, sort, or serialize the member entries to derive its name or identity

#### Scenario: Unrelated account state changes beside open positions
- **WHEN** orders, balances, history, or another state field changes while positions and settled-income content/window are unchanged
- **THEN** the memoized settled window and other stable row props retain identity so every open-position row is not recomputed solely because the parent state object changed

### Requirement: Closed history states scope and measure precisely
Closed Positions SHALL state fill reach and completeness per contract/position key, including when the visible result is empty. A cumulative quantity SHALL be named `Closed volume`; a primary value named `Position size` SHALL represent peak position size rather than cumulative turnover. Day headings and their tests SHALL accept the product locale rather than assuming one punctuation format.

#### Scenario: One contract is truncated and another is complete
- **WHEN** the review has complete fills for one contract and a page-limited window for another
- **THEN** each contract states its own reach and only the affected rows are qualified

#### Scenario: Empty review has incomplete discovery
- **WHEN** no closed round is shown but contract discovery or fill coverage is incomplete
- **THEN** the empty state states that more history may exist

#### Scenario: A round scales out and re-enters
- **WHEN** cumulative closed contracts exceed the maximum simultaneous exposure
- **THEN** the cumulative figure is labelled `Closed volume` and is not labelled position size

#### Scenario: Date punctuation differs by locale
- **WHEN** the runtime locale formats a day as `07/14` instead of `14.07`
- **THEN** the day remains a valid accessible heading and verification does not fail solely on punctuation order

#### Scenario: Two hedge legs share one settled contract
- **WHEN** BTCUSDT LONG has a settled reading and BTCUSDT SHORT has no leg-owned reading
- **THEN** the SHORT explanation says the same contract was read but no amount was assigned to that leg, and it does not call LONG one other contract
