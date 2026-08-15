# Phase 7 Live Futures Operator Runbook

> **RETIRED 2026-07-21.** The guarded production execution subsystem this
> runbook describes was removed in favor of the spot-parity futures path —
> see `docs/futures_trading.md`. Kept for history only.

Date: 2026-07-14

Updated: 2026-07-16 — Futures Testnet is retired. This is now a Spot → stopped
process → Futures production runbook; legacy `FUTURES_TESTNET_*` and `FUTURES_READ_*`
values are scrubbed and cannot enable a Testnet runtime.

Updated: 2026-07-21 — Reviewed ceiling change. The compiled order/daily notional
ceilings are raised from 10/50 USDT to 10000/100000 USDT so that exchange
minimum-notional filters (for example 100 USDT on BTCUSDT) no longer make every
major contract untradeable. The operator-configured
`FUTURES_PRODUCTION_EXECUTION_MAX_ORDER_NOTIONAL_USDT` /
`FUTURES_PRODUCTION_EXECUTION_MAX_DAILY_NOTIONAL_USDT` values remain the
authoritative caps and must be set deliberately; the compiled values are only
sanity ceilings. Leverage remains compiled at exactly 2x. The ARM LIVE phrase no
longer encodes cap numbers; the Advanced safety panel displays the exact
configured caps that arming approves.

This runbook covers manual USDⓈ-M production verification after the operator's explicit live authorization. Automated tests and development verification must still use deterministic fakes and must never send a production request.

## Non-negotiable boundaries

- Never commit credentials, put literal credentials in command-line arguments, paste them into the renderer, or store them in `.env` inside the repository.
- Use a dedicated USDⓈ-M key with the narrowest exchange permissions and external IP restrictions available. Withdrawal permission is not required by this application.
- Never delete or replace `futures-production-execution/v1` to clear a block. The journal, anchor, key, counter, unknown-outcome, and kill-switch state are one safety unit.
- Production is the red `Futures` workspace. The only other workspace is neutral `Spot`; no Testnet selector, channel, credential mode, or backend composition remains active.
- E2E always force-disables production and installs a production-network escape guard.

## Required secure process environment

Normal production composition remains disabled unless every value below passes exact parsing:

```text
FUTURES_PRODUCTION_EXECUTION_ENABLED=true
FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT=I_UNDERSTAND_REAL_USDT_FUTURES
FUTURES_PRODUCTION_EXECUTION_ACCOUNT_ALIAS=<exact signed Binance account alias>
FUTURES_PRODUCTION_EXECUTION_API_KEY_FINGERPRINT=<lowercase SHA-256 of the exact API key>
FUTURES_PRODUCTION_EXECUTION_MAX_LEVERAGE=2
FUTURES_PRODUCTION_EXECUTION_MAX_ORDER_NOTIONAL_USDT=<exact positive decimal, max 10000>
FUTURES_PRODUCTION_EXECUTION_MAX_DAILY_NOTIONAL_USDT=<exact positive decimal, max 100000>
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

Unknown `FUTURES_PRODUCTION_*` keys, alternate spelling, whitespace, coercion, an alias/fingerprint mismatch, incomplete caps, or a ceiling violation disable production. The retired `FUTURES_PRODUCTION_EXECUTION_ALLOWED_SYMBOLS` value is captured and ignored for launcher compatibility; remove it from the trusted launcher. It never authorizes a write.

If the trusted launcher supplies `https_proxy` / `http_proxy`, production signed REST and the private account stream use one backend-owned bounded agent. The renderer cannot override it. Invalid or unsupported proxy syntax disables execution; the runtime never silently switches to direct egress. Ensure the Binance API-key IP restriction permits the proxy egress address.

### Linux safeStorage readiness

Production execution also requires Electron `safeStorage` to report an encrypted OS-backed backend. The application rejects Electron's `basic_text` fallback and never enables plaintext key protection. On Hyprland, which Electron does not currently recognize as a desktop with an automatic password-store mapping, the main process pins the official `gnome-libsecret` backend before `app.ready`; an explicit operator `--password-store` selection is not overwritten. The local Secret Service must be installed, running and unlocked. See the current official [Electron safeStorage backend contract](https://www.electronjs.org/docs/latest/api/safe-storage#safestoragegetselectedstoragebackend-linux).

If the startup log still reports `SAFE_STORAGE_UNAVAILABLE` or `UNSAFE_STORAGE_BACKEND`, stop before Live arming. Do not use `--password-store=basic`, `safeStorage.setUsePlainTextEncryption(true)`, an unreviewed key file or a new storage namespace as a workaround.

## Manual verification sequence

1. **Spot launch:** start without any `FUTURES_PRODUCTION_*` values. Keep the selector on neutral `Spot` and verify the established Spot workflow. Remove obsolete `FUTURES_TESTNET_*` and `FUTURES_READ_*` values from the trusted launcher rather than relying on runtime scrubbing.
2. **Stop the app completely.** Production configuration is captured once before the first `BrowserWindow`; it is not hot-loaded.
3. **Live readiness launch:** inject the complete production environment through the trusted launcher and start normally, with no operator-action argument. A valid live configuration performs exact signed production identity/recovery GETs during startup. It does not place, cancel, or close an order automatically. The persistent kill switch starts engaged.
4. Select red `Futures`. Open `Advanced safety` and verify the backend-owned account alias, full key fingerprint, leverage/order/daily caps, UTC usage, `CONFIGURED`, `LIVE LOCKED`, healthy recovery, and `KILL SWITCH ENGAGED`. A selected symbol is admitted only after a fresh Binance `TRADING` / perpetual / USDT preflight and exact account-symbol checks; neither the public Contracts catalog nor launcher text authorizes a write. No retired Phase 5/6/Testnet ticket may be present.
5. Resolve any rejected identity, storage, recovery, rate-pause, credential-binding, or cap state before proceeding. Do not bypass it by deleting state or rotating to a fresh directory.
6. Only after the displayed identity and the exact Hedge / Isolated / 2x profile with the displayed configured order/daily caps are approved, click `Prepare ARM LIVE intent`. Type exactly `ARM LIVE FUTURES HEDGE ISOLATED 2X WITHIN CONFIGURED CAPS`, then click `ARM LIVE FUTURES`. Enter never submits. The backend must report `LIVE ARMED`, `KILL SWITCH DISENGAGED`, and `kill_switch_disengaged`; the UI does not place, cancel, or close anything during arming.
7. Every real order, cancel-all, close-positions, and kill-switch action still requires its own backend one-use intent and exact bound confirmation. Gesture execution finalizes only the exact immutable draft returned by that intent; typed confirmation remains mandatory where the safety UI explicitly asks for it. Never interpret an acknowledgement, partial result, timeout, or unknown result as a completed safety action. If the configured order cap is below an exchange quantity/minimum-notional filter, the selected symbol stays unavailable; that is a local rejection, and raising the configured cap (never above the compiled ceiling) is the reviewed response.
8. Re-engage the kill switch from its dedicated production UI action or by a reviewed backend startup action. Engaging it blocks new exposure; it does not imply cancellation or closure.

The backend `--futures-production-operator-action=disengageKillSwitch` path remains an authorized operational-recovery mechanism, not the normal arming workflow. `reconcile` remains backend-only.

## Failure and recovery

- `UNKNOWN`, `PARTIAL`, reconciliation-required, confirmed-open, credential-rotation, corrupt-store, or audit-capacity states are blocking safety states. Do not resend an order POST.
- Use `--futures-production-operator-action=reconcile` only with the original account credentials and unchanged production storage. It performs reviewed reads only; it cannot fabricate success or resend an order.
- Cancel-all and close-positions remain separate actions and can each be partial. Inspect every per-symbol result and confirm exchange state independently.
- Cancel-all targets only symbols found in a fresh account-wide regular/algo open-order inventory. Close-positions targets only fresh non-zero Hedge legs. Restart recovery performs reads only and reports success only when the whole corresponding inventory is empty/flat; it never sweeps the public catalog or resumes a write.
- If secure storage or the production journal is unavailable, preserve the whole namespace and stop. Restoration or migration requires a separately reviewed operational procedure.
