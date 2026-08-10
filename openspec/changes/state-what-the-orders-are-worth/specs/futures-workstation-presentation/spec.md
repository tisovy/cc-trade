## ADDED Requirements

### Requirement: The ticket states what the working orders are worth
The trading ticket SHALL state, beneath the available balance, the total USDT
value of the account's working orders. That total SHALL be summed from the same
orders the working-orders list shows and priced by the same valuation as each of
its rows, so the stated figure and a hand-sum of the column cannot disagree. It
SHALL NOT be the margin the exchange holds against those orders, which at
leverage is a fraction of their value and which reduce-only exits do not hold at
all. Where the order list has never synchronized the total SHALL be absent
rather than zero; where the list is synchronized and empty it SHALL be zero,
which is a reading.

#### Scenario: Orders are resting
- **WHEN** the account holds a 116890 USDT entry order and a 30006 USDT reduce-only exit
- **THEN** the ticket states `146896 USDT` as `On order` directly under `Available`, the reduce-only leg included even though the exchange holds no margin against it

#### Scenario: Nothing is resting
- **WHEN** the order list is synchronized and empty
- **THEN** the ticket states zero, which is a reading rather than a gap

#### Scenario: Orders have not synchronized
- **WHEN** no confirmed order snapshot exists
- **THEN** the total is absent, exactly as the available balance is when unread, and is not shown as zero

## MODIFIED Requirements

### Requirement: Chrome states only what the desk reads
The market header SHALL NOT repeat mark price or basis, SHALL colour funding by
its sign, and the trading rail header SHALL NOT repeat the market identity or
the selected symbol shown elsewhere. Direction controls SHALL be coloured by
direction. Account funds in the ticket — the available balance and the value of
the working orders — SHALL be shown in whole USDT: at six and seven figures the
cents never change a decision and cost a glance on every read.

#### Scenario: Funding is negative
- **WHEN** the funding rate is negative
- **THEN** it is rendered in the negative colour, and positive funding in the positive colour

#### Scenario: Operator reaches for a direction
- **WHEN** the long and short controls are displayed
- **THEN** long controls carry the positive colour and short controls the negative colour, so direction is readable without reading the label

#### Scenario: Balance carries exchange precision
- **WHEN** the exchange reports an available balance such as `245228.33961912`
- **THEN** the snapshot keeps that value exactly, and the ticket shows `245228 USDT` — rounded rather than truncated — as it shows the value of the working orders
