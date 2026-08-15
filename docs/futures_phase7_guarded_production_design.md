# ADR: Phase 7 Guarded Production Futures Rollout

> **RETIRED 2026-07-21.** This design was removed in favor of the
> spot-parity futures path — see `docs/futures_trading.md`. Kept for history only.

Date: 2026-07-13

Status: accepted; fake-backed implementation completed 2026-07-13 and live production composition explicitly authorized 2026-07-14

Historical adjacency note: references to Phase 5/6 or Testnet describe the
architecture at acceptance time. Those runtimes were retired on 2026-07-16;
the Production subsystem remains active and separately composed.

Base: `36681f07f447e5bfb0d3b4ce30642326b55a89df` (`Complete Futures testnet execution Phase 6`)

## Decision

Phase 7 is a new production-only subsystem. It does not add an environment enum, host branch, credential branch, protocol alias, storage namespace, or recovery path to Phase 5 or Phase 6.

The implementation uses separately named production configuration, credentials, account identity, coordinator, transport, protocol/actions, service, storage/locks, audit records, recovery, renderer hook, and UI. The only reviewed network origins are the compiled USDⓈ-M REST and private-stream constants. No renderer or request caller can provide a host, URL, method, path, headers, agent, dispatcher, proxy, redirect policy, timeout, retry count, timestamp, signature, or raw request options. Normal composition may resolve the process-owned `https_proxy` / `http_proxy` setting once into a bounded backend agent shared by signed REST and the private stream; invalid proxy configuration fails closed and never falls back to direct I/O.

The initial delivery intentionally retained a non-environment live-authorization interlock set to false. On 2026-07-14 the operator explicitly authorized a separately reviewed live activation commit. Normal composition now sets that non-environment interlock to true, while configuration remains exact, disabled by default, and independently gated. Live composition accepts the process-global Node `fetch` only as the authority from which it constructs the branded backend transport; a caller-supplied transport is rejected. Deterministic tests retain the explicit fake-only authorization seam, and E2E remains force-disabled with a production-network escape guard.

## Boundary inventory

At ADR acceptance, the adjacent boundaries were:

- Phase 5 remains `futures-readonly`, with only its fixed mock/testnet read facade and renderer panel.
- Phase 6 remains `futures-execution`, testnet credentials, `cc6-` identities, demo host, testnet ledger, testnet recovery, and the reduce-only ticket.
- Generic typed trading commands continue to accept Spot only. Every legacy futures command remains rejected.
- The existing CRITICAL Spot `RateLimiter` implementation is unchanged.
- Production does not import a Phase 5/6 service, facade, protocol, ledger, risk reader, composition, renderer hook, or component.

As of 2026-07-16, Phase 5/6 and Futures Testnet are retired rather than frozen
runtime neighbors. Their paths are recoverable only through the archive
manifest. The active invariant is stronger: Production imports none of those
retired paths, and legacy Testnet/read frames fail closed before generic
renderer routing.

Production owns these independently named modules:

- `futures-production-execution-config`
- `futures-production-execution-decimal`
- `futures-production-execution-json`
- `futures-production-execution-protocol`
- `futures-production-execution-coordinator`
- `futures-production-execution-facade`
- `futures-production-execution-ledger`
- `futures-production-execution-risk`
- `futures-production-execution-service`
- `futures-production-execution-composition`
- `futures-production-execution-sanitizer`
- renderer `futuresProductionExecutionProtocol`, `useFuturesProductionExecution`, and `FuturesProductionExecutionTicket`

## Production activation gates

Normal composition exposes no live write capability unless every backend-owned fact is true:

1. The exact operator flag is ASCII `true`; there is no trimming, case folding, numeric/boolean coercion, alias, or default enablement.
2. The exact operator acknowledgement is `I_UNDERSTAND_REAL_USDT_FUTURES`.
3. The compiled live-authorization interlock is separately approved and true only in normal production composition. It is not an environment option, mode enum, renderer value, or E2E capability.
4. Production API key, API secret, and backend-only recovery authorization are bounded visible ASCII, captured and deleted before the first `BrowserWindow`.
5. The configured SHA-256 API-key fingerprint matches the captured key.
6. A signed fixed-production-origin read returns exactly the configured account alias, fingerprint binding, `canTrade: true`, Hedge Mode, and single-asset mode.
7. All required limits parse exactly: account maximum leverage, maximum order notional, maximum daily notional, minimum available balance, and minimum liquidation distance. The retired launcher symbol list is ignored and has no authorization meaning.
8. The gradual-live ceilings are compiled at exactly 2x maximum leverage, 10000 USDT maximum order notional, and 100000 USDT gross maximum daily notional (raised from 10/50 USDT by the reviewed 2026-07-21 operator change so exchange minimum-notional filters cannot make every major contract untradeable). Leverage must equal 2x; the operator-configured notional caps are the authoritative limits, may be lower but never higher than the ceilings, and the ceilings are not environment-overridable.
9. The exact persistent kill-switch policy is `v1-persistent-block-new-exposure`; missing or unknown policy fails closed.
10. The production storage directory, integrity key, anchor, HMAC chain, exclusive lease, audit replay, exact counters, clock state, and recovery state validate fully.
11. The current credential binding matches every durable nonterminal record. Rotation never opens a fresh bypass namespace.
12. No unresolved unknown, confirmed-open owned order, in-flight safety action, rate pause, counter failure, audit capacity failure, or corrupt state exists.
13. A fresh same-generation preflight validates exact account, symbol, position, mark, balance, order inventories, filters, leverage, margin, and limits.
14. The command owns the current one-use backend intent and its exact revision.

Every gate decision, including disabled decisions, is recorded in the bounded redacted audit before capability is reported. Storage/audit failure prevents a positive capability decision.

## Exact production order subset

The only ordinary production order is regular USDⓈ-M `LIMIT/GTC` with exact Hedge `positionSide: LONG|SHORT`, isolated margin, auto-add margin disabled, and observed 2x leverage. Entry and exit side semantics are bound into the one-use intent; Hedge exits do not send an invalid `reduceOnly`. Leverage, margin type, position mode, and auto-add margin are assertions and are never changed.

The order draft is supplied only to `futures.production.prepareOrderIntent`. It contains exact side, `positionSide`, entry/exit effect, quantity, price, `LIMIT`, and `GTC`. The backend validates and binds the complete canonical draft into a 30-second one-use intent. The final `futures.production.placeOrder` request carries only the intent identity, revision, fixed production/account identity, and exact confirmation challenge; financial fields cannot change after preparation.

Exposure classification is backend-owned:

- an `ENTRY` on an empty LONG/SHORT leg is opening exposure;
- an `ENTRY` on the same non-zero Hedge leg is increasing exposure;
- an `EXIT` with the exact closing side and quantity no greater than that Hedge leg is reducing exposure;
- a wrong-side action, missing leg, over-reduction, one-way position mode, or ambiguous classification is rejected.

The persistent kill switch blocks only opening/increasing exposure. It does not claim to cancel an order, close a position, terminate recovery, or reinterpret renderer teardown. Reductions remain separately gated by a fresh position snapshot, exact Hedge side/leg binding, quantity and exchange filters; `reduceOnly` is intentionally omitted because Binance Hedge Mode rejects that parameter combination.

The conservative notional is `quantity * max(limit price, fresh mark price)` using native `BigInt` fixed point. Exact filters, configured order cap, configured daily cap, symbol maximum, account maximum leverage, balance buffer, and liquidation distance apply. JavaScript floating point is prohibited.

## Durable daily notional

The configured maximum daily notional is a literal gross dispatch ceiling for exposure-increasing production order POSTs. A backend-verified reducing order reserves zero additional daily exposure, while still consuming the order-rate slot and retaining its durable dispatch record. Increasing reservations are never released after a rejection, timeout, ambiguous result, or cancellation. This conservatively prevents a crash or uncertain write from restoring capacity.

The backend derives a canonical UTC day from a bounded fresh production server-time sample. Under the global production mutex it:

1. replays all durable reservations for the UTC day;
2. adds the exact proposed notional with fixed-point arithmetic;
3. rejects when the sum is greater than the cap; equality passes;
4. appends and fsyncs `daily_notional_reserved` with the dispatch intent before the single POST;
5. advances to a new day only at exact UTC midnight;
6. fails closed on clock regression, future reservations, malformed day keys, or missing history.

A close-all operation can still be partial when filters, rate admission, preflight, dispatch, or reconciliation fail. The UI must say which positions are confirmed, rejected, or unknown; it must never claim that the account is flat.

## Separate safety actions

The protocol has separate two-step actions and one-use intent kinds:

- `prepareCancelAllOpenOrdersIntent` / `cancelAllOpenOrders`
- `prepareClosePositionsIntent` / `closePositions`
- `prepareEngageKillSwitchIntent` / `engageKillSwitch`
- `prepareDisengageKillSwitchIntent` / `disengageKillSwitch`

Cancel-all first reads the authoritative account-wide regular and algo open-order inventories and derives a finite unique symbol set from the orders that actually exist. It invokes the reviewed regular `DELETE /fapi/v1/allOpenOrders` and algo `DELETE /fapi/v1/algoOpenOrders` endpoints only for those symbols, then repeats the global inventories. An HTTP acknowledgement is not success; only a globally empty regular and algo inventory confirms completion. Mixed or newly appearing results remain partial or unknown.

Close-positions reads the authoritative account-wide position inventory, selects exact non-zero LONG/SHORT Hedge legs, and issues one position-side-bound `MARKET` exit child per leg. Every child has a deterministic production client ID, its own durable dispatch intent and daily reservation, zero POST retries, Query Order reconciliation, and a per-position result. A final global position inventory must be flat; no child success is inferred from another child. Hedge or identity ambiguity blocks the affected item.

Engaging the kill switch fsyncs its state before acknowledgement. It sends no exchange request and does not invoke cancel-all or close-positions. The reviewed gradual-live amendment also permits a dedicated renderer request to disengage it only after a backend-issued one-use intent, exact current revision, owning connection, process-global mutex, exact phrase `ARM LIVE FUTURES HEDGE ISOLATED 2X WITHIN CONFIGURED CAPS`, healthy recovery/storage, no blocking durable operation, and every activation gate. The backend fsyncs the production-only transition before returning `kill_switch_disengaged`; no exchange request, cancellation, or closure is inferred. The separately authorized backend recovery action remains available for operational recovery but is not the routine UI path.

## Ambiguous outcomes and recovery

Each order POST is invoked at most once after its fsynced dispatch intent. Timeout, connection loss, malformed/truncated success, `408`, unknown `503`, any unclassified `5xx`, body/header/message overflow, response-schema drift, or loss of durable post-intent state becomes unknown. The POST is never retried.

Query Order uses only exact symbol and original client order ID. Fast reconciliation is immediate, 1, 2, 5, 10, and 30 seconds. Fast exhaustion retains an unknown record and a five-minute backend recovery cadence through the documented 90-day query horizon. `-2013` never proves rejection. Confirmed `NEW` and `PARTIALLY_FILLED` orders remain backend-owned and are monitored every 60 seconds through terminal status. Renderer disconnect, unmount, mode switch, app teardown, soft disable, and kill-switch engagement are not cancellation.

Startup replays queued-only records as durable local interruptions. Any record with dispatch intent and no proven durable result becomes unknown and Query Order-only recovery. A credential-binding mismatch remains globally blocking; recovery never queries another account. Operational recovery may query, repair an interrupted durable append, engage/disengage the kill switch with authorization, or acknowledge a verified storage migration. It may never resend an order, fabricate a terminal state, choose a host, cancel implicitly, or erase an unknown.

## Transport contract

The reviewed production origin is `https://fapi.binance.com`. Reviewed endpoints are:

- `GET /fapi/v1/time`
- `GET /fapi/v1/exchangeInfo`
- `GET /fapi/v1/premiumIndex`
- `GET /fapi/v1/accountConfig`
- `GET /fapi/v1/symbolConfig`
- `GET /fapi/v3/balance`
- `GET /fapi/v3/positionRisk`
- `GET /fapi/v1/openOrders`
- `GET /fapi/v1/openAlgoOrders`
- `POST /fapi/v1/order`
- `GET /fapi/v1/order`
- `DELETE /fapi/v1/allOpenOrders`
- `DELETE /fapi/v1/algoOpenOrders`

Every request independently asserts HTTPS origin and exact path immediately before I/O, uses `redirect: "error"`, allows no URL credentials or caller network options, has a 10-second whole-operation deadline, bounded headers/body/JSON nodes/depth/strings/messages, and uses duplicate-aware lossless parsing for int64 order identities. Signed parameters use fixed order, `recvWindow=5000`, a fresh safe timestamp, HMAC-SHA256, and `X-MBX-APIKEY`. Secrets, signatures, signed URLs/bodies, headers, and raw responses are never logged or stored.

Production GETs use a new production-origin quota bucket wrapped around the existing Spot-priority coordinator. Spot calls still reach the unchanged limiter and increment both priority views. Testnet and production have separate IP buckets and order counters. Before every production network attempt, the backend fsyncs a `rate_counter` reservation containing only the reviewed endpoint identity, exact request weight, and bounded correlation data. The exact sliding 60-second window replays on restart; abort, Spot preemption, transport failure, and crash never refund capacity. The existing volatile production limiter remains an additional guard, while the durable bucket is authoritative across restart. All production GET attempts use retry count zero; scheduled reconciliation alone decides later reads. Production writes never use the retrying Spot wrapper.

## Durable audit and storage

Packaged production storage is `userData/futures-production-execution/v1`; development uses `futures-production-execution-development/v1`; E2E opens no production store. No path can select the Phase 6 namespace.

The store is owner-only, no-follow, regular-file, exclusive-lease, HMAC-chained, sequence-checked, rollback-anchored, length-framed, file-and-directory-fsynced, and bounded. Unknown versions, bad ownership/mode/link count, corruption, rollback, replacement, torn non-tail data, lock loss, capacity exhaustion, or secure-storage failure close production execution.

Every audit record is a fixed-schema redacted event of at most 16 KiB. The journal is capped at 100,000 records and 64 MiB and fails closed at either bound. Records cover:

- received command digest and safe identity;
- every activation and dispatch gate decision;
- one-use intent issuance/consumption/expiry;
- queue, daily reservation, dispatch, response classification, acknowledgement, and terminal transition;
- each exchange request intent and redacted normalized response/error digest;
- each reconciliation/monitor result;
- kill-switch transition;
- cancel-all and close-position parent/child outcome;
- credential mismatch, restart recovery, and every operator recovery action.

The store never contains API keys/secrets, recovery authorization, signatures, signed URL/body, authentication headers, raw responses, caller objects, stack traces, network configuration, or unbounded exchange messages. Sanitization occurs before audit, logs, crash handlers, analytics, telemetry, and test snapshots.

## Renderer contract

The renderer uses channel `futures-production-execution` and exact `futures.production.*` actions. It is independent of retired Phase 5/6 code, Spot commands, generic action validation, browser storage, analytics, telemetry, clipboard, crash reporting, and global shortcuts. The application-level selector has only neutral `Spot` and red `Futures`; it never parameterizes a backend service, host, credentials, protocol, storage, or transport. Futures mounts the production workstation, while Spot affordances remain outside that branch.

The compact surface is unmistakably labeled `FUTURES · USDⓈ-M`. It displays backend-owned readiness, account/caps, kill-switch state, action capabilities, active intent, result, reconciliation, recovery, positions, and orders without adding manual entry/exit buttons. Orders and amendments start only from the reviewed gestures; ARM LIVE, cancel-all, close-positions, margin adjustment, and kill-switch actions remain separate controls in the compact safety/portfolio surfaces. When the switch is engaged, the backend rejects opening/increasing drafts while a fresh, exact Hedge-leg exit can still follow its separately validated reducing path.

Every action requires a backend-issued one-use intent, a current revision, a synchronous hook lock, and a component-level ref guard. Gesture orders and drag amendments automatically finalize only the immutable draft returned by that intent; they do not use a typed confirmation. ARM LIVE and the explicit safety actions retain their action-specific confirmation where the UI requests it. There is no form submit and Enter is always prevented. A stale/equal revision never unlocks submission. Partial or unknown outcomes are never styled or worded as success.

## Live authorization and rollout

Automated development, tests, and verification continue to use deterministic backend fakes only. E2E scrubs production configuration, force-disables the service, and rejects any attempted production socket. No live account read, order, cancellation, or close request is part of automated verification.

The operator supplied the required explicit live authorization on 2026-07-14 and then approved gradual UI arming under the compiled ceilings (2x leverage; order/daily notional ceilings raised to 10000/100000 USDT by the reviewed 2026-07-21 change, with the operator-configured caps as the authoritative limits). Normal composition permits the exact process-global production transport only after every configuration, account, storage, recovery, quota, and policy gate passes. Production remains disabled when any required environment value is absent or invalid. Startup begins with the durable kill switch engaged unless the intact production journal proves a prior reviewed disengagement. Routine disengagement uses only the dedicated two-step ARM LIVE action above. Reconciliation remains backend-only; backend kill-switch actions remain protected by captured recovery authorization. Startup arguments are scrubbed before `BrowserWindow` creation.

The operational credential ceremony, manual account/fingerprint/cap inspection, and any real request remain operator actions, not automated delivery steps. See `docs/futures_phase7_live_operator_runbook.md`.

## Official contract review

Reviewed on 2026-07-13 and rechecked on 2026-07-14 using public Binance documentation only. The product General Info identifies the production REST base as `https://fapi.binance.com`, requires signed HMAC requests and warns that timeout/unknown responses may have executed. Current catalog entries identify New Order as `POST /fapi/v1/order`, Query Order as `GET /fapi/v1/order`, regular cancel-all as `DELETE /fapi/v1/allOpenOrders`, algo cancel-all as `DELETE /fapi/v1/algoOpenOrders`, V3 balance as `GET /fapi/v3/balance`, account configuration as `GET /fapi/v1/accountConfig`, symbol configuration as `GET /fapi/v1/symbolConfig`, and V3 position risk as `GET /fapi/v3/positionRisk`.

Primary references:

- [USDⓈ-M General Info](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info)
- [USDⓈ-M Trade REST catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade)
- [USDⓈ-M Account REST catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account)
