# Testing Strategy

## Goals
- Guarantee core flows (chart rendering, pair switching, order interactions) behave across upgrades.
- Catch regressions in the Electron bridge when Binance responses change shape.
- Keep focused checks fast while retaining one explicit aggregate safety gate.

## Layers

| Layer | Tooling | Scope |
| --- | --- | --- |
| Unit | Vitest | Pure helpers (`utils/utils.js`), custom hooks (`useWebSocket`), Context logic. |
| Component | Vitest + React Testing Library | UI rendering, interactions (`InfoPanel`, `OrderFormModal`), Chart mounting (`ChartWrapper`). |
| Electron/static integration | Vitest + project checks | Protocol, runtime-boundary, build-artifact, security-guard, and deterministic composition contracts. |

## Data Strategy
- Mock mode already emits deterministic structures; add a seed toggle so tests can assert exact values.
- Use the shared factories under `src/test/mocks/` (importable via `@/test/mocks`) for DataContext snapshots and mini-chart data. The default Web Storage comes from the global harness; call `attachMockLocalStorage()` only when a suite asserts storage calls, and install it inside that suite's `beforeEach` after the harness reset.
- Keep large/static fixtures beside their retained Vitest owners so they cannot become an unowned executable suite.

## Supported Commands

- `npm test`: full Vitest suite.
- `npm run lint`: ESLint.
- `npm run build`: normal production build plus Electron artifact inspection.
- `npm run check:dependency-baseline`: local locked-version security floors, not a fresh registry vulnerability scan.
- `npm run check:circular`, `check:runtime-mock`, `check:futures-production`, and `check:command-path`: retained static architecture and safety gates.
- `npm run test:all`: aggregate of every command above.
- `npm run e:smoke`: bounded deterministic Electron readiness smoke; this is not part of `test:all`.
- `npm run dist -- --linux --dir --publish never`: fresh production build and
  local Linux directory package under `release/`, with the actual ASAR checked
  by the packaging hook. This does not launch the application or publish it.
- `npm run check:packaged-app -- /absolute/path/to/app.asar`: inspect an existing
  application archive without execution. The packaging hook also compares all
  renderer build files, including lazy-loaded chunks, with the archive.

The unit suite exercises electron-builder's real file matcher and a real
temporary ASAR fixture. These are retained file/contract checks, not a browser
runner or evidence of a live trading session. `release/` is excluded from lint
and Vitest discovery; application dependencies inside a package are not tests of
the source checkout.

Vitest owns deterministic in-memory `localStorage` and `sessionStorage` for
every test. The standard `npm test` command requires no storage-related
`NODE_OPTIONS`, storage file, or machine-global workaround. Full-suite harness
acceptance was recorded on Node.js `v24.11.0` and `v26.4.0` on 2026-08-10.

## Coverage Boundary

Browser-driven cross-process UI automation was retired on 2026-08-10. The
retained automated stack does not claim to prove real window focus, compositor
layout, or renderer-to-main interaction as one driven UI session. Those
cross-process UI checks are a known manual acceptance responsibility for the
normal, safe-development, and bounded-smoke compositions.

## Next Steps

1. Accept the first hosted `CI / Linux verification` run and record a main-compatible enforcement decision; [the CI guide](ci.md) distinguishes local preparation from remote protection.
2. Expand focused Vitest and protocol/integration coverage for trading and Electron boundaries.
