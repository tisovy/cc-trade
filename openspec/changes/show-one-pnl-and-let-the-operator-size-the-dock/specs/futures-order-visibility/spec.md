# futures-order-visibility (delta)

## ADDED Requirements

### Requirement: A basis read does not vouch a view

A `basisOnly` history read SHALL merge its rows and coverage without stamping
any view as read, and the reconcile gap-read SHALL name a contract the account
holds when none is chosen — or wait until one exists — rather than issuing a
read that will be refused.

#### Scenario: The tab still gets its first account-wide read

- **WHEN** a basis read covered one open position's trades before the operator first opens Closed Positions
- **THEN** the view is still unread, and opening the tab issues the account-wide read

#### Scenario: A session start with no contract chosen

- **WHEN** the private stream asks to close the offline history gap before any contract is selected
- **THEN** the read is sent with a held position's contract, or waits for one, and is never refused for lacking a symbol

### Requirement: A Full read's discovery reaches the whole product window

On a Full read, the traded-symbol income walk SHALL be allowed enough pages to
enumerate the whole product window rather than the ordinary bounded budget, and
the fan-out cap SHALL admit the contracts that walk finds. An ordinary read
keeps the bounded walk; a walk that still runs out of pages SHALL keep
reporting the discovery incomplete.

#### Scenario: Contracts traded early in the week

- **WHEN** the account's per-fill income spans more pages than the ordinary walk reads, and contracts were traded only in the window's older half
- **THEN** a Full read walks the older half deep enough to name them, reads them, and reports the discovery complete only when the walk actually reached the window's far edge

#### Scenario: The review no longer self-sustains at its own coverage

- **WHEN** the persisted coverage names only a subset of the account's traded contracts (for example after a store re-key emptied it)
- **THEN** the one refresh control runs the Full read while the held reading says discovery did not finish, so the subset cannot become the permanent account
