## 1. Keep the held configuration honest

- [x] 1.1 Run impact analysis for `applyFuturesLeverageFromStream`, `refreshFuturesPositionConfigs`, `heldFuturesSymbolConfig`, `readFuturesSymbolConfig` and the renderer's `symbolConfigs` reducer; record direct callers and warn before any HIGH/CRITICAL edit. Where GitNexus cannot answer, say so and use grep as the authority rather than reporting a 0/LOW it did not measure
  - GitNexus refused: its index is written by a newer build (`Database file version: 42, Current build storage version: 40`), so every `impact` call answers `impactedCount: 0` with `risk: UNKNOWN` and an error string. That is a refusal, not a measurement. Blast radius by grep: `applyFuturesLeverageFromStream` one caller (the `accountConfigUpdate` branch of the stream loop); `refreshFuturesPositionConfigs` two (the account pass and the position fold); `heldFuturesSymbolConfig` one (inside `refreshFuturesPositionConfigs`); `readFuturesSymbolConfig` four (the three command handlers and the position-config pass); the renderer's `symbolConfigs` one writer and three readers (the ticket's leverage and mode, the leverage panel, `mergeFuturesPositionConfigs`). No HIGH or CRITICAL surface among them.
- [x] 1.2 Remove the `futuresSymbolConfigReadAt` write from `applyFuturesLeverageFromStream` (`binance-connection.js:1392`), leaving the leverage update and broadcast, and verify by measurement that a leverage frame no longer postpones the contract's next configuration read
- [x] 1.3 Remember the contract last asked for through `account.symbolConfig` and include it in the symbol set `refreshFuturesPositionConfigs` builds, so a startup read that failed or was superseded is issued again on a following account pass; verify by measurement that a held configuration is not re-read once per account beat
- [x] 1.4 Make the renderer's startup read deliberate rather than incidental: re-send the pending `account.symbolConfig` when the backend connection opens instead of relying on `sendCommand`'s identity changing, and verify with the socket closed at mount that the read still lands once it opens
- [x] 1.5 Drop the renderer's held `symbolConfigs` whenever the backend drops its own (market deactivated, credentials changed), and verify no surface keeps stating a configuration after the market is left

## 2. Stop deciding the margin mode, and default to 1×

- [x] 2.1 Run impact analysis for `planFuturesContractDefaults`, `useFuturesContractDefaults`, `FUTURES_DEFAULT_LEVERAGE` and `FUTURES_DEFAULT_MARGIN_TYPE`, and report the blast radius before editing
- [x] 2.2 Remove the margin-mode half of `planFuturesContractDefaults` — the `needsIsolated` rule, the working-order carve-out that existed only for it, and `FUTURES_DEFAULT_MARGIN_TYPE` — keeping every leverage guard intact
- [x] 2.3 Set `FUTURES_DEFAULT_LEVERAGE` to 1 and verify the planner still refuses to raise, still leaves a contract holding a position alone, and still says nothing before the positions are read or while trading is paused
- [x] 2.4 Stop passing `setMarginType` into `useFuturesContractDefaults` from `FuturesProductionWorkstation` and verify no automatic path can reach the command any more

## 3. State the mode, and make it the control

- [x] 3.1 Run impact analysis for `FuturesTradingTicket`, `FuturesLeverageEditor`, `buildFuturesOrderConfirmation` and the workstation's editor wiring
- [x] 3.2 Pass the selected contract's margin mode into the ticket and render it beside the leverage chip as `ISO`/`CROSS`, with an absent mode stated as unknown rather than as isolated
  - Measured in Chromium across 54 cases (rail 250/270/310px × ui-scale 0.85/1/1.2 × a 7- and a 14-character symbol × three chip contents): nothing clips anywhere. A fourteen-character symbol on a rail of 270px or less does wrap, and the chips are grouped so they wrap together — 59px instead of 68px, and the multiple is never left stated without the mode beside it. Seven-character symbols are unchanged at 33px.
- [x] 3.3 Make that chip the control: acting on it sends the other mode for the named contract through `trade.setMarginType`, and a send the local backend did not accept says the mode was not changed rather than showing the requested one
- [x] 3.4 State the exchange's own reason locally where the desk already holds it — a position on the contract (`-4048`) or a working order (`-4047`) — and send nothing in those cases
- [x] 3.5 State the margin mode on the confirmation panel beside the multiple, in the liquidation colour, as a reading and not a control, with unknown stated as unknown

## 4. Tests after implementation

- [x] 4.1 Run each new test against the pre-change code in a copy of the tree; anything that passes there is a watchman, not a test, and is named as one or replaced
  - Copy of the working tree with only this change reverted (the other session's uncommitted work left in place). 34 of the 39 tests in the touched files fail there. The 5 that pass guard rules this change did not touch — the once-per-contract rule, the resend after a refused send, the paused and unread-account gates — and are named as guards in the file rather than presented as evidence.
- [x] 4.2 Update `futuresContractDefaults.test.js` and `useFuturesContractDefaults.test.js` for the 1× target and for a cross contract that stays cross, including the restart case: a contract the operator set to `CROSSED`, read again in a fresh session, sends no margin-mode command
- [x] 4.3 Add ticket and confirmation tests for the mode reading, the unknown mode, the toggle send, the undelivered send, and both locally-refused cases
- [x] 4.4 Add backend tests for the freshness stamp — a leverage frame that updates the multiple without restarting the hold — and for a failed startup read being issued again on the next account pass while a held one is not
- [x] 4.5 Add a renderer test that held configurations are dropped when the market is deactivated or the credentials change
- [x] 4.6 Run the broader Futures hook, workstation, adapter and connection suites, and record any baseline-only failure separately
  - Whole suite: 118 files, 2328 tests, 0 failures. No baseline-only failure to record. `lint`, `check:circular`, `check:futures-production` and `check:command-path` all pass.

## 4b. What the operator's live check found, and the fixes for it

The operator ran the ticket's mode chip and the leverage panel against the live exchange
on 2026-08-21. The chip behaved as specified: on a contract carrying a position it stated
the reason and sent nothing. The leverage panel beside it did not.

- [x] 4b.1 The panel promised what the exchange does not do. Raising 1× to 2× on an open
  position was announced as "its liquidation price moves closer to the mark", and nothing
  about the position moved. It should never have said so: the liquidation price the desk
  draws comes from `liquidationPrice()` in `futures-account-margin.js`, whose terms are
  the margin behind the position, the contract's maintenance rate, the entry and — in
  cross — the whole wallet. There is no leverage term in it, and that estimator agreed
  with the exchange's own figure to **0 bps on this operator's ONGUSDT** earlier the same
  day. What the multiple does set is `initialMargin = notional / leverage`, the margin the
  exchange *requires*, which is why the change moves free margin and not the liquidation
  price. Copy replaced per mode, and the same claim removed from the module header, the
  planner's comments, the CSS note and the spec requirement that produced it
- [x] 4b.2 The panel offered a change the exchange refuses. Putting the multiple back to
  1× answered `-4161` at 20:04:17.687Z. Binance's USDⓈ-M error-code document:
  `-4161 ISOLATED_LEVERAGE_REJECT_WITH_POSITION` — *"Leverage reduction is not supported
  in Isolated Margin Mode with open positions"* (fetched through the proxy from
  `developers.binance.com/en/docs/llms-full.txt`, USDⓈ-M block, not the Portfolio Margin
  one beside it). All three inputs of that rule — the position, the mode, the direction —
  were already on the desk. Refused locally now, on the same terms as `-4048`/`-4047` on
  the mode chip, with the mode wired into the panel from the same held configuration
- [x] 4b.3 A refusal that does reach the exchange now names its contract. The record wrote
  `symbol: null` beside `exchangeCode: -4161` on a day the desk had touched three
  contracts; these two commands carry no order identity, so the contract is the whole of
  it. `-4161` also joined the hint table, which is what turns a code into an instruction
- [x] 4b.4 Tests, and the bite check against a copy of the tree with only this round
  reverted: 5 of the 7 new or rewritten tests fail there. The 2 that pass are the
  width-of-the-rule guards — a cross contract and a flat isolated one still send — which
  cannot bite code that refuses nothing locally, and are named as guards in the file
- [x] 4b.5 Measured in Chromium, 15 cases (5 status lines × ui-scale 0.85/1/1.2): the
  panel grows 331 → 346px at scale 1 and 384 → 403px at 1.2, nothing overflows its width,
  the Apply button is not clipped and stays inside the panel in every case

## 5. Verification and operator gate

- [x] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate let-the-operator-own-the-margin-mode --strict` and verify it passes
- [x] 5.2 Run `detect_changes` against `main`, confirm only the configuration, default and ticket flows are affected, and resolve unexpected symbols before commit
  - `detect_changes` could not be run: it is an MCP tool, the MCP server is not connected here, and the CLI exposes no equivalent — and the index it would read is a storage version this build refuses anyway. Confirmed by diff instead: ten source files, all inside the configuration read, the contract default, the ticket and the confirmation panel. No other flow is touched.
- [x] 5.3 Confirm the edit reached the working tree the desk runs from, by grep against the file on disk rather than against `HEAD`
- [ ] 5.4 Operator check, on the exchange and not only on the desk: with the desk stopped, set a flat contract to cross ×1 in the Binance app; start the desk on that contract and confirm it states `CROSS 1×` from the first frame, and that the day's journal contains no `trade.setMarginType` and no `trade.setLeverage` for it. Keep unchecked until the operator confirms
- [ ] 5.5 Operator check: toggle the mode from the ticket on a flat contract and confirm the exchange holds the new mode; then toggle it on a contract with a position and confirm the reason is stated with no request sent. Keep unchecked until the operator confirms
  - Second half confirmed 2026-08-21: on a contract carrying a position the chip stated the reason and no `trade.setMarginType` reached the exchange for it. Left unchecked for the first half — the flat-contract toggle has not been run
- [ ] 5.8 Operator check, after the fixes in section 4b: on a contract carried in isolated margin that holds a position, choose a multiple below the current one and confirm the panel refuses it with the reason and sends nothing — the journal shows no `trade.setLeverage` for it. Then raise the multiple on the same contract and confirm the panel no longer claims the position's liquidation price moves. Keep unchecked until the operator confirms
- [ ] 5.6 Operator check: restart the desk and confirm the day's journal shows no margin-mode command at all, and that any leverage command it does show is a lowering to 1× on a flat contract. Keep unchecked until the operator confirms
- [ ] 5.7 Archive only after the operator confirms live behaviour; otherwise record the observed gap as a tracked task or a follow-up change
