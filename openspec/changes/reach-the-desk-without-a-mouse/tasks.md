## 1. The Dock Survives A Narrow Window

- [ ] 1.1 Give the narrow grid template an area for the portfolio dock.
- [ ] 1.2 Raise the breakpoint to the width at which the desktop columns still fit, so no window width uses a template narrower than its columns.
- [ ] 1.3 Measure the affected widths in Chromium and record the readings.

## 2. An Order Can Be Edited From The Keyboard

- [ ] 2.1 Make the editor-opening rows focusable and operable with Enter and Space, keeping the pointer behaviour unchanged.
- [ ] 2.2 Name the action for assistive technology, so the row says it opens the order editor.
- [ ] 2.3 Apply the same to the ticket's rows that open an editor on double-click.
- [ ] 2.4 Prove by test that an order can be repriced using the keyboard alone.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm test`.
- [ ] 3.2 Operator confirms the dock is present at narrow widths and that keyboard editing works.
