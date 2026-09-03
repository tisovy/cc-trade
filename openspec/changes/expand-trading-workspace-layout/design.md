## Context

The Futures page already uses a responsive three-column grid whose center track absorbs spare width and whose side rails are bounded. The page shell alone caps the workstation at 1580 CSS pixels and centers it, so larger Electron/browser viewports cannot benefit from the grid. The page currently declares two-axis `overflow: auto`, even though the workstation contract forbids page-level scrolling and the mobile composition needs only vertical page scrolling.

## Goals / Non-Goals

**Goals:**

- Hand all usable page width to the existing workstation grid.
- Preserve the desktop and mobile breakpoints, edge inset, and panel-owned scroll regions.
- Make page-level horizontal overflow impossible without hiding required content behind an undersized fixed child.

**Non-Goals:**

- Recompose workstation panels or change their order.
- Change the operator's UI scale controls, trading behavior, data flow, or Spot layout.
- Remove intentional local table/list scrolling.

## Decisions

1. Remove the fixed maximum from the page's direct workstation child and keep a percentage width. This lets the existing bounded side columns and flexible chart track allocate all additional space. A larger replacement maximum was rejected because it would recreate the same defect on the next wider display.
2. Split page overflow by axis: vertical remains automatic for the stacked mobile layout, while horizontal is hidden at the page boundary. Using `overflow: hidden` on both axes was rejected because it would make mobile sections unreachable.
3. Keep the existing responsive horizontal padding as the viewport safety inset. Adding width calculations or viewport units to the child was rejected because `box-sizing: border-box` already gives the child the parent's padded content width and avoids scrollbar-width arithmetic.

## Risks / Trade-offs

- [Very wide charts become visually dominant] → Side rails remain bounded by their existing maxima, which is appropriate for dense numerical data; the chart is the intended elastic surface.
- [A future child introduces an intrinsic minimum wider than the viewport] → Retain `min-width: 0` on the workstation root and guard the page axis in presentation coverage.
- [Horizontal page overflow is hidden rather than exposed] → Required workstation tracks already have responsive templates and designated local scroll owners; tests preserve those contracts.
