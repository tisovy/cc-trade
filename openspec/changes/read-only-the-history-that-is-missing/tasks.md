## 0. Counted Before Changing

- [x] 0.1 One refresh is up to 360 weight: income discovery up to 8 pages × 30 = 240, plus 12 contracts × 2 reads × 5 = 120. The account bucket is 800 a minute.
- [x] 0.2 It is also ~4.8 seconds before any network time: 32 admissions at the limiter's 150ms spacing.
- [x] 0.3 Nothing survives a restart: the review is rebuilt from zero every run, while closed candles beside it are served from a local store for exactly the reason that applies here — a settled order never changes.

## 1. The Store

- [ ] 1.1 A local store per contract, modelled on `futuresCandleHistoryCache.js`: terminal orders and trades, bounded, with the identity and time each contract is covered up to.
- [ ] 1.2 Only terminal rows are stored — a working order is not history.
- [ ] 1.3 An unreadable or unavailable store degrades to reading, never fails the review.
- [ ] 1.4 The store is presented on launch before any read is issued, stamped with when each contract was read.

## 2. The Read Asks For The Gap

- [ ] 2.1 `getOrderHistory` and `getTradeHistory` read forward from an identity — `orderId` and `fromId`, which is how the exchange pages them.
- [ ] 2.2 The held review states, per contract, what it is covered up to, and the command carries it.
- [ ] 2.3 A contract with no stream activity since its last read is not read, while the stream has been connected throughout.
- [ ] 2.4 A stream disconnection marks every contract as unvouched-for, so the next refresh reads them all.
- [ ] 2.5 A bounded rotation re-reads skipped contracts across successive refreshes, so a missed event surfaces within a stated number of them.

## 3. Discovery Is Asked For A Reason

- [x] 3.1 The contracts an income walk found are held for ten minutes; a refresh inside that reuses them and issues no income read. The walk answers which contracts were traded *somewhere other than this desk* — a trade made here already seeds the fan-out from the account's own positions and orders.
- [x] 3.2 What is held is what the walk found, not what the fan-out chose: the seeds are re-read from the account each time, so a contract cannot outlive the position that put it on the list.
- [x] 3.3 The held answer carries the walk's own `discoveryComplete`, so a held refresh cannot read as a wider review than the walk was.
- [x] 3.4 Deactivating the market drops it, like every other held reading.
- [x] 3.5 Test: two refreshes in a row walk income once and cover the same contracts; past the hold it is walked again.
- [ ] 3.6 Persisting it across runs, so a launch does not walk at all, waits on the store in §1.

## 4. Proof

- [ ] 4.1 Test: a launch with a populated store presents the review with no request issued.
- [ ] 4.2 Test: a contract that traded is read from its last identity, not from the window's start.
- [ ] 4.3 Test: a contract that did not trade is not read.
- [ ] 4.4 Test: a stream reconnect makes the next refresh read every contract.
- [ ] 4.5 Test: the rotation re-reads a skipped contract within the stated number of refreshes.
- [x] 4.6 Test: a refresh inside the hold issues no income page (see 3.5).
- [ ] 4.7 Test: a full re-read walks discovery and reads the whole window.
- [ ] 4.8 Test: an unreadable store behaves exactly as no store.
- [ ] 4.9 Weight test: a refresh after an idle minute costs a fraction of a full read, and the numbers are stated.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data: the review is on screen immediately at launch; ↻ is fast; a position closed a minute ago is in closed positions; and a trade made in Binance's app appears after a full re-read.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 The 150ms admission spacing stays as it is — the operator's call. Fewer reads is what makes ↻ fast, not a tighter spacing.
- [ ] 6.2 The fan-out bound of twelve contracts stays. What changes is how often each of them is actually read.
