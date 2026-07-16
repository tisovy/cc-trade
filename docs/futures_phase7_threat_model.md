# Phase 7 Guarded Production Futures Threat Model

Date: 2026-07-13

Scope: the separately named USDⓈ-M production execution subsystem described by the Phase 7 ADR. Phase 5 and Phase 6 are frozen adjacent trust domains, not production dependencies.

Update (2026-07-16): Phase 5/6 and Futures Testnet were retired. References to
them below are historical threat-boundary evidence, not an active workflow.

## Assets

- production USDⓈ-M account funds and positions;
- production API key, API secret, and backend-only recovery authorization;
- exact account alias, key fingerprint, and credential binding;
- operator-configured allowlist and leverage/notional/liquidation/balance caps;
- one-use intent identities, command digests, client order IDs, and exchange order IDs;
- durable daily-notional reservations, rate pauses, kill-switch state, dispatch states, reconciliation ownership, and audit history;
- integrity key, rollback anchor, journal lease, and storage namespace;
- renderer/backend session identity and revision ordering;
- Spot priority and the fail-closed boundary around retired Phase 5/6 protocols.

## Trust boundaries

1. Environment and deployment input are hostile until captured, parsed exactly, frozen, scrubbed, and deleted before `BrowserWindow` creation.
2. Renderer input is hostile. The renderer has no credential, filesystem, process, generic IPC, host, transport, or operational-recovery authority. It may request the separately named ARM LIVE intent, but only the backend can grant, durably apply, or reject that transition.
3. The local WebSocket is loopback/session-token protected but its frames are still hostile. Production parsing receives the original bounded UTF-8 frame before generic JSON conversion.
4. `FuturesProductionExecutionService` is the authorization boundary for gates, intent ownership, exact risk, mutex/idempotency, state, daily caps, audit, and recovery.
5. `FuturesProductionExecutionFacade` is the sole network capability and owns exact origin, endpoint, signing, resource limits, deadlines, redirect rejection, and zero write retry.
6. Binance production is an untrusted asynchronous system. HTTP success is not sufficient; every body and identity is validated. A lost response may hide a successful write.
7. The local production store is integrity-sensitive. It is not trusted until ownership, mode, link count, lease, framing, sequence, HMAC chain, and sealed anchor all validate.
8. Logs, analytics, telemetry, clipboard, crash handlers, browser storage, and test snapshots are disclosure sinks and receive only sanitized fixed-schema values.

## Threats and controls

### Accidental or malicious activation

Threats:

- missing values, `TRUE`, whitespace, inherited shell aliases, unknown production-prefixed values, or testnet configuration enables production;
- renderer state, a query string, localStorage, preload data, or a generic command enables production;
- a complete environment configuration performs a live request before the operator understands startup behavior.

Controls:

- exact ASCII flag and acknowledgement, complete hard-limit grammar, unknown-key rejection, independent credential/account identity checks, healthy storage/recovery, and active kill-switch policy;
- separately named production capture before the first window; E2E force-disable and scrubbing;
- the non-environment compiled live-authorization interlock was enabled only after explicit operator authorization and is still combined with every exact environment/account/storage/recovery gate;
- live composition accepts only the process-global Node `fetch`; a supplied transport, fake authority forgery, or E2E environment cannot resolve live I/O;
- deterministic tests inject fakes through a test-only composition seam;
- every gate combination is exhaustively tested and audited.

Residual risk: a fully valid live configuration performs signed production identity/recovery reads during application startup, before a renderer workspace is selected. Operators who require a Spot verification checkpoint must omit all production configuration for the first launch, stop the application completely, and restart with the reviewed production configuration only after Spot verification. Futures Testnet is not an available checkpoint. Writes still require a renderer subscription, backend intent, exact confirmation, current revision, and all dispatch gates.

### Wrong account or environment

Threats:

- a testnet key, another production account, rotated key, subaccount, or stale credential binding is used;
- a caller supplies an alternate Binance or attacker host;
- renderer displays one account while backend writes another.

Controls:

- compiled `https://fapi.binance.com` only, exact path assertion before I/O, redirects rejected, no caller URL/network options;
- configured full SHA-256 API-key fingerprint plus exact signed V3 balance account alias;
- opaque credential binding persisted with every nonterminal record;
- status account identity comes only from the verified backend snapshot;
- rotation mismatch blocks dispatch and reconciliation until the original credentials return or backend-only recovery authorizes a reviewed transition.

Residual risk: Binance's account alias is exchange-defined and not a legal identity. The combined operator-configured alias, full key fingerprint, fixed origin, credential binding, and signed reads are the available technical identity; the later credential ceremony must verify ownership externally.

### Renderer compromise and command forgery

Threats:

- script injection, malicious extension, renderer bug, replay, duplicate JSON key, accessor/prototype trick, oversized frame, stale revision, double click, or Enter shortcut submits a write;
- production actions fall through generic typed or legacy Spot paths;
- mutable order fields change after approval.

Controls:

- existing sandbox/context isolation/CSP/navigation/window guards remain prerequisites;
- independent `futures-production-execution` channel and `futures.production.*` raw-frame parser;
- 4096-byte production command cap inside the 16-KiB outer frame cap, duplicate-aware scalar schemas, exact own data properties, fixed actions, no aliases or extras;
- one-use 128-bit backend IDs bound to connection, generation, account, action kind, exact draft digest, revision, and 30-second expiry;
- final placement carries the bound intent rather than mutable financial values;
- synchronous hook lock, component ref guard, no form submit, Enter suppression, backend global mutex, durable replay tombstones;
- no registration in Spot/typed/legacy action enums.

Residual risk: a compromised renderer can request legitimate intents and present confirmation UI dishonestly. Backend gates and hard limits bound the damage, but renderer compromise is not equivalent to trusted operator intent. CSP and signed distribution remain important operational controls.

### Limit bypass and arithmetic error

Threats:

- binary floating point, exponent notation, scale mismatch, int64 truncation, tick/step error, stale mark, clock rollover, concurrent commands, crash gaps, or replay bypasses caps;
- reduction/open classification is wrong and a kill switch permits new exposure;
- account leverage exceeds the configured maximum.

Controls:

- native `BigInt` fixed-point parsing, comparison, multiplication, modulo, addition, and basis-point cross multiplication;
- canonical positive decimals with bounded digits/scale/bytes; lossless string int64 parsing;
- exact same-generation mark/position/config/balance/order snapshot and deterministic classification;
- observed symbol leverage must be no greater than the account cap; no leverage/margin/mode mutation exists;
- one mutex spans daily replay, exact addition, fsynced reservation, and dispatch intent;
- gross daily capacity is consumed before every order POST and never refunded;
- UTC rollover uses bounded fresh server time and fails closed on regression;
- equality/one-unit-over, concurrency, restart, crash, and midnight boundaries are deterministic tests.

Residual risk: exchange state can change after preflight. One-way mode and exchange `reduceOnly` independently protect reductions; opening orders remain subject to a bounded race inside the reviewed one-second validation-to-dispatch window.

### Ambiguous write and duplicate order

Threats:

- timeout, connection reset, `408`, `5xx`, malformed success, process crash, or teardown hides an accepted order;
- retry produces a duplicate;
- an intent-before-send crash is misclassified as a rejection.

Controls:

- fsynced queue, daily reservation, and dispatch intent precede the single POST;
- deterministic client ID and permanent request/client/digest tombstones;
- zero order-POST retries for every outcome;
- any unproven post-intent result is durable unknown;
- Query Order only by exact original client ID, complete response identity, fast/slow schedule, and confirmed-open monitoring;
- `-2013` and retention expiry never prove failure;
- teardown/unmount/kill switch/soft disable are never cancellation;
- failed post-intent persistence leaves the last durable pending state and global block.

Residual risk: an unknown can remain unresolved beyond Binance retention. It remains globally blocking until a separately reviewed backend-only recovery procedure; availability is sacrificed for safety.

### Kill-switch confusion

Threats:

- kill switch is volatile, defaults off, is silently cleared on restart, or is treated as cancel/close success;
- renderer or attacker disengages it;
- engaging it stops reconciliation and loses owned open orders.

Controls:

- exact policy configuration and persistent default-engaged state;
- fsync before acknowledgement and replay before capability;
- engagement only blocks new exposure; it emits no exchange request and does not change order/position state;
- cancel-all and close-positions are separate intent/action/state machines;
- routine renderer arming is isolated to `prepareDisengageKillSwitchIntent` / `disengageKillSwitch`; it requires an owning one-use intent, current revision, exact confirmation phrase, mutex/idempotency protection, every activation gate, healthy recovery, and no blocking durable operation;
- the backend fsyncs `kill_switch_transition=disengaged` before acknowledgement; crash before that record remains engaged, while crash after it recovers the exact confirmed transition;
- ARM LIVE sends no exchange request and cannot imply order placement, cancellation, or closure; backend-only recovery remains separately authorized and audited;
- recovery/monitoring runs while engaged or softly disabled.

Residual risk: an already compromised subscribed renderer can automate the visible ARM phrase once all backend activation gates are satisfied; the phrase is an accidental-action barrier, not proof of a human. The compiled 1x / 10 USDT / 50 USDT ceilings, durable daily accounting, one-use order intents, and persistent kill switch limit but do not eliminate that risk. Kill-switch engagement also does not protect orders placed by other applications or users. Cancel-all is the explicit exchange action and may itself be partial or unknown.

### Cancel-all and close-position partial failure

Threats:

- regular cancellation succeeds while algo cancellation fails;
- one symbol succeeds and another fails;
- a close child times out, is rejected, exceeds a cap, or races a position change;
- UI claims the account is safe based on an acknowledgement.

Controls:

- separate regular/algo requests and reconciliation reads per allowlisted symbol;
- exact empty inventories are the only cancel confirmation;
- separate reduce-only MARKET child identity, durable intent, daily reservation, Query Order, and result per position;
- parent outcome is confirmed only when every required child is confirmed; otherwise partial or unknown;
- bounded result arrays and fixed safe messages;
- no automatic retry of writes and no inferred sibling success;
- UI uses distinct controls and never maps partial/unknown to accepted.

Residual risk: the literal daily/per-order caps can prevent a complete emergency close. The system reports this as a partial hard-limit result; operators must account for this when choosing conservative caps and retain external exchange access.

### Storage corruption, rollback, and multiple owners

Threats:

- two app instances, stale lock, symlink, replacement, wrong owner/mode, partial write, anchor rollback, record deletion, corrupt audit, or capacity exhaustion loses state or reopens limits;
- credential rotation selects a fresh directory.

Controls:

- Electron single-instance plus separate production journal lease;
- fixed production namespace, no renderer path input, no credential-derived bypass directory;
- owner-only directories/files, `O_NOFOLLOW`, regular-file/link/owner/mode checks, inode-bound lease;
- length framing, monotonic sequence, previous-HMAC chain, sealed latest anchor, file and directory fsync;
- tail truncation only when provably beyond the last sealed anchor; every other anomaly fails closed;
- bounded 100,000-record/64-MiB store fails closed; no silent deletion or empty-store recovery;
- credential binding and active attempts replay before admission.

Residual risk: disk loss or secure-storage loss can make production recovery unavailable. Backups must preserve the whole namespace atomically and are not an automatic restoration authority.

### Credential and audit disclosure

Threats:

- keys, secret, recovery authorization, signature, signed URL/body, auth headers, raw response, nested error config/cause, crash stack, clipboard, analytics, telemetry, localStorage, or browser cache discloses credentials or account data;
- encoded or rotated values evade redaction.

Controls:

- capture/delete before window; renderer bridge contains no production config or credential;
- facade errors are purpose-built fixed records with only bounded classification, status, code, message digest, and endpoint ID;
- sanitizer installs before global console/crash sinks and handles raw, URL-encoded, nested, and rotated secret values;
- audit schema excludes network request objects, headers, URLs with queries, bodies, raw causes, and stacks;
- renderer hook/component never writes storage, clipboard, analytics, telemetry, or generic error reporting;
- tests scan logs, crash handlers, audit frames, snapshots, runtime bridge, bundles, and browser storage.

Residual risk: operating-system memory inspection can observe process secrets. Use a restricted host account, short-lived scoped keys, IP restrictions, and revoke credentials after suspected compromise.

### Resource exhaustion and priority inversion

Threats:

- huge frames/bodies/headers/messages/JSON trees, hanging fetch/body, unbounded audit, many intents, reconciliation storms, or production preflight delays Spot;
- retry wrapper repeats production work.

Controls:

- exact command, field, string, body, header, node, depth, audit, record, journal, connection-channel, and intent bounds;
- 10-second whole-operation deadlines race both fetch and body read; late responses cannot mutate state;
- at most one active production operation and one unused intent per session;
- explicit reconciliation timers with one zero-retry GET per schedule point;
- separate production-origin quota bucket around the unchanged Spot-priority coordinator; every request-weight reservation is fsynced before network I/O, the exact 60-second window replays after restart, capacity is never refunded after an abort/failure/crash, and Spot waiter checks occur at admission and each production read;
- production writes do not use the Spot retry wrapper;
- unchanged high-cycle open monitoring does not append duplicate audit state.

Residual risk: Production public reads, signed production execution reads, and Spot work still share process CPU/disk scheduling. The global production mutex, bounded work, and Spot admission checks limit but do not eliminate scheduling jitter.

### Supply-chain or boundary regression

Threats:

- a later refactor merges production into Phase 6, exposes generic SDK/client options, adds a caller host, enables redirects/retries, changes Spot priority, or places secrets in renderer state.

Controls:

- inverse static isolation scans for production hosts plus retired Testnet names, imports, actions, credentials, writes, and storage namespaces;
- an immutable archive manifest for the retired Phase 5/6 paths, with no active imports or build aliases;
- circular-import checks;
- exact facade export-surface tests;
- full Spot, Production execution, Production workstation, and E2E regression;
- GitNexus upstream impact before existing-symbol edits and change detection before commit.

Residual risk: static checks are not formal proof. Code review, deterministic tests, dependency review, and operational authorization remain required.

## Security acceptance

The live-authorized Phase 7 delivery is acceptable only when:

- every activation-gate combination fails except the fully satisfied live-authorized or explicitly fake-authorized test case;
- normal composition resolves only process-global `fetch`, while E2E cannot resolve a production network capability;
- every order POST ambiguity produces zero retries and durable unknown recovery;
- exact cap/concurrency/rollover/crash boundaries pass;
- kill-switch, cancel-all, and close-position states remain distinct under every partial outcome;
- audit corruption/disclosure tests fail closed;
- Spot priority and all Phase 5/6 regressions pass;
- full unit, lint, production/E2E build, Playwright, circular-import, static isolation, and GitNexus change audits pass;
- automated validation performs no production request and manual live use remains an explicit operator action with visible red production state.
