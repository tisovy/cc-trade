## 1. Reading The Frame The Exchange Already Sent

- [x] 1.1 Read `ACCOUNT_UPDATE` into the wallet balances and positions it states, instead of into a flag that means "go and ask".
- [x] 1.2 Fold it into the held balances and positions: wallet balance, and per position size, entry price, margin mode and isolated wallet.
- [x] 1.3 Drop a position the frame reports at zero size, and carry a position it does not mention unchanged.
- [x] 1.4 Fold nothing into a resource that has never been read, so a partial frame is never presented as the whole account.
- [x] 1.5 Follow the folded position set with the mark price feed and the per-contract leverage, exactly as a read does.
- [x] 1.6 Prove 1.2, 1.3 and 1.4 by test.

## 2. Reading Back Only What The Frame Could Not Say

- [x] 2.1 Name, per fold, which resources carry values the frame could not state and that moved — the liquidation price and margins behind a changed position, the free margin behind a changed wallet.
- [x] 2.2 Issue no read at all when nothing unstated moved.
- [x] 2.3 Coalesce the reads, so a burst of stream frames costs one pass rather than one per frame.
- [x] 2.4 Read the free margin back after an order is placed, amended or cancelled, since no stream reports the margin it locks or releases — balances alone.
- [x] 2.5 Issue no read for a fill's execution report; the `ACCOUNT_UPDATE` for the same fill carries it.
- [x] 2.6 Prove 2.1–2.5 by test, including that a wallet-only frame reads no positions.

## 3. Stating Why The Desk Read The Account

- [x] 3.1 Carry a reason on every account read, from the site that asked for it.
- [x] 3.2 Record each read with its reason, how many resources it asked for and what it cost in weight.
- [x] 3.3 Report the reads per reason in the day's summary, with their total weight.
- [x] 3.4 Prove 3.1–3.3 by test.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:circular`, `npm run check:runtime-mock`, `npm run check:command-path`.
- [ ] 4.2 Operator confirms on live data that a fill moves the position row and the wallet on screen at once, without the pause it had.
- [ ] 4.3 Operator confirms a newly opened position shows no LIQ line for a moment and then shows the exchange's, and never a wrong one.
- [ ] 4.4 Operator reads `node scripts/read-desk-record.mjs` after a run and confirms the account reads are few and each has a reason they recognise.

## 5. Found In Audit

- [x] 5.1 Collapse the reason of requests that queue behind a running read the way their resources already collapse. Whichever asked last used to decide, so a frame landing behind the operator's refresh, a reconnect or the periodic beat turned that full read into one allowed to state only a liquidation price — and those reads are precisely what corrects a frame the desk never saw. `unstated` now yields to any other reason sharing the pass.
- [x] 5.2 Prove 5.1 both as a rule and end to end: a position the desk holds only because a frame stated it, gone at the exchange, is removed by an operator refresh that a frame queued behind.
