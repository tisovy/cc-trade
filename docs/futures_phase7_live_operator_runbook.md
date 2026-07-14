# Phase 7 Live Futures Operator Runbook

Date: 2026-07-14

This runbook covers manual USDⓈ-M production verification after the operator's explicit live authorization. Automated tests and development verification must still use deterministic fakes and must never send a production request.

## Non-negotiable boundaries

- Never commit credentials, put literal credentials in command-line arguments, paste them into the renderer, or store them in `.env` inside the repository.
- Use a dedicated USDⓈ-M key with the narrowest exchange permissions and external IP restrictions available. Withdrawal permission is not required by this application.
- Never delete or replace `futures-production-execution/v1` to clear a block. The journal, anchor, key, counter, unknown-outcome, and kill-switch state are one safety unit.
- Production is the red `Futures Live` workspace. Testnet is the blue `Futures Testnet` workspace. The selector changes only which independently composed UI/channel is mounted; it never changes a backend host or credential mode.
- E2E always force-disables production and installs a production-network escape guard.

## Required secure process environment

Normal production composition remains disabled unless every value below passes exact parsing:

```text
FUTURES_PRODUCTION_EXECUTION_ENABLED=true
FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT=I_UNDERSTAND_REAL_USDT_FUTURES
FUTURES_PRODUCTION_EXECUTION_ACCOUNT_ALIAS=<exact signed Binance account alias>
FUTURES_PRODUCTION_EXECUTION_API_KEY_FINGERPRINT=<lowercase SHA-256 of the exact API key>
FUTURES_PRODUCTION_EXECUTION_ALLOWED_SYMBOLS=BTCUSDT
FUTURES_PRODUCTION_EXECUTION_MAX_LEVERAGE=1
FUTURES_PRODUCTION_EXECUTION_MAX_ORDER_NOTIONAL_USDT=<exact positive decimal, max 10>
FUTURES_PRODUCTION_EXECUTION_MAX_DAILY_NOTIONAL_USDT=<exact positive decimal, max 50>
FUTURES_PRODUCTION_EXECUTION_MIN_AVAILABLE_BALANCE_USDT=<exact positive decimal>
FUTURES_PRODUCTION_EXECUTION_MIN_LIQUIDATION_DISTANCE_BPS=<1000..10000>
FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY=v1-persistent-block-new-exposure
FUTURES_PRODUCTION_API_KEY=<secret supplied by the trusted launcher>
FUTURES_PRODUCTION_API_SECRET=<secret supplied by the trusted launcher>
FUTURES_PRODUCTION_RECOVERY_AUTHORIZATION=<independent 32..128 visible-ASCII secret>
```

Compute the fingerprint locally without printing the key itself:

```sh
printf %s "$FUTURES_PRODUCTION_API_KEY" | sha256sum
```

Unknown `FUTURES_PRODUCTION_*` keys, alternate spelling, whitespace, coercion, an alias/fingerprint mismatch, incomplete caps, or a ceiling violation disable production.

## Manual verification sequence

1. **Spot launch:** start without any `FUTURES_PRODUCTION_*` values. Keep the selector on neutral `Spot` and verify the established Spot workflow.
2. **Testnet launch:** configure Phase 5/6 exactly as documented in `futures_phase6_testnet_execution_design.md`, still without any production values. Select blue `Futures Testnet`; verify that Spot controls disappear and only read-only/testnet execution panels exist.
3. **Stop the app completely.** Production configuration is captured once before the first `BrowserWindow`; it is not hot-loaded.
4. **Live readiness launch:** inject the complete production environment through the trusted launcher and start normally, with no operator-action argument. A valid live configuration performs exact signed production identity/recovery GETs during startup. It does not place, cancel, or close an order automatically. The persistent kill switch starts engaged.
5. Select red `Futures Live`. Verify the backend-owned account alias and full key fingerprint, allowlist, leverage/order/daily caps, UTC usage, `CONFIGURED`, `LIVE LOCKED`, healthy recovery, and `KILL SWITCH ENGAGED`. The Phase 5 read-only and Phase 6 testnet tickets must not be present.
6. Resolve any rejected identity, storage, recovery, rate-pause, credential-binding, or cap state before proceeding. Do not bypass it by deleting state or rotating to a fresh directory.
7. Only after the displayed identity and exact 1x / 10 USDT / 50 USDT caps are approved, click `Prepare ARM LIVE intent`. Type exactly `ARM LIVE FUTURES 1X 10 USDT 50 USDT DAILY`, then click `ARM LIVE FUTURES`. Enter never submits. The backend must report `LIVE ARMED`, `KILL SWITCH DISENGAGED`, and `kill_switch_disengaged`; the UI does not place, cancel, or close anything during arming.
8. Every real order, cancel-all, close-positions, and kill-switch action still requires its own backend one-use intent and exact typed confirmation. Never interpret an acknowledgement, partial result, timeout, or unknown result as a completed safety action. At the 10 USDT ceiling, exchange quantity/minimum-notional filters may make an allowlisted symbol unavailable; that is a local rejection, not a reason to bypass or raise a cap without a new review.
9. Re-engage the kill switch from its dedicated production UI action or by a reviewed backend startup action. Engaging it blocks new exposure; it does not imply cancellation or closure.

The backend `--futures-production-operator-action=disengageKillSwitch` path remains an authorized operational-recovery mechanism, not the normal arming workflow. `reconcile` remains backend-only.

## Failure and recovery

- `UNKNOWN`, `PARTIAL`, reconciliation-required, confirmed-open, credential-rotation, corrupt-store, or audit-capacity states are blocking safety states. Do not resend an order POST.
- Use `--futures-production-operator-action=reconcile` only with the original account credentials and unchanged production storage. It performs reviewed reads only; it cannot fabricate success or resend an order.
- Cancel-all and close-positions remain separate actions and can each be partial. Inspect every per-symbol result and confirm exchange state independently.
- If secure storage or the production journal is unavailable, preserve the whole namespace and stop. Restoration or migration requires a separately reviewed operational procedure.
