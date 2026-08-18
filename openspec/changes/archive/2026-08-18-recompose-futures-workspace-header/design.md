## Context

See `proposal.md` for motivation and the delta spec for the observable contract. The mode switch and clock currently belong to `WorkspaceGateway` and use fixed viewport positioning, while the blue identity strip is rendered three component layers lower inside the Futures workstation grid. The Futures page also reserves 72 pixels of top padding and paints the exposed area with the production-red background.

The local clock owns its one-second timer. Moving its rendered element must not lift that state into the high-frequency Futures view or make market-data updates responsible for timekeeping.

## Goals / Non-Goals

**Goals:**

- Give Futures one explicit chrome composition: identity strip, overlaid market switch, then a reserved clock row.
- Keep the clock timer isolated in `MarketClock` and preserve existing switch semantics and availability states.
- Let the header remain usable across the existing responsive breakpoint without relying on viewport-fixed offsets.
- Keep the change local to renderer composition and CSS.

**Non-Goals:**

- Redesigning the Spot workspace header or neutral workspace selector.
- Changing Futures identity text, readiness states, interface scaling, trading data, or activation behavior.
- Removing the production-red treatment from areas around or below the workstation.

## Decisions

### Pass the clock as a composed React node into the Futures workstation

`WorkspaceGateway` will continue to create `MarketClock`, but for an active, acknowledged Futures workspace it will pass the clock node through `FuturesWorkspace` and `FuturesProductionWorkstation` to `FuturesWorkstationView`. The view will render it in a dedicated grid row immediately after the identity strip. Spot and activation-loading states will keep the current app-level clock placement.

This keeps the timer self-contained and gives the Futures grid real layout ownership of the clock. A viewport-fixed clock plus an empty spacer row was rejected because it would only look embedded at one scroll position and would make the visual order depend on duplicated pixel offsets.

### Keep the market switch app-owned and overlay it through mode-scoped CSS

The switch remains a direct app child so it is continuously available while market activation is changing. Futures-mode CSS will position it absolutely/fixed at the top center over the identity strip; Spot retains its existing placement. The identity strip will reserve a safe center zone at desktop widths and use a taller responsive layout when the available width cannot hold left identity, center switch, and right scale controls on one line.

Passing the switch into the lazy Futures workspace was rejected because it would disappear during the activation acknowledgement and lazy-loading interval—the exact moment an operator may want to reverse the selection.

### Make the Futures top offset structural rather than decorative

The Futures page will drop its 72-pixel top padding so the workstation begins at the window's top edge. The workstation grid will gain a named clock row between identity and the existing instrument/market header row. The shell's top corners and outer spacing will be adjusted so no production-red surface appears above the blue strip while the current bounded desktop width and lower-page background remain intact.

### Test DOM ownership and style contracts after implementation

Renderer tests will assert that the Futures clock is inside the workstation, follows the identity strip, and coexists with the app-owned market switch. A focused CSS contract test will protect the zero top inset, overlay positioning, and dedicated grid area. Existing timer behavior tests remain the source of truth for exact local-time formatting and cleanup.

## Risks / Trade-offs

- [The center switch can collide with identity or scale controls in narrow windows] → Reserve center space on desktop and use the existing responsive breakpoint to grow/wrap the strip before collision.
- [Moving the clock through memoized component boundaries could cause needless workstation rerenders] → Pass the self-updating clock as a React node; its internal state update rerenders the clock subtree, not the parent workstation.
- [The clock may disappear briefly while Futures activation is pending] → Keep the app-level clock for loading states and move it into the grid only after the Futures workspace mounts.
- [CSS used by the neutral selector shares market-switch class names] → Scope Futures overlay overrides under the active Futures mode and preserve the selector's existing static override.

## Migration Plan

Ship as a renderer-only layout change with no stored-data or protocol migration. Roll back the React composition and CSS together if visual verification finds an unsupported-window collision; no persisted user state requires cleanup.
