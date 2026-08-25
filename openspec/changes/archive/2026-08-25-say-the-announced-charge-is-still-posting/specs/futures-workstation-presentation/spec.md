# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: An announced charge awaiting its record is a wait, not a failure

When a settled read answers every request and the resource is incomplete only
because a charge the exchange announced has not yet appeared in the income
record, the desk SHALL NOT announce a failure and SHALL NOT ask the operator
to retry. The money the wait qualifies SHALL state on its own element that the
announced charge is still posting and when the confirming pass runs, in place
of the generic not-ready qualification — not as a popup or an inline banner,
which every close and every funding settlement would raise. "Failed", and the
kept-confirmed-reading stamp, SHALL be reserved for a pass whose outcome is
failed or whose requests went unanswered; a failure standing anywhere in the
resource SHALL keep the failure announcement even while a debt also stands.
The settled journal line SHALL state which of the two states an incomplete
pass was in, and name the lanes whose debt holds it open.

#### Scenario: The two minutes after a close

- **WHEN** the operator closes a position and a refresh-class settled pass runs before the confirming pass has proven the announced charge's income row
- **THEN** no failure popup and no banner fire, the round's money element states the charge is still posting and the time it is confirmed at, and the figures land without any operator action

#### Scenario: A real failure still announces

- **WHEN** a settled pass fails — a request refused, unanswered, or the walk's outcome is failed
- **THEN** the failure is announced once in the popup channel with the kept confirmed reading's stamp, and ↻ retries it
