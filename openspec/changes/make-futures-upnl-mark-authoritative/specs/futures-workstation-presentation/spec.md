## MODIFIED Requirements

### Requirement: Position rows are valued at the live mark price
Between account snapshots, position rows SHALL be re-valued only from the live mark price feed: mark price, USDT size, unrealized PnL, and return on margin SHALL all follow the incoming mark, and the dock total SHALL be derived from the same re-valued rows. Unrealized PnL SHALL be derived as `(mark price − entry price) × signed quantity`. Aggregate trades SHALL NOT alter these readings.

A position whose entry price, quantity, or live mark is unusable SHALL retain a confirmed account-snapshot unrealized PnL as a qualified fallback when one exists. It SHALL NOT be partially re-valued from a mixture of current and stale inputs. Where neither a complete live valuation nor a confirmed fallback exists, the row and dock aggregate SHALL state that they are incomplete rather than silently summing the known subset.

The mark column SHALL state the same confirmed mark used by the row arithmetic. Source and freshness SHALL remain available so that a snapshot fallback cannot be mistaken for a live mark.

Return on margin SHALL use a denominator coherent with the displayed valuation. When the same surface displays that denominator as position Margin, the amount SHALL be the one used by the adjacent ROE rather than an older snapshot amount. Position-only initial margin SHALL be preferred over an account figure that includes working-order reserve. A live CROSS reading SHALL be unknown unless its denominator can be derived for the current mark from a confirmed leverage; a stale snapshot margin SHALL NOT be presented as current live ROE.

#### Scenario: The market moves with no account event
- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140`
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change from that mark, and the dock total changes with them

#### Scenario: The mark feed is not connected
- **WHEN** the feed reports no mark for a symbol and the account snapshot has a confirmed unrealized PnL
- **THEN** the row and Ticket retain the snapshot reading with its source and age, and no aged mark is presented as live

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

#### Scenario: A live CROSS mark has no current denominator
- **WHEN** the mark advances but the position has no confirmed leverage from which current position margin can be derived
- **THEN** uPnL and notional remain complete while ROE is shown as unavailable rather than dividing by stale snapshot margin or working-order reserve

#### Scenario: A live CROSS denominator moves with notional
- **WHEN** a current mark changes the position margin derived from confirmed leverage
- **THEN** the row's Margin amount and ROE use that same current denominator rather than showing a snapshot amount beside a percentage derived from another amount

#### Scenario: An explicit short carries positive quantity
- **WHEN** tape explanation is calculated for a SHORT leg whose internal quantity is positive
- **THEN** its tape PnL keeps short direction and the presentation does not recompute it with an unsigned quantity

## ADDED Requirements

### Requirement: Live valuation does not repaint the held review
An incoming market valuation SHALL update the affected open-position presentation without rebuilding the held order or Closed Positions review. Opening a long review SHALL keep the mounted review work bounded: only a finite visible window plus overscan SHALL be rendered at once, while every held row remains reachable through an accessible review control.

#### Scenario: A mark ticks while Closed Positions is open
- **WHEN** a mark update changes one open position and the held history inputs have not changed
- **THEN** the Closed Positions review does not render again and its derived rounds are not folded again

#### Scenario: Only explanatory tape detail changes
- **WHEN** a tape-only update changes no accepted mark
- **THEN** the position aggregate does not recompute and the held review does not render

#### Scenario: Only mark freshness advances at the same price
- **WHEN** a newer valid mark frame repeats the accepted mark price and changes only its source time
- **THEN** freshness remains available without recomputing the numeric aggregate or action previews that do not display that time

#### Scenario: The review holds thousands of rounds
- **WHEN** the operator opens a Closed Positions review larger than the render window
- **THEN** the initial DOM row count remains bounded and the operator can reach older rows without another exchange read

#### Scenario: An execution changes history
- **WHEN** a new execution changes the held fills while Closed Positions is open
- **THEN** the review recomputes from the new history even if no mark changed

### Requirement: Position actions use current account facts and known safety bounds
Opening a close or margin action from a valued row SHALL retain only the row identity and current raw account position as command authority; a presentation valuation SHALL never be reclassified as an account snapshot. Once a successful positions resource confirms that the leg is absent, the action SHALL close or remain disabled rather than targeting a stale or reopened leg.

Margin adjustment SHALL fail closed independently by direction. ADD requires a known available balance. REMOVE requires a strictly positive maintenance requirement, a coherent account-risk snapshot, and a known removable amount. Unknown, zero, negative, or generation-mixed risk inputs SHALL NOT enable submission.

#### Scenario: A valued row opens an action and then disappears
- **WHEN** an action is opened from a live-mark row and a successful positions reading no longer contains that leg
- **THEN** the live-derived DTO is not relabelled as an account snapshot, no command remains enabled for the absent position, and a later position with the same symbol and side does not inherit the stale action draft

#### Scenario: ADD has no confirmed wallet bound
- **WHEN** available USDT is unknown
- **THEN** ADD is unavailable and no adjustment command is submitted

#### Scenario: REMOVE has incomplete risk inputs
- **WHEN** maintenance margin is absent, zero, negative, or not coherent with the current account position, or removable margin is otherwise unknown
- **THEN** REMOVE is unavailable and no adjustment command is submitted

### Requirement: Ticket account summaries distinguish unknown from empty
Ticket counts and empty-state copy SHALL be derived from resource availability. Zero and “none” SHALL be shown only after a successful authoritative read; idle, first-load, and never-successful error states SHALL remain unknown, while stale held data MAY remain visible with its stale status.

#### Scenario: Ticket opens before its first account read
- **WHEN** positions or orders are idle, loading, or failed without a prior successful reading
- **THEN** their count is shown as unknown and the Ticket does not state that there are no positions or orders

#### Scenario: Ticket receives a successful empty account read
- **WHEN** the corresponding account resource is ready with an authoritative empty list
- **THEN** the Ticket shows zero and its truthful empty-state copy

#### Scenario: Ticket holds stale successful rows
- **WHEN** refresh fails after a prior successful reading
- **THEN** the held count and rows remain visible with stale/error qualification rather than changing to either unknown or empty
