# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: A position row states which price it is read at, and what the exchange holds it at

Every surface that states an open position's unrealized PnL SHALL make both
figures available on the element that carries the reading: the figure at the
price the row is read at, and the exchange's own figure on its mark.

The reading SHALL be the headline. The mark's figure SHALL be stated under a
name of its own — never as a second unlabelled number, never merged into the
headline, and never with the same visual weight. On a surface with room for a
line of its own it SHALL be drawn quieter than the headline in size, emphasis
and colour, and SHALL be omitted while the row is already read at the mark,
because there is then nothing to state twice.

Where a surface names a price, it SHALL name which price it is. A column or row
labelled as the mark SHALL show the mark.

A live close estimate SHALL be computed at the price the position is read at
rather than at the mark: an exit fills near what the contract is printing.

#### Scenario: The contract prints between two marks

- **WHEN** an open position's contract trades after its latest mark
- **THEN** the row's headline PnL, its return on margin and the dock total move to the printed price, and the mark's own figure remains stated beside them

#### Scenario: A position is open on a contract that is not on screen

- **WHEN** the operator is watching one contract while holding positions in others
- **THEN** every open position is read on its own contract's prices, at the same freshness, whether or not it is the one being watched

#### Scenario: The row is already read at the mark

- **WHEN** a contract has not printed recently enough for its trade to be the newer price
- **THEN** the row is read at the mark and states no separate mark figure beside it

#### Scenario: The mark moves under a contract that is still trading

- **WHEN** a new mark arrives while the row is read at a recent print
- **THEN** the headline is unchanged, and the mark's stated figure, the position's notional and its margin are recomputed

### Requirement: Position rows are valued at the live price, and say which one

Between account snapshots, position rows SHALL be re-valued only from the live
position price feed. Unrealized PnL and return on margin SHALL follow whichever
of the contract's two prices the exchange stated more recently, as
`futures-order-visibility` fixes; the mark price column and USDT size SHALL
follow the mark. The dock total SHALL be derived from the same re-valued rows.
Unrealized PnL SHALL be derived as `(reading price − entry price) × signed
quantity`.

A position whose entry price, quantity, or live price is unusable SHALL retain
a confirmed account-snapshot unrealized PnL as a qualified fallback when one
exists. It SHALL NOT be partially re-valued from a mixture of current and stale
inputs. Where neither a complete live valuation nor a confirmed fallback exists,
the row and dock aggregate SHALL state that they are incomplete rather than
silently summing the known subset.

The mark column SHALL state the same confirmed mark the row's mark-derived
figures use. Source and freshness SHALL remain available so that a snapshot
fallback cannot be mistaken for a live price, and so that a row states which of
the two prices its own reading is on.

Return on margin SHALL use a denominator coherent with the displayed valuation.
When the same surface displays that denominator as position Margin, the amount
SHALL be the one used by the adjacent ROE rather than an older snapshot amount.
Position-only initial margin SHALL be preferred over an account figure that
includes working-order reserve. A live CROSS reading SHALL be unknown unless its
denominator can be derived for the current mark from a confirmed leverage; a
stale snapshot margin SHALL NOT be presented as current live ROE.

#### Scenario: The market moves with no account event

- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140` and the contract has not printed since
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change from that mark, and the dock total changes with them

#### Scenario: The price feed is not connected

- **WHEN** the feed reports no price for a symbol and the account snapshot has a confirmed unrealized PnL
- **THEN** the row and Ticket retain the snapshot reading with its source and age, and no aged price is presented as live

#### Scenario: A price arrives for a symbol with no open position

- **WHEN** a mark or a trade arrives for a symbol that is not in the position list
- **THEN** no row is created or changed

#### Scenario: One position cannot be valued

- **WHEN** at least one open position has neither a complete live valuation nor a confirmed snapshot fallback
- **THEN** the dock total is marked incomplete and states the missing-row count instead of presenting the sum of known rows as complete

#### Scenario: The account is not yet known

- **WHEN** the expanded positions resource has not produced its first confirmed reading
- **THEN** the expanded and collapsed dock both show an unknown aggregate rather than `+0.00`

#### Scenario: A live CROSS mark has no current denominator

- **WHEN** the mark advances but the position has no confirmed leverage from which current position margin can be derived
- **THEN** uPnL and notional remain complete while ROE is shown as unavailable rather than dividing by stale snapshot margin or working-order reserve

## REMOVED Requirements

### Requirement: Position rows are valued at the live mark price
**Reason**: It is the second statement of the rule this change overturns, in the capability that governs what the rows show rather than the one that governs the valuation. Left standing it would have produced a canon that contradicts itself the moment this change was archived — "unrealized PnL SHALL follow the incoming mark" and "aggregate trades SHALL NOT alter these readings" against a desk that reads every position at the price its contract last printed. That reconciliation is exactly what the 2026-08-24 change was raised to do once already.
**Migration**: Replaced by "Position rows are valued at the live price, and say which one", which keeps every rule of it that survives — the snapshot fallback, the refusal to mix generations, the incomplete aggregate, the mark column stating the confirmed mark, and the ROE denominator's coherence — and moves only the choice of price, which `futures-order-visibility` now fixes in one place for both capabilities.
