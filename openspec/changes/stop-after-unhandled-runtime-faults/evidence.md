# A02 evidence — 2026-09-05

## Implemented policy

Main installs one global fault owner before executable application initialization. An uncaught exception or unhandled rejection latches terminal state, sets status 1, attempts fixed synchronous stderr diagnostics and a best-effort desk fault record, then calls Electron's immediate exit. Node exit is the fallback if that call throws or returns. No controller.close/async quit wait, relaunch or trading mutation is invoked by this policy.

Network-looking globally unhandled errors are also terminal; locally handled failures retain their previous behavior. The thrown value is not read or converted to text. Diagnostics contain only fixed phase/code and guidance that exchange orders may remain active. The desk's asynchronous record is best effort and may not flush before exit; fixed stderr is attempted synchronously. No durable crash journal or cross-restart unresolved-command recovery is claimed.

Basis checked against official [Node uncaught-exception guidance](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly) and [Electron app.exit](https://www.electronjs.org/docs/latest/api/app#appexitexitcode). Main-process exceptions are not a safe point for asynchronous trading-state repair. Normal operator before-quit cleanup remains unchanged.

## Verification

Production preceded tests. **19 tests** passed: two global event types, strict rejection origin, network codes, hostile rejection getters, failing reporters, exit fallback, reentrancy/idempotence/listener ownership and main wiring. Six cases spawn real isolated Node child processes with no inherited account credentials; four unhandled variants exit 1 before the next scheduled work, broken reporters/exit adapter still terminate, and a locally caught network refusal remains operational. No live Electron process is spawned or killed.

The first child-process fixture used Vite's HTTP-rewritten import.meta.url and failed before loading the handler. It was corrected to an explicit repo file URL; all isolated tests then passed. This was a test-fixture failure, not evidence of a production fault.

Final `npm run test:all`: **146 files / 3459 tests passed**, lint, renderer/main/preload build, dependency baseline and all architecture gates. Gates: 321 cycle-free source files, 163 MOCK-free runtime modules, 24 Futures implementation files, 130 command-path modules. Strict OpenSpec validation and whitespace checks passed.

The final series was packaged to a new `release/audit-remediation-2026-09-05/linux-unpacked` directory using Electron 43.6.0 / electron-builder 26.15.3. afterPack inspected the actual ASAR: **2062 files / 10 renderer build files**, contract passed. Package was not launched; no installer/other-OS acceptance is claimed. `resources/app.asar` SHA-256: `deaf4e47c8b1b803ed90afd1dc9da84bfe7eb8966da1ca1b5463eaab0d2b7a10`. After the packager rebuilt native dependencies, another full test run passed all 3459 cases.

Ephemeral logs: `/tmp/fatal-runtime-verified.log`, `/tmp/audit-final-package.log`, `/tmp/audit-post-package-tests.log`. The known test-DOM transition `TimeoutNaNWarning` remains non-failing; its origin is recorded with A03, not suppressed.

## Graph/source audit

Initial main entrypoint impact reported LOW/empty. Its broad runtime policy was disclosed explicitly; an entrypoint with no callers is not harmless. Exact main CALLS/IMPORTS and the original before-quit/controller-close paths were inspected.

Refreshed index: 12951 nodes / 20585 edges. MCP all and compare/main: eight changed files / 43 nodes / one process, medium, no partial/truncated flags. Exact production/test counts main 5 / helper 7 / tests 5 are below the internal 20-node/file cap. Graph ties unrelated Spot socket `terminate` to the helper by common name; source confirms no such call and no Spot lifecycle edit. Event callback invocation is checked through actual child-process tests, not inferred from graph coverage.

## Acceptance and handoff

Live acceptance remains pending, no archive. Do not deliberately crash a live trading process. In-flight outcomes may be unknown after a crash; exchange orders are not cancelled. The operator should verify Binance before resubmitting and deliberately restart/reconcile. Unsaved UI/in-memory observations can be lost on immediate exit. See [consolidated remediation status](../../audit-remediation-status.md) for decisions and remaining architecture/security work.
