## 1. Production implementation

- [x] 1.1 Extend the persisted workstation UI-scale domain to 70% while preserving the existing step, reset, maximum, and storage behavior.
- [x] 1.2 Add a normalized pure symbol-history transition that removes one recent symbol without disturbing favorites and provides a safe last-symbol fallback.
- [x] 1.3 Wire recent-symbol removal through the production container and view, replace the recent-pill star with an accessible `×`, and protect the selected contract from removal.
- [x] 1.4 Convert the recent-contract group to a compact three-column grid with constrained long-symbol text and full-symbol disclosure.

## 2. Verification after implementation

- [x] 2.1 Update UI-scale and symbol-history unit tests for the 70% floor, bounded stepping, persisted removal, favorite preservation, and fallback behavior.
- [x] 2.2 Update workstation React tests for three-up styling, inactive removal, active removal protection, long-symbol disclosure, and retained favorite management in search results.
- [x] 2.3 Run the focused utility and workstation test suites, then run the repository's relevant quality checks and resolve regressions caused by this change.
- [x] 2.4 Revalidate the OpenSpec change and run GitNexus change detection to confirm only the intended presentation, scale, and symbol-history flows are affected.
