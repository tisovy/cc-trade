## 1. Establish the ground truth

- [x] 1.1 Confirmed. `getTradedSymbolPage` asks `incomeType: 'REALIZED_PNL'` and
  returns only `{symbols, full, lastTime}`
  (`electron/services/futures-trading-adapter.js:1296-1322`);
  `readFuturesTradedSymbols` (`:506`) reads nothing but `symbol` and `time`. Its
  own comment says the amounts are never read.
- [x] 1.2 Read from Binance's own OpenAPI, rendered with
  `chromium --headless --proxy-server=socks5://127.0.0.1:1080` against
  `/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#get-income-history`
  (`llms-full.txt` and `llms.txt` are both 404 now; the direct `docs/derivatives/...`
  slug 302s to the catalog and answers `202` with an empty body to curl). Six
  findings, four of which change this change's design:

  1. **`incomeType` is a single enum value, not a list**, and *"If `incomeType`
     is not sent, all kinds of flow will be returned"*. So this is **one read at
     `x-ip-weight: 30`** covering every type, not one read per type. The
     proposal's "widened to also cover" wording is corrected accordingly.
  2. **`income` is signed** — *"正数代表流入，负数代表流出"*, positive is an
     inflow. Funding paid, commission and insurance clearance all arrive
     negative. The settled figure is therefore a **sum of signed rows**, never
     "realized minus commission plus funding": subtracting an already-negative
     commission would add it back. Commission taken from a *fill* is the
     opposite — a positive magnitude to be subtracted. The two records must not
     be mixed without saying which is which.
  3. **`tranId` is unique only within one `incomeType`** — *"trandId is unique in
     the same incomeType for a user"* — so the dedup key is
     `incomeType` + `tranId`, not `tranId`. Task 3.3 corrected.
  4. **An income row carries no `positionSide`.** The response is `symbol`
     (*"if existing"*), `incomeType`, `income`, `asset`, `info`, `time`,
     `tranId`, `tradeId` (*"if existing"*). Per-leg attribution is therefore
     possible only for rows carrying a `tradeId`, by joining to the fill that
     has the leg. `FUNDING_FEE` is not a trade and carries none, so on a hedge
     account holding both legs of one contract funding cannot be split per leg
     from this record at all. The spec is corrected to state the contract-level
     figure there rather than invent a split.
  5. The enum also carries `COMMISSION_REBATE`, `FEE_RETURN`, `API_REBATE` and
     `REFERRAL_KICKBACK`, which offset commission. An account on a rebate that
     counted `COMMISSION` alone would overstate what it paid.
  6. **"Income history only contains data for the last three months"** — a hard
     floor under any window this reads, independent of the desk's own.
- [~] 1.3 Partly settled, and deliberately not blocking. `normalizeFuturesAccountUpdate`
  reads `pa/ep/up/mt/iw` off each `P` entry and no funding amount, so nothing the
  desk parses today attributes funding to a contract. Binance's user-data-stream
  *event* pages would not render through the proxy (the catalog slug serves only
  the REST listenKey endpoints; the event slugs 404, as
  `binance-docs-source` records), so whether `ACCOUNT_UPDATE` carries an
  accumulated-realized field (`cr`) per position is **unverified**. It does not
  block: even if it does, it would supply one of the four components the
  operator asked for and none of the other three, and mixing a stream-sourced
  realized figure with read-sourced funding would put two as-of times in one
  total. Check it while implementing 3.1 by logging one live frame; if `cr` is
  there, it is an optimisation to weigh, not a different design.
- [x] 1.4 Confirmed. `buildFuturesTradeRounds` already emits open rounds —
  `{open: true, openTime, symbol, positionSide, entryImplied}` — and
  `FuturesHistoryPanel` filters them out with
  `.filter(round => !round.open && round.exitPrice !== null)`
  (`FuturesHistoryPanel.jsx:237-241`). `entryImplied` is exactly the
  "opened before this window" signal task 4.2 needs. The dock already receives
  the `history` prop (`FuturesPortfolioDock.jsx:79`) and renders the panel from
  it, so the open round's start is reachable without a new data path.
- [x] 1.5 Blast radius by grep. `getTradedSymbolPage` has one caller, the
  `walkIncome` helper inside `collectFuturesHistorySymbols`
  (`binance-connection.js:3396-3540`); `readFuturesTradedSymbols` is called only
  from `getTradedSymbolPage`. **The walk is the wrong host for this reading** and
  the change is re-scoped around that: it is discovery-cached behind
  `FUTURES_HISTORY_DISCOVERY_HOLD_MS`, persisted through the renderer's coverage
  store, and bounded by a page budget — all correct for "which contracts did this
  account trade this week", which moves slowly, and all wrong for "what has this
  position settled", which moves on every fill. Settled money gets its own small
  read that shares the normalizer, not a widened walk.

## 2. Spec

- [x] 2.1 Wrote the two ADDED requirements and the MODIFIED
  "Values no stream carries are read, not computed", carrying across every
  scenario the live spec still has.
- [x] 2.2 `OPENSPEC_TELEMETRY=0 openspec validate state-what-an-open-position-has-already-paid --strict` — valid.

## 3. Code — read the amounts

- [x] 3.1 Added `getIncomePage`: `/fapi/v1/income` with **no** `incomeType` (all
  flows in one weight-30 read), returning normalized `symbol`, `incomeType`,
  `income`, `asset`, `time`, `tranId`, `tradeId`. Page by the endpoint's `page`
  number against a fixed window — advancing `startTime` past a page's last
  timestamp skips rows sharing that millisecond, exactly as the discovery walk
  already documents. While here, log one live `ACCOUNT_UPDATE` and settle
  whether it carries an accumulated-realized field per position (task 1.3).
- [x] 3.2 Left `getTradedSymbolPage` and `collectFuturesHistorySymbols`
  untouched — contract discovery keeps its own read, its own cache and its own
  page budget. Share the row normalizer only.
- [x] 3.3 Deduplicated by `incomeType` + `tranId` across pages — `tranId` is
  unique only within one income type (task 1.2), so `tranId` alone would drop a
  real row as a duplicate. A page boundary inside one millisecond can hand back a
  row twice, and a double-counted funding charge is money.

## 4. Code — fold and present

- [x] 4.1 Folded income rows to per-contract settled totals bounded by the open
  round's start, keeping the types apart and summing per asset. Sum the signed
  `income` values; do not subtract them. Count the rebate types with commission.
  Attribute to a leg only via a row's `tradeId` joined to the fill that names the
  leg; state funding on the contract.
- [x] 4.2 The fold carries `from` and `complete`; a contract with no known start
  reports `complete: false` and the cell is marked and says so in its title. The
  start comes from `buildFuturesTradeRounds`' open rounds, in the hook, so one
  walk of the fills defines when a position began for every surface.
- [x] 4.3 `binance-connection.js` broadcasts `futures_settled_income` — the
  filtered rows plus the window they cover — on a fill whose execution report
  carries a non-zero `realizedPnl`, and on an `ACCOUNT_UPDATE` whose cause is
  `FUNDING_FEE`. Coalesced on a 1.2 s timer so a market close arriving as five
  fills costs one read. The **fold** runs in the renderer instead: it needs both
  the income rows and the fills that say when each position opened, and only the
  renderer holds the second. `readFuturesSettledIncome` is shared by both sides
  so they cannot disagree about which flows are a position's.
- [x] 4.4 Added the `PnL` column to the Positions panel beside `uPnL`, with the
  breakdown on the element and the window qualification stated where it applies.
  Follow the desk's number rules: magnitudes, no stream padding, exact value in
  the title.

## 5. Proof

- [x] 5.1 Every new test bites — each was run against the pre-change tree in a
  copy before being kept. `futuresSettledMoney.js` did not exist there, so its 14
  tests fail at import; `getIncomePage` did not exist, so the adapter test fails
  on `adapter.getIncomePage is not a function`; the four dock tests fail because
  no settled cell is rendered.
- [x] 5.2 The adapter test asserts the request on the wire, not the reply: the
  path `/fapi/v1/income`, **no** `incomeType` parameter (which is what makes one
  read answer for every kind of flow), no `symbol`, and the page and limit sent.
- [x] 5.3 Fold tests: a scaled-out position, a funding boundary, a BNB
  commission held out of the USDT total, a position opened before the window, the
  same `tranId` under two income types (kept apart), the same `tranId` repeated
  across pages (collapsed), a commission rebate netted against commission, a
  transfer ignored, insurance clearance stated only where incurred, and a
  position that has settled nothing reported without inventing zeros.
- [x] 5.4 Dock tests: the column renders the signed total, the title decomposes
  it into realized / funding / commission, a component the account has none of is
  absent rather than `0.00`, the window qualification appears only when the start
  is unknown, a non-settlement asset is stated apart, and an unanswered read
  reads as `—` rather than as zero.
- [x] 5.5 Column widths measured in headless Chromium against a scratchpad
  fixture, at panel widths 760 and 907 (the CSS records ~907 as the panel's
  ceiling). The 84px track fits every magnitude through `+149707.00`; only a
  seven-figure value clips, by 2px, which is past the row's own stated bound of
  "five figures and two decimals" and is how every other money track on the row
  already behaves. **No horizontal overflow at any width** — `scrollWidth` equals
  `clientWidth` on the row and the panel at 760, 800, 840, 880 and 907.
- [x] 5.6 `npx vitest run` — 2207/2207 across 116 files in the working tree, and
  2189/2189 against the staged index tree extracted with `git write-tree` +
  `git archive` (the difference is another session's uncommitted tests, which are
  not mine to commit). `npx eslint` clean on all nine touched files.
- [ ] 5.7 Operator checks one open position's settled money against the Binance
  app's own figures for the same contract, and confirms the breakdown in the
  cell's title decomposes to what the app shows. Record in
  `openspec/live-verification-ledger.md`.
- [ ] 5.8 Operator confirms the funding component appears after a funding
  boundary passes with a position open — the read is triggered by the
  `FUNDING_FEE` cause, and that path cannot be exercised from this tree.

## 6. Carried forward

- Task 1.3 is unresolved by choice: whether `ACCOUNT_UPDATE` carries an
  accumulated-realized field per position could not be read from Binance's docs
  through the proxy. It would at most save one of four components and would put
  two as-of times in one total, so it is an optimisation to weigh later, not a
  design decision left open. Settle it by logging one live frame.
- A hedge account holding both legs of one contract states funding on the
  contract. The fold does not attribute income rows to a leg at all yet — no row
  in the current reading needs it, since the dock keys by symbol — so the
  `tradeId` join that would attribute realized PnL and commission per leg is
  written into the spec but not into the code. It becomes load-bearing the first
  time a hedged account uses this column, and
  `close-a-round-at-what-reached-the-wallet` is where the join lands.
