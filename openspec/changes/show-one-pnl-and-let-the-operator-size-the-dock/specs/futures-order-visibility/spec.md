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

### Requirement: A terminal the account vouches proves a chain's left boundary

When the account's complete open-position snapshot has been delivered, the
round fold SHALL prove a chain's left boundary backward from its terminal: a
trial fold assuming the chain began flat is adopted only when it conserves
every fill, reads every round from flat with none continuing an older
position (an opening fill realizing PnL disproves the assumption by itself),
and its terminal position lands exactly on the snapshot — absence from the
complete snapshot meaning flat. Rounds of an adopted chain resolve without a
forward-observed flat boundary. An undelivered snapshot proves nothing, and a
snapshot the trial terminal contradicts leaves the chain withheld exactly as
before.

#### Scenario: Closed chains of a contract the account no longer holds

- **WHEN** the held fills of a fully-closed contract sum to zero and the delivered account snapshot holds no position in it, while the stored coverage never witnessed flat before the first fill
- **THEN** the chain's rounds resolve and its closed positions appear in the review, matching what the exchange's own app lists

#### Scenario: The snapshot contradicts the held fills

- **WHEN** the account still holds contracts the held fills never delivered
- **THEN** no boundary is proven, the withheld rounds stay withheld, and the missing terminal remains an acquisition target

#### Scenario: A chain that begins by realizing PnL

- **WHEN** the first held fill of a chain realizes PnL even though the trial terminal would land on the snapshot
- **THEN** the flat-base assumption is rejected and the chain stays withheld
