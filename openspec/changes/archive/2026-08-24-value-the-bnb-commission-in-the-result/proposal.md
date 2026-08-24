# Value the BNB commission in the result

## Why

On 2026-08-24 the operator transferred 1 BNB to the USDⓈ-M Futures wallet and
enabled the BNB fee discount. From that moment every Futures commission on
this account is charged in BNB at a 10% discount: `userTrades` fills carry
`commissionAsset: "BNB"` with the discounted amount, and the income record's
`COMMISSION` rows carry `asset: "BNB"`. Funding, realized PnL and insurance
stay in the settlement asset (USDT). The BNB balance in the Futures wallet
drains with each fee; when it runs out, Binance silently reverts to charging
USDT without the discount — so both fee shapes can appear in one window.

The desk is already *truthful* about a foreign-asset fee and deliberately so:
`close-a-round-at-what-reached-the-wallet` proved that subtracting a BNB
quantity from a USDT result produced a row claiming a five-USDT fee cost less
than a cent, and fixed it by keeping non-settlement-asset commissions out of
the USDT net — stated in BNB on the element with "not included", carried in
`round.feesByAsset`, and conserved per-asset by the wallet-net fold. Those
rows were `N/A BY OPERATOR` while this account paid USDT fees. That N/A
flipped on 2026-08-24: from the next fill onward every closed round and every
open position's settled money will state its commission as BNB "not
included", the USDT PnL/Net columns will stop reflecting commission at all,
and the desk's rows will drift from the Binance app's by exactly the fee of
every round. Truthful, and useless for the operator's arithmetic.

## What Changes

- A commission charged in BNB is *valued* in the settlement asset and included
  in the round's net and the open position's settled money: the BNB amount is
  converted at the BNBUSDT price of the charge's own time (the fill's or the
  income row's timestamp), read from the desk's market data at minute
  resolution and cached, never from a guessed fee tier.
- The element's title names both quantities: the BNB amount as charged, and
  the USDT valuation with the price it used — the column stays one number,
  the decomposition stays exact, and a valuation whose price read failed
  degrades to today's "not included" statement rather than to a wrong number.
  **Operator ruling, 2026-08-24 evening, from a screenshot of the interim
  state** (a PnL cell reading `0.00 USDT` over `−0.0011811 BNB`): "не надо
  это показывать" — the row face never renders the BNB quantity as a second
  line; one USDT number on the face, the BNB decomposition in the title
  only. The same ruling as `name-the-quantity-not-the-column`, third time.
- **A fee-reserve readout, from the same ruling**: "лучше где-то показывать
  общий запас оставшегося BNB комсы и помечать его если его становится мало
  <50 USDT эквивалент." The desk shows, once and globally (not per row), the
  Futures wallet's remaining BNB fee reserve — the BNB amount and its worth
  at the current BNBUSDT price — and marks it as low when that worth falls
  below 50 USDT equivalent. The mark matters because Binance's fallback is
  silent: an empty reserve reverts fees to undiscounted USDT with no
  announcement, and the low mark is the desk's only warning ahead of it.
- Mixed windows are first-class: a round whose fills paid partly in USDT and
  partly in BNB (the BNB balance ran out mid-window) sums the USDT fees
  exactly and values only the BNB part.
- The first live BNB-fee round is compared against the Binance app before the
  operator gate closes: whether the app's "Реализ. PnL" folds the converted
  BNB fee into its own figure decides nothing about the desk's arithmetic,
  but it decides what "agrees with the app" means in the ledger, and it must
  be recorded, not assumed.

## Non-goals

Multi-Assets mode stays off and BNB stays a fee asset, not collateral — the
desk does not value the wallet's BNB balance into margin or free-balance
figures. The 10% discount itself is Binance's arithmetic, not the desk's: the
desk values what was actually charged and never recomputes what the fee
"should have been".
