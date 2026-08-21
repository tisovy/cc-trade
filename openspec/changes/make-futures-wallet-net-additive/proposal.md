## Why

One contract-level funding entry can currently be copied into multiple overlapping rounds or both hedge legs and then included in every displayed Net. Commission rebates are read but discarded from Closed Positions, so the figures labelled as wallet outcomes are neither additive nor complete.

## What Changes

- Separate leg-owned fill components from contract-shared income components.
- Attribute realized PnL and gross fill commission to a leg/round; attach rebate credits by reliable `tradeId` when possible.
- Keep funding, insurance clear, and un-attributable rebates in a single contract-level bucket instead of duplicating them across rows.
- Enforce a ledger-conservation invariant: every canonical income entry contributes to an additive aggregate at most once.
- Give trade, commission, and income components independent completeness states; only a fully covered result may be called wallet Net.
- Present partial, shared, multi-asset, and non-USDT amounts accessibly without relying on hover-only titles.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: define ownership, completeness, and conservation for open and closed Futures money components.
- `futures-workstation-presentation`: make shared, partial, and multi-asset results visible and accurately labelled.

## Impact

Affected areas include income normalization, `futuresSettledMoney`, `attachFuturesRoundIncome`, Closed Positions row totals/tooltips, open-position settled totals, and probes/tests. This change depends on leg identity from `make-futures-rounds-leg-and-window-correct` for full hedge-mode attribution.
