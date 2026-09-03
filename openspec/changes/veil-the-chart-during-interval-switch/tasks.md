## 1. Production presentation

- [x] 1.1 Add a translucent dark background to the existing interval
      progress layer, keeping the spinner above it and `pointer-events: none`;
      verify the stylesheet limits the veil to that switching-only layer.

## 2. Regression coverage

- [x] 2.1 After the production CSS is in place, extend the workstation
      presentation test to prove the veil has a translucent dark background,
      remains pointer-through, and disappears with the progress state; verify
      the focused Futures workstation tests pass.
- [x] 2.2 Run eslint, the production build, and the relevant architecture
      guards; run `openspec validate veil-the-chart-during-interval-switch`.

## 3. Operator verification

- [ ] 3.1 Confirm in the running desk that the chart is visibly darkened while
      the interval spinner turns, remains readable and interactive, and returns
      to its normal background when the replacement series arrives.
