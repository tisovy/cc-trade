## Why

Two controls decide how the book reads — the price step and which sides are
shown — and both are thrown away. The step is reset to 1× on every contract
change; the side mode survives a switch but not a restart. So the operator
re-dials the same book every time they come back to a contract they watch daily.

The obvious fix is the wrong one. Both controls are *relative*: the step is a
multiplier of the contract's own tick, so one remembered multiplier does not
mean one thing across contracts. At 100× a `0.0000001`-tick contract quoted at
`0.0152780` puts 0.066% of price in a row; a `0.1`-tick contract at `58420` puts
0.017%. Nearly four times apart, and at 500× a step that is a sane zoom-out on
one contract collapses the other into three rows — which is the failure the
`· X%` annotation beside the step exists to expose. A single global setting
would carry that failure from contract to contract.

What the operator actually wants back is the setting they chose **for this
coin**. That is per contract, so that is what is stored.

## What Changes

- The side mode and the grouping step are remembered per contract and restored
  on selection, replacing the step's blanket reset to 1× and the side mode's
  reset-on-restart.
- Storage is one bounded map, keyed by symbol, validated on read exactly like
  the tape settings already are: a hand-edited or stale entry falls back to the
  default rather than restoring a step the contract has no such multiple of.
- The map is capped, so watching a thousand contracts over a year cannot grow
  an unbounded key.
- A contract seen for the first time opens at both sides and 1×, as today.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: how a contract's book is read is a
  property of that contract and survives a restart.

## Impact

- Renderer only: a new `src/utils/futuresBookView.js` beside
  `futuresTapeSettings.js`, and `FuturesWorkstationView.jsx`.
- One `localStorage` key. No exchange traffic, no protocol change.
- On a contract whose filters have not arrived, the step control is not drawn
  and the book renders ungrouped; a remembered step applies the moment the
  filters land. That is the intended restore, not a switch under the operator.
