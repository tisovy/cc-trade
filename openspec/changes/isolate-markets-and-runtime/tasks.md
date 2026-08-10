## 1. Market Activation Gate

- [x] 1.1 Reject a market-scoped trading command, subscription or refresh that arrives before `activate_market` for that market, with a stable bounded reason and no started work.
- [x] 1.2 Reject the same commands after the operator has switched away, so a superseded market cannot keep issuing exchange work.
- [x] 1.3 Prove by test that a Futures command sent before activation and one sent after a switch to Spot are both refused and start no subscription, refresh, timer or stream.

## 2. Generation-Isolated Activation

- [x] 2.1 Carry an activation generation through market activation and stamp every market-scoped request with the generation it was issued under.
- [x] 2.2 Discard a request whose generation is no longer current instead of applying its result.
- [x] 2.3 Order lazy workspace mount so a child effect cannot issue refresh or subscribe before the parent activation has been accepted.
- [x] 2.4 Prove by test that a warm lazy switch never sends a market-scoped request ahead of its activation.

## 3. Connect Lifecycle

- [x] 3.1 Discard a Spot channel `connect` that resolves after its channel was cleaned up, so no WebSocket is revived post-cleanup.
- [x] 3.2 Apply the same discipline to any other channel whose connect can outlive its cleanup.
- [x] 3.3 Prove by test that cleanup during an in-flight connect leaves no live socket and no reconnect timer.

## 4. Runtime Registration Race

- [x] 4.1 Register the renderer runtime endpoint and token for a sender before creating the `BrowserWindow` that will request it.
- [x] 4.2 Remove the fallback `127.0.0.1:14477` endpoint and the empty-token path; an unregistered sender receives no runtime.
- [x] 4.3 Fail the renderer closed with a stated reason when no runtime is available, rather than connecting to a default endpoint.
- [x] 4.4 Prove by test that a preload request from an unregistered sender yields no runtime and no connection attempt.

## 5. Terminal Authentication Handling

- [x] 5.1 Treat an authentication failure on the renderer transport as terminal in `src/hooks/useWebSocket.js`: stop the 500 ms retry loop and surface the failure.
- [x] 5.2 Resume reconnection only on an explicit operator action or a new runtime registration.
- [x] 5.3 Keep ordinary transport losses retrying as they do today, so only authentication is terminal.
- [x] 5.4 Prove by test that a rejected token produces one surfaced failure rather than a repeating reconnect.

## 6. Verification Runtime Isolation

- [x] 6.1 Give a verification or end-to-end run its own runtime endpoint and token, distinct from a development instance.
- [x] 6.2 Refuse a connection whose token does not belong to the runtime that issued it, so a verification renderer cannot address a development backend.
- [x] 6.3 Prove by test that a renderer holding one runtime's token is refused by another runtime.

## 7. Verification

- [x] 7.1 Run unit and integration suites, the production-guard checks and the workstation boundary check.
- [ ] 7.2 Run an end-to-end verification concurrently with a development instance and record that neither reaches the other.
