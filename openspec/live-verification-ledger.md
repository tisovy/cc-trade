# Live Verification Ledger

This is the normative ledger of live, partial, outstanding and test-only
verification.

Assembled 2026-08-18 from the dated operator observations in
`changes/verify-the-desk-in-one-sitting/runbook.md`,
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
| `price-an-order-at-what-still-rests` | 2.4 | `OUTSTANDING` | 2026-08-15 | Production | `NOT RECORDED` | Result 41 was delayed; a live partial fill is still required. Indirect coverage remains green in `futuresOrderPresentation.test.js`, `prices a partly filled order at what is still working`: both snapshot `executedQty` and stream `z` value the remainder at 500 rather than 1000, and the shared total is 900 with a second 400 order. That proves the shared derivation, not all four live surfaces. |
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
| `align-futures-chart-time-and-header` | 3.3 | `OUTSTANDING` | `NOT RECORDED` | Production | `NOT RECORDED` | The archived task's check was flipped inside the archive commit with no recorded observation; its false check was removed on 2026-08-19. No confirmation exists to cite. |
| `compute-the-unstated-values-beside-the-read` | 4.3 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-15 | Production | `NOT RECORDED` | Archived task records 1,314 comparison lines with all five values named after the operator delegated reading the journal to the session. |
| `thin-the-scrollbars-and-split-the-market-rail` | 3.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | The archived task contains a gate to wait for live confirmation but no result; its false check was removed on 2026-08-18. |
| `keep-the-close-preview-live` | 4.3 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | The archived task contains a gate to wait for live confirmation but no result; its false check was removed on 2026-08-18. |
| `time-the-fill-to-the-screen` | 5.4 | `PARTIAL` | 2026-08-18, 18:02:30–18:02:32 UTC | Production | `NOT RECORDED` | Four identified `CANCELED` order reports and their paired account frames carry all four legs and commit as `UNCHANGED`: exchange→desk 185–202 ms, desk→queue 0 ms, queue→renderer 0–1 ms, renderer→screen 9–11 ms, total 195–213 ms. This proves the live private-stream/renderer measurement but is not the required `FILLED`/`PARTIALLY_FILLED` observation. |
| `time-the-fill-to-the-screen` | 5.5 | `OUTSTANDING` | 2026-08-18 audit | Production | `NOT RECORDED` | Depends on 5.4; runbook step 41 and the step-30 partial-fill Total follow-up remain open. |
| `drop-the-grip-that-cannot-lift` | 5.3, 7.6 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived 2026-08-20 with the gates open: the operator has not yet drag-checked a resting stop-market (plate + cancel, no grip, Ctrl/Alt-drag starts nothing) nor a stop-limit (plate names its trigger, no editor doorway, a plain limit still drags). |
| `bound-depth-delivery-through-standing-stale` | 4.1 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived 2026-08-20 with the gate open: no journal reading yet of the delivery cadence on a contract whose book stands stale (expect the 200 ms bound, not per-diff delivery); the same reading should say whether the band-edge flapping regime recorded in the change's 5.2 occurs in practice. |
| `value-filled-orders-at-their-fill-price` | 4.4 | `OUTSTANDING` | `NOT RECORDED` | `NOT RECORDED` | `NOT RECORDED` | Archived 2026-08-20 with the gate open: the operator has not yet read the Filled column against a real gapped or partial fill on the live desk. |
| `find-the-read-that-fails-on-every-start` | 4.2 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-19 record | Production | `NOT RECORDED` | The 2026-08-19 day carries six `exchange-info` lines with `outcome: "aborted"`, `code: "REQUEST_ABORTED"` at 1–5 ms — the expected losers of superseded generations, now named as such — while genuine failures are separately `REQUEST_DEADLINE_EXCEEDED` at the 10 s deadline. The operator's own reading across a few starts is not recorded; the archived box stays unchecked. |

## Test-Only Guarantees

| Change | Task | Status | Exact retained coverage |
|---|---:|---|---|
| `reach-the-desk-without-a-mouse` | 3.2 keyboard half | `COVERED BY TEST ONLY` | `FuturesPortfolioDock.test.jsx` — `opens the shared order editor once from Enter and Space at the row centre`; `FuturesTradingTicket.test.jsx` — `opens the order editor once from Enter and Space at the row centre`. |
| `harden-trading-command-integrity` | 7.2 | `COVERED BY TEST ONLY` | `trading-command-outcome.test.js` — `produces an unresolved envelope that is not a rejection`; `binance-connection.test.js` — `never resubmits an ambiguous placement whose order exists on the exchange`, `reports an ambiguous placement the exchange never received as an ordinary refusal`, `answers a Spot unresolved outcome by the identity it was raised with`, `leaves an unreconcilable outcome unresolved and offers no retry`. |
| `answer-the-command-that-asked` | 4.2 unresolved-outcome half | `COVERED BY TEST ONLY` | The same correlated-clearing tests named for `harden-trading-command-integrity` 7.2. The stop-order cancel-all half remains `PARTIAL`, not test-closed. |
| `hear-the-exchange-out` | 5.3 silent-market half | `COVERED BY TEST ONLY` | `futures-workstation-transport.test.js` — `treats a market stream that stops delivering as a disconnection`, `keeps a quiet stream alive on the exchange ping and ends one that stops pinging`, `ends a book that says nothing while its own tape prints`, `reports nothing from the watchdogs of a released connection`. |
| `say-which-readings-are-stale` | 1.4 | `COVERED BY TEST ONLY` | `useFuturesTrading.test.js` — `marks the held account unconfirmed when the transport drops` (and releases it on the first ready answer); `FuturesTradingTicket.test.jsx` — `states the age of a balance nothing has confirmed since the reconnect, and will not size against it`. |

## Awaiting The Operator — 2026-08-20 PnL Series

Three changes landed on 2026-08-20 from the operator's own report (uPnL wrong and
lagging; no settled PnL on a position; Closed Positions disagreeing with the
Binance app). All three are implemented, tested and committed; none can be closed
from a worktree, because each turns on numbers only the live account produces.
One sitting covers all of them.

| Change | Task | Status | What to look at |
|---|---:|---|---|
| `hold-the-position-value-to-one-price` | 5.6 | `OUTSTANDING` | On a fast-moving position, the Positions row's sign must agree with the Binance app and must stop flipping between two values once a second. Before this, a short with the mark above the entry and the tape below it read `+129.28` and `−43.10` in the same second. |
| `hold-the-position-value-to-one-price` | 5.7 | `OUTSTANDING` | Work **more than one contract**. Opening or closing any position used to blank every other row's live mark until a rebuilt socket delivered — that is the "uPnL lags" half of the report, and one contract will not show it. |
| `hold-the-position-value-to-one-price` | 5.8 | `OUTSTANDING` | When the tape crosses an entry and the mark has not, the row now explains itself in its title. Does that read as useful or as noise? |
| `state-what-an-open-position-has-already-paid` | 5.7 | `CAUSE FOUND AND FIXED 2026-08-20, AWAITING RECHECK` | Column blank on a position the app charged −264.38 (−229.43 funding, −34.95 commission). First cause found and fixed in `73cefbc` (the income reader ran three times on one path and was not idempotent). **The operator re-checked and it was still blank**, so that was not the whole of it. The path is correct on paper end to end and the account cannot be re-read from a worktree — the desk's keys are in the OS keyring. The read is therefore now recorded: a `settled` line per pass carrying `pages`, `rows`, `kept`, `contracts`, `fundingRows`, `recipients`, `outcome`, `code`. **That line named the cause on sight**: `rows: 2831, fundingRows: 1`. Rows the exchange gave no usable `tranId` all keyed to `FUNDING_FEE:` and a `Map` keeps one per key. Fixed; live on the operator's desk `fundingRows` went 1 → 45 and a complete pass holds 13 330 rows, the same count their own probe read from Binance for the same window. Re-check: the column should read **−270.49** (funding −237.04, commission −33.45), not −33.45. |
| `state-what-an-open-position-has-already-paid` | 5.8 | `OUTSTANDING` | Hold a position across a funding boundary and confirm the funding component appears. The read is triggered by the `FUNDING_FEE` cause and that path cannot be exercised offline. |
| `close-a-round-at-what-reached-the-wallet` | 4.5 | `CAUSE PROVEN AND FIXED 2026-08-20, AWAITING RECHECK` | Four rows disagreed. The operator's two screenshots close the arithmetic exactly — see "The four rows, settled" below. The desk is short by precisely the funding of each round, and only on the rounds that crossed a settlement. No longer a prediction to re-check but a measured cause: the income rows were not reaching the rounds, same root as 5.7 above and fixed with it. Two things to check now. The rounds that crossed a settlement should have moved by their funding (BTWUSDT 2nd **+56.76**, CYSUSDT 2nd **+1.64**). And the table now has **two** money columns — *Realized*, which is Binance's own figure and is what the app's column of that name holds, and *Net*, which is that less commission plus funding. The one-cent rows were never a defect; they are two independent roundings of the same number. |
| `close-a-round-at-what-reached-the-wallet` | 4.6 | `OUTSTANDING` | A round held across a funding boundary must show its funding component. |
| `read-only-the-income-the-desk-cannot-derive` | 8.1 | `OUTSTANDING` | **The figures must not move.** This change is about what the settled read spends, not about what it says: the same column, the same closed rounds, the same numbers as the sitting above. Realized PnL and commission now come from the fills rather than from the income record, so any difference is a defect in it — and `scripts/probe-futures-settled.mjs` prints both records side by side with their difference, which answers it without a screenshot. |
| `read-only-the-income-the-desk-cannot-derive` | 7.3 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-21 04:24–08:59 UTC | Production | — | **8 passes, 1 800 weight, 6.54 a minute**, every one `complete` over the full week, against the same desk's own 117.2 across 295 passes of which 125 never reached the window's start. Eighteenfold. Reasons: three `stream`, three `refresh`, one `settlement`, one `confirm` — and no `tick` at all. Original wording: | **What it now costs, from the journal.** The `settled` line carries `reads` and `types` beside `pages`; weight is `reads × 30`. Expect a cold start of about 12 reads / 360 weight reaching `complete` on the **first** pass, against 67 pages and 2 010 weight over nine, and roughly 3.75 weight a minute after it against 60. |
| `hold-the-position-value-to-one-price` | 5.6–5.8 | `CONFIRMED BY OPERATOR` | 2026-08-20 evening | Production | — | "Вроде стала работать гораздо лучше, пока кейс можно закрывать." The popup recalculates the unrealized PnL correctly too. Reopen rather than reinterpret if the row starts jumping again. |
| `stop-waiting-on-the-spot-account-read` | 4.2 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-20 19:56 UTC | Production | — | Two spot placements and two cancellations: `answer` lines of **361, 361, 360, 360 ms**, all `ok`, against futures at 365–410 ms in the same session. Both markets now measure the exchange round trip and nothing else. |
| `add-futures-weekly-interval` | 3.4 | `CONFIRMED BY OPERATOR` | 2026-08-20 evening | Production | — | "Недельные свечи работают, все вроде ок." The archive gate is closed. |
| `time-the-fill-to-the-screen` | 5.5 | `CONFIRMED BY OPERATOR` | 2026-08-20 evening | Production | — | The resting order the price kept hitting now updates, and its Total in USDT updates with it — runbook step 41 and the step-30 follow-up, both reported working by the operator without prompting. |
| `read-only-the-income-the-desk-cannot-derive` | 10.2 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-21 | Production | — | No `settled` line carries reason `tick` anywhere in the session, and the thirty-second reconcile ran throughout. Original wording: | **What a session costs now that the timer no longer reads.** Expect `settled` lines only on a stream opening, a settlement and its confirming pass two minutes later, a person pressing refresh, and once an hour. No line every thirty seconds while an order rests. |
| `keep-the-settled-reading-across-restarts` | 4.1–4.2 | `CONFIRMED BY DIAGNOSTIC RECORD` | 2026-08-21 | Production | — | `restored: 46, pages: 1` at 08:59:21 — a start that read only the tail. `restored: 42, pages: 2` at 04:24:08 is the same start with the hour's verification due, which walks from nothing on purpose; it reads like a cold start and is not one. Both `missing: 0, differing: 0`. Archived 2026-08-21. Original wording: | **The store.** After a restart the `settled` line for the first pass should read `restored` greater than zero with one page rather than two, and the column should be complete from the first frame. The hour's verification should read `missing: 0, differing: 0` — anything else means the file disagreed with the exchange and the exchange won, which is worth seeing. |

**Archived 2026-08-21**: `add-futures-weekly-interval`,
`hold-the-position-value-to-one-price`, `stop-waiting-on-the-spot-account-read`
and `keep-the-settled-reading-across-restarts`. Five changes remain active and
every one of them is held by the same two disagreements below — the settled
money on an open position, and Closed Positions. They are one question, not
five, and nothing else stands between any of them and the archive.

**Still open after the 2026-08-20 evening sitting**, both reported by the
operator and neither closed: an open BEATUSDT position reading **9169.88** in the
desk against **9182** in the Binance app before the 20:00 funding, and
**9169.88** against **9201.09** after it; and Closed Positions "так же
неправильно всё считает". The second of those had a cause found and fixed the
same evening — the settlement's row is written into `/fapi/v1/income` after the
sockets announce the charge, and the desk moved its own cursor past the instant
before the row existed — but the 12.12 that stood *before* the settlement is a
separate disagreement and is not explained by it. Which column each number is
has to be named before the arithmetic can be closed: see
`name-the-quantity-not-the-column`.

**One thing to check before that sitting.** At 21:59 on 2026-08-20 the desk was
running with `dist-electron/main.js` built at 21:27 — the narrowed read and the
new schedule were in it, the resized walk was not, and two further edits after it
produced no rebuild. That has since cleared: the bundle rebuilt at 22:09 with no
source newer than it, carrying `INSURANCE_CLEAR`, `MAX_REQUESTS: 4` and the
settlement wiring, and the audit's own edits rebuilt it again after that. The
bundle is what runs, not the tree, so if the desk has been left open across all
of this, **restart `npm run e`** anyway before reading any of the numbers above;
a mixed build measures neither state.

### The four rows, settled — 2026-08-20, from the operator's screenshots

The operator sent the desk's Closed Positions beside the Binance app's Position
History. The two together close the arithmetic, so this stopped being a
prediction. Gross is `(entry − exit) × qty` on a short, `(exit − entry) × qty` on
a long, from the app's own averages; times converted from the phone's MSK to UTC.

| Round | Gross | Desk | App | Desk = gross − | App − desk | Funding boundary crossed |
|---|---:|---:|---:|---:|---:|---|
| BTWUSDT short, 14 min, closed 19.08 13:50 | 622.06 | 605.72 | 605.71 | 16.34 commission | **−0.01** | none (10:36→10:50 UTC) |
| BTWUSDT short, 4 h 19 min, closed 19.08 13:29 | 1405.13 | 1280.83 | 1337.59 | 124.30 commission | **+56.76** | one, 08:00 UTC (06:10→10:29) |
| CYSUSDT long, 16 min, closed 18.08 12:23 | 187.67 | 185.21 | 185.20 | 2.46 commission | **−0.01** | none (09:07→09:23 UTC) |
| CYSUSDT long, closed 18.08 10:44 | — | 1755.93 | 1757.57 | — | **+1.64** | open time not on the screen |

Read down the last two columns. **Every round that crossed a funding settlement
is short by a funding-sized amount; every round that crossed none agrees with the
app to one cent.** Row 2 closes exactly: `1405.13 − 124.30 + 56.76 = 1337.59`.

Three consequences. The desk's definition of a round's result and the app's
"Реализ. PnL" **agree** — both are realized net of commission and funding — so
there is no definitional gap to chase, which settles task 1.4. The desk is
missing funding and nothing else. And the two one-cent differences are rounding
between two independent computations, not a defect: those rounds have no funding
to be missing.

One correction to the earlier prediction: the second BTWUSDT row is **1 337,59**
in the app, not the 1337.39 first reported, so its funding is **+56.76** received,
not +56.56. CYSUSDT's **+1.64** received stands.

A defect the screenshots exposed on their own: every one of those four rows was
drawn as a plain, whole figure. `is-partial` is set on the cell whenever the
income read did not cover a round's funding — all four qualified — but the only
rule in the stylesheet was `.futures-workstation-dock-settled.is-partial`, and
the round result cell is `.futures-workstation-dock-pnl`. The class matched
nothing and the qualification was invisible. The tests asserted the class and
never that it renders as anything; the guard that checks every rendered class has
a rule reads static class names only, so the conditional modifiers were never in
its sample. Both are fixed.

### Reading the `settled` line — 2026-08-20, after the second failed sitting

The empty column has four possible causes and until now the journal could not
separate them. One line in `~/.config/cc-trade/diagnostics/desk-<date>-000.jsonl`
now does:

```
grep '"kind":"settled"' ~/.config/cc-trade/diagnostics/desk-2026-08-20-000.jsonl
```

| What the line says | Where the fault is |
|---|---|
| no line at all | the read never fired — no trigger reached `scheduleFuturesSettledRead` |
| `"outcome":"abandoned"` | overtaken by a newer activation, or no futures adapter (`"code":"NO_ADAPTER"`) |
| `"outcome":"failed"` | the exchange or the route refused it; `code` names which |
| `"rows":0` | the read was answered and the account has no income in the window |
| `"kept":0` with `rows` > 0 | rows came back but none is a position's own money — the type map or the contract filter is wrong |
| `"recipients":0` | correct answer, sent to nobody — the frame was produced before any renderer was listening |
| `"contracts"` > 0 and the column still empty | the main process is right and the fault is renderer-side: the fold, the position starts, or the props |

The last row is also answerable without the journal. Hovering the `—` now says
which of three absences it is: *not read yet* (no frame ever arrived), *the
income read answered N other contracts and nothing against this one* (the frame
arrived and this contract was not in it), or *nothing settled on this position
yet* (it was read and there is genuinely no charge).

Two things worth knowing before the sitting. An account that pays fees in **BNB**
exercises the sharpest defect fixed here — a BNB fee was being subtracted from a
USDT result — so if BNB fee discount is on, a closed round is the fastest check.
And a position or round **older than the read's window** is expected to say so
rather than show a complete-looking total; that qualification is the fix
working, not a gap.

## Awaiting The Operator — 2026-08-22 Depth Recovery

Two changes landed on 2026-08-22 after the morning's degradation window on the
exchange side (05:11–05:24 UTC: `-1008` on orders, depth snapshots served
behind the stream, 122 `DEPTH_SEQUENCE_GAP` lines in the journal for one
actual break per book). Both are implemented, tested and committed; neither
can be closed from a worktree, because both turn on how the journal reads
through the next real degradation. Nothing needs to be done to provoke one —
the next bad morning closes both.

| Change | Task | Status | What to look at |
|---|---:|---|---|
| `say-why-the-book-stayed-down` | 4.1 | `OUTSTANDING` | Next time the book breaks, the journal should tell the story in order: one `DEPTH_SEQUENCE_GAP` for the break itself, a `DEPTH_BOOTSTRAP_NOT_BRIDGED` or `DEPTH_BOOTSTRAP_BUFFER_GAP` beside every rebuild attempt that failed, and `DEPTH_BOOK_DOWN` for the rounds while it stays down. If a long outage still reads as an unbroken run of `DEPTH_SEQUENCE_GAP`, the relabel is back. |
| `back-off-a-recovery-that-keeps-failing` | 3.1 | `OUTSTANDING` | In the same window, `book-recovery` round starts per contract should thin — spaced at roughly 5, 10, 20, 40 seconds, then about once a minute — not seven to eight a minute for the duration. And once the exchange recovers, the book should still come back within about a minute. |

## Defects And Contradictions

- **Open, unowned as of 2026-08-22 19:31 UTC — the history read is refused on
  every start.** `account.history` comes back `rejected` with
  `INVALID_TYPED_HISTORY_SYMBOL` once per session start: 18:43:04, 18:49:51,
  18:54:34, 18:56:00, 19:18:50, 19:19:43 and 19:23:58 UTC. The code appears
  **zero** times in the journals for 18, 19, 20 and 21 August, so it began that
  evening. The refusal is at `trading-command-validation.js:806` — neither
  `payload.symbol` nor `selectedSymbol` is set — and that validation is old; what
  is new is the caller. The uncommitted diff of `src/hooks/useFuturesTrading.js`
  adds `historyReconcileGeneration`, described in its own comment as *"a request
  to close the REST history gap spanning offline time"*, which fits the profile
  exactly: once per start, before a contract has been chosen, so the symbol is
  empty. Written here rather than sent, because the session holding that work is
  live (its transcript was being written at 19:31:35 UTC) but is not listed by
  `ListAgents`, and the desk runs the working tree — so this is live on the
  operator's desk now and has been failing silently for the better part of an
  hour. Not diagnosed further and not touched: it is somebody's active work.
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
- The 2026-08-18 18:02 UTC cancellation reports prove that the newer private
  frame record reaches a committed renderer. They do not prove how a fill or
  partial-fill changes the screen, so they cannot close `time-the-fill-to-the-screen`
  5.4 or its dependent 5.5.
- Those four lines were written under the earlier reading of the `code` field,
  where `UNCHANGED` meant "nothing on the screen moved". Since the audit landed
  that afternoon a frame is judged against its own subject and says one of three
  things — `DELIVERED`, `UNCHANGED` (the screen already showed what it said) and
  `NOT_DRAWN` (the screen does not show it, which is the fault). Lines written
  before 2026-08-18 21:00 UTC cannot be compared with later ones on that field.
- What to do when the fill finally happens is written out, step by step with a
  reading table, in that change's own §7:
  `openspec/changes/archive/2026-08-18-time-the-fill-to-the-screen/tasks.md`.
  It needs nothing asked of the operator beyond the contract and roughly when.
- The late-frame item remains open until a complaint supplies contract and time
  and the nearest raw `kind: "frame"` supplies its own four legs. Daily medians
  are explicitly not evidence for it.
