## 1. Refusing a Settled Order

- [x] 1.1 Remember the identity of every order the exchange reports settled, in a
  map bounded to the last 256, re-inserting an identity that is reported again so
  it cannot age out while it is still being contradicted.
- [x] 1.2 Refuse to list an order whose identity has settled, both from an
  execution report and from an account snapshot.
- [x] 1.3 Settle nothing on a report the exchange did not identify: without an
  order id the identity is the prefix every unidentified order on the contract
  shares.
- [x] 1.4 Split the exchange id out of `orderIdentity` so the settlement path and
  the identity path cannot disagree about what identifies an order.

## 2. Reading Again Without Being Asked

- [x] 2.1 Re-read the account every thirty seconds while orders are working, and
  stop while none are. This is the periodic half of the reconciliation the
  order-visibility capability has always required; only the operator-requested
  half existed.
- [x] 2.2 Send the same account refresh the ↻ control sends, so the read is one
  path and not two.

## 3. Verification

- [x] 3.1 `npx vitest run` — 90 files, 1,176 passed, including the placement
  reply that arrives after the fill, the snapshot that still lists the settled
  order beside one that is genuinely resting, a settlement report with no id, and
  the beat starting and stopping with the list.
- [x] 3.2 `eslint` clean on the file this change touches.
- [x] 3.3 `npm run check:futures-production` passes.
- [x] 3.4 Operator confirms on the live account that an order placed into a
  breaking level leaves the list when it fills, with no reload. — closed by the operator on 2026-08-10 rather than reported checked.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 The memory lives in the renderer and starts empty on every launch. A
  settlement reported before the desk was running is not remembered — the first
  snapshot after mount is authoritative for that, which is what a reload already
  did.
- [ ] 4.2 Thirty seconds is the ceiling on staleness only for the case where no
  message arrives at all. Every message the desk does receive is applied
  immediately, as before.
- [ ] 4.3 The beat is gated on working orders, not on open positions: a position
  going stale is a different reading with a different feed behind it.
- [ ] 4.4 An order that reaches a terminal state and is then genuinely reissued
  under the same identity would be refused. Binance does not reuse an order id,
  which is what makes the refusal safe.
