# Keep The Desk Grid Under The Clock

## Why

The market-clock row entered the Futures grid as a mobile-first rule:
`.futures-workstation.has-market-clock` restates the whole
`grid-template-rows` with the clock row added. That selector carries
specificity 0-2-0, and the desktop rule it must yield to —
`@media (min-width: 845px) { .futures-workstation { … } }` — carries 0-1-0. A
media query adds no specificity, so on every desktop width the clock rule wins
and quietly brings back exactly what the desktop rule exists to remove: the
420px chart floor and a content-sized tape.

Measured on the audit fixture, not guessed: at 1920×993 the tape row is
**16px**; at 1366×681 the dock — positions, orders, balance — sits entirely
below the desk's bottom edge, clipped by `overflow: hidden`, with no scrollbar
to reach it. The clock is always passed while the workspace is mounted, so the
desk is always in this state.

The same commit removed the 72px of page padding above the desk, but the
desk's height budget still subtracts it: `height: calc(100vh - 90px)` against
a page whose only remaining chrome is 18px of bottom padding. That is a 72px
dead band under the dock on every desktop window.

The guard that should have caught this asserts the desktop
`grid-template-rows` exists in the stylesheet text — and it does; it just
never applies. The guard does not know the clock variant exists.

## What Changes

- `FuturesWorkstation.css`: the desktop media block gets its own
  `.futures-workstation.has-market-clock` row template — the same
  window-shared rows with the clock row added
  (`auto auto auto minmax(0, 65fr) minmax(0, 35fr) auto`).
- The desktop height budget drops the padding that no longer exists:
  `calc(100vh - 90px)` becomes `calc(100vh - 18px)`.
- The breakpoint guard test learns the clock variant and the budget, so
  removing either fails the suite.
- `futures-workstation-presentation`: the clock requirement states that
  reserving the clock row may not displace the desktop rows or push the dock
  out of the window.

## What this is not

No change to the clock itself, to the narrow (≤844px) layout — which already
carries its own correct clock variant — or to what any panel renders.

## Impact

- `src/components/features/futures/FuturesWorkstation.css`
- `src/components/features/futures/FuturesWorkstationView.test.jsx`
- Modifies one requirement in `futures-workstation-presentation`.
- Raised by the 2026-08-19 audit of the header recompose series; the defect is
  live on the operator's desk now, which is why this change goes first.
