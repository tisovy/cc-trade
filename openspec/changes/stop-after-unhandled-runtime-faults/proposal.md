## Why

Audit A02 found main-process uncaught exceptions and unhandled rejections are logged and then ignored, including errors guessed to be network-related. Once a failure escapes its owner, runtime integrity cannot be established from an error code or message substring.

## What Changes

- Replace log-and-continue global handlers with one idempotent terminal fault policy installed before application initialization.
- Write fixed, bounded synchronous fatal diagnostics and best-effort desk fault metadata; never serialize the thrown value, credentials or request payload.
- Exit Electron immediately with code 1, bypassing normal asynchronous quit cleanup. Keep ordinary handled request failures and normal operator shutdown unchanged.
- Do not cancel real exchange orders, replay pending mutations, or automatically relaunch. Operator recovery must verify exchange state.

## Capabilities

### New Capabilities
- `terminal-runtime-faults`: main-process integrity-loss termination policy.

### Modified Capabilities
None.

## Impact

Electron main entrypoint and a standalone testable fatal-handler owner. This is a broad runtime policy despite the graph's empty upstream entrypoint walk. Existing controller/network request handling is not reclassified; only failures that escape to global process events are terminal.
