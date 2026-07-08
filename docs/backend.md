# Backend & Data Services

## Electron Main Process (`electron/main.js`)

- Initializes Electron window (1200×800) and opens DevTools only during Vite dev-server runs or with `ELECTRON_OPEN_DEVTOOLS=true`.
- Imports and executes `setupBinanceConnection()` before creating the BrowserWindow so the WebSocket server is always ready.
- Loads the Vite dev server URL during development, otherwise serves the built `dist/index.html`.

## Binance Connection Service (`electron/services/binance-connection.js`)

### Responsibilities
1. **WebSocket Server**: Creates an HTTP server + WebSocketServer on `process.env.WS_PORT` (defaults to `14477`).
2. **Mock Mode**: When `BK/BS` are missing we emit synthetic ticker/depth/trade/chart data every second so the renderer can boot without hitting Binance.
3. **Live Mode**: Uses `@binance/spot` REST + WebSocket Streams to hydrate:
   - 24h ticker snapshots + incremental updates for the Activity panel.
   - Candlesticks, trades, and depth per selected symbol/interval.
   - Account filters, balances, open orders, and personal trade history via REST.
   - Order placement/cancellation through signed REST endpoints.

### Minimal WebSocket Architecture (Only 3 Sockets!)

The service uses the absolute minimum number of WebSocket connections to Binance:

| Socket | Stream(s) | Purpose |
| --- | --- | --- |
| `globalWsConnection` | `!miniTicker@arr` | 24h ticker updates for all symbols (`!ticker@arr` is deprecated/silent) |
| `userDataWsConnection` | `<listenKey>` | User data (orders, balances, execution reports) |
| `marketWsConnection` | Combined streams | **ALL market data in ONE socket** (klines + trade + depth) |

**Benefits:**
- **Only 3 WebSocket connections total** regardless of how many charts you have
- Compliant with Binance's connection limits (max 5 connections/second, 1024 streams/connection)
- 2-second debounce batches all subscription changes during startup

**How the Market Socket works:**
1. Combines streams into one WebSocket based on what's needed:
   - All kline streams for mini charts (e.g., `btcusdt@kline_1d`, `ethusdt@kline_4h`)
   - **Trade + Depth streams ONLY when DepthView is active** (saves bandwidth on MainView!)
2. Subscription changes are debounced (2 seconds) to batch them together
3. Single message handler routes data by event type:
   - `kline` events → routed to appropriate channel(s) by symbol/interval
   - `trade` events → routed to detail channel (only when depth view enabled)
   - `depthUpdate` events → routed to detail channel (only when depth view enabled)

**Smart Stream Management:**
- **MainView**: Only subscribes to klines (no trades/depth - minimal bandwidth)
- **DepthView**: Subscribes to klines + trades + depth for the selected symbol
- Frontend sends `enable_depth_view` / `disable_depth_view` actions when switching views

### Data Normalization

- Chart payloads are converted to lightweight-charts friendly arrays (`[{ time, open, high, low, close, volume }]`), with `last_tick` matching the same shape.
- `sendJSON()` guards against writing to a closed socket.
- Channel subscriptions are managed by `ChannelManager` and `MarketStreamManager` to prevent ghost updates.

### Rate Limiting

The backend implements rate limiting to comply with Binance API restrictions:

- **REST API Rate Limiter**: Uses a token bucket algorithm with 800 weight/minute (conservative limit under Binance's 1200/minute cap)
  - Each REST request has an assigned weight (e.g., exchangeInfo=10, depth=5, klines=2)
  - Requests are queued and executed when capacity is available
  - Automatically calculates wait time when approaching limits

- **WebSocket Connection Throttling**: 200ms minimum interval between new WebSocket connections
  - Prevents exceeding Binance's 5 connections/second limit
  - Mini chart subscriptions are staggered with 250ms delays

- **Implementation**: `RateLimiter` class in `binance-connection.js`
  - `rateLimiter.execute(fn, weight)` - Execute function with rate limiting
  - `throttleWsConnection()` - Throttle WebSocket connections

### Logging

- Set `LOG_LEVEL` (`error`, `warn`, `info`, `debug`) to control how noisy the Electron backend logs are. Default is `info`.
- Secrets from `BK/BS` are masked in stdout/stderr (`SECURED`) before any log line is emitted.

### Message Schema (Renderer ↔ Service)

**New Channel Protocol** (preferred):

| Direction | Payload | Description |
| --- | --- | --- |
| Renderer → Service | `{ action: 'subscribe', channelId, channelType, symbol, interval }` | Subscribe to a channel (detail or mini). |
| Renderer → Service | `{ action: 'unsubscribe', channelId }` | Unsubscribe from a channel. |
| Renderer → Service | `{ action: 'enable_depth_view', symbol }` | Enable trade + depth streams (call when entering DepthView). |
| Renderer → Service | `{ action: 'disable_depth_view' }` | Disable trade + depth streams (call when leaving DepthView). |
| Renderer → Service | `{ action: 'order', type: 'buy'|'sell', symbol, price, quantity }` | Place an order. |
| Renderer → Service | `{ action: 'cancelOrder', orderId, symbol }` | Cancel an order. |
| Service → Renderer | `{ channelId, type: 'chart', symbol, interval, payload, extra }` | Chart data with channel metadata. |
| Service → Renderer | `{ channelId: 'global', type: 'ticker', payload }` | Global ticker updates. |

**Legacy Protocol** (still supported for backward compatibility):

| Direction | Payload | Description |
| --- | --- | --- |
| Renderer → Service | `{ request: 'chart', data: panelState }` | Ask for a (re)subscription to the selected symbol/interval. |
| Renderer → Service | `{ request: 'buyOrder' | 'sellOrder', data: {...} }` | Places signed GTC LIMIT orders through the Binance REST API. |
| Renderer → Service | `{ request: 'cancelOrder', data: {...} }` | Cancels an open order by `orderId` and refreshes balances/orders/history. |
| Service → Renderer | `{ chart, last_tick }` | Candle array + latest tick (seconds). |
| ` ` | `{ trades }` or `{ history }` | Trade feed (single object) or initial list. |
| ` ` | `{ depth }` | Bid/ask book snapshots (already sorted). |
| ` ` | `{ orders }`, `{ balances }`, `{ filters }` | Account data hydration. |
| ` ` | `{ ticker }` / `{ ticker_update, index }` | Activity panel feed. |

## Extending the Service

- Keep mock mode updated whenever new renderer features need additional data fields.
- Prefer `async/await` + try/catch for new REST endpoints; legacy callback style can be refactored gradually.
- When adding new streams, use `MarketStreamManager` to consolidate connections:
  - For kline streams: `marketStreamManager.addKlineStream(channelId, symbol, interval)`
  - For detail streams: `marketStreamManager.setDetailSymbol(symbol)`
  - All streams are combined into ONE WebSocket connection
- Channel cleanup is automatic when using `channelManager.removeChannel()` or `channelManager.cleanup()`.

## VPS Announcer & Analytics (`tele_announcer/server.js`)

- Reuses the Telegram announcer that listens to Binance `miniTicker` streams and persists state in Redis (`binance_announcer` key). The service now also:
  - Buckets every tracked `USDT` pair (plus `BTCUSDT`) into 1‑minute price snapshots, retaining ~26h of history in memory.
  - Computes two resilience metrics per symbol:
    - **Strength** (3m/5m/15m/1h windows) → gauges short‑term decoupling from fast BTC moves. The engine calculates BTC and coin percentage moves per window, divides them to get a ratio, then converts that ratio into a 0‑100 score (ratio ≤0 ⇒ strong inverse/resistance, ratio 1 ⇒ neutral, ratio ≥2.5 ⇒ weak). Per-window contributions are smoothed with an EMA (`α=0.4`).
    - **Endurance** (1h/4h/1d windows) → similar math but with longer horizons and a tighter EMA (`α=0.2`) to emphasise persistent behaviour.
  - Exposes a secured REST surface on `/analytics` with:
    - `GET /analytics/strength?limit=25` and `GET /analytics/endurance?limit=25`
    - Symbol lookups (`/analytics/strength/:symbol`, `/analytics/endurance/:symbol`)
    - `GET /analytics/combined` for a single payload the renderer can hydrate into the Activity panel.
  - `GET /analytics/activity?interval=1m&limit=10` to replicate the front-end Activity panel using server-side calculations (falls back to local estimation if unavailable).
    - `GET /analytics/health` for dashboards/monitoring.
  - Protects the API via an HMAC header triad:
    - `X-Analytics-Key` – must match `ANALYTICS_API_KEY`
    - `X-Analytics-Ts` – unix ms timestamp, ±30s skew (configurable via `ANALYTICS_MAX_CLOCK_SKEW_MS`)
    - `X-Analytics-Signature` – `HMAC_SHA256(secret, "<key>:<ts>:<METHOD>:<url>:<body>")`
  - Optional hardening knobs:
    - `ANALYTICS_ALLOWED_ORIGINS` (CSV) to gate CORS
    - `ANALYTICS_RATE_LIMIT_MAX` / `ANALYTICS_RATE_WINDOW_MS`
    - `ANALYTICS_TRACKED_SYMBOLS` (CSV) to limit calculations to specific pairs
    - `ANALYTICS_MIN_VOLUME` to ignore illiquid symbols during ingestion

### Renderer Integration Sketch

1. On app boot, call `GET /analytics/combined?limit=30` with the signed headers (desktop builds can keep the key/secret in the user config or fetch from the VPS over SSH).
2. Store `strength.metrics` / `endurance.metrics` in `dataContext` so both `ActivityPanel` and any chart overlays can consume the new scores.
3. Activity panel: render two compact lists under the existing “Activity” cards, each row showing `{ symbol, score (progress bar), last btcMove/coinMove }`. Highlight rows that exceed user-defined thresholds (e.g., Strength ≥ 75).
4. Use the `generatedAt` timestamp to decide whether the client should delta-refresh (poll every 30‑60s) or fall back to local estimation if the VPS feed stalls.
5. Optional: wire notifications so that when `score` crosses configured thresholds we leverage the existing in-app toast/Telegram channels.
6. Configure `ANALYTICS_URL`, `ANALYTICS_KEY`, `ANALYTICS_SECRET`, plus optional `ANALYTICS_POLL_INTERVAL`/`ANALYTICS_LIMIT`, so the renderer can sign and poll the VPS API.

### Analytics Auth & Key Management

- **Key roles**
  - `ANALYTICS_KEY` (a.k.a. public key/client id) is sent in the `X-Analytics-Key` header so the VPS can look up the correct signing secret.
  - `ANALYTICS_PUBLIC_KEY` is optional. Reserve it if you later move to an asymmetric scheme; today it simply mirrors `ANALYTICS_KEY`.
  - `ANALYTICS_SECRET` must *never* ship inside the renderer bundle. It is only used to calculate `HMAC_SHA256` signatures before each request.
- **Generating secrets**
  - Linux/macOS: `openssl rand -hex 64 > analytics.secret`
  - Windows (PowerShell): `[System.Convert]::ToHexString((1..64 | % { Get-Random -Max 256 })) > analytics.secret`
  - Store the resulting hex string in a password manager and copy it over SSH when provisioning servers or trusted desktops.
- **Supplying values to the Electron renderer**
  - Export environment variables before launching Electron/Vite:
    ```
    export ANALYTICS_URL="https://vps.example.com"
    export ANALYTICS_KEY="trade-desktop"
    export ANALYTICS_SECRET="$(cat ~/.secrets/analytics.secret)"
    export ANALYTICS_LIMIT=40
    export ANALYTICS_POLL_INTERVAL=45000
    ```
  - Alternatively inject the secret at runtime by setting `globalThis.__ANALYTICS_RUNTIME__ = { secret: '...' }` *before* the React bundle executes (e.g., custom preload script). Never hard-code it inside `import.meta.env`.
- **Server-side validation**
  - `tele_announcer/server.js` lives alongside its own `package.json` and redis/Telegram dependencies. It reads the same env vars (prefixed with `ANALYTICS_`) and exposes `/analytics/*` routes protected by HMAC signatures.
  - Because this service is a separate deployment unit, nothing inside the React/Electron workspace depends on it; keep its dependencies isolated under `tele_announcer/`.
