## Why

The application can silently substitute synthetic balances, orders, filters, and market data when production credentials are unavailable, while real Futures account-read failures leave the renderer indefinitely disabled without an actionable alert. Startup also always chooses Spot and initializes its data path even when Futures was the operator's last active workspace.

## What Changes

- **BREAKING**: Remove every runtime MOCK branch and synthetic application-data source used outside tests, including fake balances, orders, executions, tickers, candles, and exchange filters. The running application becomes production-only; test doubles and fixtures remain test-only.
- **BREAKING**: Require a complete supported API key and secret pair during startup preflight. Missing, partial, or retired-only credentials SHALL trigger a sliding error alert plus a blocking configuration-error screen, and SHALL stop all market/account initialization instead of starting public data or simulating execution.
- Persist the last explicitly selected Spot/Futures workspace and restore it before either market tree mounts. Load only that workspace and its subscriptions initially; lazy-load the other on first selection. Never silently fall back to Spot: absent or invalid stored mode shows a neutral selector and initializes neither market.
- Model account synchronization as an observable state with per-resource freshness and sanitized failures for balances, positions, regular orders, algorithmic orders, and the user-data stream.
- Route each new configuration, account-sync, user-data-stream, and trading failure through the existing sliding notification system with deduplication, while retaining the detailed blocking status in the relevant trading UI.
- Keep the order ticket disabled only while a disclosed readiness condition is unmet: disconnected transport, operator pause, non-trading contract, missing exchange filters, unavailable account state, invalid sizing, insufficient available USDT, or the configured per-order notional ceiling.
- Maintain an account-wide order snapshot and merge regular and algorithmic orders without replacing unrelated symbols during a symbol-scoped refresh; show supported exchange-created orders in both the sidebar and chart.
- Remove the visual MARK series and MARK price line from the chart while retaining mark-price data for account/risk calculations and non-chart status where required.
- Add bounded-tape controls for emission timeout and minimum displayed trade notional in USDT. Validate the settings and apply filtering/coalescing before renderer delivery so the controls reduce IPC, parsing, state updates, and React rendering rather than merely hiding rows.
- Preserve the existing operator pause and optional maximum-order-notional protections; this change does not bypass exchange permissions or local risk controls.

## Capabilities

### New Capabilities

- `futures-live-readiness`: Production-only credential preflight, fail-fast startup, observable account synchronization, sliding error alerts, and explicit order-ticket readiness reasons.
- `futures-order-visibility`: Account-wide regular and algorithmic order synchronization and consistent chart/sidebar presentation.
- `futures-workstation-presentation`: Persisted Spot/Futures startup selection with lazy market initialization, MARK overlay removal, and configurable bounded-tape throttling/filtering.

### Modified Capabilities

None; this repository has no baseline OpenSpec capability specifications yet.

## Impact

- Electron account/execution integration: `electron/services/binance-connection.js` and `electron/services/futures-trading-adapter.js`.
- Shared startup and Spot/Futures lifecycle: `src/App.jsx`, `DataProvider`, local WebSocket ownership, storage, lazy component boundaries, and cleanup of inactive subscriptions.
- Renderer account state, notification bridging, and readiness: `src/hooks/useFuturesTrading.js`, `NotificationProvider`/`NotificationToast`, `FuturesTradingTicket`, `FuturesWorkstationView`, and `FuturesProductionWorkstation`.
- Workstation stream protocol and service: request parsing, IPC transport, trade emission, timers, and their tests.
- Chart and tape presentation: `FuturesWorkstationChart`, workstation styling, accessibility labels, tests, and futures operator documentation.
- Binance USDⓈ-M REST/user-data contracts, including regular and algorithmic open-order endpoints; no new runtime package is required.
- Removal of runtime MOCK also affects Spot startup/execution and deletes synthetic initial data from `DataProvider`; test-only mocks remain available.
- GitNexus reports CRITICAL impact for account refresh and tape emission, HIGH impact for readiness/view changes, and MEDIUM impact around shared notifications, so implementation requires contract tests plus integration/regression coverage before any live use.
