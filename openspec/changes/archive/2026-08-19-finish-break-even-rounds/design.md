## Context

The trade-round fold must infer position state from a bounded fill window. It tentatively reads a zero-PnL first fill as opening an opposite position unless later same-side PnL proves it was closing an older one. In the target sequence the evidence arrives on the opposite side: the tentative position predicts non-zero realized PnL, but Binance reports zero because the fill actually added to the original position.

## Goals / Non-Goals

**Goals:**

- Reconsider only an ambiguous first round that has not been seen from flat.
- Preserve the initial break-even close, later addition, final close and reported PnL in one real round.
- Keep real reversals and hedge-leg boundaries unchanged.

**Non-Goals:**

- Infer a standalone break-even close when no later fill provides evidence.
- Repair the broader hedge-account folding limitation.
- Recompute or challenge exchange-reported realized PnL.

## Decisions

An initial zero-PnL tentative round will retain an `ambiguousWindowEdge` marker only when the walk has not seen that contract/leg flat and the existing same-side lookahead found no proof. Before applying its first opposite-side reducing fill, the fold will calculate the PnL for the quantity that fill would reduce, using the tentative held average and the existing notional-relative tolerance. A materially non-zero prediction paired with exchange-reported zero disproves the tentative interpretation. A consistent reducing fill, an observed flat boundary or a contract/leg change clears the marker permanently.

On disproval, the round will be restarted in place as a partial close of the original position: the tentative entry quantities/notional become exit quantities/notional, their already-counted fees and fill count stay counted exactly once, the position side is reversed, and the disproving zero-PnL fill is applied as an addition to the original position. The round enters an explicit `adding-after-edge-close` phase. The first later fill on the closing side moves it to `reclosing`; further closing-side fills stay in the same partial round and retain their reported PnL. If another addition arrives after `reclosing` has begun, the partial round is finished before that addition opens the next round, matching the existing boundary used for a pre-window close followed by a new position.

A restarted partial round has both pre-window quantity and in-window additions, so its aggregate entry cannot be taken only from the additions. It will be marked as requiring an implied aggregate entry: finish-time recovery uses total exit notional, total reported realized PnL and total closed quantity, while the additions remain in the round's closed size, fill count and fees. This preserves the exchange total instead of mixing it with an invented short.

The marker is cleared when the walk observes flat, when reported PnL is consistent with a real reversal, or when the contract/position leg changes. The existing same-side lookahead remains the first and cheaper proof path.

## Risks / Trade-offs

- [A genuine zero-PnL reduction could trigger reconsideration through rounding] → Require the tentative position to predict PnL outside the existing notional-relative tolerance.
- [Partial rounds with additions could swallow a later new position] → Use explicit `adding-after-edge-close` and `reclosing` transitions and finish the partial round before an addition that follows the reclose run.
- [Restarting could count an early fill or fee twice] → Reclassify accumulated quantities/notional in place and preserve the existing fill/fee counters rather than replaying the rows.
- [Recovered entry can be distorted by bad exchange PnL] → Keep the current rule that exchange-reported PnL is authoritative and add mirror/guard cases for both directions.
