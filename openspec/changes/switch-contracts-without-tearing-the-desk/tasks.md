## 0. Reproduce Before Changing

- [x] 0.1 Reproduce the throw in a test: close a socket handle whose underlying connection is still in its handshake, and assert it no longer escapes (`futures-workstation-transport.test.js`).
- [x] 0.2 Reproduce the consequence at the service: a teardown whose stream close throws still starts the next contract and leaves no timer of the previous one running (`futures-workstation-service.test.js`).

## 1. A Socket Closes Quietly

- [x] 1.1 Make `createSocket(...).close()` survive a connection that has not finished its handshake (`futures-production-workstation-transport.js:358`) — the error `ws` raises there is the ordinary answer to closing early, not a fault.
- [x] 1.2 Keep the close otherwise unchanged: one close per socket, listeners released, the lifetime timer cleared.
- [x] 1.3 Prove by test that closing a connecting socket raises nothing and still closes it.

## 2. Teardown Is Total

- [x] 2.1 Release each part of a session independently in `stopCurrent` and `haltSession`, so one failure cannot skip the rest.
- [x] 2.2 Report a failed step through the service's internal-error path rather than raising it.
- [x] 2.3 Prove by test that a session whose abort throws still has its stream closed, its order book stopped and its timers cleared.

## 3. The Switch Completes

- [x] 3.1 Start the requested generation even when releasing the previous session reported a failure (`handleRequest`).
- [x] 3.2 Prove by test that a select-symbol request following a failing teardown still starts the new contract's session.
- [x] 3.3 Prove by test that a rapid sequence of contract selections leaves exactly one live session, and that no earlier selection's frame is delivered after the last one starts.

## 4. Timers Cannot Outlive Their Session

- [x] 4.1 Make the reconnect, interval-reconnect and freshness callbacks no-ops once their session is no longer current. No code change was needed: all three already open with `isCurrent(session)`, which is false for a released session on both counts — `this.current` no longer points at it and its abort signal is set. The guards are load-bearing, not incidental: removing them fails 4.2's test.
- [x] 4.2 Prove by test that a timer belonging to a released session performs no read and emits nothing.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data: switching between contracts repeatedly — including while a chart is still loading — leaves no flicker between contracts, no `RESYNCHRONIZING` that does not resolve, and no `WebSocket was closed before the connection was established` in the main-process log.

## 6. Stated Limits, Not Fixed Here

- [x] 6.1 The renderer already refuses frames that do not name its own `requestId` and symbol; this change does not touch that path. If two contracts still appear after the backend is corrected, that is a separate defect.
- [x] 6.2 The repeated `Peer 127.0.0.1 disconnected` / `Connection accepted` lines are expected to stop once `handleRequest` no longer rejects. If they persist, the local transport's handling of a failed request is the next thing to look at, and it is not this change.
