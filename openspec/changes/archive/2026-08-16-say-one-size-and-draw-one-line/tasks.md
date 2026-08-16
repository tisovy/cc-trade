## 1. One Size

- [x] 1.1 Carry a confirmation resize back to the rail's own sizing, so the two surfaces state one number.
- [x] 1.2 Carry the amount rather than the percent, and state why in the code: the rail's slider is a share of the balance and an exit's confirmation slider is a share of the position, so only the amount means the same on both.
- [x] 1.3 Prove by test that a size set on the rail, then changed on the confirmation, leaves the rail showing the new amount **and** the recomputed share.
- [x] 1.4 Leave what is sent untouched — the confirmation already sends what it displays, and `futures-order-entry-fidelity` holds that.

## 2. One Line

- [x] 2.1 Draw a resting order at the same weight as every other price overlay.
- [x] 2.2 Leave the drag line heavier, and say why: it marks an action in progress rather than a standing fact, and it is on screen only while the operator holds it.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`. 2060 passed.
- [x] 3.2 Does the test bite? Yes — `carries a confirmation resize back to the rail` fails against `git archive HEAD` in a copy and passes after. The line width has no test and is not given one: it is a single constant with no behaviour behind it, and a test asserting `lineWidth === 1` would restate the line rather than prove anything about it. Said here rather than covered badly.
- [x] 3.3 **Confirmed by the operator on the running desk, 2026-08-16**, both halves in their own words: "the line got better — not so thick", and "the slider from the popup now changes the slider in the main panel too, as I wanted." Reconfirmed one action at a time against the complete acceptance surface: the operator answered `PASS` after the confirmation slider changed both the rail amount and its recomputed share, `PASS` after the resting-order line left the candles readable, and `PASS` while the drag-line remained emphasized. No order submission was requested or performed by the agent.

### Where these came from

Both raised by the operator on 2026-08-16 while the desk was running, from use
rather than from review. The size one is the more interesting of the two: nothing
was ever sent wrongly, so no test and no check would have found it — the desk was
simply stating two numbers and letting the operator work out which one it meant.
