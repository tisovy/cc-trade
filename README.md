# CC-Trade

A modern cryptocurrency trading terminal built with React, Vite, and Electron. Features real-time charting, order book visualization, and Binance API integration. Licensed under GPL-3.0; see `LICENSE` for full terms.

![Version](https://img.shields.io/badge/version-0.5.1-blue)

## Features

- **Real-time Charts** — Candlestick charts with SMA, volume, and VPVR overlays using lightweight-charts
- **Multi-chart Dashboard** — 8 mini-charts in a 4×2 grid with per-chart interval controls
- **Order Book** — Aggregated depth view with precision controls and quick order shortcuts
- **Activity Panel** — Top movers per interval with configurable volume filters
- **Live Trades** — Real-time trade feed with throttling controls
- **Order Management** — Place and cancel orders directly from the interface
- **Drawing Tools** — Horizontal lines, trend lines, and measurement tools
- **Mock Mode** — Runs with synthetic data when API keys aren't configured

## Prerequisites

- Node.js `^22.12.0 || >=24.0.0` (Node 24 LTS recommended for development)
- npm or yarn
- Binance API keys (optional — app runs in mock mode without them)

## Installation

```bash
# Clone the repository
git clone https://github.com/tisovy/cc-trade.git
cd cc-trade

# Install dependencies
npm install
```

## Development

All development and integration work is committed directly to `master`. Do not
create feature branches or additional Git worktrees for this repository. See
[Repository workflow](docs/repository_workflow.md) for the mandatory checks.

```bash
# Start the Vite dev server (web mode)
npm run dev

# Start Electron with the normal operator configuration. This enables the
# reviewed public-read Futures Production transport; if BK is
# configured, Spot may also connect to real market-data/account endpoints.
npm run e

# Start Electron persistently with credentials cleared and deterministic fakes
npm run e:safe

# Run the bounded fake-only Electron readiness smoke (exits automatically)
npm run e:smoke
```

The app will be available at `http://localhost:5174` in web mode.

Futures Testnet was retired on 2026-07-16 and is not part of the runtime or
verification build. Its recovery manifest is in
[`archive/futures-testnet/`](archive/futures-testnet/README.md).

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BK` | Binance API Key | — |
| `BS` | Binance API Secret | — |
| `WS_PORT` | WebSocket server port | `14477` |
| `LOG_LEVEL` | Logging verbosity (`error`, `warn`, `info`, `debug`) | `info` |
| `ANALYTICS_URL` | Analytics service URL | — |
| `ANALYTICS_KEY` | Analytics API key | — |
| `ANALYTICS_SECRET` | Analytics HMAC secret | — |

> **Note:** API secrets are read from environment variables and never hardcoded. See [docs/backend.md](docs/backend.md) for key management details.

If you create a `.env` file locally, keep it untracked (already covered by `.gitignore`) or add a scrubbed `.env.example` before publishing.

## Building

```bash
# Build for production
npm run build

# Build Electron distributables (runs a fresh production build first)
npm run dist
```

Distributables are written to `release/`, separately from the renderer build in
`dist/`. Packaging includes only built first-party runtime files and production
dependencies; local `.env` files, source, tests, OpenSpec and archives are not
application resources. Supply runtime credentials through the launch environment,
not files placed inside the distribution.

The packaging hook checks the actual `app.asar`, including every renderer build
asset and the production main/preload. For a local Linux directory package
without publishing or starting the app:

```bash
npm run dist -- --linux --dir --publish never
npm run check:packaged-app -- "$PWD/release/linux-unpacked/resources/app.asar"
```

The standalone archive check verifies its manifest, entry assets and allowed
contents; the packaging hook additionally compares the full renderer build
inventory, including lazy chunks. Neither check proves a launched window:
packaged-window acceptance remains a separate operator check.

## Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run the supported aggregate verification
# (Vitest, lint, normal build, and retained static safety gates)
npm run test:all
```

## Project Structure

```
├── docs/               # Project documentation
├── electron/           # Electron main process & services
│   └── services/       # Binance connection, WebSocket server
├── server/             # Analytics metrics engine
├── src/
│   ├── components/     # React components
│   ├── context/        # React contexts (Data, Notifications)
│   ├── hooks/          # Custom hooks (useWebSocket, etc.)
│   ├── styles/         # Global styles
│   └── utils/          # Utility functions
```

## Documentation

Detailed documentation is available in the [`docs/`](docs/) folder:

| Document | Description |
|----------|-------------|
| [architecture.md](docs/architecture.md) | WebSocket system and data flow |
| [components.md](docs/components.md) | UI component reference |
| [backend.md](docs/backend.md) | Electron main process and Binance integration |
| [tests.md](docs/tests.md) | Testing strategy and coverage |
| [known_issues.md](docs/known_issues.md) | Current quirks and technical debt |
| [future_features.md](docs/future_features.md) | Roadmap items |

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). You may copy, modify, and distribute under the GPL-3.0 terms. Commercial use must respect copyleft requirements.
