## ADDED Requirements

### Requirement: Settled-income triggers spend weight only on relevant lanes
Settled-income scheduling SHALL map each trigger to the minimum income lanes needed to make that event current. A funding event SHALL refresh funding; any fill SHALL coalesce a delayed refresh for underivable commission-credit lanes; insurance-related account events SHALL refresh insurance; cold start and periodic verification SHALL reconcile every required lane. Completeness SHALL remain per lane so this narrowing cannot falsely mark the union complete.

A funding, fill, or insurance witness SHALL create and persist the applicable confirmation debt before scheduler cooldown, account-wide backoff, or ordinary due checks decide whether its immediate REST read may run. A declined immediate read SHALL retain the stale lane and its dedicated confirmation timer. If that timer becomes due while admission remains deferred, confirmation SHALL be re-armed for the earliest bounded eligibility instant rather than silently dropped.

Before a fired, re-armed, debounced, or single-flight-queued confirmation performs REST work, the scheduler SHALL intersect its captured lanes with current confirmation debt. A lane already repaid by a successful pass SHALL NOT be re-read merely because an older timer or queue entry named it, and a confirmation with no remaining debt SHALL be discarded before physical admission. A terminal account/IP-wide HTTP 418 floor SHALL remain active until a deliberate all-lane pass produces successful lane answers; a timeout, empty answer, or different refusal without a repeated 418 SHALL NOT by itself prove recovery.

An ordinary account tick SHALL request only genuinely incomplete, non-loading lanes that are not waiting on an unexpired confirmation deadline. Debt-only incompleteness SHALL spend no tick income weight because the dedicated confirmation pass owns it; a simultaneous acquisition gap in another lane SHALL request only that other lane.

The desk SHALL define and verify request-weight budgets for a single event refresh, its confirmation, cold start, and periodic verification using the exchange-declared weight of every physical request. Each settled-income pass diagnostic SHALL expose bounded reason, lane/page/read counts, physical-attempt count, charged weight, and coverage gained. For underivable credit lanes it SHALL expose only aggregate counts of rows with a symbol and/or reliable trade identity, never the identity value, raw row, URL, signed parameters, credential, or money.

The maintained read-only probe SHALL acquire settled income through the production fixed-window per-lane walker with explicit page numbers and the production row/page bounds. It SHALL NOT maintain a separate timestamp cursor or unfiltered union pagination path. If any lane is incomplete or failed, its canonical wallet comparison SHALL remain qualified and its acquisition summary SHALL expose only bounded lane/page/count/state evidence.

Every physical settled-income page attempt SHALL remain owned by the Futures activation that scheduled it. If deactivation or an account switch retires that activation while the attempt is waiting for admission, the retired attempt SHALL stop before transport creation and SHALL NOT publish, persist, or clear settled-income state for a later activation.

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

#### Scenario: Private stream opens after bootstrap has started
- **WHEN** Futures activation has already scheduled its all-lane bootstrap and the private stream opens before or after that pass completes
- **THEN** stream readiness does not enqueue a second all-lane income pass, while account refresh and later event-specific income triggers remain active

#### Scenario: Request budget would be exceeded
- **WHEN** completing all pending lane work would exceed the admission budget
- **THEN** the work remains partial/queued with its target visible and does not borrow unrecorded weight from trading commands

#### Scenario: A lane reaches its local row ceiling
- **WHEN** a lane terminates with `ROW_LIMIT_REACHED`
- **THEN** ordinary automatic ticks place that lane in the per-lane reconciliation cooldown instead of restarting page one, while unrelated lanes and deliberate manual/full verification remain eligible

#### Scenario: A settled-income page needs physical retries
- **WHEN** one logical income page is sent more than once because of transport or timestamp recovery
- **THEN** the pass diagnostic counts every physical attempt and its charged weight rather than multiplying only logical page count by 30

#### Scenario: Account changes while an income page waits for admission
- **WHEN** a settled-income physical attempt is queued and its Futures activation is retired by deactivation or an account switch before transport creation
- **THEN** the old attempt is cancelled at admission and cannot send against, publish into, persist over, or clear state owned by the next activation

#### Scenario: Rebate-shape evidence is recorded safely
- **WHEN** underivable credit rows are acquired with and without symbol or trade identity
- **THEN** diagnostics expose bounded aggregate presence counts and do not record any raw identity, row, signed request material, or money

#### Scenario: Every settled scheduler reason reaches the record
- **WHEN** a pass runs with one of the production reasons `bootstrap`, `stream`, `fill`, `funding`, `settlement`, `refresh`, `confirm`, `credit-confirm`, `insurance`, `insurance-confirm`, `verification`, `extension`, or `tick`
- **THEN** its closed diagnostic vocabulary recognizes the scheduler's exact bounded reason instead of silently dropping the whole pass record

#### Scenario: Event arrives during lane cooldown or account backoff
- **WHEN** a funding, fill, or insurance witness arrives while its immediate income read is declined by a lane cooldown or account-wide backoff
- **THEN** the affected lanes become durably stale before that decision, their confirmation remains armed, and later manual work cannot promote the missing event to exact money

#### Scenario: Confirmation deadline arrives before backoff ends
- **WHEN** a dedicated confirmation timer becomes due while the applicable lane or account admission backoff is still active
- **THEN** the stale debt survives and confirmation is re-armed for the earliest bounded eligible instant rather than disappearing with the fired timer

#### Scenario: Queued confirmation debt was already repaid
- **WHEN** a manual, verification, or sibling pass successfully clears one or more lanes while an older confirmation timer or single-flight request still names them
- **THEN** the obsolete lanes are removed before REST admission, a fully repaid confirmation sends no request, and a later failure cannot degrade those newly exact lanes

#### Scenario: Confirmation debt is repaid during scheduling debounce
- **WHEN** a fast manual or verification pass clears a lane after its confirmation was scheduled but before the debounce callback runs, including when a newer fill or funding event coalesces into the same debounce or single-flight follow-up
- **THEN** confirmation-only and non-confirmation lane provenance survives every queue boundary, the callback keeps genuinely new event lanes but drops each repaid confirmation-only lane before REST admission, and an obsolete failed read cannot replace exact evidence

#### Scenario: Full recovery probe does not succeed
- **WHEN** an account-wide HTTP 418 floor exists and a deliberate all-lane probe returns a timeout, empty answer, or non-successful lane without another 418
- **THEN** automatic event and tick work remains behind the account-wide floor until a deliberate pass proves recovery with successful lane answers

#### Scenario: Tick runs before a confirmation deadline
- **WHEN** an ordinary account tick sees debt lanes plus one unrelated lane with a genuine acquisition gap
- **THEN** only the unrelated incomplete lane is requested, while a debt-only resource sends no tick income request

#### Scenario: Operator probe reads a dense timestamp peer set
- **WHEN** the maintained probe encounters more than one income page sharing a millisecond or a lane needs a continuation pass
- **THEN** it follows the production lane walk and explicit page checkpoint without advancing a timestamp cursor or claiming complete comparison coverage early
