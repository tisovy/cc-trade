## ADDED Requirements

### Requirement: An open position states the money it has already settled
Every open position SHALL state, beside its unrealized PnL and distinctly from
it, the money the position has already settled: the realized PnL of the parts of
it already closed, the funding it has paid or received while held, the commission
it has been charged, and any insurance clearance it has incurred. Unrealized PnL
is what the position would produce if closed now; this is what it has produced
already, and the two SHALL NOT be added together into one figure, because only
one of them is in the wallet.

The components SHALL remain individually readable on the element. A single net
number the operator cannot decompose cannot be checked against the exchange, and
this figure exists to be checked against the exchange.

A component the account has none of SHALL be absent rather than stated as zero —
a position that has never been part-liquidated has no insurance clearance, and
`0.00` beside that label reads as a liquidation that cost nothing.

Amounts SHALL be summed per settlement asset. Where commission was charged in an
asset other than the contract's settlement asset, it SHALL be stated in the asset
it was charged in and SHALL NOT be added into the settlement-asset total, because
the desk holds no rate at which to convert it and a converted guess would be
printed beside money.

Where the components are taken from the exchange's income record they SHALL be
summed as the signed amounts that record states — an outflow is already negative
there — and SHALL NOT additionally be subtracted. Where a commission is taken
from a fill it is an unsigned magnitude and SHALL be subtracted. A surface SHALL
NOT combine the two conventions without resolving the sign, because doing so
counts every fee twice or not at all.

Rebates that offset commission SHALL be counted with it. An account trading on a
rebate that counted only what it was charged would overstate what the position
cost it.

A position's settled money SHALL be attributed to a position leg only where the
exchange states the leg, directly or through a trade the row names. Where it does
not — funding is charged against a contract and names no trade and no leg — the
figure SHALL be stated on the contract rather than divided between the legs of a
hedged position by a rule the exchange did not apply, and the row SHALL say that
is what it is.

#### Scenario: An outflow is counted once
- **WHEN** a position's settled money is folded from income rows in which the commission is stated as a negative amount
- **THEN** the commission reduces the total exactly once, rather than being subtracted from an amount that already carried its sign

#### Scenario: The account trades on a commission rebate
- **WHEN** an open position's contract has both commission and commission-rebate rows against it
- **THEN** the rebate is counted with the commission, and the stated cost is the net of the two

#### Scenario: Both legs of one contract are held
- **WHEN** a hedge account holds a long and a short on the same contract and funding is charged against it
- **THEN** the funding is stated on the contract rather than divided between the two legs, and the rows say the funding is the contract's

#### Scenario: A position has been scaled out of
- **WHEN** an open position has had part of it closed at a profit
- **THEN** its row states that realized profit as settled money, separately from the unrealized PnL of the part still held

#### Scenario: A position is held across a funding boundary
- **WHEN** funding is charged or paid on an open position
- **THEN** the charge appears in the position's settled money, on the contract it was charged against

#### Scenario: The operator reads the components
- **WHEN** the operator inspects the settled-money figure on a position row
- **THEN** the realized PnL, funding, commission and any insurance clearance are each readable individually

#### Scenario: Nothing has been settled yet
- **WHEN** an open position has never been reduced, has not crossed a funding boundary since it opened, and has been charged no commission the desk can see
- **THEN** its settled money reads as nothing settled rather than as a profit of zero

#### Scenario: Commission was charged in BNB
- **WHEN** an open position's commission was charged in BNB while the contract settles in USDT
- **THEN** the BNB commission is stated in BNB and is not added into the USDT total

### Requirement: A settled-money reading names its own window
A position's settled money SHALL be accumulated from the moment that position was
opened. Where the desk's history does not reach back to that moment — the
position was opened before the window of the read, so its start is not in the
data — the reading SHALL state that it covers the read's window rather than the
position's life, and SHALL NOT present a partial total as a complete one.

The start of an open position SHALL be taken from the same fold of fills that the
closed-position review uses, so that one walk of the account's executions defines
when a position began for every surface that asks.

#### Scenario: The position opened inside the window
- **WHEN** the fills in hand include the fills that opened the position
- **THEN** its settled money covers the whole life of the position and is stated without qualification

#### Scenario: The position opened before the window
- **WHEN** the position's opening fills are older than the history the desk has read
- **THEN** the row states that the settled money covers the read's window, not the position's life

#### Scenario: The history is extended backwards
- **WHEN** the operator reads further back and the opening fills come into the window
- **THEN** the settled money is restated over the position's whole life and the qualification is dropped
