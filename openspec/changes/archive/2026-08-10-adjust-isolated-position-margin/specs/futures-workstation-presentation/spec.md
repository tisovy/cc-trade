## ADDED Requirements

### Requirement: A panel opened at the cursor stays wholly inside the window
A panel anchored at the pointer SHALL be placed so that its whole height and
width remain inside the window, wherever the operator clicked and whatever the
window's size and position on the desktop. The placement SHALL follow the
panel's actual rendered height rather than an assumed one, and SHALL be
corrected when the panel's content changes size while it is open.

#### Scenario: The click lands near the bottom edge
- **WHEN** the operator opens a panel by clicking near the bottom of the window
- **THEN** the panel is placed above that point so that its last control is visible, rather than extending past the window's edge

#### Scenario: The panel grows after it opens
- **WHEN** a panel's content grows while it is open
- **THEN** its position is corrected so it still ends inside the window

#### Scenario: The panel is taller than the window
- **WHEN** a panel cannot fit in the window at all
- **THEN** it is aligned to the top edge, so that its heading and its first controls are the part that is reachable

### Requirement: A panel's drag handle does not swallow the controls on it
A panel's drag handle SHALL start a drag only for a press that did not land on
a control. A press that begins on a button, field or link inside the handle
SHALL reach that control.

#### Scenario: The close button is pressed
- **WHEN** the operator presses the close button that sits on a panel's drag handle
- **THEN** no drag begins and the panel closes

### Requirement: Dock columns line up with the headings above them
Every row of a dock table SHALL resolve to the same column widths as its
heading row. No column in a dock table SHALL be sized by its own content,
because a heading and the cells beneath it never hold the same content and a
content-sized column therefore shifts every flexible column beside it.

#### Scenario: A table with an action column is rendered
- **WHEN** the positions or orders table renders a row carrying an action control and a heading row that carries none
- **THEN** the values sit under the headings that name them
