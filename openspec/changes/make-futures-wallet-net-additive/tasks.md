## 1. Dependency and impact gates

- [ ] 1.1 Confirm `make-futures-rounds-leg-and-window-correct` is implemented for canonical leg/round identity, or explicitly keep this change blocked and verify no symbol-only ownership code is added
- [ ] 1.2 Run GitNexus upstream impact for income normalization, open settlement, round income attachment, dock/history consumers, and probe paths; record effective money-flow risk before editing

## 2. Canonical ledger production path

- [ ] 2.1 Introduce exact signed canonical ledger components and one ownership result (`roundOwned`, `legOwned`, `contractShared`, `accountShared`) in production code, then verify every input identity appears in exactly one owner set with a local probe
- [ ] 2.2 Attribute realized PnL/gross fill commission by fill leg and reliable commission credits by trade identity, then verify the `120 - 4 + 0.4` rebate example yields `116.4` once
- [ ] 2.3 Replace overlapping-time duplication with deterministic single ownership or shared buckets for funding/insurance/unattributed credits, then verify the two-round `10 + 10 - 3` example reconciles to `17`
- [ ] 2.4 Add independent trade/commission/income coverage and per-asset aggregate state, then verify exact wallet Net is absent when an opening fee or newest income edge is uncovered
- [ ] 2.5 Switch open-position and Closed Positions production selectors to the canonical reconciliation result and remove legacy duplicated per-round arithmetic, then verify per-asset conservation over the held ledger

## 3. Truthful presentation production path

- [ ] 3.1 Render contract/account-shared adjustments once and expose partial/shared qualifications to keyboard and touch, then verify no explanation is hover-only
- [ ] 3.2 Render non-USDT components visibly without converting them into USDT and verify a BNB-only reading is not a bare dash
- [ ] 3.3 State per-contract history reach in empty and non-empty reviews and rename cumulative turnover to `Closed volume`, then verify incomplete discovery cannot read as proven empty
- [ ] 3.4 Make day-heading behavior locale-robust and verify both `07/14` and `14.07` formats retain valid accessible headings

## 4. Tests after implementation

- [ ] 4.1 Replace duplicated-funding expectations with conservation tests for sequential boundaries, hedge overlap, duplicate delivery, and shared buckets; run the focused ledger/round suites
- [ ] 4.2 Add rebate tests with/without trade identity, opening-fill credits, BNB commission, insurance, and multi-asset totals; run the focused settled-money suite
- [ ] 4.3 Add component/accessibility tests for partial-empty, shared funding, BNB-only, per-contract scope, Closed volume, and locale-independent headings; run the history/dock suites
- [ ] 4.4 Run the settled-income probe against canonical per-asset sums and record any live rows whose attribution evidence is absent

## 5. Verification and operator gate

- [ ] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-futures-wallet-net-additive --strict` and verify it passes
- [ ] 5.2 Run GitNexus `detect_changes` against `main`, confirm only expected ledger/open/closed/UI flows are affected, and resolve unexpected symbols before commit
- [ ] 5.3 Compare four representative live Closed Positions plus simultaneous hedge-leg open settlement with Binance income/fill rows per asset; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after operator confirmation and carry any rebate-shape unknown into an explicit follow-up change
