## 1. The Dock Survives A Narrow Window

- [x] 1.1 Give the narrow grid template an area for the portfolio dock.
- [x] 1.2 Raise the breakpoint to the width at which the desktop columns still fit, so no window width uses a template narrower than its columns.
- [x] 1.3 Measure the affected widths in Chromium and record the readings.

## 2. An Order Can Be Edited From The Keyboard

- [x] 2.1 Make the editor-opening rows focusable and operable with Enter and Space, keeping the pointer behaviour unchanged.
- [x] 2.2 Name the action for assistive technology, so the row says it opens the order editor.
- [x] 2.3 Apply the same to the ticket's rows that open an editor on double-click.
- [x] 2.4 Prove by test that an order can be repriced using the keyboard alone.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`.
- [ ] 3.2 Operator confirms the dock is present at narrow widths and that keyboard editing works.

## Evidence Log

### Baseline Chromium geometry

Starting ref: `9075216707e0468a18e511e6b5b5067732e17fb1`. While planning,
`master` advanced to `c838dd91f7dfb4dd8689ad4d36a3103a1c2adf64`; that commit changed
none of this change's allowed production, test, or OpenSpec paths.

Node: `.nvmrc` (`24.11.0`). Chromium: `150.0.7871.128`, headless,
`--force-device-scale-factor=1`. The exact baseline was materialized with:

```sh
git archive --format=tar 9075216707e0468a18e511e6b5b5067732e17fb1 | tar -x -C "$START_TREE"
ln -s /home/me/work/trade_ui_latest/node_modules "$START_TREE/node_modules"
chromium --headless --no-sandbox --disable-gpu --force-device-scale-factor=1 \
  --window-size=<width>,1100 --virtual-time-budget=1000 --dump-dom \
  "file://$START_TREE/measure-layout.html"
```

The measurement page used the archived `base.css`, `app-layout.css`, and
`FuturesWorkstation.css` with the real workstation wrapper and all seven grid
children. Rects are CSS pixels.

| Viewport | Container | Grid client / scroll | Computed areas | Dock rect | Result |
|---:|---:|---:|---|---|---|
| 760 | 724 | 722 / 722 | `identity header instruments chart depth trades` | `x=662.31 w=78.69 h=320.63` | Narrow template has no `dock`; it is forced into an implicit, unreadable column. |
| 761 | 725 | 723 / 792 | desktop, including `dock` | `x=19 w=792 h=284.63` | Desktop grid overflows by 69 px; dock extends outside the grid rect. |
| 827 | 791 | 789 / 792 | desktop, including `dock` | `x=19 w=792 h=284.63` | Near the track floor, still 3 px overflow. |
| 829 | 793 | 791 / 792 | desktop, including `dock` | `x=19 w=792 h=284.63` | Last width with overflow (1 px). |
| 830 | 794 | 792 / 792 | desktop, including `dock` | `x=19 w=792 h=284.63` | First desktop width with no overflow. |
| 1280 | 1244 | 1242 / 1242 | desktop, including `dock` | `x=19 w=1242 h=284.63` | Control desktop width; no overflow or panel intersection. |

At every measured width the dock had a non-zero rect and did not overlap a
named panel. At 760 px it was nevertheless absent from the explicit grid and
only 78.69 px wide; at 761–829 px the desktop grid exceeded its container.
These readings select complementary boundaries of `max-width: 829px` and
`min-width: 830px`.

### Baseline test oracle

The three changed test files were copied by absolute path into the archived
starting ref, whose production files and stylesheet remained unchanged, and
run there against the shared `node_modules` symlink:

```sh
install -m 0644 /home/me/work/trade_ui_latest/src/components/features/futures/FuturesPortfolioDock.test.jsx \
  "$START_TREE/src/components/features/futures/FuturesPortfolioDock.test.jsx"
install -m 0644 /home/me/work/trade_ui_latest/src/components/features/futures/FuturesTradingTicket.test.jsx \
  "$START_TREE/src/components/features/futures/FuturesTradingTicket.test.jsx"
install -m 0644 /home/me/work/trade_ui_latest/src/components/features/futures/FuturesWorkstationView.test.jsx \
  "$START_TREE/src/components/features/futures/FuturesWorkstationView.test.jsx"
/home/me/.local/share/fnm/node-versions/v24.11.0/installation/bin/node \
  node_modules/vitest/vitest.mjs run --reporter=json \
  src/components/features/futures/FuturesPortfolioDock.test.jsx \
  src/components/features/futures/FuturesTradingTicket.test.jsx \
  src/components/features/futures/FuturesWorkstationView.test.jsx
```

Result on the unchanged starting production tree: **5 biting tests**, covering
dock keyboard activation, ticket keyboard activation, the missing explicit
`dock` row, the too-low/non-complementary breakpoint, and missing visible row
focus. **6 changed guard tests** passed on the old code, covering exact dock
click payload, exact ticket double-click payload, nested Cancel/Show isolation,
ALGO/triggered display-only behavior, and regular rows without an edit callback.
The other old-code passes are not findings. Aggregate baseline result:
160 passed, 5 failed; current implementation result: 165 passed, 0 failed.

### Exact staged-tree Chromium geometry

An isolated temporary index was populated from HEAD
`b087689fe088b2abc3283aeda8ec531954db00d6` with only this change's
allowed paths. `git write-tree` produced
`3bf1802356f71badf933d2db357b2785e543d43c`; that exact tree was archived,
given the same `node_modules` symlink and measurement page, and loaded with the
same Chromium command as the baseline.

| Viewport | Container | Grid client / scroll | Computed template | Dock rect | Result |
|---:|---:|---:|---|---|---|
| 760 | 724 | 722 / 722 | seven narrow rows, last is `dock` | `x=19 w=722 h=320.63` | No overflow or intersection; dock is inside the grid. |
| 761 | 725 | 723 / 723 | seven narrow rows, last is `dock` | `x=19 w=723 h=320.63` | No overflow or intersection; old 69 px overflow is gone. |
| 827 | 791 | 789 / 789 | seven narrow rows, last is `dock` | `x=19 w=789 h=320.63` | No overflow or intersection. |
| 829 | 793 | 791 / 791 | seven narrow rows, last is `dock` | `x=19 w=791 h=320.63` | Last narrow width; no overflow or intersection. |
| 830 | 794 | 792 / 792 | desktop, including `dock` | `x=19 w=792 h=284.63` | First desktop width; minimum tracks fit exactly. |
| 1280 | 1244 | 1242 / 1242 | desktop, including `dock` | `x=19 w=1242 h=284.63` | Control width; no overflow or intersection. |

The dock had a non-zero rect, stayed inside the grid, and intersected no named
panel at every measured width. The desktop template was absent whenever the
grid content box was narrower than its 792 px minimum.

### Isolated staged-tree verification

An evidence-only update to this file aside, temporary-index tree
`7aaf678575241e49a6f90a50ff0172fe61d492be` contained exactly the eight allowed
paths. It was archived separately, linked to the shared `node_modules`, and
checked with Node `24.11.0` from `.nvmrc`:

```sh
node node_modules/vitest/vitest.mjs run \
  src/components/features/futures/FuturesPortfolioDock.test.jsx \
  src/components/features/futures/FuturesTradingTicket.test.jsx \
  src/components/features/futures/FuturesWorkstationView.test.jsx
npm run lint
npm run test:all
OPENSPEC_TELEMETRY=0 openspec validate reach-the-desk-without-a-mouse --strict
```

Focused Vitest passed **165/165** tests across the three allowed files. Lint
passed. `test:all` passed **1807/1807** tests across 109 files, both production
builds, and the circular-import, runtime-mock, Futures-boundary, and trading
command-path checks. Strict OpenSpec validation passed. The first sandboxed
`test:all` attempt reached 1806 passes but could not bind its integration-test
socket (`listen EPERM 127.0.0.1`); rerunning the same archived tree with local
socket permission passed in full.

Before commit, `master` advanced to
`a186f32c098f468de531dec92226a666625a9f17` without changing any allowed path.
The change was rematerialized from that HEAD as isolated tree
`d6cfcf70b04ac2806ed5353ff87cfe413de01d2a` and checked again: focused Vitest
passed **165/165**, lint and strict OpenSpec validation passed, and `test:all`
passed the then-current **1811/1811** tests plus both builds and all boundary
checks.
