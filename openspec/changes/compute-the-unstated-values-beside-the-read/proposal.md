## Why

The operator wants the desk on the stream entirely — for the speed, for the
weight budget, and because a desk that reads REST on every account change is
worst exactly when the contract is busiest and the read queue longest.

`let-the-stream-state-the-account` put the wallet, the positions and the working
orders on the stream and left three values behind, because Binance publishes
them on no socket:

- the **liquidation price**
- the margin a position commits — its **notional, initial and maintenance margin**
- the **free margin** an order is sized against (`availableBalance`)

Those three are what the remaining REST traffic is for. In steady running the
desk now reads only because of them: a coalesced pass after a fold moved a
position, and a balances-only pass after an order was placed, amended or
cancelled — the read the operator watched follow a fill.

The reason they were not computed was stated plainly, and this change does not
overturn it: a liquidation line drawn from the desk's own arithmetic is wrong in
exactly the conditions that matter, and it is wrong **silently**. This change
removes the *silently*. The desk computes all three, keeps reading them, shows
the read, and records how far its own answer stood from the exchange's. After a
window of real trading the operator decides from evidence instead of hope —
which is what the follow-up change `stop-reading-what-the-desk-can-count` is
for.

## What the desk already has to compute from

Nothing new has to be fetched to try:

- **maintenance brackets** — `/fapi/v1/leverageBracket`, already read for each
  held contract's leverage ceiling and then thrown away except for the highest
  multiple. Every band's `notionalFloor`, `notionalCap`, `maintMarginRatio` and
  `cum` arrives in the same answer.
- **leverage and margin mode** — `symbolConfig`, already read and held per
  contract the account has a position in.
- **mark price** — the public mark-price feed, already subscribed for exactly
  the positions on screen. No credentials and no weight.
- **position size, entry price, isolated wallet, wallet balance** — the folded
  `ACCOUNT_UPDATE`.
- **resting orders** — the working set, already carried on the stream.

The arithmetic is Binance's own, stated here so the tests have something to be
wrong against:

- `notional = |size| × mark`
- `maintenance = notional × mmr(bracket) − cum(bracket)`
- `initial margin = notional / leverage` in both margin modes; an isolated
  wallet is separate collateral used by the liquidation formula, not the
  position's initial-margin requirement
- `free margin = crossWallet + crossUnPnl − Σ cross position initial margin
  − Σ resting order initial margin`, where a reduce-only order commits nothing
  and, per contract, only the heavier of the two sides is counted
- `liquidation = (WB − TMM₁ + UPNL₁ + cumB − side × size × entry)
  ÷ (size × mmr − side × size)`, with the cross case taking the wallet and the
  other positions' margin and uPnL into account, and the isolated case taking
  the isolated wallet with neither

## What Changes

- **The desk computes all three, for every position it holds and for the
  wallet.** Where a bracket, a mark or a leverage is missing it computes
  nothing rather than a number — an absent estimate is a fact worth recording,
  a guessed one is not.
- **Nothing on screen changes.** The exchange's read stays the only thing shown
  and the only thing an order is sized against. The computed answer reaches the
  record and nothing else. This is what makes the change safe to leave running
  unattended for a fortnight.
- **Every read that answers positions or balances is stood beside the desk's own
  answer for the same instant**, and the distance between them is recorded.
- **The comparison uses like-for-like exchange facts.** A short position's
  signed `notional` is compared by magnitude, and the position calculation is
  compared with `positionInitialMargin`, not the row's aggregate
  `initialMargin` that can also include open orders.
- **The full bracket table is kept** from the read already being made, so the
  arithmetic costs no extra weight for a contract the desk has already priced.
  An incomplete table or a non-default `notionalCoef` still supplies the
  exchange's leverage ceiling, but is not guessed into a diagnostic margin
  formula.

## What the record may carry, and what it may not

The desk's record refuses money by construction: every field it accepts is
matched against a pattern that cannot spell a decimal, so a price or a size
cannot arrive under a field name meant for a code. A comparison log of
liquidation prices would break that rule in the one file an operator might hand
to someone else.

So the record keeps the **distance, not the values**: for each of the five
computed values, one line per read pass stating how many rows were compared, the
worst disagreement in basis points of the exchange's own answer, and the
contract it was on. A ratio is not an amount — nothing in it reconstructs the
size of the account.

One line per value per pass, and the worst case rather than each row: a safety
decision is made on the tail, not the median, and five lines per pass keeps a
fortnight of comparison inside a record that already bounds itself to 32 MB.

## Trade-offs this accepts

- REST traffic does not fall in this change. It cannot: the whole point is to
  keep reading the truth while the desk's arithmetic is on trial beside it. The
  saving is the next change's, and only if the evidence earns it.
- The brackets are held per contract and re-read on the same clock as the
  symbol config. A bracket that changed mid-hold makes the desk's own answer
  wrong for that hold — which the record will show as a disagreement, correctly.
- The comparison runs on the reads the desk already makes. On a quiet account
  that is few samples per day; the window has to be long enough to matter, and
  the record forgets after fourteen days.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: the values no stream carries are still read and
  still what the desk shows — and are now computed alongside, for comparison
  only.

### Added Capabilities

- `desk-diagnostic-record`: the distance between the desk's own arithmetic and
  the exchange's answer is recorded, without any amount reaching the file.

## Impact

- `electron/services/futures-trading-adapter.js` — the whole bracket table read
  out of the answer already fetched for the leverage ceiling.
- `electron/services/futures-account-margin.js` *(new)* — the arithmetic, and
  nothing else: pure functions over a reading, so they can be tested against
  numbers taken from the live account.
- `electron/services/binance-connection.js` — holding the brackets, computing
  beside each read, and handing the comparison to the record.
- `electron/services/desk-diagnostic-record.js`, `scripts/read-desk-record.mjs`
  — the `estimate` event and how the day's summary reports it.
