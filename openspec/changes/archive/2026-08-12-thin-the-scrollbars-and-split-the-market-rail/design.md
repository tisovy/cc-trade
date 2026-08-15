## Context

See `proposal.md` for motivation and the delta spec for observable behavior.
On desktop, `FuturesWorkstation.css` owns the market rail through two adjacent
grid rows: the chart spans both while the order book and tape occupy one each.
Those rows currently use `1.15fr` and `1fr`, so their content changes do not move
the separator, but the resulting split is roughly 53/47 rather than 65/35.

The tape already scrolls inside `.futures-workstation-trade-rows`, and each
portfolio panel already delegates both axes to
`.futures-workstation-dock-table`. The scroll ownership is correct; only the
native chrome is unstyled. Electron 39's Chromium renderer is the deployment
target, while the stylesheet should retain a standards-based fallback.

## Goals / Non-Goals

**Goals:**

- Express the requested ratio in the grid tracks that own the complete panels,
  including their headings and padding.
- Keep the existing overflow owners and DOM structure intact.
- Scope compact scrollbar chrome to the tape and portfolio tables shown in the
  report.
- Make the styling verifiable without relying only on subjective screenshots.

**Non-Goals:**

- Changing the mobile single-column layout, workstation/dock total height, or
  the amount of market data delivered by the service.
- Hiding required horizontal overflow, adding virtualized lists, or changing
  order-book row measurement.
- Restyling the contract selector, execution-ticket body, or unrelated app
  scroll containers.

## Decisions

### Use fractional grid tracks for the panel split

The desktop track pair will use `minmax(0, 65fr)` and `minmax(0, 35fr)`.
Fractional tracks divide the exact space left after the fixed header, identity,
dock, and one-pixel grid gap. This avoids the overflow that `65% 35%` can create
when a gap is added and retains the existing zero minimum that prevents a short
window from making one panel paint over the other.

Alternative considered: flex-wrap the two asides in a new rail container. That
would require JSX/DOM and grid-area changes for a ratio the existing grid already
owns, increasing regression risk without improving behavior.

### Style only the existing scroll owners

One shared CSS rule group will target the trade-row list and dock tables. It
will set a transparent track/corner, a rounded neutral thumb, a stronger hover
thumb, and suppress native scrollbar buttons. Chromium pseudo-elements will
set both axes to 6px; standard scrollbar color/thin declarations will provide a
fallback where the pseudo-elements are unavailable.

Alternative considered: apply a scrollbar theme to the whole workstation.
That would alter unrelated contract and ticket scroll areas not identified in
the report and make the visual change broader than necessary.

### Verify the presentation contract in focused component tests

The existing suites already read `FuturesWorkstation.css` for layout contracts.
Focused assertions will check the desktop 65/35 tracks, the two scoped overflow
owners, 6px Chromium dimensions, transparent track/button treatment, and hover
thumb rule. Runtime inspection at representative desktop heights will confirm
that computed tracks preserve the ratio and both lists still scroll.

Alternative considered: screenshot-only coverage. Screenshots are useful for
the final audit but are less precise about ratios and can pass despite a
platform-native scrollbar returning later.

## Risks / Trade-offs

- [The 35-percent tape shows fewer rows] → Keep the list independently
  scrollable; this is the requested prioritization rather than data loss.
- [A 6px thumb is a smaller pointer target] → Retain wheel, touchpad, keyboard,
  and drag behavior, keep the thumb high-contrast, and give it a visible hover
  state instead of making it disappear until hover.
- [Scrollbar pseudo-element support differs outside Electron] → Pair the exact
  Chromium styling with standard thin/color fallbacks and audit the supported
  Electron renderer.
- [A later broad scrollbar rule could override the scoped theme] → Keep focused
  contract assertions on selectors and dimensions near the owning rules.

## Migration Plan

Ship as a CSS-only presentation change with focused tests. No persisted state,
data migration, or staged rollout is required. Rollback consists of restoring
the previous fractional tracks and removing the scoped scrollbar rule group.
