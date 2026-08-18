## Why

The Futures desk currently mixes the host-local clock with UTC-formatted chart labels, compresses a complete recent-contract row behind an unnecessary scrollbar, and spends a full header row on statistics that can fit beside the selected symbol. The trading ticket also presents an ordinary zero-size draft as an exchange-filter error even though the operator has simply not chosen a size yet.

## What Changes

- Format the Futures chart's time-axis and crosshair labels in the host system's local time so they agree with the visible workspace clock while preserving the underlying exchange timestamps.
- Let all nine recent-contract pills occupy their three complete rows whenever the instrument rail has the required height, and enable internal scrolling only when the rail is genuinely too short.
- Keep the selected-symbol identity at the left of the market header while arranging the seven market readings as compact paired rows beside it, rather than wrapping the entire reading block below the symbol.
- Keep an untouched zero-size ticket quiet while retaining disabled order actions and all actionable readiness, validation, and submission feedback.
- Preserve existing recent-contract styling and selection/removal behavior, exact-value tooltips, funding countdown behavior, responsive fallbacks, market data, and trading semantics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Define host-local chart time presentation, complete recent-contract rows without premature scrolling, quiet zero-size ticket state, and a compact two-row market-header composition.

## Impact

- React/chart composition: `src/components/features/futures/FuturesWorkstationChart.jsx`, `FuturesWorkstationView.jsx`, and `FuturesTradingTicket.jsx`.
- Workstation layout and visual semantics: `src/components/features/futures/FuturesWorkstation.css`.
- Focused Futures view/chart tests will be updated after production code, in accordance with repository implementation order.
- No backend, exchange protocol, persisted state, dependency, or public API changes are expected.
