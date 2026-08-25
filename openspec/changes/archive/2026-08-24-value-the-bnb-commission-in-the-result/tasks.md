# Tasks

## 1. Facts before code

- [x] 1.1 Mechanics confirmed 2026-08-24: BNB in the USDⓈ-M wallet + the
      discount toggle → fees charged in BNB at 10% off; `userTrades` carries
      `commissionAsset: "BNB"` with the discounted amount; income `COMMISSION`
      rows carry `asset: "BNB"`; funding/realized/insurance stay USDT; an
      empty BNB balance silently reverts fees to USDT without the discount.
- [x] 1.2 (confirmed live 2026-08-25 — ledger, «B3 answered»; income-row asset recorded as unread-by-design) Verify on the wire with the account's own first BNB-fee fill: the
      `commissionAsset` and amount on the fill, the matching income row's
      asset, and — in the Binance app — whether Position History's
      "Реализ. PnL" folds the converted fee in. Record all three in
      `openspec/live-verification-ledger.md` before writing the fold.
- [x] 1.3 Operator ruling recorded, 2026-08-24 evening, from a screenshot of
      the interim rendering (`0.00 USDT` over `−0.0011811 BNB` on a row
      face): no per-row BNB line — one USDT number on the face, BNB in the
      title only; and a single global BNB fee-reserve readout, marked low
      below 50 USDT equivalent. Folded into the proposal and the spec delta.

## 2. Spec

- [x] 2.1 Delta under `futures-workstation-presentation`: a foreign-asset
      commission is valued in the settlement asset at the charge's own time,
      named with its price on the element, and degrades to "not included"
      when no price is readable.

## 3. Code

- [x] 3.1 A BNBUSDT price-at-time source at minute resolution (existing kline
      reads, cached per minute; no new standing stream), answering "value X
      BNB at time T in USDT" and answering `null` honestly.
- [x] 3.2 The round fold and `foldFuturesSettledMoney` value BNB commissions
      through it: nets include the valuation, `feesByAsset` keeps the exact
      BNB quantities, per-asset wallet conservation stays intact, mixed
      USDT+BNB windows sum exactly + value only the BNB part.
- [x] 3.3 Titles name both quantities and the price used; the row face renders
      one settlement-asset number and never a visible BNB line; a failed
      price read renders today's "not included" statement, never a wrong
      number.
- [x] 3.4 The BNB fee-reserve readout: one global element stating the Futures
      wallet's BNB amount and its worth at the current BNBUSDT price (the
      account snapshot already carries the balance; the same price source as
      3.1 values it), marked low under 50 USDT equivalent
      (`FUTURES_BNB_FEE_RESERVE_LOW_USDT = 50`, declared where it is
      enforced), and stating absence/unreadability instead of a zero that
      looks like a reading.

## 4. Proof

- [x] 4.1 Tests that bite against the current fold: a BNB-fee round's net
      includes the valued commission (fails today — today's net excludes it);
      a mixed-fee round; a price-read failure degrading to "not included";
      per-asset conservation unchanged; the row face carries no visible BNB
      line (fails against the interim rendering the operator screenshotted);
      the reserve readout marks low under the bound and states absence
      honestly. Assert the kline address on the wire for the price source,
      not only the behavior behind it.
- [x] 4.2 Full suite, lint, and the repository guards.

## 5. Operator gate

- [x] 5.1 (confirmed live 2026-08-25 — ledger, «B3 answered»: Wallet Net, both quantities in the title, app to the cent) Operator compares the first BNB-fee closed round against the Binance
      app: the desk's PnL column agrees (to the settled one-cent rounding
      class), the title names the BNB quantity and its valuation. Record in
      `openspec/live-verification-ledger.md`, including what the app itself
      does with the fee (task 1.2's third fact).
