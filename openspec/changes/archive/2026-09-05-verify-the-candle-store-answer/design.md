## Contract

The local Hunter API source was read without executing or editing it: ui/backend/api/candles.py, schemas/models.py and repositories/candles.py. USD-M responses include symbol, tf, market, requested_from/to, actual_from/to, gap_count, coverage_complete and numeric bars whose time is Unix seconds. Request range is inclusive start/exclusive end. The store uppercases symbol; caller canonicalizes likewise while preserving Unicode contract names.

Identity proof compares exact canonical symbol/timeframe/market and timezone-qualified requested timestamps by instant. Null, missing or ambiguous timezone metadata is invalid. Validate raw rows before the normalizer can sort them: safe timestamps, epoch/Monday-week alignment, within requested range, strictly increasing, numeric finite OHLCV without null/boolean coercion, valid OHLC ordering. Require page range length = limit * interval; a complete page must cover that exact span contiguously and actual minute coverage must equal its bounds. A short or declared incomplete page remains a miss, not listing proof.

Windows retain the existing policy: gap metadata must account only for missing head/tail minutes; trim partial edge buckets; verify the remaining rows cover every whole bucket between actual coverage bounds. A known internal hole remains a miss. Claimed coverage with a missing/shifted bucket is invalid. No partially checked rows are returned.

Invalid identity/geometry uses fixed safe error codes through existing cooldown/fallback; never log the body. Existing transport caps, deadline and exchange admission are unchanged. No direct live read or external database write is needed. Number-to-decimal conversion retains its existing eight-place policy; this change does not claim lossless upstream float precision.

## Impact and verification

GitNexus parseAnswer/servePage/serveWindow/tupleOf reach readCandles and emitStoreWindow/readStorePage plus generation/history/interval owners. Name-based decimalOf selected the unrelated wallet helper (HIGH); no wallet code changes. Exact candle-store path graph confirms tupleOf as its caller. Production first, then real loopback adversarial cases for wrong identity/range, duplicate/reversed/skipped/off-grid/out-of-range bars, missing/coerced OHLCV, valid Unicode/minute/five-minute/Monday-week pages and trimmed windows. Run full checks, graph/diff review, validate and commit main; live acceptance stays outstanding.
