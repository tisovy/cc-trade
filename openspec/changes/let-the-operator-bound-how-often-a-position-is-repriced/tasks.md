# Tasks

## 1. Spec

- [x] 1.1 Delta under `futures-order-visibility`: the print publication rate
      follows the operator's tape control, floored at the coalescing window,
      spacing rather than discarding, and never applied to marks.
- [x] 1.2 Delta under `futures-workstation-presentation`: a control that reaches
      past its own panel states what else it governs, and what it does not.

## 2. Code

- [x] 2.1 `futuresPrintPublicationWindow` decides the bound from a tape settings
      object in one place, with the coalescing window as its floor.
- [x] 2.2 The feed gates print publications on that bound: a pending print, a
      gate closed by any publication that carried one, reopened one window
      later. Marks keep the coalescing window and carry the newest print.
- [x] 2.3 `boundPrints` applies a changed setting and releases a price already
      waiting; withdrawing marks clears both the pending print and the gate.
- [x] 2.4 The connection reads the workstation service's applied tape settings
      after each workstation request and hands them to the feed, so one place
      decides what the setting is and both followers read the same number.
- [x] 2.5 The Aggregate trades panel states what its throttle and timeout now
      bound, and that marks keep their own cadence.

## 3. Proof

- [x] 3.1 Feed tests that bite: prints spaced by the timeout with the newest
      held and released; a mark published on the coalescing window inside a shut
      gate, carrying the newest print; the bound read from the menu with the
      window as its floor and `throttleEnabled: false` meaning the floor; a
      shortened bound releasing a waiting price.
- [x] 3.2 A connection test that bites on the seam itself: with the menu set to
      2000 ms through the workstation channel, a printing contract republishes
      once and then not again until the window elapses, and the price that goes
      out is the newest one. Verified failing with the wiring line removed.
- [x] 3.3 A view test that the panel states both what the dial now bounds and
      what it does not.
- [x] 3.4 Full suite 2939/2939 across 128 files, eslint clean on every touched
      file, all four guards pass. Panel measured in Chromium: the added line is
      11 px in `#6a7c8e`, two lines at a 300 px panel width, below the effective
      readout and quieter than it.

## 4. Operator gate

- [x] 4.1 Can be looked at in the same sitting as task 4.1 of
      `price-every-open-position-at-the-last-print`. With the Aggregate trades
      timeout at its default, position rows move about four times a second
      rather than continuously; lowering it toward 16 ms restores the realtime
      feel; raising it slows the rows and not the mark. Record in
      `openspec/live-verification-ledger.md`.
