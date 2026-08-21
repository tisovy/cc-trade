## ADDED Requirements

### Requirement: Settled-income triggers spend weight only on relevant lanes
Settled-income scheduling SHALL map each trigger to the minimum income lanes needed to make that event current. A funding event SHALL refresh funding; any fill SHALL coalesce a delayed refresh for underivable commission-credit lanes; insurance-related account events SHALL refresh insurance; cold start and periodic verification SHALL reconcile every required lane. Completeness SHALL remain per lane so this narrowing cannot falsely mark the union complete.

The desk SHALL define and verify request-weight budgets for a single event refresh, its confirmation, cold start, and periodic verification using the exchange-declared weight of every physical request.

#### Scenario: Funding event arrives
- **WHEN** one funding settlement event invalidates a confirmed reading
- **THEN** the immediate logical page requests the funding lane rather than all six lanes

#### Scenario: Opening fill may earn a rebate
- **WHEN** a fill realizes zero but may produce an underivable commission credit
- **THEN** one coalesced delayed credit-lane refresh is scheduled and the current command is not blocked

#### Scenario: Many fills arrive in a burst
- **WHEN** multiple executions occur inside the coalescing interval
- **THEN** they produce one bounded credit-lane confirmation rather than one six-lane walk per fill

#### Scenario: Periodic verification runs
- **WHEN** the verification interval is due
- **THEN** all required lanes are eventually reconciled within the declared verification budget

#### Scenario: Request budget would be exceeded
- **WHEN** completing all pending lane work would exceed the admission budget
- **THEN** the work remains partial/queued with its target visible and does not borrow unrecorded weight from trading commands
