## Context

`evaluateBinanceCredentialPreflight(process.env)` returns one verdict built from `BK`/`BS`. `setupBinanceConnection` derives a single boolean, `credentialPreflight.ready`, and uses it as the construction gate for everything: the Spot REST client, the Spot trading adapter, the Futures trading adapter, the shared proxy agent, the Futures production workstation runtime, the Futures user-data stream, and the renderer command path. The renderer mirrors this with one `startupStatus.ready` boolean that either shows a blocking screen or the whole application.

The operator now holds two key pairs with disjoint permissions. A single boolean cannot express "Spot works, Futures does not".

## Goals / Non-Goals

**Goals**

- Two independent credential pairs with independent readiness.
- Market-scoped fail-closed behavior: an unconfigured market initializes nothing and says why.
- No credential value ever reaches the renderer, a log line, or an alert.

**Non-Goals**

- Runtime credential entry or hot reload. Configuration is still read once at startup; changing it still requires a restart.
- Any change to signing, `recvWindow`, server-time sync, proxy selection, request weights, or order semantics.
- Backwards compatibility with `BK`/`BS` as a Futures fallback. A shared-pair fallback would silently re-enable the failure this change exists to remove: the operator would believe Futures runs on the Futures key while it actually runs on the Spot key.

## Decisions

### Per-market preflight result

`evaluateBinanceCredentialPreflight` returns version `2`:

```
{
  version: 2,
  state, code, ready,        // aggregate: ready when at least one market is configured
  requiredFields,            // ['BK','BS','BFK','BFS']
  missingFields,             // union across both markets
  retiredFields, message, retryable,
  markets: {
    spot:    { market, ready, code, requiredFields, missingFields, message },
    futures: { market, ready, code, requiredFields, missingFields, message },
  },
}
```

The aggregate `ready` is `spot.ready || futures.ready`. It answers exactly one question — "may the application show a workspace at all?" — and nothing else. Every construction gate reads a market section, never the aggregate.

*Alternative rejected*: aggregate `ready = spot.ready && futures.ready`. That keeps one gate but reintroduces the all-or-nothing failure: a missing Futures key would block Spot, which is a regression against the current behavior for Spot-only operators.

### Construction gates

| Constructed thing | Gate |
|---|---|
| Spot REST client, Spot trading adapter, Spot market/user-data streams | `markets.spot.ready` |
| Futures trading adapter, Futures user-data stream | `markets.futures.ready` |
| Futures production workstation runtime | `markets.futures.ready` |
| Shared proxy agent | `spot.ready \|\| futures.ready` |

The workstation serves public market data and technically needs no key. It is gated on the Futures pair anyway so that "Futures is unavailable" means one thing everywhere — a chart that loads behind a market the operator cannot trade is a worse signal than a market that is uniformly off.

### Renderer contract

The startup envelope carries the same `markets` section. `GatewayContext` normalizes it defensively — an envelope without `markets` degrades to both markets taking the aggregate value, so a stale main process cannot leave the renderer with `undefined` gates.

`App.jsx` decides:

- neither market ready → blocking configuration screen;
- exactly one ready → selector and switch render, the unavailable market is `disabled` with its missing variable names as the accessible reason;
- persisted mode points at an unavailable market → neutral selector, and the persisted value is left untouched so the operator recovers it by fixing the environment rather than by re-selecting.

### Alert fingerprints

The existing fingerprint is `code + missingFields + retiredFields`. It gains the market name so a Spot configuration error and a Futures configuration error cannot suppress each other.

## Risks / Trade-offs

- **Missed gate** — the largest risk. `credentialPreflight.ready` appears at many call sites in `binance-connection.js`; any one left on the aggregate lets an unconfigured market construct clients. Mitigation: after the edit, no construction site may reference the aggregate — verified by reading every remaining occurrence, plus a test asserting that a Spot-only environment constructs no `FuturesTradingAdapter` and a Futures-only environment constructs no `Spot` client.
- **Operator migration** — an operator who upgrades without setting `BFK`/`BFS` loses Futures with no code error. Mitigated by a named per-market alert and documentation, not by a fallback.
- **`env-setup.js`** clears `BK`/`BS` for safe/verification launches. If it does not also clear `BFK`/`BFS`, a verification build inherits live Futures credentials — a real leak of production trading capability into a mode designed to have none.
