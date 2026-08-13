## 1. Market Activation Gate

- [x] 1.1 Reject a market-scoped trading command, subscription or refresh that arrives before `activate_market` for that market, with a stable bounded reason and no started work.
- [x] 1.2 Reject the same commands after the operator has switched away, so a superseded market cannot keep issuing exchange work.
- [x] 1.3 Prove by test that a Futures command sent before activation and one sent after a switch to Spot are both refused and start no subscription, refresh, timer or stream.

## 2. Generation-Isolated Activation

- [x] 2.1 Carry an activation generation through market activation and stamp every market-scoped request with the generation it was issued under. *(Reopened 2026-08-10: the backend mints and announces a generation, but the renderer never sends one back — `src/context/GatewayContext.jsx:150` stores it and `electron/services/binance-connection.js:1364` gates on the market name alone.)*
- [x] 2.2 Discard a request whose generation is no longer current instead of applying its result. *(Reopened 2026-08-10: with no generation on the request there is nothing to compare; a stale Spot frame after Spot → Futures → Spot is accepted because the mode string matches.)*
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

## 6. Runtime Isolation

- [x] 6.1 Give each independently constructed renderer runtime its own endpoint and token.
- [x] 6.2 Refuse a connection whose token does not belong to the runtime that issued it, so one renderer cannot address another runtime.
- [x] 6.3 Prove by test that a renderer holding one runtime's token is refused by another runtime.

## 7. Verification

- [x] 7.1 Run unit and integration suites, the production-guard checks and the workstation boundary check.
- [x] 7.2 Use retained integration coverage with two independently issued runtimes and record that each rejects the other runtime's token, without browser automation.
  - 2026-08-13 retained Node integration result on Node `v24.11.0` (`1/1` passed; no Playwright/browser): the issued pairs satisfied `endpoint A != endpoint B` and `token A != token B`; token values were neither printed nor recorded.
  - Runtime A result pair: own token accepted and stayed connected; runtime B's token closed with `4401 invalid-token`; post-startup market/account transport delta was `0` calls.
  - Runtime B result pair: own token accepted and stayed connected; runtime A's token closed with `4401 invalid-token`; post-startup market/account transport delta was `0` calls.
  - Biting proof: the same retained test overlaid on `git archive 23110079cfd1a65e4dc9e6361f161ab5a4d9a95a` with a symlink to `node_modules` failed `1/1` at endpoint independence (`expected false`, received `true`), before either runtime could bind.
  - Staged-tree verification on Node `v24.11.0`: `npm run test:all` passed `109` files / `1758` tests, lint and all three build targets (`547` renderer, `297` main, `5` preload modules), plus the artifact (`2` files), circular-import (`257` files), runtime-mock (`133` modules), Futures-production (`23` files), and command-path (`115` modules, one builder) guards.

## 8. Activation Survives A Reconnect And A Fast Switch

*(Added 2026-08-10 from the delivery audit.)*

- [x] 8.1 Bind the renderer's stored activation to the connection that acknowledged it, so a reconnect starts from "no market activated" instead of carrying the previous socket's acknowledgement.
- [x] 8.2 Serialize `activate_market` handling in the main process so two activations cannot interleave and leave the backend on the market the operator left.
- [x] 8.3 Prove by test that a reconnect issues no market-scoped frame before the new activation is acknowledged, and that two rapid switches settle on the last one requested.
- [x] 8.4 Re-run the suites and guard checks after sections 2 and 8 land.
- [x] 8.5 Read the activation generation from a ref rather than closing over it, so the sender keeps one identity. *(Added 2026-08-10 from live operation: every acknowledgement rebuilt `sendMessage`, which re-ran the effect that activates the market — an endless activation loop that refused every frame issued behind it.)*
- [x] 8.6 Take the stamp back off before a channel with a closed request shape validates the frame. *(Added 2026-08-10 from live operation: the production workstation rejected every stamped request as `INVALID_REQUEST_SHAPE`/`INVALID_TAPE_CONFIGURATION`, so chart, book and tape stayed empty.)*
- [x] 8.7 Prove by test that an acknowledgement triggers no second activation, that a stamped workstation request reaches its channel, and that a superseded one is still refused.
- [x] 8.8 Stamp at the transport's own write point rather than at a caller, so the frames the channel helpers build and send themselves carry the activation too, and compare the held activation against the socket being written to. *(Added 2026-08-10 from a review of the delivery: every Spot `subscribe` and `unsubscribe` was leaving unstamped, and the held activation was cleared by an effect that runs after the children that can send under it.)*
- [x] 8.9 Prove by test that a channel helper's frame carries the activation, and that a frame written to a socket that acknowledged nothing carries none.
