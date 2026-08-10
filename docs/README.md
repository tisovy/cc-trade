# Project Documentation

This directory centralizes the living documentation for the modernized trading terminal.  
Each file focuses on a specific aspect so we can keep implementation notes, quirks, and future plans aligned with the codebase.

| Document | Scope |
| --- | --- |
| `repository_workflow.md` | Mandatory single-branch policy: work only on `master` in the primary checkout. |
| `architecture.md` | High-level system overview (runtime stack, build targets, data flow). |
| `components.md` | UI components, props/contracts, and any migration caveats. |
| `backend.md` | Electron main process, WebSocket bridge, and Binance integration workflows. |
| `fixed_issues.md` | Timestamped log of resolved issues and completed migration milestones. |
| `future_features.md` | Longer-term roadmap items once core migration is complete. |
| `known_issues.md` | Current quirks/technical debt; resolved items move to `fixed_issues.md`. |
| `tests.md` | Supported Vitest, lint, build, static-boundary, and smoke verification strategy. |

> When adding a new feature or uncovering a regression, please update the relevant doc alongside the code change. This keeps the next engineer (and future you) in sync with reality. 
