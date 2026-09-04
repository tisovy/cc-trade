## Decision and basis

Use synchronous bounded diagnostics followed by `app.exit(1)`, with Node process exit as fallback if Electron exit throws. Do not attempt asynchronous trading-state repair after an unhandled fault. Node explicitly warns against resuming operation after uncaught exceptions and recommends synchronous cleanup before termination: https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly . Electron documents that app.exit exits immediately and bypasses before-quit/will-quit, unlike cancellable app.quit: https://www.electronjs.org/docs/latest/api/app#appexitexitcode . Both official contracts were checked on 2026-09-05.

All unhandled exceptions and rejections are terminal, including ECONNRESET/TLS-like values. Expected network/request failures must be handled by their existing owner; a globally unhandled error code does not prove the owner recovered. No normal request catch/retry or user-initiated shutdown behavior changes here.

## Handler ownership

The Node exit fallback also runs if Electron's immediate-exit function unexpectedly returns. Returning from a faulty exit adapter is not permission to resume runtime work.

One installation per process event emitter; repeat installation does not add duplicate listeners. The first fault latches terminal state before diagnostics. Reentrant faults during reporting cannot repeat shutdown. Synchronous stderr records and optional desk fault records use fixed phase/code/guidance only, without touching the thrown object's getters or string conversion. Reporter failure cannot prevent exit. Uninstall removes only this owner's listeners (for isolated tests), never unrelated handlers.

Register before executable main initialization. The desk diagnostic reference starts null and becomes available later; pre-startup faults still get the fixed stderr attempt and exit. The policy does not await controller.close, queue drains, store writes or user prompts. In-memory last observations and unsaved UI state may be lost. It is safer to state that explicitly than run possibly corrupt trading state to save them.

## Recovery and non-goals

No automatic relaunch, exchange cancellation or mutation replay. Already accepted exchange orders can remain active, and an in-flight mutation can have unknown outcome. After an unintended exit the operator checks Binance, restarts deliberately and lets existing startup/activation/account reads recover current evidence. Durable unresolved-command recovery across process crashes is a separate requirement, not claimed solved.

## Verification

Production before tests. Test real isolated Node child processes for uncaught exception/unhandled rejection exit and no subsequent timer work, plus ordinary locally caught network failures staying operational. Unit-test idempotence, reentrancy, hostile thrown values, failing diagnostic sinks, exit fallback and listener cleanup. Source/build checks prove main wiring; do not launch or kill the live Electron application. Full gates and graph/source audit before main commit; live acceptance remains pending.
