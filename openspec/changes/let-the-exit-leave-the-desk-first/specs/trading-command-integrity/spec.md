## MODIFIED Requirements

### Requirement: A command does not wait on a read the operator is not waiting for
A mutating spot command SHALL be complete when the exchange has answered it and
that answer has been emitted. An account read issued because the command changed
something SHALL NOT be awaited inside the command, so the operator's next action
does not queue behind a refresh they were not waiting for.

A futures configuration command — the margin mode, the leverage multiple — SHALL
be complete when the exchange has answered it and the re-read configuration has
been broadcast: the configuration is the surface the operator is watching, and
the account pass behind it prices consequences, not the answer. That pass SHALL
still run, and a pass that fails SHALL still be recorded.

A futures position-margin adjustment SHALL be complete when the exchange has
answered it. The read that prices its consequence — the position's margin and
the wallet it came from — SHALL be issued and SHALL NOT be awaited, and while the
private stream carries the account it SHALL ask only for the positions and the
balances. On 2026-09-02 this command answered in 24 362 ms because its handler
awaited the whole four-resource pass, and every command behind it on the
contract waited too.

The read SHALL still happen. What changes is only whether the command holds until
it answers.

Where the screen would be wrong until the read answers, the wait SHALL be kept
and the reason stated at that call site. That is the case after an unresolved
outcome has been reconciled: the desk has just learned what became of an order,
and the operator must not act on a screen that predates it.

Because mutating commands are serialized per contract, a wait inside one
command's answer is a wait in front of the operator's next command on that
contract. A command SHALL NOT hold that lane on work the operator did not ask
to wait for.

#### Scenario: An order is accepted
- **WHEN** the exchange accepts a spot order and the desk emits the execution report
- **THEN** the command is done, and the account read it triggers runs without the command waiting on it

#### Scenario: A margin-mode change is accepted
- **WHEN** the exchange accepts a futures margin-mode change and the re-read configuration has been broadcast
- **THEN** the command is done, and the account pass it triggers runs without the command — or the next command on that contract — waiting on it

#### Scenario: The account pass behind a configuration change is deferred by the budget
- **WHEN** the desk's own read budget defers the account pass that follows a configuration change
- **THEN** a second configuration command on the same contract is answered in round-trip time rather than queuing behind the deferred pass

#### Scenario: An unknown outcome has just been resolved
- **WHEN** a spot command's outcome was unknown and reconciliation has just established what happened
- **THEN** the account read is awaited, because the screen is wrong until it answers and the operator may act on it

#### Scenario: The read is the command
- **WHEN** the operator asks the desk to refresh the spot account
- **THEN** the read is awaited, because it is the whole of what was asked for and no outcome was emitted in front of it

#### Scenario: A position-margin adjustment is accepted
- **WHEN** the exchange accepts a futures position-margin adjustment while the private stream carries the account
- **THEN** the command is answered in round-trip time, a positions-and-balances read is issued behind it without the command waiting, and a cancellation sent on the same contract a second later is answered in round-trip time too

#### Scenario: A position-margin adjustment ends unresolved
- **WHEN** the exchange's answer to a position-margin adjustment is indeterminate
- **THEN** the reconciliation read is still awaited to its drain, exactly as before, because the screen is wrong until it answers

### Requirement: A displayed position closes on the first command

The desk SHALL confirm a reduce-only order against the newest successful
positions reading, and SHALL NOT void that evidence because the reading is
being re-confirmed — an in-flight account refresh or a re-activation of the
contract's market data is not a reason to refuse. When no successful reading
exists at all, the command SHALL wait, bounded, for the in-flight pass rather
than refuse on sight, and SHALL be refused only when the reading disagrees
with the requested reduction or the bound expires without a reading.

The renderer SHALL hold itself to the same rule. A surface that sends an exit
SHALL NOT withhold it because the positions reading or the balance reading is
being re-confirmed over a prior success, and SHALL NOT withhold it because the
balance reading is stale: a stale balance bounds what may be opened, not what
may be closed. On 2026-09-02 the ticket withheld every exit for the twenty-four
seconds an account pass took, with the leg on screen the whole time, and the
operator reloaded the window to get out.

A command the renderer withholds — for readiness, for a leg it cannot resolve,
for a cancel already in flight — SHALL be reported to the desk's record as an
outcome of its own, naming the command and the condition, so that an exit that
never left the renderer is not a blank in the record.

#### Scenario: Closing while the account reading is re-stamped

- **WHEN** the desk displays an open leg from its last successful positions reading, a book recovery or refresh pass is re-stamping that reading, and the operator sends a matching reduce-only close
- **THEN** the order is confirmed against the displayed reading and sent on the first command

#### Scenario: A wrong reduction is still refused

- **WHEN** a reduce-only order names a leg, side, or quantity the newest successful positions reading disagrees with
- **THEN** the order is refused and not sent

#### Scenario: The ticket exits while the positions reading is being re-read

- **WHEN** the positions resource reads `loading` over a prior successful reading and the operator confirms an exit on the ticket
- **THEN** the exit leaves the renderer and is proved by the main process, rather than being withheld with «no current confirmed position»

#### Scenario: The ticket exits on a stale balance

- **WHEN** the balance reading is stale and the operator confirms an exit
- **THEN** the exit leaves, with the reading's age stated, while an entry on the same ticket is still held for the stale balance

#### Scenario: A withheld command reaches the record

- **WHEN** the renderer withholds a command for a readiness condition
- **THEN** the record carries an outcome line for that command with the condition named, and no price or size

### Requirement: A reduction refusal names its cause

A `FUTURES_REDUCTION_NOT_CONFIRMED` refusal SHALL name which condition failed
— no successful reading, reading stale beyond the allowed bound, quantity
exceeding the open leg, leg mismatch, or side mismatch — in both the
operator-facing rejection detail and the journal's `outcome` line.

A refusal for a quantity exceeding the open leg SHALL state both numbers to the
operator — the size requested and the leg the desk holds — and the record SHALL
carry their ratio as a bounded count rather than either amount. A staged exit
SHALL show the current leg beside the size about to be sent, so the mismatch is
visible before the confirmation rather than after the refusal. Nothing is cut
to fit: a staged size that no longer passes is refused, as the order-entry
canon requires.

#### Scenario: Diagnosing a refusal from its own line

- **WHEN** a reduce-only order is refused for any cause
- **THEN** the journal `outcome` line and the popup carry the named condition, and no journal archaeology is needed to tell a transient reading gap from a wrong order

#### Scenario: The size exceeds the leg

- **WHEN** a reduce-only order is refused because its quantity exceeds the open leg
- **THEN** the popup states the requested size and the open leg, and the record's `outcome` line carries the ratio of the two in basis points and neither amount

#### Scenario: The leg shrinks under a staged exit

- **WHEN** a partial fill reduces the leg after an exit was staged for the whole of it
- **THEN** the confirmation shows the leg beside the staged size before the operator confirms

### Requirement: Duplicated commands cannot reach the exchange twice
The main process SHALL maintain a bounded registry of in-flight and recently
completed trading commands, keyed by command identity. A command whose identity
is already in flight or already completed SHALL be answered from the registry
instead of being submitted to the exchange. The registry SHALL be bounded in
size and age so it cannot grow without limit.

The renderer SHALL NOT send a second cancellation for an order whose
cancellation has not been answered. The row SHALL state that a cancel is in
flight until the answer, the rejection, the unresolved report or the answer
watcher settles it, and the second request SHALL be reported as withheld. Four
cancellations of one order left the renderer in six seconds on 2026-09-02;
three came back `-2011`.

#### Scenario: The same frame is delivered twice
- **WHEN** two identical trading command frames arrive concurrently
- **THEN** exactly one exchange submission occurs and both frames receive the same outcome

#### Scenario: A completed command is redelivered
- **WHEN** a command identity that already completed is delivered again
- **THEN** the recorded outcome is returned and no new submission occurs

#### Scenario: The registry stays bounded
- **WHEN** commands accumulate over a long session
- **THEN** the registry evicts by age and size and never grows without limit

#### Scenario: The operator cancels an order twice
- **WHEN** a cancel for an order is in flight and the operator triggers another cancel of the same order
- **THEN** no second command leaves the renderer, the row states the cancel in flight, and the record carries the withheld request

#### Scenario: The cancel is answered
- **WHEN** the exchange answers the cancel, refuses it, or the answer watcher expires
- **THEN** the row's in-flight state clears and a further cancel may be sent
