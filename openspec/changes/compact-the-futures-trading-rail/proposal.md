## Why

The Futures workstation spends scarce vertical space on one-contract-per-row recency, duplicated readiness/status chrome, redundant table headings, always-open tape settings, and acknowledgements that repeat information already available at the point of action. This makes the actual market and order controls harder to scan and forces more scrolling in the narrow Electron layout.

## What Changes

- Present recently selected contracts as a compact wrapping group of selectable pills, so several ordinary USDⓈ-M symbols fit on one line while persisted recency, selection, and favorite access remain intact. The active starting contract seeds an otherwise empty history. With no search query, this group is the only contract list; the ordinary catalogue appears only as one unified list of active search results.
- Make the workstation identity bar the single routine state location: while authenticated account resources are synchronizing it shows `SYNC` in place of `LIVE`; remove the duplicate contract-section state and the ticket's `READY`/reason plus `Pause trading` header.
- Keep the percentage slider and its percentage/USDT readout, but remove the five percentage anchor buttons and the derived `Quantity` row. Exact exchange quantity remains enforced and remains visible in the order confirmation.
- Remove the mouse-shortcut help block, the passive `Awaiting shortcut`/last-action label, successful submission feedback, cancellation acknowledgements, and the passive last-execution acknowledgement card.
- Remove the visible `Price`/`USDT`/`Total` order-book headings and `Price`/`USDT`/`Time` tape headings while retaining an accessible name for every numeric row.
- Reduce the last-print separator to the coloured price alone: remove both divider lines, the direction arrow, and the visible `LAST` label, and trim its vertical margin and padding by a couple of pixels without changing the price source.
- Put the tape pause/filter/settings controls behind a click-to-open section that is collapsed by default; keep the aggregate-trade rows visible when the settings are closed.
- Preserve safety-critical disclosure: disabled actions still expose their blocking reason, and locally unsent actions, exchange rejections, unresolved command outcomes, account synchronization failures, and their retry paths remain visible. Trading gates and command behavior do not change.
- Update component tests and responsive styling to lock in the compact hierarchy and the `LIVE`/`SYNC` transition without weakening order-entry safety coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: changes the visual organization of recent contracts, consolidates routine synchronization state in the workstation identity, removes redundant order-ticket controls and passive status chrome, and compacts the order-book/tape surfaces.

## Impact

- Renderer components: `FuturesWorkstationView`, `FuturesProductionWorkstation`, and `FuturesTradingTicket`.
- Renderer styling: `FuturesWorkstation.css` and `FuturesProductionExecutionTicket.css`.
- Tests: Futures workstation view/production integration tests and trading-ticket interaction tests.
- No Electron main-process, Binance adapter, IPC/protocol, persistence format, trading gate, or order-command semantics change.
- GitNexus preflight reports MEDIUM upstream risk for `FuturesWorkstationView` (six direct dependants, one affected production flow) and LOW risk for `FuturesTradingTicket` and `FuturesProductionWorkstation`; no HIGH or CRITICAL risk was found.
