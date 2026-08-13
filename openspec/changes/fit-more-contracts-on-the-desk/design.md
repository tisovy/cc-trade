## Context

See `proposal.md` for motivation. The futures view currently receives a persisted
numeric scale from its production container and applies it through
`--fx-ui-scale`; the shared clamp stops at 85%. Recent contracts are persisted in
the existing symbol-history record, rendered as flex-wrapped pills, and use a
favorite toggle as the pill's secondary action. Search results already retain a
separate favorite control.

The change crosses a state utility, the production container, the presentational
view, and CSS. The local-storage schema and the Electron window-zoom path are
already stable and do not need a migration.

## Goals / Non-Goals

**Goals:**

- Preserve the current five-point scale interaction while adding three smaller
  persisted values.
- Make pill density deterministic at the workstation width and keep long symbols
  operable.
- Give recent-history removal one pure state transition and keep selection and
  favorite mutations independent.

**Non-Goals:**

- Replacing Electron's application-wide keyboard zoom or changing its bounds.
- Removing favorite support from catalogue search and quick switching.
- Redesigning the overall workstation grid, order book, ticket, or portfolio dock.
- Implementing the additional visual-hierarchy and scrolling recommendations
  raised during the UI review.

## Decisions

### Extend the existing scale domain to 70%

`UI_SCALE_MIN` will move from `0.85` to `0.70`; the step, default, maximum,
storage key, and clamp/write path stay unchanged. Existing stored values remain
valid, and older or out-of-range values continue to normalize through the same
function.

An Electron zoom bridge was considered because it changes every pixel, but that
would duplicate the persisted window-zoom feature and turn a focused workstation
control into a cross-process API change. This change extends the control the
operator identified while leaving the independent whole-window shortcut intact.

### Remove recency through a pure symbol-history operation

A `removeFuturesRecentSymbol(history, symbol)` utility will normalize the input,
remove it only from `recent`, preserve `favorites`, and preserve `lastSymbol`
unless the removed value owns it, in which case the next recent symbol (or null)
becomes the fallback. The production container will expose a memoized handler to
the view; its existing persistence effect will store the result.

Mutating the array directly in the view was rejected because it would bypass the
history invariants and make persistence behavior harder to prove. Reusing the
favorite toggle was rejected because an unfilled star does not describe removal
and would couple two independent operator intents.

### Protect the selected contract at the interaction boundary

Every recent pill will render an `×` button, but the selected pill's button will
be disabled and carry an accessible explanation. The removal utility remains
defensive for direct callers, while the UI prevents the confusing state where the
market being traded is absent from its only idle contract list.

Allowing selected removal and immediately choosing another market was rejected
because a cleanup action must not switch live trading context. Allowing selected
removal without switching was rejected because startup restoration would either
reinsert the contract or silently reopen on a different one.

### Use a three-track grid and constrain content inside each track

The recent group will use `grid-template-columns: repeat(3, minmax(0, 1fr))`.
Each pill and selection button will have a zero minimum width; the symbol will
ellipsis rather than expanding its track, with the full symbol retained in the
button's accessible name and title. The remove target will use a narrow fixed
track while preserving a practical minimum pill height.

Flex wrapping with calculated widths was considered, but borders, gaps, font
rounding, and long symbols can still cause a nominal third item to wrap. Explicit
grid tracks make three-per-row an invariant.

## Risks / Trade-offs

- [70% can be difficult to read on some displays] → Keep the choice opt-in,
  retain a one-action 100% reset, and do not change existing stored values.
- [Three-up pills reduce horizontal text space] → Ellipsize only visually and
  retain the complete symbol in title/accessibility text.
- [A narrower secondary action can become hard to target] → Keep the pill row at
  a practical minimum height, test the control independently, and use a visible
  `×` rather than an icon-font glyph.
- [Removed recency cannot be reconstructed automatically] → Removal is explicit;
  selecting or searching the contract adds it through the existing history path.

## Migration Plan

No data migration is required. Deploy the new clamp, removal transition,
container/view callback, and grid styling together. Existing `v1` UI-scale and
symbol-history records remain readable. Rollback restores the prior scale floor
and two-up presentation; any recency entries explicitly removed while the change
was active remain removed, as intended by the operator action.
