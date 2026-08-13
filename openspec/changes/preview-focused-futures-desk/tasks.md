## 1. Production implementation

- [x] 1.1 Replace the futures structural accent, soft accent, border, and shell variables with the neutral-slate and calm-blue preview while preserving explicit semantic state colors.
- [x] 1.2 Add an expanded-by-default, session-local portfolio-dock collapse control and compact live summary that preserves order-tab state and account readings across collapse and expansion.
- [x] 1.3 Add responsive dock styling so the compact summary releases the expanded panels' grid height and remains readable at supported workstation scales.

## 2. Verification after implementation

- [x] 2.1 Add focused portfolio-dock tests for default expansion, truthful compact counts and uPnL, live summary updates, expansion, and retained order-tab state.
- [x] 2.2 Add focused stylesheet assertions that distinguish neutral structure and calm selection from unchanged red/green semantic state colors.
- [x] 2.3 Run focused React suites and the frontend quality checks appropriate to the affected presentation code, resolving regressions caused by this experiment.
- [x] 2.4 Revalidate the OpenSpec change, run GitNexus change detection, and keep the experiment isolated for one-command `git revert` rollback.
