# Futures Testnet archive

Retired: 2026-07-16

Last active source revision: `f1b5d7eba661afe92406749965bb539c9ba4d3f4`

## Status

Futures Testnet (the Phase 5 read-only subsystem, Phase 6 reduce-only execution subsystem, and Phase 8 Testnet workstation) is retired and is not a supported application mode.

The archived implementation is intentionally not copied into the application tree or package. Keeping executable trading code under an `archive/` importable path would leave a second, unmaintained security boundary and would allow default test discovery to continue executing it. Git is the immutable source archive; `MANIFEST.md` records every retired path.

Active code must not import a path listed in the manifest, accept a Testnet workstation/execution protocol frame, capture Testnet credentials, create a Testnet ledger, expose a Testnet selector, or alias a Testnet composition into a build.

## Recovering a historical file

Inspect without restoring:

```sh
git show f1b5d7eba661afe92406749965bb539c9ba4d3f4:electron/services/futures-testnet-workstation-service.js
```

Recover into a separate research worktree, never into the production application by accident:

```sh
git worktree add ../trade-ui-testnet-archive f1b5d7eba661afe92406749965bb539c9ba4d3f4
```

Any future reactivation requires a new threat model, fresh exchange/API review, explicit operator authorization, current dependency review, and a separately reviewed implementation. The archived code is evidence, not a supported fallback.
