## Context

Entry and liquidation lines are created through the chart library's price-line API with `title` text. The library sizes those titles and ordinary price-scale ticks from the same layout font setting. The component already maintains DOM overlays whose vertical coordinates are refreshed from `priceToCoordinate`.

## Goals / Non-Goals

**Goals:**

- Keep standard numeric price labels and line geometry.
- Render `ENTRY` and `LIQ` text at independently controlled sizes.
- Keep annotations synchronized with price coordinates and chart lifecycle.

**Non-Goals:**

- Replace alert titles or working-order handles.
- Change entry/liquidation price derivation, line color or execution behavior.
- Introduce a new charting dependency.

## Decisions

Entry and liquidation price lines will keep `axisLabelVisible: true` but use an empty library title, leaving the numeric price plate intact. A position-annotation model will be derived from usable position prices and rendered as DOM plates inside the chart overlay, following the same coordinate-refresh scheduling used by order handles.

The coordinate pass will run after series data/range changes, chart resize and position changes. Labels with no finite positive coordinate will be omitted. Keys will include the position identity and annotation kind so entry and liquidation labels update independently without remounting unrelated overlays.

CSS will define an annotation font variable separately from the chart layout font. The chart scale can return to its readable independent size while `ENTRY` and `LIQ` retain the smaller annotation size and continue to participate in the workstation's interface scale.

## Risks / Trade-offs

- [DOM labels can collide near the same price] → Reuse the existing vertical layout/displacement approach where necessary and keep exact line alignment as the anchor.
- [A stale coordinate can survive a range change] → Schedule refresh from every existing price-coordinate invalidation and clear coordinates during series teardown.
- [Custom labels could cover the numeric scale plate] → Place them inside the plot edge with bounded width, leaving the scale gutter to the library.
