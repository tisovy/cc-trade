## Why

One contract-level funding entry can currently be copied into multiple overlapping rounds or both hedge legs and then included in every displayed Net. Commission rebates are read but discarded from Closed Positions, so the figures labelled as wallet outcomes are neither additive nor complete.

## What Changes

- Separate leg-owned fill components from contract-shared income components.
- Attribute realized PnL and gross fill commission to a leg/round; attach rebate credits by reliable `tradeId` when possible.
- Keep funding, insurance clear, and un-attributable rebates in a single contract-level bucket instead of duplicating them across rows.
- Enforce a ledger-conservation invariant: every canonical income entry contributes to an additive aggregate at most once.
- Independently conserve each deduplicated canonical fill quantity against exact round assignments before a round can contribute an exact wallet Net.
- Deduplicate contradictory payload evidence by complete signature so repeated delivery cannot change conflict audit cardinality or retain unbounded duplicate payloads.
- Carry a deterministic identity-conflict qualification on the selected representative of a contradictory shared bucket, so neither open nor Closed UI presents that amount as ordinary Shared money.
- Give trade, commission, and income components independent completeness states; only a fully covered result may be called wallet Net.
- Present partial, shared, multi-asset, and non-USDT amounts accessibly without relying on hover-only titles.
- Give each shared-adjustment row one compact scope identity that remains stable as bucket membership grows, preserving focus without sorting every entry identity during render.
- Summarize each shared bucket's component kinds during ledger reconciliation so open and Closed renderers do not rescan a lane-sized member list, and show unattributed/reliable-identity qualifications plus movement type on both surfaces.
- Recompute wallet ownership only when the canonical settled-money generation/digest changes; observation clocks and unrelated account state may update presentation metadata without folding up to six retained lanes again or replacing stable open-row props.
- Canonicalize the position snapshot signature by semantic position tuple, so exchange-only array reordering does not refold rounds or replace stable wallet/UI identities.
- Count settled-read reach by unique contract symbol and distinguish another hedge leg of the same contract from another contract in empty-position explanations.
- Use each round's exchange-reported settlement asset for realized PnL and fee fallback, so USDC-settled rounds reconcile as one USDC wallet result rather than a fictitious USDT/USDC split.
- Derive open/closed shared presentation scope only from fill or interval evidence: include interval-matched unresolved closed rounds, while keeping entries outside every round interval global instead of guessing a symbol-only owner.
- Preserve every round touched by a reversal fill when a rebate names that fill, and keep late symbol-scoped credits visible once while qualifying every plausible round instead of leaving a false exact NET.
- Ignore exactly zero auxiliary-asset net balances when deciding `MULTI_ASSET`, while retaining every underlying ledger entry and per-asset conservation evidence.
- Move the maintained read-only settlement probe onto the same canonical trade-round index and wallet ledger as production, preserving each fill's `marginAsset` and reporting owned/shared totals per asset without the legacy time-overlap funding attachment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: define ownership, completeness, and conservation for open and closed Futures money components.
- `futures-workstation-presentation`: make shared, partial, and multi-asset results visible and accurately labelled.

## Impact

Affected areas include income normalization, `futuresSettledMoney`, `attachFuturesRoundIncome`, per-round settlement-asset propagation, Closed Positions row totals/tooltips, open-position settled totals, and probes/tests. The maintained probe becomes a canonical consumer rather than another caller of `attachFuturesRoundIncome`. GitNexus reports HIGH risk at round aggregation; this change depends on leg and settlement-asset evidence from `make-futures-rounds-leg-and-window-correct` for full attribution.
