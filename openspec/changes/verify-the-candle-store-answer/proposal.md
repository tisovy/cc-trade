## Why

Audit F07 reproduced a successful BTCUSDT/1m store page answered with ETHUSDT/1h candles from another day. Row count and upstream coverage claims are not proof that the response answers the requested chart.

## What Changes

- Require matching market, symbol, timeframe and echoed requested range before accepting local-store rows.
- Validate raw numeric bars, bucket alignment, ordering and bounds before normalization; verify exact contiguous page geometry and whole-window coverage before a hit.
- Preserve bounded loopback-only GET/topup=false, deadlines, cooldown, short-page refusal and existing exchange fallback. Invalid data never enters renderer/cache.

## Capabilities

### New Capabilities

- `candle-store-answer-integrity`: request-specific identity and geometry proof at the loopback boundary.

## Impact

One production candle-store module and its tests; no Hunter edits, database migration, trading paths or new network route. Existing listing-vouch and cache-observability proposals remain independent and unimplemented by this change.
