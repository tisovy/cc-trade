<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cc-trade** (8082 symbols, 15323 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/cc-trade/context` | Codebase overview, check index freshness |
| `gitnexus://repo/cc-trade/clusters` | All functional areas |
| `gitnexus://repo/cc-trade/processes` | All execution flows |
| `gitnexus://repo/cc-trade/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Repository Workflow — Mandatory Override

- **`master` is the only development and integration branch.** Before any task, verify that `git branch --show-current` returns `master`.
- Commit all work directly to `master`. Do not create or use feature, fix, release, session, or other development branches.
- Do not create additional Git worktrees. Work only in the primary checkout at `/home/me/work/trade_ui_latest`.
- If approved work is found outside `master`, move it into `master` before making further edits and verify that no commit is lost.
- For regression review, override the generated GitNexus example and use `detect_changes({scope: "compare", base_ref: "master"})`.

# Spec Workflow — Mandatory Override

**All work goes through OpenSpec.** No behaviour change lands without a change proposal in `openspec/changes/<change-id>/`.

- Before writing code for any feature, fix, refactor, or UX change: create `proposal.md`, `tasks.md`, and spec deltas under `specs/<capability>/spec.md` (`## ADDED|MODIFIED|REMOVED|RENAMED Requirements`, every requirement with at least one `#### Scenario:`).
- A `MODIFIED` requirement replaces the whole block — copy across every scenario the current spec still has, or `openspec validate` fails and archive drops them.
- Run `OPENSPEC_TELEMETRY=0 openspec validate <change-id>` before starting implementation and again before archiving.
- Keep `tasks.md` current as work proceeds: check items off as they land, and add tasks discovered mid-implementation rather than doing untracked work.
- Only archive (`openspec archive <change-id>`) after the operator confirms the behaviour on live data; carry unfinished items into a follow-up change instead of silently dropping them.
- Trivial exceptions (typo fixes, comment wording, dependency bumps with no behaviour change) may skip the proposal; anything a user could notice may not.

# Implementation Order — Mandatory Override

- For every implementation task, write or modify the production code first. Only after that implementation is in place may its tests be written or modified.
- Do not use a test-first or TDD sequence in this repository. Tests prove the implementation that was written first.
