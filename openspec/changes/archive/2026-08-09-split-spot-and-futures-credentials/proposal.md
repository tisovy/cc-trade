## Why

Startup preflight accepts exactly one credential pair, `BK`/`BS`, and uses it for both Spot and USDⓈ-M Futures. That forces a single API key to carry both Spot and Futures permissions, which violates least privilege and makes a Futures-permission problem indistinguishable from a Spot one: the operator sees four identical `-2015` account alerts with no indication of which key is at fault.

The operator has now provisioned a second, Futures-only key pair under `BFK`/`BFS`. The application cannot read those names at all, so a correct configuration still starts with the wrong key and fails closed against Binance.

## What Changes

- **BREAKING**: Credential preflight SHALL evaluate two independent pairs — `BK`/`BS` for Spot and `BFK`/`BFS` for USDⓈ-M Futures — and report per-market readiness instead of a single global verdict. An operator configuring only `BK`/`BS` loses Futures, which previously worked from the same pair.
- Startup SHALL fail closed only for the markets whose credentials are absent or partial. A complete Spot pair with no Futures pair SHALL start Spot normally and disable Futures with a named reason; the reverse SHALL hold for Futures.
- The blocking configuration screen SHALL appear only when neither market is configured. When exactly one market is configured, the market selector SHALL render, the unavailable market SHALL be visibly disabled with its missing variable names, and selecting it SHALL NOT be possible.
- The Futures trading adapter, Futures user-data stream, and Futures production workstation runtime SHALL be constructed from the Futures pair only. The Spot client, Spot trading adapter, and Spot market/user-data path SHALL be constructed from the Spot pair only. Neither pair SHALL be substituted for the other.
- A persisted market workspace whose credentials are missing SHALL resolve to the neutral selector rather than mounting a workspace that cannot connect.
- Sliding configuration alerts SHALL name the market and its missing variable names, and SHALL NOT expose credential values.
- Operator documentation SHALL describe both pairs, per-market failure behavior, and the migration from a single shared pair.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: Credential preflight becomes per-market with independent Spot and Futures pairs, and fail-closed behavior becomes market-scoped rather than global.
- `futures-workstation-presentation`: Workspace selection and startup gating account for a market being unavailable through missing credentials.

## Impact

- Credential contract: `electron/services/binance-credential-preflight.js` and its test — result shape gains a per-market section; `BINANCE_SUPPORTED_CREDENTIAL_FIELDS` grows from two names to four.
- Electron integration: `electron/services/binance-connection.js` — separate gates for Spot client/adapter construction, Futures adapter construction, Futures user-data stream, Futures production workstation runtime, `activate_market` handling, and the startup envelope.
- Renderer startup: `src/context/GatewayContext.jsx` normalizes and exposes per-market status; `src/App.jsx` gates the blocking screen, the selector, and the market switch.
- Safe-launch environment scrubbing: `electron/env-setup.js` must clear the Futures pair as well, or verification builds inherit real Futures credentials.
- Operator documentation: `docs/futures_trading.md`.
- No new runtime dependency. No change to signing, proxy handling, request weights, or order semantics.
- Risk: the Spot path and the Futures path stop sharing a construction gate. Every place that previously read `credentialPreflight.ready` must be re-pointed at the correct market, or a market silently initializes without credentials.
