## MODIFIED Requirements

### Requirement: The renderer's display transitions are recorded
The renderer SHALL report, and the record SHALL keep, which contract the screen
switched to (`symbol-shown`, with the contract it left and a cause of
`operator` or `restored`), which chart interval it switched to
(`interval-shown`, with the interval left and the same causes), and when the
workspace mounted and unmounted. The report SHALL be validated by the
record's own field rules, reach no exchange and block nothing. Without it, a
remount that reopens a stored contract is indistinguishable from a selection
nobody made, and an interval switch can be read only by inferring it from
timing phases.

#### Scenario: The workspace remounts after an activation flap
- **WHEN** the workspace unmounts and mounts again on the restored contract
- **THEN** the record shows the unmount, the mount, and a `symbol-shown` line whose cause is `restored`

#### Scenario: The operator switches contracts
- **WHEN** a contract is selected by click or quick-switch
- **THEN** the `symbol-shown` line's cause is `operator` and `from` names the contract left

#### Scenario: The operator switches intervals
- **WHEN** an interval is selected by button or picker
- **THEN** the record carries an `interval-shown` line naming the contract, the interval, the interval left and the cause `operator`

#### Scenario: The interval is restored on mount
- **WHEN** the workstation mounts on a stored interval
- **THEN** the `interval-shown` line's cause is `restored`
