# Read candles from the nearest source

## Why

Every candle the chart draws today comes from the exchange, through the proxy,
at exchange weight: the live window on every contract open and interval
switch (`/fapi/v1/klines`, 99 rows, weight 1, ~1.3 s through the proxy) and
every page of history behind it (1 000 rows, weight 5). The desk's only cache
is the renderer's IndexedDB run of closed history pages it has already scrolled
to — nothing for a window it has not opened, nothing for an interval it has not
scrolled.

Meanwhile the machine already holds the whole USDⓈ-M universe as closed
minutes: `hunter`/`trader` keep `binance_usdm_ohlcv_1m` in the Timescale
database `hunter_trader` (container `trader_postgres`), fed live by the
scanner and the bot, and `hunter`'s UI backend on `127.0.0.1:8765` serves it
as candles of any chart interval through `GET /api/candles/{symbol}?market=usdm`.

Measured 2026-09-03 20:34Z:

| | |
|---|---|
| Hypertable size / rows | 5 649 MB / ~23.9 M |
| Symbols with rows in 30 days / fresh within 15 min | 533 / 526 |
| Oldest minute / newest minute | 2026-07-30 17:20Z / 20:33Z (one minute ago) |
| Operator's contracts (BULLAUSDT, USELESSUSDT, BTRUSDT, SKRUSDT) | ~50 000 minutes each, fresh |
| CJK listings (龙虾USDT, 牛来USDT, 币安人生USDT) | present, fresh |
| Retention / compression | 488 days / after 14 days |

Operator, 2026-09-03: «мы изначально пытаемся получить кэш из базы — если
его нет, то кэш из аппа, если его нет — тогда запрашиваем … обеспечит нам и
скорость и сэкономит лимиты бинанса». And the picture behind the interval
spinner: the series of the interval being left, fitted whole into the screen,
«совершенно странное значение графика».

## What Changes

- **A candle store in the main process**, one reviewed loopback reader over
  `hunter`'s candles endpoint: contract, interval, a half-open time span, a row
  bound, `topup=false`. It answers rows in the exact shape the exchange's
  klines are normalized to, or nothing. It never triggers an exchange read
  itself, never leaves loopback, and is off when its URL is empty.
- **Three sources, nearest first.** A history page behind the live window is
  taken from the renderer's own cache when it holds the whole page, else from
  the store when it covers the whole page, else from the exchange. A store
  page is served only complete and exact — the same rows the exchange would
  send — so a short store answer is never read as the start of a contract's
  history. Pages from the store are written to the renderer's cache like the
  exchange's.
- **The live window arrives twice.** On a contract open and on an interval
  switch the store's window of the selected interval is delivered first, under
  the `loading` state, while the exchange's window and socket are on their
  way; the exchange's window then replaces it bar for bar and lifts the veil.
  The switch draws the new interval's candles at once instead of the old
  interval's fitted whole.
- **The record states the source.** Timing lines `candle-store-window` and
  `candle-store-page` with `hit` / `miss` / error, beside the exchange's
  `contract-klines` and `candle-history`; the daily summary counts candle
  reads by source and the exchange weight not spent.
- **`hunter` learns `topup=false`** on its candles endpoint (five lines and a
  test in `~/work/hunter`): without it, a span the database does not cover
  makes `hunter` read Binance itself — up to eight pages of 1 500 klines
  from the same IP, outside the desk's limiter.
- **Not changed:** the exchange stays the authority for the forming candle
  and the live tail; the socket path; the history protocol on the wire; the
  renderer's cache. Background contracts read nothing from the store either —
  the store is free of exchange weight, but the pool rule is «фон не читает».

## Impact

- Specs: `futures-workstation-presentation` (ADDED: candles are read from the
  nearest source; MODIFIED: an interval change touches only the candles;
  scrolling left loads older candles), `desk-diagnostic-record` (ADDED: a
  candle read names its source).
- Code, main: new `electron/services/futures-workstation-candle-store.js`;
  `futures-production-workstation-service.js` (a provisional window on
  `startGeneration` and `selectInterval`, the store tier in
  `loadCandleHistory`); `futures-production-workstation-composition.js`
  (constructs the store; the verification composition does not);
  `scripts/check-futures-workstation-boundaries.mjs` (the store is a second
  reviewed network module, loopback and GET only).
- Code, renderer: `useFuturesProductionWorkstation.js` (the switch wait ends on
  the exchange's `live` window, not on the store's `loading` one).
- `scripts/read-desk-record.mjs`: a «Candle reads» block.
- `~/work/hunter`: `ui/backend/api/candles.py` gains `topup` (default true);
  `ui.service` must be restarted for it to take effect.
- Configuration: `FUTURES_CANDLE_STORE_URL`, default `http://127.0.0.1:8765`,
  empty to disable; anything but a loopback `http:` origin disables it with a
  code in the record.
- Deploy: every `electron/**` file here restarts a running desk, and one file
  copied into a running desk killed the dev server this evening (`7fff0f4`).
  Deployed only with the desk stopped by the operator.
