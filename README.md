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

- Node.js 18+
- npm or yarn
- Binance API keys (optional — app runs in mock mode without them)

## Installation

```bash
# Clone the repository
git clone https://github.com/<your-org>/cc-trade.git
cd cc-trade

# Install dependencies
npm install
```

## Development

```bash
# Start the Vite dev server (web mode)
npm run dev

# Start with Electron
npm run e
```

The app will be available at `http://localhost:5174` in web mode.

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

# Build Electron distributables
npm run dist
```

## Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run E2E tests (Playwright)
npm run test:e2e

# Run all tests
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
└── tests/              # E2E tests
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
