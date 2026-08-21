## MODIFIED Requirements

### Requirement: Position rows are valued at the live mark price
Between account snapshots, position rows SHALL be re-valued only from the live mark price feed: mark price, USDT size, unrealized PnL, and return on margin SHALL all follow the incoming mark, and the dock total SHALL be derived from the same re-valued rows. Unrealized PnL SHALL be derived as `(mark price − entry price) × signed quantity`. Aggregate trades SHALL NOT alter these readings.

A position whose entry price, quantity, or live mark is unusable SHALL retain a confirmed account-snapshot unrealized PnL as a qualified fallback when one exists. It SHALL NOT be partially re-valued from a mixture of current and stale inputs. Where neither a complete live valuation nor a confirmed fallback exists, the row and dock aggregate SHALL state that they are incomplete rather than silently summing the known subset.

The mark column SHALL state the same confirmed mark used by the row arithmetic. Source and freshness SHALL remain available so that a snapshot fallback cannot be mistaken for a live mark.

#### Scenario: The market moves with no account event
- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140`
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change from that mark, and the dock total changes with them

#### Scenario: The mark feed is not connected
- **WHEN** the feed reports no mark for a symbol and the account snapshot has a confirmed unrealized PnL
- **THEN** the row retains the snapshot reading with its source and age, and no aged mark is presented as live

#### Scenario: A mark arrives for a symbol with no open position
- **WHEN** a mark arrives for a symbol that is not in the position list
- **THEN** no row is created or changed

#### Scenario: The row is valued between two marks
- **WHEN** aggregate trades move after the last confirmed mark
- **THEN** the row's primary valuation and the dock total remain on that mark

#### Scenario: One position cannot be valued
- **WHEN** at least one open position has neither a complete live valuation nor a confirmed snapshot fallback
- **THEN** the dock total is marked incomplete and states the missing-row count instead of presenting the sum of known rows as complete

#### Scenario: The account is not yet known
- **WHEN** the expanded positions resource has not produced its first confirmed reading
- **THEN** the expanded and collapsed dock both show an unknown aggregate rather than `+0.00`

## ADDED Requirements

### Requirement: Live valuation does not repaint the held review
An incoming market valuation SHALL update the affected open-position presentation without rebuilding the held order or Closed Positions review. Opening a long review SHALL keep the mounted review work bounded: only a finite visible window plus overscan SHALL be rendered at once, while every held row remains reachable through an accessible review control.

#### Scenario: A mark ticks while Closed Positions is open
- **WHEN** a mark update changes one open position and the held history inputs have not changed
- **THEN** the Closed Positions review does not render again and its derived rounds are not folded again

#### Scenario: The review holds thousands of rounds
- **WHEN** the operator opens a Closed Positions review larger than the render window
- **THEN** the initial DOM row count remains bounded and the operator can reach older rows without another exchange read

#### Scenario: An execution changes history
- **WHEN** a new execution changes the held fills while Closed Positions is open
- **THEN** the review recomputes from the new history even if no mark changed
