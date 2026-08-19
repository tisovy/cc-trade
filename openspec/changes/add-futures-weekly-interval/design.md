## Context

See `proposal.md` for motivation. The renderer already has one exported `FUTURES_WORKSTATION_INTERVALS` list that drives both the visible toolbar and the keyboard picker, but the main-process market contract, production transport, and deterministic transport keep their own boundary allowlists. Futures history continuity is separately defined by `FUTURES_CANDLE_HISTORY_INTERVAL_MS`. All five boundaries currently end at `1d`; adding only the button would therefore produce a request that later layers reject or cannot cache safely.

The current production flow already owns interval replacement, generation isolation, candle-stream selection, history paging, and late-answer rejection. This change extends the accepted value set and does not introduce a new delivery path.

## Goals / Non-Goals

**Goals:**

- Make `1w` a first-class value at every existing Futures interval boundary.
- Keep one ordered renderer list as the source for toolbar and picker presentation.
- Preserve weekly live/history ownership, continuity, cache isolation, and unsupported-value rejection.
- Keep the compact toolbar usable at the supported narrow width shown by the operator.

**Non-Goals:**

- Changing the `15m` default or persisting a new interval preference.
- Adding other Binance intervals such as `3d` or `1M`.
- Changing Spot, mini-chart, candle payload, paging limits, or chart rendering semantics.
- Refactoring the existing browser/main-process module boundary merely to remove duplicate allowlists.

## Decisions

### Extend the existing ordered renderer list

Append `1w` after `1d` in `FUTURES_WORKSTATION_INTERVALS`. The toolbar and keyboard picker already derive from this list, so both surfaces receive the same value and ordering without a second UI-specific constant.

Alternative considered: add a standalone button in the view. Rejected because the picker and protocol would drift from what the toolbar presents.

### Update each existing trust boundary explicitly

Add `1w` to the interval validators in the shared workstation protocol, the normalized market contract, the production transport, and the deterministic transport. Keep these boundary-local allowlists rather than importing renderer-oriented code into Electron services.

Alternative considered: centralize every allowlist in this small change. Rejected because that changes dependency structure beyond the requested behavior; focused matrix tests can prove the existing boundaries agree.

### Model a Futures week as a fixed seven-day exchange interval

Add `1w: 604_800_000` to the Futures candle-history interval map. Binance weekly klines are fixed UTC exchange periods, so the cache continuity check must use seven days rather than host calendar or daylight-saving arithmetic. The existing `${symbol}:${interval}` key already isolates weekly runs.

Alternative considered: infer duration from adjacent rows. Rejected because a missing row could then be mistaken for a valid interval and silently bridge a cache gap.

### Reuse the existing interval replacement lifecycle

Weekly selection continues through the current select-interval request and session replacement. No weekly-specific state is added: request identity, selection, generation/revision guards, history teardown, and late-answer rejection remain authoritative.

Alternative considered: keep a second weekly series beside the active interval. Rejected because the workstation contract presents exactly one selected candle interval.

### Prove both acceptance and containment

Focused tests will cover toolbar/picker exposure, protocol and transport acceptance, `@kline_1w`/history request forwarding, seven-day cache continuity, service selection, late old-interval isolation, and continued rejection of an unsupported value. Existing interval cases remain regression guards.

## Risks / Trade-offs

- [A duplicated boundary allowlist misses `1w`] → Add focused acceptance tests at every existing validator/transport boundary and retain an unsupported-value case.
- [The seventh control no longer fits the compact toolbar] → Verify its order and visibility in the view tests and adjust only the existing interval-group sizing if the supported width requires it.
- [Weekly cache continuity uses the wrong time basis] → Assert exactly `604_800_000` milliseconds and reject discontinuous weekly rows.
- [An old interval contaminates the weekly chart] → Exercise the existing ownership/generation guards while switching to `1w`.

## Migration Plan

No persisted-data migration is required because cache keys already include the interval. Deploy the new accepted value and duration together. Rollback removes `1w` from the allowlists and UI; any cached `symbol:1w` run becomes unreachable and does not affect other intervals.
