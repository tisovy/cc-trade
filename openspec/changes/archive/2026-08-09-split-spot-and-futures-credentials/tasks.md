## 1. Per-Market Credential Preflight

- [x] 1.1 Extend `binance-credential-preflight.js` to evaluate `BK`/`BS` and `BFK`/`BFS` independently, returning version `2` with a `markets.spot` / `markets.futures` section, per-market codes and missing fields, and an aggregate that is ready when at least one market is configured.
- [x] 1.2 Keep the startup envelope bounded and free of credential values, carrying the per-market section and stable field-name lists.
- [x] 1.3 Extend preflight tests for both pairs complete, Spot-only, Futures-only, each partial pair, neither pair, retired-only names, and non-exposure of every credential value.

## 2. Market-Scoped Construction in Electron

- [x] 2.1 Gate the Spot REST client and Spot trading adapter on Spot readiness, and construct the Futures trading adapter from `BFK`/`BFS` gated on Futures readiness.
- [x] 2.2 Gate the Futures user-data stream and the Futures production workstation runtime on Futures readiness, and resolve the shared proxy agent when either market is configured.
- [x] 2.3 Reject `activate_market` for a market without credentials, and reject workstation and trading commands for that market with a named, value-free reason.
- [x] 2.4 Verify no construction site still reads the aggregate readiness flag.
- [x] 2.5 Clear `BFK`/`BFS` alongside `BK`/`BS` in `electron/env-setup.js` so safe-dev, smoke, and e2e launches inherit no production Futures capability.
- [x] 2.6 Extend connection tests: Spot-only environment constructs no Futures adapter and no Futures stream; Futures-only environment constructs no Spot client; each rejects only its own market's commands.

## 3. Renderer Startup and Workspace Gating

- [x] 3.1 Normalize the per-market startup section in `GatewayContext.jsx`, degrading safely when an envelope omits it, and include the market name in configuration-alert fingerprints.
- [x] 3.2 Show the blocking configuration screen only when neither market is configured, and name both variable pairs and the diagnostic code without exposing values.
- [x] 3.3 Render the selector and market switch when exactly one market is configured, disable the unavailable market with its missing variable names as the accessible reason, and prevent its selection.
- [x] 3.4 Resolve a persisted-but-unavailable market to the neutral selector without discarding the persisted value.
- [x] 3.5 Extend startup/App tests for neither market, Spot-only, Futures-only, both markets, persisted-unavailable market, and absence of a transient mount for an unavailable market.

## 4. Verify and Document

- [x] 4.1 Update `docs/futures_trading.md` for both pairs, per-market failure behavior, migration from the shared pair, and the unchanged proxy/IP-restriction requirement.
- [x] 4.2 Run the full test suite, ESLint, production build, runtime-MOCK check, futures boundary check, and circular-import check.
- [x] 4.3 Confirm no credential value appears in the diff, in renderer payloads, or in logs.
