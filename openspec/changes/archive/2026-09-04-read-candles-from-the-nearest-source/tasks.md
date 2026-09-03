# Tasks

## 0. Measured first, 2026-09-03

- `binance_usdm_ohlcv_1m`: 5 649 MB, ~23.9 M rows, 533 symbols, 526 fresh
  within fifteen minutes, oldest minute 2026-07-30 17:20Z; the operator's
  contracts and the CJK listings present and fresh. `hunter`'s endpoint
  aggregates every desk interval and tops up uncovered spans from Binance —
  up to 8 × 1 500 klines per span — unless told not to.

## 1. The store (main)

- [x] 1.1 `futures-workstation-candle-store.js`: URL from
      `FUTURES_CANDLE_STORE_URL` (default loopback 8765, empty = off, any
      non-loopback `http:` origin = off with a code); one `http.request`, GET,
      1 500 ms deadline, body ceiling; `readCandles({ symbol, interval, from,
      to, limit, mode, signal })` → normalized rows or `null`; page mode
      strict, window mode tolerant of a head gap; a 30 s cooldown after an
      error; timings as D6.
- [x] 1.2 Boundary guard: the store is the second reviewed network module —
      `node:http` only, loopback pin, `market=usdm`, `topup=false`, GET, no
      headers or agent; the production composition constructs it, the
      verification composition must not name it.

## 2. The service and the renderer

- [x] 2.1 `FuturesProductionWorkstationService`: optional `candleStore`; the
      provisional window on `startGeneration` and `selectInterval` (D4); the
      store tier in `loadCandleHistory` before the exchange (D2).
- [x] 2.2 Composition: `createFuturesWorkstationCandleStore({ onTiming })` in
      the production runtime only.
- [x] 2.3 Hook: `candlesSwitching` ends on the first candles frame at the
      selected interval that is not the store's `loading` one — the
      exchange's `live` window or a switch's stated failure.
- [x] 2.4 `read-desk-record.mjs`: the «Candle reads» block, fixture-tested.

## 3. `hunter`

- [x] 3.1 `ui/backend/api/candles.py`: `topup: bool = True` query parameter;
      `False` skips `topup_usdm_bars`. A test with a REST client present and
      `topup=False` asserting no call.
- [ ] 3.2 Operator: `systemctl --user restart ui.service` (the UI backend
      only; the scanner writing the minutes is another unit).

## 4. Tests that bite, then the suite

- [x] 4.1 Against a `git archive` copy of `7fff0f4` first: the store asserts
      the address on the wire (path, `market=usdm`, `tf`, `from`/`to`,
      `limit`, `topup=false`, a CJK symbol percent-encoded) against a loopback
      server of the test's own; a page one bucket short is refused; a window
      with a head gap is served from its first bucket; a hole refuses a
      window; a refused connection answers null with an error line and a
      cooldown; an empty URL never connects; a non-loopback URL is off with a
      code; a bar with `high < low` is refused as the exchange's would be.
      Service: a switch emits the store's window under `loading` before the
      exchange's `live` one (HEAD: one `live` frame); a history read served by
      the store never calls `transport.readCandleHistory` (HEAD: calls it); a
      store answer of `limit − 1` rows falls through to the exchange; a store
      window arriving after the exchange's is dropped; a background session
      reads nothing. Hook: `candlesSwitching` survives a `loading` frame at the
      new interval and ends on the `live` one (HEAD: ends on the first).
      Guard: the boundary check passes with the store and fails on a store
      that imports `https` or names a non-loopback origin.
      **Done 2026-09-04**: on a `git archive` copy of `7fff0f4` seven of the
      new cases fail (two of the summary, one of the hook, four of the
      service) and the store's fifteen cannot import their module; two are
      guards — «reads the exchange when the store has less than the page»
      (HEAD always reads the exchange) and «leaves the block out of a day
      without a candle read». The guard refuses a store that imports
      `https` (two failures) and one whose route is not the candles route.
- [x] 4.2 Full suite, `eslint .`, the four guards, build; `hunter`'s unit
      suite for the endpoint. **2026-09-04**: 3 090 tests green on the copy
      (3 066 + 24), eslint clean, four guards ok, build ok; `hunter`'s
      `test_candles_futures_fallback.py` 13 passed.

- [x] 4.3 Self-audit, 2026-09-04, before deploy. Five defects, all in the
      first cut: (1) a weekly span floored to the epoch opened on a Thursday
      — the store answered a bucket made of four days; (2) a window served
      the partial bucket at its head (a 30 July made of seven hours on the
      daily chart) and was refused whenever the scanner had not reached its
      tail; (3) `candlesSwitching` ended on `live` alone, so a switch that
      failed kept the veil over its reason for the whole retry ladder;
      (4) a page ending off the interval's buckets would have been asked of
      the store and answered with partial buckets; (5) the summary counted a
      read the session abandoned as a store failure. Also: the store's timing
      lines now name the contract, durations use the store's own clock, and
      the body of a stalled answer is under the deadline too. Eight new
      cases fail on the pre-audit code in a copy (`work8`); the full suite
      is 3 095 green on the copy.

## 5. Deploy and operator verification (live)

- [x] 5.1 Deploy with the desk stopped by the operator — five `electron/**`
      files, one `scripts/**`, one hook, one guard; then `npm run e`.
      **2026-09-04 01:10Z**: copied into the live tree with `electron` at
      zero processes; guards and the four touched suites green there.
      `npm run e` is the operator's.
- [ ] 5.2 Switch 1m → 5m → 1h on a live contract: the new interval's bars are
      on the chart under the veil at once, the veil lifts when the exchange's
      window lands, no jump; the journal shows `candle-store-window` `hit`
      before `contract-klines` on each switch.
- [ ] 5.3 Scroll left through the last month on 5m: pages arrive with no
      `candle-history` timing and no `history-trades`-like weight; the
      journal shows `candle-store-page` `hit` per page; past 2026-07-30 the
      pages come from the exchange (`candle-history` timings resume).
- [ ] 5.4 Stop `ui.service` for a minute: switches and scrolls keep working
      from the app cache and the exchange; the journal shows
      `candle-store-*` errors then `skipped`, then hits again after the unit
      is back.
- [ ] 5.5 A CJK contract (龙虾USDT): the store serves its window and pages.
- [ ] 5.6 Journal read after the sitting: the summary's «Candle reads» block
      states pages from the store, pages from the exchange, and the weight
      not spent.
