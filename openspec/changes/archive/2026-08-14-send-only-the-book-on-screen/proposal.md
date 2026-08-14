## Why

The desk delivers a thousand levels per side on every depth frame, ten times a
second, to draw about forty rows — and a third of every level it delivers is a
field the renderer never reads.

**The book is not bounded by the reading.** `toRendererView` formats both sides
at `RENDERER_LEVELS_PER_SIDE`
(`electron/services/futures-workstation-order-book.js:432`), which is pinned to
the protocol ceiling of a thousand levels — the deepest book the exchange can
deliver complete. It is not what the panel reads. The panel already states how
much it reads: the rows on screen times the grouping step, sent as
`configure-depth` and held on the session as `depthRange`
(`electron/services/futures-production-workstation-service.js:303`). The backend
uses that range to decide which *snapshot page to buy*, and then ignores it when
deciding what to *send*. At forty-four rows and a 5× step the panel consumes
about two hundred and twenty levels per side; it is given a thousand.

**A third of each level is dead weight.** `formatSide` computes a running
`total` on every delivered level — one decimal addition each, two thousand per
frame — and the renderer discards it: `groupFuturesBookLevels` accumulates its
own cumulative column from the grouped notional
(`src/utils/futuresOrderBook.js:139-148`), because a total over raw levels is not
a total over grouped rows. Nothing else reads the field. It is computed,
serialized, parsed, regex-validated, frozen, and thrown away.

Everything downstream is priced per level. Measured on a real frame, on this
machine:

| Frame | Size |
| --- | --- |
| 1000 levels/side, with `total` — what ships today | 117.9 KiB |
| 1000 levels/side, without `total` | 78.5 KiB |
| 220 levels/side, with `total` | 25.9 KiB |
| 220 levels/side, without `total` | **17.5 KiB** |

| Per-frame cost | Measured |
| --- | --- |
| `toRendererView` — two full sorts, two thousand decimal additions | 1.29 ms |
| `emitResource` size check — `JSON.stringify` of the whole event | 0.15 ms |
| `sendJSON` — the same event serialized a second time | 0.15 ms |
| Renderer parse, validate, deep-freeze two thousand objects | 2.66 ms |

At the exchange's hundred-millisecond cadence that is tens of milliseconds per
second of blocking work in each process, before React and before the chart, and
it grows with the diff during exactly the move the operator is trading.

Delivering the levels the panel stated it reads removes most of that work at its
source rather than managing it downstream. It is also the cheapest of the fixes
this audit found: the range is already known, already carried, already correct,
and not one number on screen changes — the panel's grouping already bounds
itself and already computes its own totals.

## What Changes

- The delivered book carries the levels the panel stated it reads, rather than
  every level the book retains. The book keeps its full depth in the main
  process — the trim is on delivery, not on what is held or proven.
- A delivered level carries its price and its quantity. The running total is
  dropped, because the panel computes the only total it can use.
- A session that has not yet been told a range delivers at the protocol ceiling,
  as it does today, so a book never arrives short because the panel has not
  spoken yet.
- The protocol's byte ceiling, node budget and level bound are unchanged: they
  stay the proof that the widest legal frame is deliverable.

## Impact

- `electron/services/futures-workstation-order-book.js`,
  `electron/services/futures-production-workstation-service.js`,
  `electron/services/futures-workstation-decimal.js`,
  `src/utils/futuresWorkstationProtocolShared.js`,
  `src/components/features/futures/FuturesWorkstationView.jsx` (its row cap
  becomes the shared floor, so the panel can never ask for more rows than a
  delivery carries levels).
- No level the operator can see changes value, and no trading decision changes.
  What changes is how much of the book that nobody is reading is paid for.
- Adds a requirement to `futures-workstation-presentation` and modifies the one
  that fixes the delivered payload's shape.
- Independent of the other changes from this audit: it can land and be measured
  on its own.
