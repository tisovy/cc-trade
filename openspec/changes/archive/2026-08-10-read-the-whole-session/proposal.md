## Why

The operator reviewed the closed-position history looking for two days of losses
they knew they had taken, found four profitable rounds and one from two days ago,
and concluded the list was lying. It was not lying — it was bounded in three ways,
none of which it stated.

**The fills were read a hundred deep per contract.** They are not shown as a list:
they are folded back into the positions they formed. A hundred fills is an hour on
a contract that closes in five, so the fold began in the middle of a day and
everything older simply was not there. This is the one that removes whole days.

**Eight contracts were read, and the desk's own state was spending seven of
them.** The contract on screen leads the fan-out, then every contract holding a
position, then every contract holding a working order. Three positions and four
resting orders — the state in the operator's screenshot — leaves one slot for
everything they closed and moved on from. Which is exactly where a day's losses
sit.

**The traded-contract discovery was reading the wrong end of the week.** Income
history is the only USDⓈ-M read that answers "which contracts" without being told
a contract first, and it answers a start time with the *oldest* rows after it. A
week that overruns one page hands back the contracts traded last Tuesday and never
reaches this morning's.

And none of it was visible: the payload said which contracts it had covered, the
renderer dropped the field on the way through, and the review said "in this
window" where it meant "across the eight contracts read". A bounded list that does
not say it is bounded is read as a complete one.

Separately, and reported with it: the size column states a contract count.
`237518` BMT and `5210` BEAT are the same column of digits and nothing like the
same money, on a desk that sizes every order in USDT.

## What Changes

- Fills are read to the endpoint's ceiling, a thousand per contract, instead of a
  hundred. The read costs the same weight at any depth.
- The fan-out covers twelve contracts instead of eight, and the payload states how
  many the account actually traded, so the surface can say what it does not cover.
- Traded-contract discovery walks its pages forward to the recent end of the
  window, and reads them back to front, so the contract traded most recently leads
  the list and the cap drops the stalest rather than the newest. The walk is
  bounded to four pages and costs nothing when the first page is not full.
- The review states its reach under the rows: how many of the traded contracts
  were read, and how far back the fills it read reach.
- A closed position is sized in USDT, valued at the price it was entered at, with
  the contract count kept on the row.

## Impact

- Affected specs: `futures-order-visibility`
- Affected code: `electron/services/futures-trading-adapter.js`,
  `electron/services/binance-connection.js`, `src/hooks/useFuturesTrading.js`,
  `src/utils/futuresTradeRounds.js`,
  `src/components/features/futures/FuturesHistoryPanel.jsx`,
  `src/components/features/futures/FuturesWorkstation.css`
- Weight: a history read was 30 (income) + 8×10 (orders and fills per contract);
  it is now 30–120 + 12×10, against a limiter budget of 800 a minute. The deeper
  fill read costs no extra weight and no extra request.
- `getTradedSymbols` becomes `getTradedSymbolPage` and returns a page rather than
  a list: the caller cannot walk the window without being told whether the page
  was full.
