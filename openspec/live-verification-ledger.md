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
| `let-the-operator-own-the-margin-mode` | 5.5 | `CONFIRMED` | 2026-08-21 and 2026-08-23 | Production | `NOT RECORDED` | Position half 2026-08-21: the chip stated the reason and no `trade.setMarginType` reached the exchange. Flat half 2026-08-23: BEATUSDT toggled `ISOLATED → CROSSED` from the ticket at 08:26:56Z (`ok`, 1 823 ms), the mode held in the Binance app, two repeat presses answered `-4046 NO_NEED_TO_CHANGE_MARGIN_TYPE` — the exchange itself countersigning the held mode — and a cross BUY LIMIT filled on that contract at 08:28:16Z while two other contracts stood isolated. |
| `let-the-operator-own-the-margin-mode` | 5.4 | `CONFIRMED` | 2026-08-24 | Production | `4d2cb45` | The record half was closed by the change's 5.6. Display half closed in the 2026-08-24 sitting: with the desk stopped the operator set a flat contract to cross ×1 in the Binance app, restarted, opened that contract and saw `CROSS 1×` immediately — "сразу увидел кросс х1 без морганий". |
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

Two things worth knowing before the sitting. This operator does not pay Futures
commission in **BNB**, so that live case is not applicable; deterministic
coverage still verifies that a foreign-asset fee cannot be subtracted from a
USDT result. A position or round **older than the read's window** is expected to
say so rather than show a complete-looking total; that qualification is the fix
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
  empty. Written here rather than sent because **the work has no author among
  this machine's Claude sessions**: no transcript anywhere under
  `~/.claude/projects` contains an `Edit` or `Write` of `useFuturesTrading.js`
  carrying that identifier, and the last Claude edit of that file from any
  transcript is 2026-08-20 14:51:54 UTC against a file mtime of 2026-08-22
  11:16 UTC. The precedent for authorless work in this tree is the operator's
  own Codex sessions. The desk runs the working tree, so this is live on the
  operator's desk now and had been failing silently for the better part of an
  hour when it was found. Not diagnosed further and not touched.

  A method note, because this entry first named the wrong author: grepping the
  transcripts for an identifier finds who **mentioned** it, and within minutes of
  a finding being passed between sessions that is whoever investigated it — two
  transcripts held the identifier, and both belonged to the investigation rather
  than the work. Authorship is the identifier inside an `Edit`/`Write` whose
  `file_path` is the file in question, cross-checked against that file's mtime.

  **Closed 2026-08-23 in `04b1c9c`**, after the work landed in `ac1800e` and
  the operator reported the symptom it fed ("Closed Positions used to show all
  symbols"). The refusal was one of three legs: the reconcile fired with no
  symbol and never retried (send success recorded as done); a one-contract
  `basisOnly` read stamped `readViews.trades` so the tab's account-wide read
  never ran; and the `ac1800e` v2 store re-key emptied persisted coverage while
  discovery short-circuits on any covered contract, so the review self-sustained
  at one contract. All three fixed renderer-side (`useFuturesTrading.js`,
  `futuresHeldHistory.js`, dock ↻ escalates to full while discovery is
  incomplete); journals 2026-08-23 07:43–08:23 UTC hold the refusals and the
  one-request "wide" read that proved the chain.
- **Closed / superseded 2026-08-23 — exact-settled money in
  `FuturesPortfolioDock.jsx`:** open and Closed PnL cells now show rounded cents
  at a glance, retain the exact decimal in the element title, and keep shared
  contract/account adjustments outside leg-owned totals. The earlier red
  shared-adjustment expectation and the large/sub-cent/zero regressions are
  green in the final focused and full suites. Nothing further is owed by this
  historical defect entry; live account comparison is tracked separately.
- **Measured 2026-08-23 ~12:00 UTC, offline against the operator's own store
  (LevelDB write-ahead log + Snappy + SSV parsed in scratchpad; desk was down) —
  why Closed Positions showed 3 rounds against a week the operator counts ~20
  in.** Three legs, two fixed, one recorded: (1) the v2 re-key **deleted** the
  old object store outright (`deleteObjectStore`, `futuresHistoryStore.js:435`),
  so the legacy records naming the week's sixteen contracts are unreachable by
  the app — six of them (BLUAI, BMT, AKE, BICO, EPIC, PUMP) were traded only in
  the older half of the week, and (2) the bounded 4-page income walk cannot
  reach them, so no read ever named them again. Fixed: a Full read's older-half
  walk now takes up to 12 pages (`FUTURES_INCOME_MAX_PAGES_FULL`) and the
  fan-out cap rose 12 → 16; with `04b1c9c`'s ↻-escalation one press of ↻ on the
  narrowed review runs it. (3) The fold over the healed v2 store yields 8
  resolved closed rounds and suppresses 7 more as `left-boundary-unproven` —
  each contract's oldest chain — even where trade coverage is complete for the
  whole window and the terminal snapshot is flat. Anchoring the chain backward
  from the terminal position would prove most of those boundaries; that
  inference belongs to the round-fold owner
  (`make-futures-rounds-leg-and-window-correct`) and is deliberately not
  attempted here. BEAT and BTW carry `history-page-limited` windows that heal
  through the existing reacquisition checkpoints.
  **Leg (3) closed 2026-08-23 evening.** The operator pressed ↻ live, the deep
  walk ran (journal 18:52:44–18:53:01Z: five 30-weight income pages, the
  fan-out behind them), and Closed Positions settled at exactly the predicted
  8 rounds against "all of them" in the Binance app — so the anchoring was
  implemented inside `show-one-pnl-and-let-the-operator-size-the-dock`
  (task 2a.3) rather than left recorded: the fold now adopts a flat-base trial
  fold when it conserves fills, reads every round from flat, and lands its
  terminal exactly on the delivered account snapshot. The handoff to the
  round-fold owner is therefore withdrawn.
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
- **Measured 2026-08-23, owned by the change
  `stop-the-consequence-read-holding-the-answer` — a margin-mode toggle can
  answer in 45–57 s while the exchange answers it in ~340 ms.** Five toggles on
  flat BEATUSDT, 08:26:56–08:28:00Z. The first answered in 1 823 ms — POST,
  configuration re-read, bracket re-read and a 90-weight account pass, all
  serial, all inside the answer. The second's account pass found the desk's own
  window at `spent: 796` of 800 (minute 08:26 carried a ~700-weight book
  bootstrap) and its last weight-5 read slept 55 093 ms — the journal's
  `kind: "deferred"` line names it. `handleFuturesSetMarginType` holds the
  command's answer on that pass, and the registry serializes mutating commands
  per contract, so toggles three to five never reached the limiter until it
  woke: answers of 56 752, 52 132, 48 044 and 45 202 ms, the last two `-4046`
  because the chip was stale when pressed. Two self-inflictions compound. The
  exchange's own minute counter had already reset — `observedWeight` 704 at
  08:26:57.999 against 1 at 08:27:00.532 — while the desk's baseline, restamped
  at `now` by `reconcilePhysicalResponse`, carried the spend to 08:27:56. And
  the answer waits on a consequence read the operator never asked to wait for —
  the rule `trading-command-integrity` already states for spot. The 2026-08-22
  queue fix held: the deferred read slept outside the slot; the lane above it,
  the per-contract command serialization, is what stood still. The mode itself
  switched on the exchange in ~340 ms every time, and nothing mispriced: the
  chip kept stating what the exchange last reported.

  **FIXED AND CONFIRMED LIVE 2026-08-23.** Implementation in `1b5e6b0` (answer
  released at the configuration broadcast, account pass detached, mode path
  bracket-less, observed baseline stamped at the exchange interval's start).
  Operator confirmed the same evening; the journal countersigns: CYSUSDT
  18:59:55–19:00:03Z, `setLeverage` 1 019 ms then four `setMarginType` answers
  1 163 / 1 244 / 746 / 800 ms straight across the 19:00:00 minute boundary,
  zero `deferred` lines in the window. The change is archived as
  `2026-08-23-stop-the-consequence-read-holding-the-answer`.

  One residual observation, not a defect of this change: ONGUSDT `setLeverage`
  at 18:52:52Z answered in 9 095 ms at `spent: 799` of 800 — a genuinely full
  minute (two 90-weight refresh passes), and the wait ended exactly at the
  boundary, which is the new baseline behaviour doing its job. The nuance
  worth keeping: the command's configuration re-read deduplicated onto an
  in-flight **ordinary** read started an instant earlier by the contract
  selection, so the command's urgent standing never reached the limiter, and
  the journal's `deferred` line for it says `ordinary` (waitedMs 8 762,
  started at the command's own millisecond). If an operator ever reports a
  slow first configuration command again, look for that dedup rider before
  anything else; promoting an in-flight read to urgent when an urgent caller
  joins it would close the gap, and is left unowned until a sitting shows it
  matters.

## Final PnL Audit Archive Handoff — 2026-08-23

The operator confirmed before this final audit that uPnL and PnL were reading
normally, but reported that some Closed Positions still disagreed with the
Binance app while others were correct. The audit then changed persisted-fill
restore, exact-decimal display, lane completeness, confirmation scheduling,
limiter fairness, and ambiguous account reconciliation. Those final changes
have deterministic coverage and passed the final full suite (126 files, 2,860
tests), lint, build, and repository guard checks, but have not yet been observed
on the live account. The operator explicitly requested commit, spec sync, and
archive; the archive records implementation completion and does not turn the
following rows into live evidence. Every remaining observation is carried by
the active verification-only change `verify-final-futures-pnl-live-data`.

The operator also stated that this Futures account does not use USDC and pays no
Futures commission in BNB. Those two live cases are therefore `N/A BY OPERATOR`,
not silently treated as confirmed; their deterministic regression coverage is
retained.

| Change | Task / case | Status | Observation date | Account | Desk revision | Evidence / remaining check |
|---|---:|---|---|---|---|---|
| `charge-every-binance-retry-weight` | 3.3 | `OUTSTANDING` | `NOT RECORDED` | Production | this archive commit | Full automated accounting, retry, fairness, and reconciliation suites pass; live charged weight, latency, priority, and `429` rate after the final fairness fix remain unmeasured. |
| `charge-every-binance-retry-weight` | 3.4 | `ARCHIVE AUTHORIZED WITH LIVE CHECK OUTSTANDING` | 2026-08-23 | Production | this archive commit | The operator explicitly requested archive. Task 3.3 remains outstanding here and archive is not its proof. |
| `make-futures-rounds-leg-and-window-correct` | 5.3, USDT/startup/hedge/reversal cases | `OUTSTANDING` | `NOT RECORDED` | Production | this archive commit | The post-audit persisted-fill revision fix still needs a live restart/Closed check; simultaneous hedge legs, one-leg partial close, and reversal also remain unobserved after the final diff. |
| `make-futures-rounds-leg-and-window-correct` | 5.3, USDC case | `N/A BY OPERATOR / COVERED BY TEST ONLY` | 2026-08-23 | N/A (account does not use USDC) | this archive commit | The operator does not use USDC. Deterministic USDC denomination and no-USDT-relabel regressions remain green. |
| `make-futures-rounds-leg-and-window-correct` | 5.4 | `ARCHIVE AUTHORIZED WITH LIVE CHECK OUTSTANDING` | 2026-08-23 | Production | this archive commit | The operator explicitly requested archive; the unperformed task-5.3 cases remain recorded above. |
| `make-futures-wallet-net-additive` | 4.4 | `PARTIAL / COVERED BY DETERMINISTIC PROBE` | 2026-08-23 | N/A (offline fixture) | this archive commit | The canonical USDT probe conserves `10.0049 - 0.21 = 9.7949`, and ownership/presentation are disjoint; live missing-attribution rows and commission-rebate posting delay were not measured. |
| `make-futures-wallet-net-additive` | 5.3, USDT Closed/hedge cases | `OUTSTANDING` | `NOT RECORDED` | Production | this archive commit | Four representative post-audit Closed rows and simultaneous hedge-leg open settlement still need comparison with Binance rows. |
| `make-futures-wallet-net-additive` | 5.3, USDC case | `N/A BY OPERATOR / COVERED BY TEST ONLY` | 2026-08-23 | N/A (account does not use USDC) | this archive commit | The operator does not use USDC; per-asset conservation and denomination remain covered deterministically. |
| `make-futures-wallet-net-additive` | 3.2 / 4.2 / 4.3 / 4.37, BNB cases | `N/A BY OPERATOR / COVERED BY TEST ONLY` | 2026-08-23 | N/A (no Futures BNB commission) | this archive commit | The operator states Futures commissions are not paid in BNB; BNB-only non-relabel behavior remains covered deterministically. |
| `make-futures-wallet-net-additive` | 5.4 | `ARCHIVE AUTHORIZED WITH LIVE CHECK OUTSTANDING` | 2026-08-23 | Production | this archive commit | The operator explicitly requested archive; live rebate shape and the remaining task-5.3 comparisons stay recorded above. |
| `make-settled-income-acquisition-lossless` | 5.3 | `OUTSTANDING` | `NOT RECORDED` | Production | this archive commit | Funding/rebate posting latency and an hourly verification cycle after the debounce-debt fix remain unmeasured on the live account. |
| `make-settled-income-acquisition-lossless` | 5.4 | `ARCHIVE AUTHORIZED WITH LIVE CHECK OUTSTANDING` | 2026-08-23 | Production | this archive commit | The operator explicitly requested archive; task 5.3 and any future live ordering observation remain in this ledger. |
| `make-settled-income-resource-truthful` | 5.3 | `OUTSTANDING` | `NOT RECORDED` | Production | this archive commit | Live success → failure → recovery and same-shape correction were not forced after the numeric-money and lane-target fixes. |
| `make-settled-income-resource-truthful` | 5.4 | `ARCHIVE AUTHORIZED WITH LIVE CHECK OUTSTANDING` | 2026-08-23 | Production | this archive commit | The operator explicitly requested archive; task 5.3 remains outstanding and archive is not recovery evidence. |

## Live Settled-Income Failure Surfaced — 2026-08-23 evening

The failure half of `make-settled-income-resource-truthful` task 5.3 has now
been observed live, unforced. Since the 18:52Z restart every non-bootstrap
settled read in the journal ends `outcome: "partial"` while every HTTP request
under it is `ok, 200` — `refresh` 19:01:33Z (6 pages, 180 weight, restored 0,
verified 0), `credit-confirm` 18:55:16Z, `funding` 19:00:01Z, `confirm`
19:02:03Z; the morning session shows the same pattern (08:30, 08:48). The
resource surfaced it to the operator as "Wallet-adjustment refresh failed.
Showing the confirmed reading from 21:52:00" — the 21:52 stamp is the
bootstrap's `successfulAt`, so the truthful-resource plumbing works. Two
things remain and are not this session's to close:

- **Why is every refresh-class read `partial` while bootstrap completes?**
  `verified: 0` on all of them suggests the verification leg never confirms
  on the refresh path (rows 62, kept 62, missing 0, differing 0, coverage a
  full week). Chronic `partial` means the operator's screen carries a stale
  wallet-adjustment reading essentially always outside the seconds after
  bootstrap. Owned by the settled-income owner
  (`make-settled-income-resource-truthful` / `read-the-settled-money-from-
  the-newest-end`); journal `desk-2026-08-23-000.jsonl` lines above are the
  evidence.
- **Recovery** (failure → later verified success without restart) still has
  no live observation.

The surface itself moved on the operator's word the same evening: the panel
banner is gone, the failure is announced once per episode in the popup
channel, and the one ↻ control also retries the settled reading
(`show-one-pnl-and-let-the-operator-size-the-dock` tasks 1.7). The popup will
therefore fire once per session under the chronic-partial fault above — one
more reason the root cause deserves its owner's sitting.

**Re-read 2026-08-24, after the popup fired at the operator.** Two of the
open questions above are now answered by code and journal, not by sitting:

- `verified` is 1 only on hourly `verification` passes by construction
  (`binance-connection.js:3310`) — `verified: 0` on refresh-class passes is
  labeling, not a broken verification leg. The 2026-08-23 entry's suspicion
  should not be read through that field.
- A `partial` within ~2 minutes of a close or funding settlement is the
  confirmation-debt accounting working: the socket announced a charge, the
  income row is not yet written, `withFuturesSettledConfirmationDebt` holds
  the lane `stale` until the confirming pass proves the row. The 2026-08-24
  18:11:03 popup ("Wallet-adjustment refresh failed … press ↻") fired on
  exactly that state — all six lanes answered `ok, 200`, nothing failed —
  and is a mislabel, owned by the new change
  `say-the-announced-charge-is-still-posting`.
- What remains the settled-income owner's: whether 2026-08-23's *all-day*
  partials were a debt that never cleared (a stuck debt is a real fault,
  distinct from the mislabel), and the still-unobserved live recovery
  (failure → later verified success without restart).

## The 2026-08-24 Verification Sitting

One sitting against desk revision `4d2cb45`, Production account, run from the
runbook assembled the same day. Desk restarts in the journal: 17:40:15 UTC
(bootstrap `restored: 75`, `complete`) and 18:06:47 UTC (`restored: 77`,
`complete`). No `429` anywhere in the day's journal.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `verify-final-futures-pnl-live-data` | 1.2, startup half | `CONFIRMED` | Operator: an already-open position showed its values immediately after start, before History was first opened. Hedge LONG+SHORT half remains unobserved (did not occur naturally). |
| `verify-final-futures-pnl-live-data` | 1.4, restart half | `CONFIRMED` | Two restarts with settled data on hand: `restored: 75` then `restored: 77`, both bootstraps `complete`, columns full without operator action ("работает ок"). The failed-refresh → recovery half remains unobserved (proxy-stop step was not run). |
| `make-futures-upnl-mark-authoritative` | 4.3–4.4 | `CONFIRMED` | uPnL on the test position identical to the app. Mark-vs-chart divergence recognized as designed. Cadence question answered by measurement: the row updates on `@markPrice@1s` — the exchange's 1 Hz stream — so 200 ms is not buyable desk-side. Change archived. |
| `state-what-an-open-position-has-already-paid` | 5.7 | `CONFIRMED` | Test VELVETUSDT position: desk 0.37 commission vs app 0.38 — one-cent rounding class, already settled as not-a-defect; uPnL exact. 5.8 (funding boundary) did not fall inside the sitting and stays open. |
| `let-the-operator-own-the-margin-mode` | 5.4 | `CONFIRMED` | Row updated above: `CROSS 1×` from the first frame after an app-side change with the desk down. |
| `read-only-the-income-the-desk-cannot-derive` | 1.3–1.4 | `ANSWERED` | `rebateRows: 0` across every settled line of the day (no rebate rows on this account; counters keep watching). Operator: positions are isolated by policy, default ×1 isolated everywhere. |
| `verify-final-futures-pnl-live-data` | 1.5, USDC half | `N/A BY OPERATOR, PERMANENT` | "USDC НИКОГДА не использовал и скорей всего НИКОГДА не буду" — USDC is officially unsupported; if that ever changes it gets its own announced change. Deterministic fixture coverage retained. BNB half: **the operator enabled BNB fee payment the same day** (1 BNB transferred, discount toggle on) — every future fee is BNB and the case is now applicable, owned by `value-the-bnb-commission-in-the-result`. Until that change lands, rows will state BNB fees as "not included" and the USDT columns will exclude commission — expected, not a defect. Ruling the same evening from a screenshot of that interim state: no per-row BNB line (title only), plus one global BNB fee-reserve readout marked low under 50 USDT equivalent — folded into the change. |
| `show-one-pnl-and-let-the-operator-size-the-dock` | 3.4 | `MISMATCH RECORDED` | Desk listed 11 closed positions, 12 after ↻; the app lists 20 and lazy-loads older ones on scroll. The desk's window is exactly seven days (`coveredMs: 604800000`); the app's history reaches months back. Whether the missing eight are all older than the window start — which would make the count correct but the bound unstated on screen — is the one question the operator must answer before this is a defect or a display gap. |
| `verify-final-futures-pnl-live-data` / `close-a-round-at-what-reached-the-wallet` / `read-the-settled-money-from-the-newest-end` | 1.1 / 4.5, 6c.3 / 5.2, 9.1 | `MISMATCH RECORDED` | Closed-row sums differ from the app by ~2–3 USDT, and the operator observed the desk's average entry prices are rounded where the app's are not. The tooltip decomposition (realized / commission / funding) was not captured for a disagreeing row; the probe's side-by-side record comparison is the designed instrument and has not run yet (needs `BFK`/`BFS` in the launching shell). Open, next action named below. |

**Defects the sitting surfaced** — both owned by changes filed the same day:

- 18:09:41.958 UTC: first market-close click on the displayed VELVETUSDT
  position refused `FUTURES_REDUCTION_NOT_CONFIRMED` in 1 ms while the
  positions reading was being re-stamped (refresh pass started 477 ms before
  the click, after an 18:09:37 book recovery); second click ten seconds later
  sent and closed in 349 ms. Owned by `close-the-position-the-desk-is-showing`.
- 18:11:03 UTC: "Wallet-adjustment refresh failed" popup on a pass in which
  nothing failed — a confirmation debt from the 18:09:51 close correctly held
  the resource incomplete and the surface called the wait a failure. Owned by
  `say-the-announced-charge-is-still-posting`.

**Not run this sitting** and still open: the funding-boundary block (no
boundary fell in the window), the proxy-stop block (stream states its
silence; settled failure → recovery), and the four-row comparison retold
with tooltip decompositions.

### The probe run — 2026-08-24, after the sitting

The operator ran `scripts/probe-futures-settled.mjs` against Production
(`reason=operator-probe`, 6 lanes, 6 pages, 180 weight, every lane
`complete`). What it settles:

- **`read-only-the-income-the-desk-cannot-derive` 8.1 — closed.** Canonical
  NET equals visible NET on all nine closed rounds; the wallet audit is
  `conserved / disjoint / presentationDisjoint / additive`, canonical and
  assigned totals identical (4654.31822757 USDT); zero skipped rows, zero
  identity conflicts, zero invalid inputs. The change is archived on this
  evidence with its §5 persistence note left open by design.
- **`read-the-settled-money-from-the-newest-end` 9.4 — measured.**
  `identity conflicts: 0` over the window: no key collision on this
  account's rows.
- **The ±2–3 USDT disagreement has a named suspect.** The desk's own two
  records agree exactly, so the gap to the app is not acquisition. The probe
  holds three account-level shared adjustments the rounds do not own:
  funding of **+2.37543496 USDT against CYSUSDT** — the scale the operator
  reported — +16.55220971 against BTWUSDT and −413.36327791 against
  BEATUSDT. They sit outside leg-owned totals because fill coverage cannot
  prove which round they belong to (BEATUSDT: 2000 fills behind an unread
  gap, BTWUSDT: 1024, both `coverage=PARTIAL`), while the Binance app folds
  funding into its position rows. The desk is being deliberately honest
  where the app is being generous; whether that honesty can be narrowed
  (deeper fill reads on the two gapped contracts) is a question for the
  round-fold owner once a disagreeing row's tooltip is read against the
  app's row. Average entry prices are exact in the record (display rounding
  only) — the operator's rounding suspicion is retired.
- Two small probe-report defects noticed in passing: shared adjustments
  print their leg as `undefined:` (`undefined:BEATUSDT`), and the report
  does not print the per-page key-collapse counts §12 promised — `identity
  conflicts` answered the question anyway.
- The acquisition-shape section confirms `rebate rows in the window: 0` and
  an all-flat snapshot at run time.

## The BNB Fee Valuation Archive Handoff — 2026-08-24

`value-the-bnb-commission-in-the-result` is implemented (`cd1a42a`, audited
and corrected in `9307a8f`): a BNB commission is valued at the BNBUSDT close
of each charge's own minute through `/fapi/v1/klines` (cached per closed
minute, never a fee-tier guess, never a forming minute), the valuation joins
the round net and the open position's settled money while `feesByAsset` and
per-asset wallet conservation stay untouched, the row face shows one USDT
number with the BNB decomposition in the title, an unreadable price degrades
to the "not included" statement, and the dock carries the global BNB
fee-reserve readout (amount and worth, low under 50 USDT equivalent, absence
and unreadability stated as themselves). Deterministic coverage bites: the
valued-net, one-number-face, reserve and gate tests all fail against the
pre-change code; full suite 128 files / 2,912 tests, lint, the four boundary
guards and the build pass. The operator requested commit and archive; the
account has not yet paid its first BNB fee, so archive records
implementation completion and is not live evidence.

| Change | Task / case | Status | Observation date | Account | Desk revision | Evidence / remaining check |
|---|---:|---|---|---|---|---|
| `value-the-bnb-commission-in-the-result` | 1.2 | `OUTSTANDING` | `NOT RECORDED` | Production | `9307a8f` | The account's first BNB-fee fill has not happened. To record: the fill's `commissionAsset`/amount on the wire, the matching income row's asset, and whether the Binance app's Position History "Реализ. PnL" folds the converted fee into its own figure — that third fact decides what "agrees with the app" means for 5.1, not the desk's arithmetic. |
| `value-the-bnb-commission-in-the-result` | 5.1 | `OUTSTANDING` | `NOT RECORDED` | Production | `9307a8f` | First BNB-fee closed round against the Binance app: PnL column agrees to the settled one-cent rounding class; the row title names the BNB quantity, the USDT valuation and the price used; the reserve readout shows the drained amount. Until the first fill, rows state BNB fees as expected and only the reserve readout is observable live. |
| `value-the-bnb-commission-in-the-result` | 5.1 archive | `ARCHIVE AUTHORIZED WITH LIVE CHECK OUTSTANDING` | 2026-08-24 | Production | `9307a8f` | The operator explicitly requested archive after the audit pass. Tasks 1.2 and 5.1 above remain outstanding here and archive is not their proof. |

## The 2026-08-25 Operator Runbook Pass

The operator ran the assembled runbook
(`changes/verify-final-futures-pnl-live-data/runbook.md`) against desk
revision `d015e22`, Production account. Journal: `desk-2026-08-25-000.jsonl`
(and `desk-2026-08-24-001.jsonl` for the quiet night session). No `429` and
no rate-limit responses anywhere in either file.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `close-the-position-the-desk-is-showing` | 5.1 | `CONFIRMED` | Operator: a market close "uходит с первого клика" during ordinary trading. No refusal episode to record — the named-condition path stays covered by tests. |
| `verify-final-futures-pnl-live-data` | 1.4 | `CONFIRMED` | Both halves now observed. Restart half: 2026-08-24 sitting. Failure→recovery half today: proxy stopped 07:26:03Z (`futures-user-data` fault `SOCKET_CLOSED`, then `ECONNREFUSED` retries to 07:26:17), operator saw "куча сообщений", the chart froze, and ↻ answered an honest failure message; proxy restored and the first `ok, 200` request landed 07:26:21Z — the desk's own `networkRetries: 2` bridged the gap, recovery "практически мгновенно" with no restart. The same-shape-correction case did not occur and stays a natural-occurrence watch. |
| `prove-the-private-stream-is-carrying` | 1.5 / 5.3 | `CONFIRMED (runbook step, left unchecked in tasks by convention)` | Quiet half: an ordinary session writes no `futures-user-data` chatter at all — `desk-2026-08-24-001.jsonl` holds exactly one line, `STREAM_ABANDONED` at 20:00:48Z on the planned deploy restart; today's file holds only the outage episode. Break half: the break names itself, `SOCKET_CLOSED` → `ECONNREFUSED`. `RECONNECT_EXHAUSTED` was not reached — the proxy returned in ~18 s, before retries exhausted — and the optional `kill -STOP` silence probe was skipped, as the step permits. |
| `close-a-round-at-what-reached-the-wallet` | 4.5, 6c.3 | `CONFIRMED, WITH A FINDING` | Operator compared closed rows against the app and the figures agree — **against the desk's net**: "в бинанс-апп в строке PnL бинанс показывает то, что у нас отображается как Visible Net". The app's headline is a net, not the gross realized; the desk's PnL column (gross, chosen 2026-08-23 as "the figure the app shows") therefore differs from the app's headline by exactly commission+funding on every row, while the net on the element matches. Open follow-ups: the screen name (1.4) and one row's exact label (Wallet Net vs Visible net on a BNB-fee row) are asked of the operator; whether the column itself should become the net is the operator's call and would be its own change. |
| `read-the-settled-money-from-the-newest-end` | 5.2, 9.1 | `CONFIRMED` | Same observation: the rows agree with the app once the net is the figure compared. |
| `value-the-bnb-commission-in-the-result` | 1.2 (partial) | `OUTSTANDING, NARROWED` | Fee payment in BNB is live: "уже было несколько трейдов и BNB тратится" — the reserve drains with each fill, so `commissionAsset: BNB` is charging. Fee-valuation plumbing works on the wire: the journal carries `account.feeValuation` commands answered `ok` with weight-1 `read reason=fee-valuation` lines (first burst 06:31:09–06:31:14Z). Remaining for 1.2: the income `COMMISSION` row's asset (one signed read; the desk does not read that lane) and the app-fold fact, which the B3 answer below settles. |
| `value-the-bnb-commission-in-the-result` | 5.1 | `OUTSTANDING` | Waits on the operator's B3 reading: the row's label word, the fee line in the title, and the app's number for the same row. |

**Operator ruling recorded, 2026-08-25:** the reserve face shows the BNB
amount at two decimals ("стоит округлить до 0.00 для BNB") — implemented in
`c8da790` with the non-zero-never-0.00 guard, exact text kept on the element.

**Instrumentation finding, fixed the same pass:** the reserve chased every
new minute — one weight-1 klines ask per minute, minute-aligned in the
journal (07:28:10, 07:29:10, 07:30:10…). A standing poll nobody needed:
`c8da790` bounds the refresh to a five-minute-old price
(`FUTURES_FEE_RESERVE_REFRESH_MS`), the readout still names its price's
minute.

**Still open from the runbook:** A2 (closed-count window question), B3 (one
BNB row's label + numbers), C1 (funding boundary), and `verify-final` 1.1's
per-row transcript (symbol, cents, exact, app value for four rows).

### B3 answered — 2026-08-25, the BNB gates close

The operator read a BNB-fee closed row's element on desk revision `c8da790`:
the label is **"Wallet Net"** (the valuation branch is live, not degraded),
the title carries the fee line with **both quantities** (the BNB charge and
its USDT valuation at the named BNBUSDT price), and the number **matches the
Binance app to the cent**.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `value-the-bnb-commission-in-the-result` | 5.1 | `CONFIRMED` | First BNB-fee closed rounds agree with the app to the cent; the element names the BNB quantity, the USDT valuation and the price used; the row face is one number. Closes the archive-handoff row above. |
| `value-the-bnb-commission-in-the-result` | 1.2 | `CONFIRMED` | Fill asset: the desk's own `/fapi/v1/userTrades` read carries `commissionAsset: BNB` — that is what the fold valued and the reserve drains against. App fold: the app's headline equals the desk's valued net, so the converted fee **is** folded into the app's figure — "agrees with the app" means net-to-net, as the proposal required recording. Income `COMMISSION` row's asset: not separately read — the desk reads no COMMISSION lane by design (derivable from fills); recorded as unread-by-design rather than assumed. |
| `verify-final-futures-pnl-live-data` | 1.1 | `CONFIRMED` | The operator confirmed row agreement twice: across the compared rows on 2026-08-25 (against the net) and for a BNB-fee row to the cent in this reading. Per-row transcript (symbol, cents, exact, app value) was not taken — this row stands on the operator's word, stated as such. |

### The net column confirmed — 2026-08-25

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `show-one-pnl-and-let-the-operator-size-the-dock` | 6.3 | `CONFIRMED` | Operator on `d855ca2`: "теперь вижу net" — the Closed Positions column reads as the app's headline does. |

### The false refresh failure, reported live — 2026-08-25

The operator hit the popup on opening *and* closing a position and sent the
screenshot: "Wallet-adjustment refresh failed. Closed-position PnL keeps the
confirmed reading from 18:28:56. Press ↻ to retry." — the exact case
`say-the-announced-charge-is-still-posting` was written for, now reproduced
from the desk rather than from the journal, and on the open side too (an
opening fill announces its commission the same way a close does).

Fixed in `efa9d4a`: the two states an incomplete settled resource can be in
are told apart by one shared classifier, the debt-only state is stated on the
round's money element instead of the popup channel, and the `settled` journal
line carries `partialKind` with the lanes owing a confirmation.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `say-the-announced-charge-is-still-posting` | 1.1–1.3, 2.1, 3.1–3.2, 4.1–4.2 | `IMPLEMENTED` | `efa9d4a`. Three biting tests verified against `main`'s pre-change files: the panel test reproduced the operator's exact popup text before the change, the journal test failed on the missing `partialKind`, the classifier is new. Full suite 2921/2921, lint clean, four guards pass. |
| `say-the-announced-charge-is-still-posting` | 3.1 (second cut) | `IMPLEMENTED` | `14fb863`. The first cut passed `partialKind` to `record()` and the journal wrote it nowhere: `desk-diagnostic-record.js` copies **only** the fields a kind declares, and the `settled` kind declared neither. Caught by reading the operator's 17:40:05Z line, not by the suite — `binance-connection.test.js` mocks `record` and asserts the payload upstream of that whitelist. Both fields are declared now and asserted at `describeDeskDiagnosticEvent`; the live desk's 18:14:09Z line carries them. Pre-existing, not fixed here: `incomeTypes`, `generation` and `status` are built on every settled pass and have never reached the file — the record's owner may want them declared, and a list needs a validator that file does not have. |
| `say-the-announced-charge-is-still-posting` | 5.1 | `CONFIRMED` | Operator on `14fb863`, minutes after the deploy: "проверил только что — ошибки не было". The case demonstrably arose rather than being absent — the journal carries the VELVETUSDT fill at 18:27:20.426Z (an opening fill arms the credit-confirm debt exactly as a close does, `binance-connection.js` `armFuturesSettledConfirmation('fill')`), and the confirming pass at 18:29:23.336Z cleared it: `reason: credit-confirm, partialKind: short, awaitingLanes: 0`, no ↻ pressed. What the operator did not separately read: the "still posting" wording on the element and the row's own promotion to Wallet Net — both covered by biting tests, neither observed live. The real-failure half rests on D1's proxy stop (2026-08-25, popup fired once and recovery was immediate) and the unchanged code path, not on a second outage. |

**Reading the new field, for whoever asks the chronic-partial question next:**
`partialKind: short` with `awaitingLanes: 0` is the *ordinary* outcome of a
partial-lane confirm pass — that pass advances only its own lanes' target, so
the aggregate target runs ahead of the lanes it did not read. It says "nothing
is owed by a debt; coverage lags", not "something failed". A standing debt is
`awaitingLanes` above zero, and the same lane count pass after pass is what the
2026-08-23 all-day partials would look like if they were a stuck debt.

### The chart plates move to the quiet side — 2026-08-26

The operator sent a screenshot: the working order's handle
(`SHORT · 31215 USDT · ×`) and the position's `ENTRY SHORT` plate sat against
the right edge of the plotting area, over the newest candles — "мешают когда я
ставлю или двигаю ордера" — and proposed moving them to the left.

Measured in Chromium against a fixture before touching anything (jsdom lays
nothing out): plot area 0–828 of a 900px frame, annotation at 748–828, handle
at 699–828 — both ending exactly on the plot's right edge, gap 0. After
`11d8384`: 0–80 and 0–129, clearing that edge by 748px and 699px.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `draw-the-price-plates-on-the-quiet-side` | 1.1–3.3 | `IMPLEMENTED` | `11d8384`. Mirrored rather than moved (coloured edge follows the plate, contents pack to the anchored edge), and the layer now stacks above the corner boxes it joined on the left so a draggable handle cannot vanish under ambient text. Biting test verified against `main`'s stylesheet; full suite 2923/2923, lint clean, four guards pass. |
| `draw-the-price-plates-on-the-quiet-side` | 2.4, 3.4 | `IMPLEMENTED` | `f796857`. The operator looked the same day: "плашки слева - ок, но я бы сделал еще небольшой отступ именно у ордеров, чтобы они не висели прям у самой левой кромки". The handle is held off by the gutter the desk already writes its corner notices at, and shortened by the same amount so the inset cannot push its far end into the price scale; the annotations stay flush, being read rather than reached for. The test takes the gutter from the reading notice's own rule instead of restating it. Re-measured in Chromium: handle 8–137, annotation 0–80. |
| `draw-the-price-plates-on-the-quiet-side` | 4.1 | `PASSED` | Operator, 2026-08-26: *«как оператор подтверждаю всё работает как я и ожидал»*, closing every gate open at that moment. The left side was separately approved in words earlier the same day — *«плашки слева - ок»* — and the gutter that followed is `f796857`. Closed on the operator's use of the desk rather than on an itemised walkthrough of the four items; recorded that way so a later reader does not take it for one. |

### The watched position gets a price that keeps up — 2026-08-26

The operator, in the same message: *"надо чтобы наша UPNL цена чаще обновлялась
в позициях на график которых я сейчас смотрю - а то бывают тормоза когда
сильные движения и MARK PRICE сильно отстает от того что я вижу глазами на
графике."*

Measured on the live exchange through the operator's proxy before deciding
anything, because two different things could have been true and only one of
them was fixable by refreshing harder:

- **The mark's cadence is the exchange's, and it is already at maximum.** 239
  frames in 240 seconds on each of BTCUSDT, ETHUSDT and DOGEUSDT; gap p50
  1000 ms, p95 1012 ms, worst 1141 ms. `@markPrice@1s` is the fastest mark
  route Binance publishes, and the desk is already on it.
- **The mark is a different quantity from the chart's price.** Against every
  print in that window the held mark sat 0.5 bps away at the median (1.16 on
  DOGEUSDT), 2.4–3.5 bps at the 95th percentile, and up to 5.8 bps in the
  fastest 5% of seconds. No refresh rate closes that.
- **The desk was adding age of its own.** Marks for four contracts land within
  2 ms of each other (p95 3 ms, worst 6 ms), and the feed held every one of
  them in a 200 ms coalescing window sized to fold exactly that together.
  Transit is a further 220 ms (p95 232 ms).

So the displayed value could be about **1.4 s old** — 1000 ms of the exchange's
quantisation, 220 ms transit, 200 ms of the desk's own window — beside a chart
redrawing on every print (ETHUSDT printed 8.3 times a second in that window,
DOGEUSDT 1.4).

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `value-the-watched-position-at-the-price-on-the-chart` | 1.1–3.4 | `IMPLEMENTED` | `fbf954a`. The contract on screen has its own tape — the `@aggTrade` stream the chart is already drawn from — joined to the position mark store, coalesced to ten a second. The position states what it is worth at that price under its own name on its own line, 11px neutral grey under the 17px position-toned headline (measured in Chromium; jsdom lays nothing out). The mark stays the headline and the only input to ROE, margin, liquidation and the dock total, which is what the canonical requirement already fixes. The coalescing window is cut 200 ms → 25 ms, four times the worst measured spread. Five biting tests, each verified failing against the pre-change file it covers; full suite 2935/2935, lint clean, four guards pass. |
| `value-the-watched-position-at-the-price-on-the-chart` | 4.1 | `RETIRED` | Never looked at. The operator answered the shipped behaviour in words the same day (next section), and the check no longer describes the desk: the "At last" line it was written for is gone, and the headline it was written to protect has moved. Replaced by task 4.1 of `price-every-open-position-at-the-last-print`. That change's `futures-workstation-presentation` delta was withdrawn rather than left to reach canon; its `futures-order-visibility` delta on the coalescing window stands. |

**Not built, and deliberately:** the one lane carrying the price behind uPnL is
the only lane the desk cannot time. `markAccountFrame` refuses to stamp a
`futures_position_marks` frame because the payload's own price map is already
called `marks` and the transport stamp would be the same key twice — so the
frame instrument covers header, candles, depth, trades, account and orders, and
not this one. That is why the numbers above come from a probe rather than from
the operator's journal. Measuring it needs the key collision resolved and a
commit boundary defined for a store that deliberately does not set React state;
it is its own change.

### Every open position moves with its own contract — 2026-08-26

The operator, having looked at the change above on the same day: *"мне до сих
пор не нравится скорость с которой обновляется uPnL у открытых позиций — для
скальпинга это слишком медленно. я бы предложил — чтобы на все открытые позиции
мы держали сокет соединение с последней ценой и обновляли быстрей, чем сейчас."*

Two corrections in one sentence. **Coverage**: the printed price reached only
the contract on screen, and positions in contracts the operator is not looking
at were the ones sitting on a price up to a second and a half old.
**Weight**: the printed price was a second line under a headline that still
moved once a second, and the headline is what is being watched.

Measured again through the operator's proxy, 180 s, BTCUSDT/ETHUSDT/SOLUSDT/
DOGEUSDT on one combined stream, 50.5 frames a second in total:

- **Mark cadence, confirmed against a fourth contract.** 178 frames per contract
  in 180 s; gap p50 1000 ms, p95 1015 ms, worst 1272 ms.
- **The contracts print far faster.** BTCUSDT 25.5 trades a second (gap p95
  196 ms), ETHUSDT 15.0 (354 ms), SOLUSDT 4.0 (712 ms), DOGEUSDT 2.0 (1609 ms,
  worst 6579 ms).
- **And the price moves inside a mark second.** Roam from the standing mark,
  per mark-second: p50 0.68 bps (BTC), 0.80 (ETH), 1.15 (SOL), 1.99 (DOGE);
  worst 3.59 / 6.02 / 6.20 / 6.99. On a 10 000 USDT position that is up to
  7 USDT that existed and was not on the row until the second was over.
- **Transit** p50 210–336 ms, p95 341–403 ms.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `price-every-open-position-at-the-last-print` | 1.1–3.5 | `IMPLEMENTED` | `ca8be7e`. `<symbol>@aggTrade` joins `<symbol>@markPrice@1s` on the feed's existing combined socket for every contract carrying a position — no new socket, no credentialed subscription, no request weight. A position is read at whichever of its two prices the exchange stated more recently, with `FUTURES_LAST_PRICE_GRACE_MS = 1500` above the worst measured mark interval (1272 ms) so the mark's metronome cannot take the reading off a contract that is printing, and below the mark's own age so the fallback is never worse than what it replaces. Notional, margin, margin balance, removable margin and the liquidation buffer stay on the mark; the mark's own uPnL is carried on every row under its own name — a quiet 11 px line on the ticket card, and in what the dock row and the total say about themselves. The renderer's watched-contract tape path is removed: one source for every position. Nine biting tests, each verified failing against the pre-change file; two named as guards rather than biters. Full suite 2934/2934 across 128 files, lint clean, four guards pass. |
| `price-every-open-position-at-the-last-print` | 4.1 | `PASSED` | Operator, 2026-08-26, having traded through it: *«теперь обновление было вообще REALTIME — СУПЕР!»*, and then *«как оператор подтверждаю всё работает как я и ожидал»*. Rows move with their own contract rather than once a second, on `ca8be7e`. |

**Known and accepted:** the headline now disagrees with the Binance app's
default display by the deviation measured above — about 1 bp of notional at the
median, up to 7 bps in a fast second. The app offers the same choice
(*Calculate PnL based on: Last Price*); this desk states both figures at once
instead of asking for a setting. A reconciliation done by eye against the app's
default screen must use the mark line, not the headline.

**Still not built:** the `futures_position_marks` lane remains the one lane the
frame instrument cannot stamp, for the `marks` key collision recorded above.
Second change running whose numbers come from a probe rather than from the
operator's journal.

### The operator owns the reprice rate — 2026-08-26

*"отлично, теперь обновление было вообще REALTIME — СУПЕР! Но я бы предложил
ограничить его значением таймаута которое выставлено в меню Aggregate Trades."*

The behaviour was right; the rate is theirs. The desk already had the dial —
**Aggregate trades → Throttle / Timeout (ms)**, 16–5000 ms, default 250 — and a
second control for the same question would have been two numbers to keep in
step. What it bounds, measured: BTCUSDT prints 25.5 times a second, which the
coalescing window turned into up to 40 publications a second, each a full frame
across IPC and a re-render of every position row and the dock total. At the
menu's default that is four a second.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `let-the-operator-bound-how-often-a-position-is-repriced` | 1.1–3.4 | `IMPLEMENTED` | `a9079db`. The feed gates print publications on the operator's tape timeout, floored at its own coalescing window (25 ms), with `throttleEnabled: false` meaning that floor. The first print of a move publishes on the window so the start of a move is seen at once; prints inside a shut gate supersede one another and the newest goes out when it opens; shortening the bound releases a price already waiting. Marks are never bounded by it — one a second is already slower than anything that menu accepts, and it is what funding, margin and liquidation are decided on — so a mark publishes on the coalescing window and carries whatever has printed since. The minimum trade size does not reach the positions: a small print is as real a price as a large one. The connection reads the workstation service's applied settings after each workstation request, so one place decides the number and both followers read it. Four biting feed tests, one biting connection test on the seam itself (verified failing with the wiring line removed), one view test on the panel's own statement. Full suite 2939/2939, lint clean, four guards pass. |
| `let-the-operator-bound-how-often-a-position-is-repriced` | 4.1 | `PASSED` | Same sitting, same words: *«как оператор подтверждаю всё работает как я и ожидал»*, on `a9079db`. |

**Watched for:** a dial that reaches past its own panel is a trap for whoever
moves it next — including the operator months from now, turning the tape down to
read the trade list and quietly slowing their position rows with it. The panel
states both effects, and the floor means the setting can never make a position
slower than the mark it would otherwise sit on.

### Self-audit of the reprice work — 2026-08-26

Run on the operator's word before archiving. Three defects, all of the same
kind: the change moved the rule and left older statements of the old rule
standing where nothing was testing them.

1. **The dock's uPnL column heading still stated the overturned rule** — *"uPnL,
   ROE and size use the exchange mark… trades between marks do not alter these
   readings."* A heading weighs as arithmetic (operator ruling, 2026-08-20), and
   no test guarded it, which is why it went stale silently. Rewritten to state
   what the cells under it actually do, and now covered by a test asserted
   against those cells rather than against its wording.
2. **The canon said the same thing twice more, in requirements this change never
   touched** — `futures-workstation-presentation`'s "Position rows are valued at
   the live mark price" (*"unrealized PnL SHALL follow the incoming mark…
   aggregate trades SHALL NOT alter these readings"*) and
   `futures-order-visibility`'s "A position row that disagrees with the chart
   says why" (*"the desk SHALL NOT resolve the disagreement by valuing the row
   on the tape"*). Archiving as it stood would have produced a canon that
   contradicts itself — which is the exact reconciliation the 2026-08-24 change
   was raised to perform once already. Both are now removed with reason and
   migration, and replaced by requirements that keep every rule of theirs that
   survives.
3. **A note that referred to two prices it had not named.** On a raw account
   position with no live valuation, `futuresPnlReadingNote` could open with *"the
   two are on opposite sides of your entry"* having named neither. Gated on the
   naming sentence being present; test added.

Also stated, not changed: the position card's `Last` and the market header's
`Last` are the same quantity read at two cadences — the card at the operator's
Aggregate trades timeout, the header on every repaint — so during a fast move
they can stand a fraction of a second apart. The card says so on the row.

Checked and found sound: the main process's margin/liquidation estimator reads
the feed's `snapshot()`, which carries mark prices only, so nothing the exchange
decides moved onto a printed price; the margin editor's removal gate reads
`markUnrealizedPnl` first; `broadcastFuturesPositionMarks` does not touch the
diagnostic journal, so raising the publication rate did not inflate it.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `price-every-open-position-at-the-last-print` | audit | `IMPLEMENTED` | `87543ae`. Three defects above fixed, each with a test verified failing against the pre-fix file. Full suite 2941/2941 across 128 files, eslint clean across the whole repo, four guards pass, build passes. |

## The 2026-08-30 Operator Sitting

The operator traded through the day on desk revision `913582b` (the plate
series). Journal: `desk-2026-08-30-000/001/002.jsonl`. Verdict in their own
words: plates and orders — "все ордера нормально двигаются, все нормально
отображаются, все видно как нужно"; funding — "дождался фандинга, фандинг
был". The plate change's live gates (2.1–2.5) were closed and archived the
same day in `6b6f703`; the funding rows below are this sitting's.

| Change | Task | Status | Evidence |
|---|---:|---|---|
| `state-what-an-open-position-has-already-paid` | 5.8 | `CONFIRMED` | Operator held positions across a funding boundary and reported the funding present and displaying correctly. Journal countersigns: three boundaries in the day (00:00Z, 16:00Z, 20:00Z), each a `reason: funding` settled pass ~2 s after the boundary arming the confirmation debt (`partialKind: debt-only, awaitingLanes: 1`) and one `reason: confirm` pass at +2:00 clearing it (`awaitingLanes: 0`). `fundingRows` stepped 66 → 67 across the 16:00Z boundary. |
| `close-a-round-at-what-reached-the-wallet` | 4.6 | `CONFIRMED` | Same observation and journal evidence. 1.4 (which app screen was compared) remains the one open item on this change. |
| `verify-final-futures-pnl-live-data` | 1.3 | `CONFIRMED` | Posting latency: debt armed within ~2.5 s of each boundary; single confirming pass at +2:00, no duplicate confirm requests; two-minute horizon sufficient on all three boundaries; no `Wallet-adjustment refresh failed` popup reported. |
| `the-ledger-reads-the-exchanges-alphabet` | 2.1–2.3 | `CONFIRMED` | Operator, 2026-08-30, after a day trading 龙虾USDT (515 frames, commands and positions in the journal) through the day's funding boundaries: "да все ок" — the pair's funding reaches the settled ledger and agrees with the app, its closed rounds anchor without a standing "reading", and its book grouping survived the day's desk restart (18:47:24Z in the journal). Change archived on this confirmation. |

**Defect the sitting surfaced — the desk stalls while an order is partially
filling. Measured, unowned as of 2026-08-30; the operator asked whether it is
worth fixing.** Two distinct mechanisms in the same evening session
(`desk-2026-08-30-002.jsonl`, 17:10–20:10Z, fill bursts of 25–59
`PARTIALLY_FILLED` frames a minute on SKRUSDT):

1. **The orders surface stops drawing during a fill burst.** 286 of 409
   order-frame journal lines that session are `NOT_DRAWN` (84 `DELIVERED`,
   39 `UNCHANGED`), concentrated exactly in the burst minutes (17:25–26: 107,
   18:56: 47, 19:17: 49). The renderer commit leg runs 300–500 ms per frame
   against the 9–11 ms baseline of 2026-08-18 — at several frames a second
   the renderer thread saturates, which is the visible freeze while dragging.
   `NOT_DRAWN` is the instrument's own fault verdict, not an interpretation.
2. **Trading commands queue behind the desk's own read spend.** At 18:47:00
   the weight window stood at `spent: 799–800` of 800 and `deferred` lines
   show waits of 9.2–14.5 s — including an **urgent weight-1** ask waiting
   9 229 ms, so urgent standing does not preempt a fully spent window (at
   17:27:59 an urgent weight-5 waited 33 574 ms). Answers in the episode:
   `trade.placeOrder` 9 573 ms, `trade.replaceOrder` 11 532 ms, six
   `trade.cancelOrder` at 4 230–5 356 ms, `account.feeValuation` 30 192 ms —
   all `ok`; the exchange refused nothing. What spent the window: fifteen
   90-weight `refresh` reads over 18:40–18:46 (the 30-second reconcile
   cadence while orders rest — `one-command-two-callers`), the burst's
   credit-confirm income passes, and — after the desk restart at
   18:47:24–27Z that fell inside the episode — the bootstrap volley
   (`reason: bootstrap` 18:48:00, `complete`), which pinned the next window
   too. Same family as `a-wait-bounded-by-a-window-is-self-inflicted`: the
   budget is the desk's own, not the exchange's.

Neither mechanism misprices anything — frames that did not draw were
superseded, commands all landed — but both put seconds between the operator's
hand and the book during exactly the moments a scalper acts. Recommended as
two separate changes: (a) coalesce or cheapen the orders/account commit path
under a fill burst so frames draw inside their budget; (b) keep standing
headroom for command-class weight under the ceiling and thin the standing
refresh while the private stream is already carrying the fills.
