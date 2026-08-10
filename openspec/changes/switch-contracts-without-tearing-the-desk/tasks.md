## 0. Reproduce Before Changing

- [ ] 0.1 Reproduce the throw in a test: close a socket handle whose underlying connection is still in its handshake, and assert that today it escapes as an unhandled error.
- [ ] 0.2 Reproduce the consequence: a `stopCurrent` whose first abort throws leaves the stream open, the timers armed and the order book running.

## 1. A Socket Closes Quietly

- [ ] 1.1 Make `createSocket(...).close()` survive a connection that has not finished its handshake (`futures-production-workstation-transport.js:358`) — the error `ws` raises there is the ordinary answer to closing early, not a fault.
- [ ] 1.2 Keep the close otherwise unchanged: one close per socket, listeners released, the lifetime timer cleared.
- [ ] 1.3 Prove by test that closing a connecting socket raises nothing and still closes it.

## 2. Teardown Is Total

- [ ] 2.1 Release each part of a session independently in `stopCurrent` and `haltSession`, so one failure cannot skip the rest.
- [ ] 2.2 Report a failed step through the service's internal-error path rather than raising it.
- [ ] 2.3 Prove by test that a session whose abort throws still has its stream closed, its order book stopped and its timers cleared.

## 3. The Switch Completes

- [ ] 3.1 Start the requested generation even when releasing the previous session reported a failure (`handleRequest`).
- [ ] 3.2 Prove by test that a select-symbol request following a failing teardown still starts the new contract's session.
- [ ] 3.3 Prove by test that a rapid sequence of contract selections leaves exactly one live session, and that no earlier selection's frame is delivered after the last one starts.

## 4. Timers Cannot Outlive Their Session

- [ ] 4.1 Make the reconnect, interval-reconnect and freshness callbacks no-ops once their session is no longer current.
- [ ] 4.2 Prove by test that a timer belonging to a released session performs no read and emits nothing.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data: switching between contracts repeatedly — including while a chart is still loading — leaves no flicker between contracts, no `RESYNCHRONIZING` that does not resolve, and no `WebSocket was closed before the connection was established` in the main-process log.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 The renderer already refuses frames that do not name its own `requestId` and symbol; this change does not touch that path. If two contracts still appear after the backend is corrected, that is a separate defect.
- [ ] 6.2 The repeated `Peer 127.0.0.1 disconnected` / `Connection accepted` lines are expected to stop once `handleRequest` no longer rejects. If they persist, the local transport's handling of a failed request is the next thing to look at, and it is not this change.
