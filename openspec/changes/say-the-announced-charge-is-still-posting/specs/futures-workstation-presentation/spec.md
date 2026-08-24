# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: An announced charge awaiting its record is a wait, not a failure

When a settled read answers every request and the resource is incomplete only
because a charge the exchange announced has not yet appeared in the income
record, the desk SHALL NOT announce a failure and SHALL NOT ask the operator
to retry. The surface SHALL state that the announced charge is being
confirmed and when the confirming pass runs. "Failed", and the
kept-confirmed-reading stamp, SHALL be reserved for a pass whose outcome is
failed or whose requests went unanswered. The settled journal line SHALL state
which of the two states an incomplete pass was in.

#### Scenario: The two minutes after a close

- **WHEN** the operator closes a position and a refresh-class settled pass runs before the confirming pass has proven the announced charge's income row
- **THEN** no failure popup fires, the surface states the charge is being confirmed, and the figures land without any operator action

#### Scenario: A real failure still announces

- **WHEN** a settled pass fails — a request refused, unanswered, or the walk's outcome is failed
- **THEN** the failure is announced once in the popup channel with the kept confirmed reading's stamp, and ↻ retries it
