## Context

Only main owns configured credentials. The renderer receives private snapshots and incremental events over its authenticated local socket. A fingerprint identifies a configured key, not a verified Binance UID: two keys for the same account deliberately do not share a baseline.

## Goals / Non-Goals

Prevent cross-account history and PnL reads/writes, including socket replacement and same-tick messages. Preserve legacy data. Do not introduce account discovery requests, automatic migration, Futures persistence changes, or redesign the portfolio return calculation.

## Decisions

Main appends `spot_account_fingerprint` only to recognized Spot private envelopes. SHA-256 uses a Spot/schema domain separator and the API key, without secret material. Public and Futures messages are unchanged. Appending the property preserves legacy first-payload-key parsing.

Storage keys and envelopes validate schema version 1, market Spot, fingerprint and allowed data kind. Invalid/missing identity or malformed envelopes return defaults and cannot write. Legacy `orders_history` and `pnl_snapshots` remain untouched.

DataContext admits private frames only from the current open connection with a valid fingerprint. It synchronously switches refs and loads the new scoped history before processing a frame. New connections reset live private data even for the same key, while same-key unresolved warnings remain held. A different known key clears old command warnings. A full balances snapshot is required before exposing live balances for PnL; deltas alone are insufficient. Old-socket private frames cannot mutate current state.

InfoPanel results carry ownership and period, so effect scheduling cannot briefly display another account's result. All PnL persistence APIs explicitly receive the fingerprint. Malformed snapshots are ignored. Existing price-readiness and calendar rollover behavior is retained.

## Risks / Trade-offs

Key rotation loses automatic continuity by design, but retains the old namespace for a future explicit migration. The fingerprint is pseudonymous, not encryption or an authorization token. Local storage remains local plaintext. Shared broadcaster impact is CRITICAL; unchanged Futures/public delivery must be tested. Graph misses nested React callbacks and arrow-function calls, so exact-file graph/source review supplements named impact.

## Verification

Production before tests. Cover identity stamping, storage envelope validation, A/B isolation, legacy preservation, old socket rejection, full balance readiness, same-account reconnect and account-scoped UI. Run complete local gates and graph change analysis before commit. Live acceptance remains pending; no real orders or production restart.
