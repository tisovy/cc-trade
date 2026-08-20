## ADDED Requirements

### Requirement: The settled-money read covers the newest end of its window and states what it covered
The read that answers what a position or a closed round has settled SHALL cover
the newest end of its window first. Where the exchange orders its income record
oldest-first and pages that order, a bounded read SHALL NOT spend its budget
walking forward from the far edge of the window: on an active account that
returns a reading covering none of what is on screen, which is indistinguishable
from an account that has settled nothing.

A page returned full SHALL NOT be accepted as covering the range it was asked
for, and SHALL NOT be discarded either. A full page is the oldest rows of that
range: it covers that range's start up to its own newest row, and the remainder
SHALL be read forward from there. Discarding it and re-asking a narrower range
throws away rows the read has already paid for, which is what turns a reading of
fourteen pages into a hundred requests. What the read *claims* as covered SHALL
always be a contiguous span whose newest instant is known; rows held below that
claim are kept but not claimed.

The read SHALL state the oldest instant it actually covered, never the window it
asked for. Any surface or fold deciding whether a figure is complete SHALL decide
it against that stated coverage. A reading that names the requested window while
having reached only part of it reports every figure built from it as whole, which
is the one failure this statement exists to prevent.

A contract whose position or round began before the read's coverage reaches SHALL
be presented as partially covered and SHALL say so, rather than presenting the
covered total as the whole of what the position settled.

Rows already read SHALL be retained across passes, and a pass SHALL read only
what it does not already hold. Re-reading a held span on every pass spends the
budget that would otherwise extend coverage, and leaves the reading permanently
short on exactly the accounts whose volume makes it short in the first place.

#### Scenario: The account produces more rows than one budget can walk
- **WHEN** the income window holds more rows than the read's request budget can return
- **THEN** the rows the read keeps are the newest ones, and the reading states an oldest covered instant later than the window's start

#### Scenario: A slice comes back full
- **WHEN** a requested slice of the window returns a full page
- **THEN** its rows are kept, the rest of that slice is read forward from the page's newest row, and the slice is claimed as covered only once a page comes back short — so no gap is left between the rows claimed and the instant the coverage claims to reach

#### Scenario: The slice asked for is far wider than the account answers
- **WHEN** a full page spans a small fraction of the slice it was asked for
- **THEN** the read sizes its next slice from what that page demonstrated, and carries that width into later passes rather than re-deriving it from a fixed starting guess each time

#### Scenario: A round began before the read reaches
- **WHEN** a closed round opened earlier than the oldest instant the income read covered
- **THEN** the round's result is presented as missing funding the read did not cover, rather than as a complete result

#### Scenario: A second pass follows a first
- **WHEN** a settled read runs again while rows from an earlier pass are still within the window
- **THEN** it reads only the span it does not already hold, and the rows already held are not re-requested

#### Scenario: Coverage is stated rather than implied
- **WHEN** a fold decides whether a contract's settled total is complete
- **THEN** it decides against the instant the read stated it covered, and a contract whose position began before that instant is reported as incomplete

### Requirement: A position's settled money is never stated as its contract's
What a surface states an open position has already settled SHALL be bounded at
the moment that position was opened. Where the desk cannot establish that moment
— the read of fills does not reach back to it — the desk SHALL state no figure at
all, and SHALL say why.

A total bounded by nothing is not a partial answer to the question the column
asks. It is a whole answer to a different one: rounds closed days before the
position was opened contribute their realized PnL, their commission and their
funding to a figure presented as this position's. That is not a qualified figure
and marking it as incomplete does not make it true.

#### Scenario: The fills read does not reach the position's opening
- **WHEN** an open position's contract has income in the read's window but the desk has no trustworthy moment for when that position was opened
- **THEN** the settled column states no amount, and names the reason as the fills read not reaching back to the opening rather than as the position having settled nothing

#### Scenario: The position's opening is known
- **WHEN** the desk knows when an open position was opened
- **THEN** the settled figure counts only income recorded at or after that moment, and income belonging to earlier closed rounds on the same contract is excluded

### Requirement: Every income row the exchange charged is held as its own row
Rows of the income record SHALL be held under a key that separates two charges
the exchange actually made. Where the exchange states an identity the desk can
carry, that identity together with the kind of flow SHALL be the key — Binance
states `tranId` is unique only within one `incomeType`, so neither field
identifies a row alone.

Where the exchange states an identity the desk **cannot** carry, the row SHALL
still be held as its own row. `tranId` arrives as a JSON integer and one past
2^53 has already lost digits by the time it is parsed, so an adapter that refuses
a rounded identity — which it must, since paging from a rounded one asks for a
row that does not exist — leaves the row with no identity at all. Keying every
such row alike collapses them: on 2026-08-20 the desk held **one** funding charge
of the twenty an open position had been charged, and the column beside that
position printed its commission exactly and its funding not at all. Nothing
failed, nothing was logged, and the count of rows held looked healthy; only a
count of rows *of that kind* named it.

The key for such a row SHALL be what the row is: the kind of flow, the contract,
the instant, the amount, and the fill the charge was made on. The fill is
required. Every fill is charged commission, and an account working one contract
fills the same size at the same price more than once in a millisecond, so
without it two real charges are read as one row handed back twice and the
position's commission is stated short by the difference. Funding and insurance
clearance name no fill and need none: a contract is charged once per settlement.

A reading SHALL be idempotent under this key. The same row handed back twice —
which a page boundary inside one millisecond does — SHALL count once.

#### Scenario: The exchange gave a row no identity the desk can carry
- **WHEN** several funding charges on one contract arrive with a `tranId` the adapter refused
- **THEN** every charge is held, and their sum is what the exchange charged rather than the amount of whichever arrived last

#### Scenario: Two charges the exchange made in the same millisecond
- **WHEN** two fills of the same size at the same price in the same millisecond are each charged the same commission, and neither row carries a usable `tranId`
- **THEN** both charges are held, because the rows name different fills

#### Scenario: A page boundary hands a row back twice
- **WHEN** a row already held is returned again by an overlapping page
- **THEN** it is counted once, whether or not the exchange gave it a usable identity
