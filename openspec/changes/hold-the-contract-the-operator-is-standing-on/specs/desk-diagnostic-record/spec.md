## ADDED Requirements

### Requirement: The record reads the exchange's identity alphabet
Every `symbol` field the record declares SHALL accept the identity alphabet the
workstation protocol reads — uppercase, titlecase and caseless letters and
numbers, with the dated delivery-contract form — and SHALL continue to refuse
anything that could spell an amount. A record narrower than the exchange it
records lost every line about 龙虾USDT across a full trading day, including the
status lines naming a fifteen-second resynchronization storm, to the
malformed-field rule.

#### Scenario: A status line names a CJK listing
- **WHEN** a workstation status frame for a CJK-ticker contract is sent to the renderer
- **THEN** the record keeps the line, symbol included

#### Scenario: A decimal is offered as a symbol
- **WHEN** an event arrives whose `symbol` field holds a decimal or lowercase text
- **THEN** the line is refused exactly as before

### Requirement: A session-scoped fault or timing names its contract
A fault raised inside a workstation session, and the aggregate-readiness
timing, SHALL carry the session's contract symbol. A fault raised outside any
session SHALL keep its line with the symbol absent. Unnamed, a held session's
endless rebuild cycle reads as the desk's own — which is exactly how
2026-08-28's storm read until the pair was found by other means.

#### Scenario: A held session's book breaks in the background
- **WHEN** book recovery or a stream fault fires for a session, shown or not
- **THEN** the fault line names that session's symbol

#### Scenario: An aggregate comes up
- **WHEN** the `aggregate-ready` timing is recorded
- **THEN** it names the contract the aggregate came up for

### Requirement: The renderer's display transitions are recorded
The renderer SHALL report, and the record SHALL keep, which contract the screen
switched to (`symbol-shown`, with the contract it left and a cause of
`operator` or `restored`) and when the workspace mounted and unmounted. The
report SHALL be validated by the record's own field rules, reach no exchange
and block nothing. Without it, a remount that reopens a stored contract is
indistinguishable from a selection nobody made.

#### Scenario: The workspace remounts after an activation flap
- **WHEN** the workspace unmounts and mounts again on the restored contract
- **THEN** the record shows the unmount, the mount, and a `symbol-shown` line whose cause is `restored`

#### Scenario: The operator switches contracts
- **WHEN** a contract is selected by click or quick-switch
- **THEN** the `symbol-shown` line's cause is `operator` and `from` names the contract left

### Requirement: The local link's lifecycle is recorded
The record SHALL state when a renderer socket connects and disconnects, with
the number of renderer sockets open after the event. Two where one is expected
is a second window or a leaked subscriber, and this line is the only record
either has: a doubled frame reporter ran for over two hours on 2026-08-28 with
nothing counting the sockets it implied.

#### Scenario: The renderer reconnects
- **WHEN** the local socket drops and a new one is accepted
- **THEN** the record shows the disconnect and the connect, each with the count after it
