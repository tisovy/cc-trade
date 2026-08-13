## 1. Production implementation

- [x] 1.1 Extend the existing six-pixel workstation scrollbar treatment to the recent-contract group, searchable contract list, and shrinkable execution-ticket body without changing native scrolling behavior.
- [x] 1.2 Replace the four chart-tool text labels with compact inline SVG buttons that retain their complete accessible names, titles, actions, and states, and remove desktop toolbar overflow.

## 2. Verification after implementation

- [x] 2.1 Update focused workstation presentation tests for the complete scrollbar owner set, icon-only chart controls, stable accessible names, and non-scrolling desktop toolbar.
- [x] 2.2 Run the focused React suites, lint/build checks appropriate to the affected frontend, and resolve regressions caused by this change.
- [x] 2.3 Revalidate the OpenSpec change and run GitNexus change detection to confirm only the intended futures presentation flows are affected.
