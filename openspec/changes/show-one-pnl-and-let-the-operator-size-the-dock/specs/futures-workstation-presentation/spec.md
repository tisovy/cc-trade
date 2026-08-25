# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: The portfolio dock height is the operator's

The portfolio dock SHALL expose a drag handle on its top edge that sets one
height for both dock panels, adjustable by pointer and by keyboard, reset by
double-click, and persisted across restarts. The stylesheet's default height
applies only while the operator has not chosen one.

#### Scenario: Stretching the dock to review more orders

- **WHEN** the operator drags the dock's top-edge handle upward
- **THEN** both dock panels grow to the dragged height, their tables show more rows, and the height survives a desk restart

#### Scenario: Handing the height back

- **WHEN** the operator double-clicks the handle
- **THEN** the dock returns to the stylesheet's default height and the persisted choice is cleared

### Requirement: A closed round states one money quantity in its row

A closed-position row SHALL carry exactly one money column, named PnL, showing
what the round did to the wallet — the figure the Binance app's Position
History headlines, as the operator's 2026-08-25 live comparison established
("в строке PnL бинанс показывает то, что у нас отображается как Visible
Net"): the exact Wallet Net where the ledger proves one (a foreign-asset fee
valued at its charge's minute; a net proven only in a foreign asset valued
the same way when its price is readable), and the qualified visible
settlement-asset net with every reason on the element where it cannot.
Rounding to cents SHALL be performed on the exact decimal string so no figure
is altered by float precision, and a sub-cent amount that would render as
zero SHALL keep its exact text; the figure is set in bold. The exchange's own
gross realized PnL is a different quantity and SHALL be named on the row's
element — never shown as the column's figure under the net's meaning. No
second money column, measure label, or qualification badge appears in the
row, and no scope banner stands above the table; an unresolved scope still
forbids the claim that no closed positions exist.

#### Scenario: A rounded row keeps its exact figure

- **WHEN** a round's wallet net is `86.70158975` USDT
- **THEN** the row shows `+86.70 USDT` and the element names `Wallet Net: +86.70158975 USDT` beside the exchange's own realized PnL

#### Scenario: The gross realized rides the element

- **WHEN** the ledger proves an exact Wallet Net for a round
- **THEN** the row shows that Wallet Net rounded to cents, and the element names Binance's own realized PnL with its exact text wherever rounding dropped anything

#### Scenario: A qualified net stays one qualified number

- **WHEN** a round's wallet coverage cannot prove an exact net
- **THEN** the row shows the qualified visible settlement-asset net with its reasons on the element, and never the gross realized wearing the net's column

#### Scenario: An unresolved scope without a banner

- **WHEN** a contract's opening boundary has not been reached and the table holds resolved rows
- **THEN** no banner narrates the unresolved scope, and an empty review still states that it cannot prove no closed positions exist

### Requirement: An open position's PnL cell shows amounts only

The open-position PnL (settled money) cell SHALL render its amounts and
nothing else. Coverage qualifications stay on the element; resource failures
surface through the dock's own alert line, never as a badge in the row.

#### Scenario: A partial settled reading

- **WHEN** an open position's settled money does not cover the whole life of the position
- **THEN** the cell shows the amounts with the partial marking on the figure itself, the element names the coverage, and no badge word appears in the row

### Requirement: Wallet-adjustment trouble is announced in the popup channel

A failed or stale wallet-adjustment (settled-income) reading SHALL NOT place a
status banner inside the Closed Positions panel. The failure SHALL be
announced once per failure episode through the desk's popup notification
channel, naming the confirmed reading the rows keep and the re-read control as
the way back; the rows themselves keep showing the confirmed reading with
their qualifications on the row elements. Loading, ready, and never-read
states are announced nowhere. While the settled reading reports failure or has
never been read, the history re-read control SHALL also retry it.

#### Scenario: A refresh fails behind held rows

- **WHEN** a wallet-adjustment refresh fails while the operator reads Closed Positions
- **THEN** one popup announces the failure and the confirmed reading's time, no inline banner appears, the rows keep their qualified confirmed values, and the same failure on later renders is not announced again

#### Scenario: The re-read control is the way back

- **WHEN** the operator presses the history re-read control while the settled reading reports failure
- **THEN** the press issues the history read and retries the wallet-adjustment reading in the same gesture

### Requirement: The history header holds one read control

The history header SHALL offer a single compact re-read control. While the
held reading says contract discovery did not finish, that control SHALL run
the full discovery read; once discovery is complete it SHALL read only what
may have changed. No separate full-read control is shown.

#### Scenario: Healing a narrowed review

- **WHEN** the held reading's discovery is incomplete and the operator presses re-read
- **THEN** the desk runs the full discovery read across the account rather than an incremental read of the contracts already covered

## MODIFIED Requirements

### Requirement: Shared and multi-asset Futures money remains explicit beside compact row money
The positions and Closed Positions surfaces SHALL present leg-owned amounts separately from contract/account-shared adjustments. Shared buckets SHALL remain visible in their rendered group, and shared/unattributed/conflict qualifications SHALL remain focusable rather than existing only in a hover title. A row-owned PnL or settled-money cell SHALL show one settlement-asset figure and SHALL NOT render a foreign-asset quantity as a visible second line (the operator's 2026-08-24 ruling); every distinct asset amount, exact component, and coverage qualification SHALL remain on that money element's accessible title without adding an inline badge. A result held only in a foreign asset SHALL be valued into the settlement figure when its price is readable, and with no readable price the cell states the settlement figure it can prove — or a dash — while the foreign amount stays named exactly on the element. An empty partial reading SHALL NOT be described as proof that nothing settled.

#### Scenario: A contract has shared funding
- **WHEN** funding cannot be attributed between overlapping hedge legs
- **THEN** the contract group shows the funding once as shared and neither leg row claims it as its own wallet Net

#### Scenario: The only component is BNB
- **WHEN** complete additive ownership leaves `-0.003 BNB` as the only non-zero settled component of a round whose trade settlement asset is USDT
- **THEN** the element retains exact `-0.003 BNB` plus any qualification, and the face shows the settlement-asset valuation of that movement when its minute price is readable — never the non-zero movement rounded to zero or relabelled as a USDT amount

#### Scenario: An open position has settlement and auxiliary assets
- **WHEN** an open position has a settlement-asset total plus a commission or credit in another asset
- **THEN** the cell shows one settlement-asset figure — the fee valued into it where its price is readable — while every asset amount, exact component, and any row-owned partial qualification remain named on that money element

#### Scenario: A closed round settles in USDC
- **WHEN** Closed Positions renders a round whose proven settlement asset is USDC
- **THEN** its single `PnL` element retains the USDC denomination for exact realized and wallet detail and never labels or formats either value as USDT

#### Scenario: Exchange realized PnL has sub-cent or large exact precision
- **WHEN** a closed round carries a bounded exact net or realized-PnL decimal that would round, become signed zero, or lose integer precision as a JavaScript `Number`
- **THEN** the `PnL` cell rounds its net directly from the exact text to cents for its glance value except where that would hide a non-zero sub-cent amount as zero, and retains the unchanged exact signed decimals — the net and the exchange's own realized PnL — plus proven asset on the element without a JavaScript `Number`

#### Scenario: Open settled money has sub-cent or large exact precision
- **WHEN** an open position's canonical settled total or component contains a sub-cent decimal or a value beyond JavaScript's safe integer range
- **THEN** the position row sums exact signed decimal strings, shows a cents-rounded glance value except where that would hide a non-zero sub-cent amount as zero, and retains every unchanged exact total/component plus proven asset in its accessible breakdown

#### Scenario: Open settlement components cancel exactly
- **WHEN** one or more exact settlement-asset components belong to an open position and their signed sum is zero
- **THEN** the compact position cell states `0.00` in that asset and its accessible breakdown retains the cancelling components instead of presenting an absent reading

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
- **THEN** Closed Positions shows the shared amount once with an unattributed qualification and every plausible row avoids claiming an exact wallet outcome

#### Scenario: One shared adjustment reaches open and closed scopes
- **WHEN** funding, insurance, or a commission credit can affect both a closed round and the next open round while Dock and Closed Positions are simultaneously rendered
- **THEN** the canonical amount appears in exactly one shared-adjustment group, all affected position rows remain qualified, and neither surface claims a second copy

#### Scenario: Shared qualification receives keyboard focus
- **WHEN** a keyboard or touch operator reaches a shared, unattributed, or conflicted adjustment group
- **THEN** the missing ownership explanation is visible and focusable without hover

#### Scenario: Compact row-owned money is partial
- **WHEN** one open-position or Closed PnL amount has incomplete coverage but no separate shared adjustment row
- **THEN** the cell keeps only the amount at a glance, uses its partial styling, and names the coverage reasons on the money element without adding a badge or second measure label

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
