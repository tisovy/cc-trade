## Why

Bounded order-book delivery returns roughly 220 of 1,000 retained levels per
side, but `toRendererView` still fully sorts every retained price before it can
discard the unread tail. Selecting the bounded nearest subset first can remove
most of that remaining main-process cost while preserving the delivered bytes.

## What Changes

- Select only the nearest levels needed by a valid bounded range before fully
  ordering the selected subset for renderer delivery.
- Preserve the existing nearest-first bid and ask order, range edge, minimum
  level floor, maximum level limit, spread, and exact decimal-string semantics.
- Keep null, invalid, non-positive, and effectively unbounded ranges on the
  existing ceiling-delivery path.
- Leave retained-side trimming on its existing exact full-order path.
- Add deterministic regression and equivalence coverage, plus repeatable
  baseline/after measurements for bounded and unbounded views.
- Keep the payload shape, protocol version, renderer, and snapshot/diff behavior
  unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: bounded order-book delivery must avoid
  fully sorting an unread retained tail while remaining exactly equivalent to
  the established delivered view.

## Impact

- Production: `electron/services/futures-workstation-order-book.js`.
- Tests: `electron/services/futures-workstation-order-book.test.js`.
- Planning: this change takes ownership of the optimization recorded as
  `send-only-the-book-on-screen` task §6.1; that earlier change retains its own
  delivered behavior and live operator verification.
- No dependency, payload, protocol, renderer, account-state, chart, dock, or
  exchange-connection changes.
