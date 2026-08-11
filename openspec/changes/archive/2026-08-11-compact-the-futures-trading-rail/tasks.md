## 1. Safety and Baseline

- [x] 1.1 Verify the primary checkout is still on `master`, re-read the affected files for concurrent edits, and validate `compact-the-futures-trading-rail` before touching product code.
- [x] 1.2 Run fresh upstream GitNexus impact analysis for `FuturesWorkstationView`, `FuturesProductionWorkstation`, and `FuturesTradingTicket`; report the direct callers, affected production flows, and risk, and stop for operator review if any result is HIGH or CRITICAL.
- [x] 1.3 Run the three targeted Futures component test files to establish a passing baseline and record any pre-existing failure before changing behavior.

## 2. Recent Contracts and Identity State

- [x] 2.1 Update `FuturesWorkstationView` to derive catalogue-resolved and pending recent contracts as a most-recent-first pill group, exclude those symbols from the ordinary empty-search list, and produce one deduplicated ordinary list while search is active.
- [x] 2.2 Render recent selection and favorite as separate accessible controls, expose selected/favorite state, and add wrapping content-sized styling that fits several ordinary USDⓈ-M symbols at the supported narrow rail width.
- [x] 2.3 Derive authenticated account synchronization in `FuturesProductionWorkstation`, pass an explicit signal to the view, display `SYNC` only in place of `LIVE`, preserve non-routine market state precedence/reasons, and remove the duplicate contract-section state badge.
- [x] 2.4 Extend `FuturesWorkstationView.test.jsx` and `FuturesProductionWorkstation.test.jsx` for pending recency before catalogue load, catalogue reconciliation, selection/favorite isolation, empty-search deduplication, unified search results, wrapping hooks, and `LIVE`/`SYNC`/non-routine precedence.

## 3. Compact Execution Ticket

- [x] 3.1 Remove the ticket's routine readiness/reason and pause/resume header plus passive shortcut/action label without changing readiness or backend pause enforcement for order actions.
- [x] 3.2 Remove percentage anchor buttons, the derived `Quantity` summary, the mouse-shortcut legend, and their dead constants/styles while retaining the slider's percentage and whole-USDT readout and editable notional.
- [x] 3.3 Suppress successful-submission and cancelled-confirmation feedback and remove the passive last-execution acknowledgement card; keep contextual blocked/not-sent reasons, exchange rejections, unresolved outcomes, account-sync failures, and valid retry actions visible.
- [x] 3.4 Extend `FuturesTradingTicket.test.jsx` to prove removed chrome is absent, slider sizing and gates are unchanged, exact quantized quantity remains in confirmation, passive success/cancel states add no banner, and every retained safety-critical failure/retry path still renders.

## 4. Compact Order Book and Aggregate Tape

- [x] 4.1 Remove the visible order-book and tape heading rows while preserving numeric grid alignment, and give each book level and tape row an accessible name containing the meaning and units of every value.
- [x] 4.2 Render only the resolved price in the last-print separator, remove its arrow, `LAST` label, and divider borders, reduce vertical margin and padding by two pixels, and expose up/down/neutral price-change direction in its accessible name.
- [x] 4.3 Move tape pause/filter controls and effective-settings text into a semantic disclosure that is closed by default, keep interactive controls out of its summary, and keep the trade list mounted outside it so values, updates, pause state, and scroll position survive toggling.
- [x] 4.4 Prune obsolete workstation CSS, style the disclosure and compact rows, and verify the order book, tape, and recent pills do not overflow or obscure controls at the supported narrow Electron dimensions.
- [x] 4.5 Extend `FuturesWorkstationView.test.jsx` for absent visual headings, row-level accessible names, compact price-only last print, default-closed/open/closed settings behavior, retained setting drafts/applied values, continuously visible trades, and unchanged tape scroll position.

## 5. Verification and Operator Handoff

- [x] 5.1 Run `npm test -- src/components/features/futures/FuturesWorkstationView.test.jsx src/components/features/futures/FuturesProductionWorkstation.test.jsx src/components/features/futures/FuturesTradingTicket.test.jsx` and resolve all regressions attributable to this change.
- [x] 5.2 Run `npm run lint`, `npm run build`, `npm run check:futures-production`, and `npm run check:command-path`; confirm no renderer/main boundary or trading-command invariant changed.
- [x] 5.2a Confirm the production build, both renderer/main boundary checks, and ESLint scoped to every changed JSX/test file pass.
- [x] 5.2b Re-run repository-wide lint after the pre-existing `no-undef` references in `electron/services/binance-connection.js` were fixed independently on `master`; confirm this UX change did not modify the Electron service.
- [x] 5.3 Run `OPENSPEC_TELEMETRY=0 openspec validate compact-the-futures-trading-rail`, `git diff --check`, and GitNexus change detection for all working-tree changes; verify only the expected symbols, direct dependants, and production Futures flow are affected before committing to `master`.
- [x] 5.3a Audit GitNexus's aggregate `HIGH` change-detection rating: confirm individual production-symbol impacts remain `MEDIUM`/`LOW`, all direct callers are covered, and the affected processes stay inside the Futures workstation/Context renderer path.
- [x] 5.4 Restart the full application/backend to clear any non-persistent pre-existing pause, then have the operator verify on live data at the narrow Electron size: recent pills/search, `LIVE` ↔ `SYNC`, retained failures/retries, compact ticket, book levels, last price, and tape disclosure/update/scroll behavior.
- [x] 5.5 After operator confirmation, mark live verification complete and archive `compact-the-futures-trading-rail`; otherwise record every discovered issue as an explicit unfinished or follow-up task instead of archiving it.

## 6. Post-implementation Audit

- [x] 6.1 Re-audit the implementation on the current `master` after concurrent changes: re-run GitNexus impact/context checks, trace every requirement to current renderer code and tests, and inspect responsive, accessibility, state-precedence, persistence, and command-safety edge cases.
- [x] 6.1a Hide the ordinary catalogue list when search is empty, retain the recent-pill group as the only idle contract list, preserve one unified selectable list for active search, and add focused regression tests for both modes.
- [x] 6.1b Seed an otherwise empty recent history with the active starting contract so a fresh installation still renders the retained pill list, persists it normally, and has production-container regression coverage.
- [x] 6.2 Run the targeted and broader relevant test suites plus a narrow-layout production render; fix every confirmed functional regression in scope with focused automated coverage, and repeat the narrow render after each responsive correction.
- [x] 6.3 Re-run repository lint/build, Futures boundary and command-path checks, OpenSpec validation, diff hygiene, and staged GitNexus change detection; review the final diff and commit the audited change directly to `master`.
- [x] 6.3a Audit GitNexus's aggregate `HIGH` staged rating: confirm it is the combined count from OpenSpec headings plus the two renderer components, while individual production impacts remain `MEDIUM`/`LOW`, no Electron/main file is staged, and every d=1 dependant is covered by the targeted and full suite.
- [x] 6.3b Record the concurrent verification boundary: repository-wide lint passed after the audited UI implementation, then a final rerun encountered the unrelated in-progress `bootstrap-the-book-on-a-quiet-market` `depthBootstrapCode` `no-undef`; scoped lint for every staged JSX/test file still passes and none of that concurrent change is staged here.

## 7. Adaptive Recent-Pill Height

- [x] 7.1 Re-run GitNexus impact analysis for the current contract-rail owner and inspect the live rail/flex layout before editing; report and stop if the refreshed risk is HIGH or CRITICAL.
- [x] 7.2 Make the recent-pill group use its wrapped content height while the rail has spare vertical space, then constrain it to the genuinely available height and enable internal scrolling only when needed without pushing the execution ticket out of the rail.
- [x] 7.3 Add focused regression coverage for the content-first overflow contract and visually verify both a roomy narrow rail and a shorter rail where scrolling is required.
- [x] 7.4 Run the targeted Futures tests, scoped lint, production build, OpenSpec validation, diff hygiene, and staged GitNexus change detection; review and commit only this follow-up directly to `master`.
