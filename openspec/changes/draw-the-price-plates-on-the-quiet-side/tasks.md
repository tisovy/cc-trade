# Tasks

## 1. Spec

- [x] 1.1 Delta under `futures-workstation-presentation`: the chart's own plot
      labels keep off the edge prices are worked at, and a handle is never
      hidden behind an ambient box.

## 2. Code

- [x] 2.1 Mirror the position annotation to the left edge — anchor, coloured
      border side, and corner radii — so it still reads as belonging to its
      line.
- [x] 2.2 Mirror the order handle (working, exchange-managed, and the lifted
      mark that follows the pointer) to the left edge, including the direction
      its contents pack in.
- [x] 2.3 Stack the layer carrying both above the chart's ambient corner boxes.
- [x] 2.4 Hold the order handle off that edge by the desk's own corner gutter,
      shortened by the same amount so the inset cannot push it into the price
      scale. The annotations stay flush.

## 3. Proof

- [x] 3.1 Test that bites in the suite: the stylesheet anchors both families to
      the left and neither to the right (fails against today's `right: 0`).
- [x] 3.2 Measured in Chromium against a fixture, because jsdom has no layout.
      Plot area 0–828 of a 900px frame (72px is the price scale). Before: the
      annotation occupied 748–828 and the handle 699–828 — both ending exactly
      on the plot's right edge, gap 0. After: 0–80 and 0–129, clearing that edge
      by 748px and 699px.
- [x] 3.3 Full suite 2923/2923 across 128 files, eslint clean, and all four
      guards pass.
- [x] 3.4 The gutter is read from the reading notice's own rule rather than
      restated, so the two cannot drift apart; the test fails against the flush
      `left: 0`. Re-measured in Chromium: the handle now occupies 8–137 and the
      annotation stays at 0–80.

## 4. Operator gate

- [ ] 4.1 Operator looks at a contract carrying a position and a working order:
      the plates are on the left with the handle held off the edge, nothing sits
      over the newest candles, the handle still drags and cancels, and no plate
      is hidden behind a corner notice. Record in
      `openspec/live-verification-ledger.md`.
