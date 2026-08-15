## Context

See `proposal.md` for motivation and the two delta specs for observable behavior. The active workspace shell already owns the fixed centered market-mode switch, but it has no adjacent time reading. The narrow Futures execution ticket receives account-wide orders but not the workstation's symbol-selection callback; its rows deliberately reserve separate columns for compact symbol, side, price, USDT value, and action. Futures recency uses one shared limit throughout read, write, remember, removal, favorite ranking, and catalogue ordering. History orders already retain Binance `cumQuote` as `quoteQty`, while stream-folded rows can have `quoteQty` `0` and still carry executed quantity and average fill price.

GitNexus impact analysis reports LOW risk and no detected upstream callers or affected execution flows for `WorkspaceGateway`, `FuturesTradingTicket`, `FuturesProductionWorkstation`, and `FuturesHistoryPanel`. The recent-limit constant is not indexed as a symbol, so the read, write, remember, remove, favorite, search, and order helpers were analyzed individually; each also reports LOW risk.

## Goals / Non-Goals

**Goals:**

- Keep all four changes presentation-local and use existing workstation selection, persistence, precision, and history data paths.
- Make the time and money readings stable at supported desktop widths without increasing rail width or changing workspace height allocation.
- Preserve exact source values as accessible/hover detail whenever the visible compact value omits digits.
- Keep timer ownership explicit so switching, startup gating, and unmounting leave no background interval behind.

**Non-Goals:**

- Synchronizing the host clock, showing exchange/server time, choosing a timezone, or adding clock preferences.
- Changing the three-column recent-pill layout, storage key, favorites limit, or catalogue ranking semantics.
- Changing order normalization, Binance endpoints, history read bounds, or the meaning of working-order notional.
- Making whole order rows select symbols; only the explicit symbol control receives that behavior.

## Decisions

### Render one shell-owned local clock only for an active workspace

Add a small clock component beside the existing shell components and mount it from the active branch of `WorkspaceGateway`, immediately after the market-mode switch. It will construct its exact English display from `Intl.DateTimeFormat(...).formatToParts`, hold the current `Date` in state, refresh from a new host `Date` once per second, and clear its interval on unmount. A semantic `time` element will carry the ISO instant, while restrained fixed positioning, tabular numerals, and `pointer-events: none` keep it visually stable beneath the switch.

This is preferred over putting clocks in both workspaces because it avoids duplicate timers and guarantees identical Spot/Futures placement. CSS-generated content cannot read live time, and an exchange-time feed would incorrectly couple a local desktop reading to market connectivity.

### Route trading-rail symbol activation through the existing workstation callback

Pass `handleSymbolChange` into `FuturesTradingTicket` as `onSymbolChange`. Replace only the compact symbol text in each account-wide order row with a native button whose visible label remains the shortened base asset and whose accessible name/title use the full contract. The control will stop click and double-click propagation before invoking the callback, so it cannot open the row's double-click editor; native button keyboard behavior supplies Enter/Space activation.

This is preferred over making the whole row select because the row already owns edit semantics and the cancel button owns cancellation. A distinct link-like button makes the three actions unambiguous.

### Give the compact price a measured minimum track

Rebalance the five-column ticket grid by reducing horizontal gaps and flexible space assigned to the already-shortened symbol and USDT cells, then reserve a minimum price width sufficient for eight monospaced characters at default scale. Keep a single-line row, the fixed cancel track, and exact price detail on the price cell. Style the symbol button as a quiet underlined-on-hover link so it does not increase row height.

This is preferred over reducing the global font size, widening the rail, or allowing wrapping, all of which would reduce readability or disturb the surrounding workstation grid.

### Raise the single recency invariant from eight to nine

Change the shared recent-symbol limit to nine and leave every consumer on that constant. The storage key and data shape remain unchanged, so existing histories upgrade in place and future selections naturally occupy the previously empty third-row slot.

This is preferred over padding the grid with a placeholder or maintaining a separate render-only ninth item because selection, persistence, and display must agree on which contracts are recent.

### Prefer reported executed quote value and derive only when necessary

For each history order, derive a presentation record in this order: positive finite `quoteQty`; otherwise positive finite `executedQty × averagePrice`; otherwise absent. Show the result under `Filled USDT`, use a fixed two-decimal reading for ordinary amounts and the existing compact-USDT formatter for large amounts, and place the exact USDT value plus executed/original contract quantities in the cell title. The title will identify a fallback-derived value so exchange-reported and calculated readings are not silently conflated.

This is preferred over always multiplying contracts by average price because Binance already provides the authoritative cumulative quote for REST history. It is also preferred over changing normalization because the required source field is already retained and stream-folded fallback can be handled without widening transport scope.

### Verify production behavior before adding tests

Implementation will follow the repository override: production components, styles, and the recent limit are changed first. Tests are added or updated only after those production changes exist. Focused tests will cover clock formatting/ticking/cleanup, symbol activation isolation, the small-price CSS contract, nine-entry persistence/eviction, and reported/derived/absent filled-USDT values.

## Risks / Trade-offs

- [A one-second interval can tick slightly after the wall-clock boundary] → Every tick rereads `new Date()` instead of incrementing state, so it self-corrects and never accumulates drift.
- [A fixed clock can overlap content at unusually small window sizes] → Keep it inside the already reserved top shell band and add a compact small-width treatment if the existing mode switch breakpoint requires it.
- [The symbol button can accidentally trigger double-click edit] → Stop both click and double-click propagation and test selection against an edit spy.
- [Reserving price width can squeeze a very large USDT value] → Keep the existing compact notional formatter and full value tooltip; the action track remains fixed.
- [Changing the recency constant also changes favorite/alphabetic rank sentinels] → All relative ordering remains the same because every rank branch uses the same constant; test persisted order and tenth-symbol eviction.
- [Floating-point fallback multiplication can expose binary residue] → Format the visible value to money precision and keep a bounded exact decimal string in secondary detail.

## Migration Plan

1. Ship the renderer-only changes with the existing storage and normalized history shapes.
2. On first read after deployment, up to nine existing valid recent entries are accepted; histories with eight or fewer need no rewrite until the normal symbol-history path next saves them.
3. Rollback requires only reverting renderer code and the limit. A rollback will read the same storage key and truncate a nine-entry record back to the previous limit without corrupting other symbol-history fields.
