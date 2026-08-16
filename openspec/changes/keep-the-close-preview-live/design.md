## Context

See `proposal.md` for the defect. The renderer already receives a live positions
array whose rows have been merged with the mark/last-trade feed. The portfolio
dock renders that array directly. The workstation instead stores the entire row
object when opening the close panel, so subsequent array replacements never
reach the panel.

The merged position distinguishes `markPrice` (the confirmed exchange mark)
from `valuationPrice` (the price currently used for the visible position value:
the newer last trade between marks, otherwise the mark). The close panel already
owns local draft state for order type, size and limit price; valuation updates
must not remount it or recreate those drafts.

## Goals / Non-Goals

**Goals:**

- Keep the open close panel bound to the latest row for the same position.
- Price a market-close preview from the same current valuation as the position
  surface, including between-mark last-trade estimates.
- Preserve operator-owned size, order-type and limit-price drafts while live
  position props change.
- Keep current quantity validation and reduce-only submission semantics.

**Non-Goals:**

- Changing the market/mark WebSocket feeds, their repaint cadence, or account
  synchronization.
- Predicting market-order slippage, fees, or order-book execution.
- Re-pricing a limit-close preview from the market after the operator has set its
  limit price.

## Decisions

### Resolve the panel target in the workstation container

The workstation will retain the row and anchor that opened the panel, then
derive the rendered target from the current `executionState.positions` using the
position's stable symbol and exchange position-side identity. The opening row is
the fallback when a matching live array is temporarily unavailable.

This mirrors the existing live-target pattern used by the position-margin
editor and keeps account-state selection in the container that owns that state.
Passing the whole positions array into the close panel was rejected because it
would make the leaf component responsible for account identity and availability.

The panel key remains based on position identity, not on the row object or its
valuation. Therefore a price update rerenders the existing panel instead of
remounting it and discarding local draft state.

### Use the position's resolved valuation only for market mode

For a market preview the close panel will use `valuationPrice` when present and
fall back to `markPrice` for position sources that predate or do not carry the
resolved field. That is the same price selection already embodied in the
position row's live PnL and makes full-size close arithmetic agree with the row.

For limit mode the normalized operator-entered price remains the exit price.
Live changes to entry price or quantity still rerender and revalidate the
preview, but market ticks cannot overwrite the limit draft.

Reading `unrealizedPnl` directly was rejected because the close panel must also
price partial sizes; recomputing from entry, selected size and the shared
valuation works for both full and partial closes.

### Keep draft state local and validate it against live props

The existing React state for size and limit price remains initialized once per
position identity. A valuation-only prop update changes derived output only.
If the live open quantity changes, the existing derivation validates the held
draft against that current quantity and updates `Leaves` without silently
rewriting what the operator typed.

## Risks / Trade-offs

- [The close panel now rerenders at the bounded live-valuation cadence] → The
  work is limited to the already-open panel and a small set of arithmetic/string
  derivations; no new subscription or workspace-wide state update is added.
- [A temporarily missing live row falls back to the opening snapshot] → Existing
  reduce-only semantics remain the execution safety boundary, while transient
  account-read gaps do not make the panel disappear mid-decision.
- [The current valuation is still only an estimate of market execution] → The
  panel retains its estimated wording and tooltip; no claim of fill-price
  certainty is introduced.

## Migration Plan

No data or protocol migration is required. Deploy the renderer change with its
focused tests. Rollback consists of reverting the live target resolution and
`valuationPrice` selection; server-side state is unaffected.
