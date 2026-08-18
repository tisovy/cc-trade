# Reconciled Live-Verification Evidence

Assembled 2026-08-18 from the dated operator observations in `runbook.md`,
the archived task records they reference, the existing live-verification
ledger, and the diagnostic observations quoted by those records. A broad
statement such as “everything works” is evidence for the numbered step the
operator was performing, not for an unperformed edge case elsewhere.

`Production` below is recorded only where the source identifies the Production
account or is part of the runbook's Production pass. `NOT RECORDED` is literal:
the legacy record did not preserve that metadata. No revision is reconstructed
from a nearby commit.

## Runbook And Transferred Confirmation Items

| Change | Task | Status | Observation date | Account | Desk revision | Evidence |
|---|---:|---|---|---|---|---|
| `verify-live-futures-account-read` | 1.2 | `CONFIRMED` | 2026-08-13; reconfirmed 2026-08-18 | Production | `NOT RECORDED` | `runbook.md`, result 1; archived task already quotes the five ready resources. |
| `verify-live-futures-account-read` | 1.3 | `CONFIRMED` | 2026-08-13; reconfirmed 2026-08-18 | Production | `NOT RECORDED` | `runbook.md`, result 1: no resource failed, so there was no failure category to record. |
| `isolate-markets-and-runtime` | 8.6 | `CONFIRMED` | 2026-08-13; reconfirmed 2026-08-18 | Production | `NOT RECORDED` | `runbook.md`, result 2: chart, book and tape live. |
| `isolate-markets-and-runtime` | 8.5 | `CONFIRMED` | 2026-08-13 | Production | `NOT RECORDED` | `runbook.md`, result 3: fast switches, clean terminal. |
| `isolate-markets-and-runtime` | 8.8 | `CONFIRMED` | 2026-08-13 | Production | `NOT RECORDED` | `runbook.md`, result 3: fast switches, clean terminal. |
| `say-which-readings-are-stale` | 5.2 | `CONFIRMED` | 2026-08-12 and 2026-08-13 | Production | `NOT RECORDED` | Archived task records the live outage and recovery; `runbook.md`, results 4 and 16. |
| `hold-the-history-the-desk-has-read` | 5.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, results 5 and 30: instant held review and the filled round appearing without refresh. |
| `hold-the-history-the-desk-has-read` | 8.7 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 5 covers only the sweep; result 32 says the close/reopen check was not performed. |
| `fit-the-desk-in-the-window` | 4.2 | `CONFIRMED` | 2026-08-12 and 2026-08-15 | Production | `NOT RECORDED` | Archived task: “вёрстка ок”; `runbook.md`, result 6: everything displays normally. |
| `wait-out-the-read-budget` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 7: 15 contracts loaded quickly without failures or damaged book/tape. |
| `switch-contracts-without-tearing-the-desk` | 5.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 7: repeated fast switching, no lag, error or torn book/tape. |
| `send-only-the-book-on-screen` | 5.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 8: all offered grouping steps agreed with Binance. |
| `buy-the-book-as-deep-as-it-is-read` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, results 7, 8 and 10: fast switches, grouping rows and thin-book comparison. |
| `prove-the-book-covers-both-sides` | 5.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 9: both sides and badge passed. |
| `hold-the-book-through-a-spike` | 5.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 9, recorded after the step's moving-contract observation. |
| `bootstrap-the-book-on-a-quiet-market` | 4.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 10: quiet contract opened correctly and matched Binance. |
| `let-the-desk-act-on-a-stale-chart` | 4.2 | `OUTSTANDING` | 2026-08-12 to 2026-08-15 | Production | `NOT RECORDED` | Result 11 is partial and result 19 failed; the complete composite promise is not proved. |
| `stop-rebuilding-the-desk-on-every-tick` | 5.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, results 12 and 13: Futures stayed synchronized; Spot history/RSI/month loaded without shifting. |
| `keep-a-record-of-what-the-desk-did` | 7.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 14: 741 events read; no credential, price, size, amount or PnL recorded. |
| `send-only-the-confirmed-order` | 5.2 | `CONFIRMED` | 2026-08-12 and 2026-08-15 | Production | `NOT RECORDED` | Archived task confirms shown size equals sent size; result 18 and its diagnostic events confirm a failed send leaves the panel open. |
| `let-the-chart-ask-again` | 3.3 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 19 is the pre-fix `FAIL`; no post-fix repeat is recorded. Separate change exists and is archived. |
| `keep-the-chart-loadable` | 6.2 | `PARTIAL` | 2026-08-15 | Production | `NOT RECORDED` | Result 21 confirms Spot; result 19 failed on Futures. The archived checkbox records handoff, not a full live PASS. |
| `recover-the-market-feed-after-an-outage` | 4.2 | `CONFIRMED` | 2026-08-13 and 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 20: market recovered without reload, with observed recovery times. |
| `let-the-chart-ask-again` | 3.4 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 21 predates the follow-up change; it is a baseline, not a post-change regression check. |
| `verify-live-futures-account-read` | 1.4 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 23; archived task records the operator's confirmation. |
| `name-the-refusal-the-exchange-gave` | 4.4 | `CONFIRMED` | 2026-08-12 and 2026-08-15 | Production | `NOT RECORDED` | Archived diagnostic evidence and result 24 record `-4164` without the exchange message. |
| `hold-the-order-the-read-has-not-seen` | 3.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 25 is PASS for the complete six-part step. |
| `hold-the-working-orders-on-the-stream` | 5.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 25 is PASS for the complete six-part step. |
| `keep-trading-while-the-account-is-read` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | Result 26: six placements and cancellations, no visible stall, stuck SYNC or refusal; record has no `NOT sent`. |
| `start-the-drag-on-the-pointer` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 27: “работает как надо” for the complete drag step. |
| `cancel-the-order-the-drag-lifts` | 6.2 | `CONFIRMED` | 2026-08-12 and 2026-08-15 | Production | `NOT RECORDED` | Archived task records lift/drop/abandon and eleven cancel→place pairs; result 27 reconfirms the drag. |
| `do-not-cancel-what-cannot-be-replaced` | 3.4 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 24 created this defect; result 27 predates its fix. No post-fix minimum-notional drag exists. |
| `hold-the-drag-on-the-button` | 3.3 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 27 predates this change and does not name modifier release mid-drag. |
| `serialize-and-deduplicate-trading-commands` | 3.2 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 28 says the required sequence was not reproducible by hand. |
| `answer-the-command-that-asked` | 4.2 | `PARTIAL` | 2026-08-15 | Production | `NOT RECORDED` | Result 29 confirms ordinary cancel-all only; no stop order existed. Its ambiguous-outcome half is test-only below. |
| `let-the-stream-state-the-account` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 30: the complete fill/position sub-step was run and answered “всё работает”. |
| `let-the-stream-state-the-account` | 4.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 30: the complete liquidation-line sub-step was run and answered “всё работает”. |
| `move-the-pnl-with-the-market` | 5.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, results 12 and 30 cover the moving last price and the position/PnL comparison. |
| `read-a-contract-configuration-once` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | `runbook.md`, result 30 covers the leverage/configuration sub-step. |
| `carry-execution-ahead-of-market-data` | 5.4 | `CONFIRMED` | 2026-08-16 | Production | `NOT RECORDED` | Archived task and result 31 quote the live HEMIUSDT execution and diagnostic position transition. |
| `name-the-algo-order-that-fired` | 4.3 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 33 was delayed and result 34 is blank. |
| `keep-trading-while-the-account-is-read` | 4.3 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 34 is blank. |
| `let-the-stream-state-the-account` | 4.4 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 34 is blank. |
| `prove-the-private-stream-is-carrying` | 1.5 | `CONFIRMED` | 2026-08-13 | Production | `NOT RECORDED` | Result 35 and the runbook's exact record: four commands, four weight-5 `unstated` folds. |
| `hear-the-exchange-out` | 5.3 | `PARTIAL` | 2026-08-15 | Production | `NOT RECORDED` | Results 36–38: no ALGO measurement, leverage delayed, proxy method invalid for a silent stream. The checkbox records runbook handoff, not live success. |
| `keep-the-contracts-warm` | 5.4 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | Result 39: AKE/APR/ACE switches were seamless and retained their books. |
| `lift-the-next-order-while-the-last-lands` | 4.4 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | Result 40: several orders dragged before earlier replacements landed; all completed correctly. |
| `price-an-order-at-what-still-rests` | 2.4 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 41 was delayed; a partial fill is still required. |
| `keep-the-book-under-the-market` | 3.3 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 42 was delayed pending a real sharp break. |
| `end-the-book-where-the-market-does` | 4.3 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | Result 43: step ladder checked against Binance and passed. |
| `keep-the-book-the-stream-restates` | 5.4 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | Result 44: live comparison with Binance passed. |
| `reach-the-desk-without-a-mouse` | 3.2 | `CONFIRMED BY MEASUREMENT` / `COVERED BY TEST ONLY` | 2026-08-15 | Production | `NOT RECORDED` | Result 46 and runbook test-only section: narrow dock measured at 12 widths; keyboard use declined permanently and is covered by the two named suites below. |
| `make-the-order-history-readable` | 5.3 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 47 is blank. |
| `report-execution-state-truthfully` | 7.2 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 48 is blank. |
| `keep-the-history-read-out-of-the-way` | 3.4 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | Result 49 is blank. |
| `prove-the-private-stream-is-carrying` | 5.3 | `PARTIAL` | 2026-08-16 | Production | `NOT RECORDED` | Result 50: quiet connection observed for 10m36s; items 2–4 not run. |
| `pay-the-spot-handshake-once` | 5.2 | `CONFIRMED` | 2026-08-16 | Production | `NOT RECORDED` | Archived task and result 51: 15 commands, 328–352 ms, median 331 ms, seven pooled connects, no fallback. |
| `harden-trading-command-integrity` | 7.2 | `COVERED BY TEST ONLY` | 2026-08-13 measurement | N/A (test guarantee) | `NOT RECORDED` | Runbook explains why the 340–800 ms live window cannot be aimed; exact tests are listed below. |
| `say-which-readings-are-stale` | 1.4 | `COVERED BY TEST ONLY` | `NOT RECORDED` | N/A (test guarantee) | `NOT RECORDED` | Runbook explains why reconnect and the first account answer cannot be separated by the available operator action. |
| `time-the-frame-from-exchange-to-screen` | 5.3 | `OUTSTANDING` | 2026-08-18 complaint; event time `NOT RECORDED` | Production | `NOT RECORDED` | The complaint recurred without contract/time/revision. The 2026-08-18 record had 20,820 raw frames but zero order/account frames with identity/status; unrelated market frames and daily medians were not substituted. |

## Existing Ledger Items

These ten items remain exactly as the existing ledger recorded them. No later
runbook row directly proves their complete compound behaviour.

| Change | Task | Status | Observation date | Account | Desk revision | Evidence |
|---|---:|---|---|---|---|---|
| `adjust-isolated-position-margin` | 11.1 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no later complete observation. |
| `adjust-isolated-position-margin` | 11.2 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no later complete observation. |
| `adjust-isolated-position-margin` | 11.3 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no later complete observation. |
| `deepen-futures-chart-history` | 6.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; result 19 is a different failed retry case. |
| `deepen-spot-chart-history` | 5.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; result 13 does not prove restart reuse. |
| `keep-position-value-live` | 5.6 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no direct proof of both readings. |
| `price-the-exit-and-the-liquidation` | 5.5 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no direct proof of the whole compound case. |
| `read-the-desk-at-a-glance` | 9.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no direct proof of the whole compound case. |
| `review-the-account-not-the-contract` | 5.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no direct proof of the whole compound case. |
| `state-and-set-the-leverage` | 4.6 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Existing ledger row dated 2026-08-13; no direct proof of the whole compound case. |

## Previously Checked Live Confirmations Outside This Runbook

These archived tasks were already checked and contain their own direct live
observation. They are included so the later “no checked confirmation without a
ledger row” audit has a complete evidence source instead of silently assuming
that archival implied verification.

| Change | Task | Status | Observation date | Account | Desk revision | Evidence |
|---|---:|---|---|---|---|---|
| `improve-futures-trading-ergonomics` | 7.4 | `CONFIRMED` | 2026-08-09 | `NOT RECORDED` | `NOT RECORDED` | Archived task says moving, resizing and cancelling were confirmed in the desk ergonomics run. |
| `sharpen-futures-desk-ergonomics` | 8.4 | `CONFIRMED` | 2026-08-09 | `NOT RECORDED` | `NOT RECORDED` | Archived task records book, positions and balances present and correct. |
| `deliver-the-whole-order-book` | 6.5 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records live distance and chart-ruler comparison. |
| `fit-the-orders-and-mark-the-walls` | 3.4 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records fitting rows and visually correct walls. |
| `keep-the-book-readable-at-speed` | 4.4 | `CONFIRMED` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived task records heavy-flow price tracking, intact edges and one-sided reach. |
| `keep-the-rail-legible` | 3.5 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records contracts on launch and uncut working-order rows. |
| `quiet-the-chart-labels` | 4.3 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records readable annotations and comfortable price scale. |
| `read-the-whole-session` | 5.4 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records complete recent closed positions, money sizes and stated bounds. |
| `remember-the-book-view-per-contract` | 3.4 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records step/sides persistence across restart. |
| `state-what-the-orders-are-worth` | 4.4 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records `On order` matching the live working-order total. |
| `stop-relisting-a-settled-order` | 3.4 | `CONFIRMED` | 2026-08-10 | `NOT RECORDED` | `NOT RECORDED` | Archived task records a filled order leaving without reload. |
| `hold-every-contract-at-two-times-isolated` | 5.3 | `CONFIRMED` | 2026-08-11 | `NOT RECORDED` | `NOT RECORDED` | Archived task says contracts opened as expected on live data. |
| `read-only-the-history-that-is-missing` | 5.2 | `CONFIRMED` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived task records launch display and measured 2s/6s/8s review updates. |
| `compact-the-futures-trading-rail` | 5.4 | `CONFIRMED` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived task records the required live narrow-window verification before archive. |
| `read-the-desk-at-a-glance` (2026-08-15 change) | 5.1 | `CONFIRMED` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived task records clock, symbol switching, small prices, ninth recent item and Filled USDT. |
| `compute-the-unstated-values-beside-the-read` | 4.2 | `CONFIRMED` | 2026-08-15 | Production | `NOT RECORDED` | Archived task cites runbook results 23, 30 and 45 from two live sittings. |
| `compute-the-unstated-values-beside-the-read` | 4.4 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-15 | Production | `NOT RECORDED` | Archived task records unchanged reasons and weights and no extra read. |
| `carry-execution-ahead-of-market-data` | 5.4 | `CONFIRMED` | 2026-08-16 | Production | `NOT RECORDED` | Same direct observation as result 31; included above. |
| `say-one-size-and-draw-one-line` | 3.3 | `CONFIRMED` | 2026-08-16 | Production | `NOT RECORDED` | Archived task quotes the operator and three one-action PASS responses. |
| `pay-the-spot-handshake-once` | 5.2 | `CONFIRMED` | 2026-08-16 | Production | `NOT RECORDED` | Same direct observation as result 51; included above. |
| `align-futures-chart-time-and-header` | 3.3 | `CONFIRMED` | 2026-08-18 | Production | `NOT RECORDED` | Archived task records live confirmation before archive. |
| `compute-the-unstated-values-beside-the-read` | 4.3 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-15 | Production | `NOT RECORDED` | Archived task records 1,314 comparison lines with all five values named after the operator delegated reading the journal to the session. |
| `thin-the-scrollbars-and-split-the-market-rail` | 3.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | The archived task contains a gate to wait for live confirmation but no result; its false check was removed on 2026-08-18. |
| `keep-the-close-preview-live` | 4.3 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | The archived task contains a gate to wait for live confirmation but no result; its false check was removed on 2026-08-18. |
| `time-the-fill-to-the-screen` | 5.4 | `OUTSTANDING` | 2026-08-18 audit | Production | `NOT RECORDED` | The landed frame schema first appears at 16:03:52 UTC; the last trading command was at 15:21:27 UTC, and all later sessions contain zero order/account frames with identity/status. |
| `time-the-fill-to-the-screen` | 5.5 | `OUTSTANDING` | 2026-08-18 audit | Production | `NOT RECORDED` | Depends on 5.4; runbook step 41 and the step-30 partial-fill Total follow-up remain open. |

## Test-Only Guarantees

| Change | Task | Status | Exact retained coverage |
|---|---:|---|---|
| `reach-the-desk-without-a-mouse` | 3.2 keyboard half | `COVERED BY TEST ONLY` | `FuturesPortfolioDock.test.jsx` — `opens the shared order editor once from Enter and Space at the row centre`; `FuturesTradingTicket.test.jsx` — `opens the order editor once from Enter and Space at the row centre`. |
| `harden-trading-command-integrity` | 7.2 | `COVERED BY TEST ONLY` | `trading-command-outcome.test.js` — `produces an unresolved envelope that is not a rejection`; `binance-connection.test.js` — `never resubmits an ambiguous placement whose order exists on the exchange`, `reports an ambiguous placement the exchange never received as an ordinary refusal`, `answers a Spot unresolved outcome by the identity it was raised with`, `leaves an unreconcilable outcome unresolved and offers no retry`. |
| `answer-the-command-that-asked` | 4.2 unresolved-outcome half | `COVERED BY TEST ONLY` | The same correlated-clearing tests named for `harden-trading-command-integrity` 7.2. The stop-order cancel-all half remains `PARTIAL`, not test-closed. |
| `hear-the-exchange-out` | 5.3 silent-market half | `COVERED BY TEST ONLY` | `futures-workstation-transport.test.js` — `treats a market stream that stops delivering as a disconnection`, `keeps a quiet stream alive on the exchange ping and ends one that stops pinging`, `ends a book that says nothing while its own tape prints`, `reports nothing from the watchdogs of a released connection`. |
| `say-which-readings-are-stale` | 1.4 | `COVERED BY TEST ONLY` | `useFuturesTrading.test.js` — `marks the held account unconfirmed when the transport drops` (and releases it on the first ready answer); `FuturesTradingTicket.test.jsx` — `states the age of a balance nothing has confirmed since the reconnect, and will not size against it`. |

## Defects And Contradictions

- `runbook.md` result 19 is the only literal `FAIL`. It has the separate
  `let-the-chart-ask-again` change; because no post-fix repeat exists, its live
  tasks remain open.
- Result 24 passed the refusal-code check but discovered order loss during a
  below-minimum drag. That finding has the separate
  `do-not-cancel-what-cannot-be-replaced` change; its post-fix live task remains
  open.
- Result 31 proves that ordinary fast fills reached the old screen promptly. It
  does not prove the newer per-frame timing record or the partial-fill Total
  request.
- The late-frame item remains open until a complaint supplies contract and time
  and the nearest raw `kind: "frame"` supplies its own four legs. Daily medians
  are explicitly not evidence for it.
