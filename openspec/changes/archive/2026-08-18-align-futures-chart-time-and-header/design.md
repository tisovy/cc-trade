## Context

See `proposal.md` for motivation and the delta spec for observable behavior. `FuturesWorkstationChart` passes exchange candle instants to Lightweight Charts as Unix seconds but supplies neither `localization.timeFormatter` nor `timeScale.tickMarkFormatter`, so the library's UTC-oriented defaults disagree with the separately rendered host-local `MarketClock`.

The recent-contract group and execution ticket are sibling flex items in the instrument rail. Both currently participate in flex shrinking, which can take a fraction of one row from the bounded nine-pill group even while the ticket body can absorb the same constraint through its own internal overflow.

The market-header description list currently uses seven one-row auto-flow columns. Once their aggregate minimum width exceeds the header, flex wrapping moves the whole list below the contract title even though the same readings fit beside it when distributed across two rows.

The ticket derives a draft even when its intentionally empty size is zero. That ordinary initial state produces `INVALID_DRAFT_INPUT`, which the persistent draft-reason surface currently translates as missing price or Binance symbol filters. Readiness already owns actual metadata availability, so the message is both redundant and inaccurate.

## Goals / Non-Goals

**Goals:**

- Keep timestamp conversion a presentation concern and make both chart label surfaces use the host's local time zone.
- Prefer the complete bounded recent-contract group at supported desktop heights while retaining an internal-overflow fallback for genuinely short rails.
- Fit the complete market context beside the contract title in a stable scan order with a responsive fallback.
- Keep the untouched zero-size ticket quiet without weakening order gating or actionable failure feedback.
- Cover the formatter and layout contracts with focused automated tests written after the production changes.

**Non-Goals:**

- Rewriting exchange timestamps, candle interval boundaries, history paging, or the chart's logical coordinates.
- Changing the local clock component, symbol-history limit or order, recent-contract styling, contract selection/removal behavior, or the execution ticket's fields.
- Introducing a chart library, date library, JavaScript layout measurement, or persisted layout preference.
- Redesigning the narrow single-column workstation beyond preserving a readable fallback.

## Decisions

### Format chart labels at the library boundary

Add small pure timestamp-formatting helpers beside the Futures chart and pass them to both Lightweight Charts extension points: `localization.timeFormatter` for the crosshair label and `timeScale.tickMarkFormatter` for axis ticks. The helpers will turn the existing Unix-second value into a `Date` and read local calendar/time parts without specifying a UTC or fixed `timeZone`. Tick labels will remain short and vary by tick type, while the crosshair label can carry enough local date-and-time context to disambiguate the instant.

The series data will continue to use `Math.floor(openTime / 1000)`. Shifting timestamps by `getTimezoneOffset()` was rejected because it would corrupt the actual instant, distort daylight-saving transitions, and detach price and volume coordinates from the exchange data. Adding a date dependency was rejected because the platform and chart hooks already provide everything required.

### Give the bounded recent group its complete-row size before flexible ticket overflow

Adjust the desktop rail allocation so the recent group keeps its wrapped content height for at most three rows before the execution ticket receives the remaining flexible height. The recent group keeps `overflow-y: auto` as the short-rail fallback, and the ticket body keeps its own existing scroll ownership. The change will be expressed through CSS sizing rather than runtime element measurement.

A permanently hidden scrollbar was rejected because it would make genuinely clipped contracts unreachable. Increasing the whole instrument rail or page height was rejected because it would take space from the chart and reintroduce page-level overflow.

### Keep an untouched draft quiet and preserve actionable feedback

Treat a zero order size as the ticket's ordinary idle state. The draft remains invalid and all order actions remain disabled, but the persistent draft-reason surface renders nothing for that state. Actual readiness failures still take precedence and remain visible. Once a positive size is present, invalid draft input receives a validation-specific message instead of being mislabeled as missing Binance filters. Gesture and submission refusal paths retain their explicit feedback.

Removing the draft validation or enabling actions at zero size was rejected because the quiet state must not weaken trading safety. Hiding every draft reason was rejected because invalid operator input and operational failures require a corrective explanation.

### Use a two-row, column-flow reading grid beside the symbol title

At desktop widths, keep the header on one flex line and give its description list two explicit rows with column flow. Existing DOM order then produces the requested scan pairs: last/change, high/low, volume/funding, and next funding in the final column. The list can flex within the remaining width; labels and values retain their present formatting and exact-value title.

At the existing narrow breakpoint, switch back to a wrapping/stacked grid that does not scroll. Shrinking every reading into a single line was rejected because it would reduce type below the workstation scale and make labels collide. Moving statistics into the blue identity strip was rejected because that strip owns global workspace state and controls, not selected-contract market data.

## Risks / Trade-offs

- [Local date boundaries and daylight-saving transitions can change the calendar label for the same UTC instant] → Derive every label independently from the original timestamp and test under an explicit non-UTC process time zone.
- [A two-row header is taller than a single ideal row] → It replaces the current full-width wrapped row and remains materially shorter at the constrained width shown; responsive tests protect the non-scrolling fallback.
- [Protecting all three recent rows can leave less initial height for the execution ticket] → Keep the ticket body as the flexible scroll owner and constrain the recent group only at genuinely short rail heights.
- [Suppressing the idle notice could hide a genuine metadata problem] → Suppress only the zero-size draft reason after readiness has been evaluated; readiness metadata and connectivity reasons retain priority.

## Migration Plan

Ship as a renderer-only change with no stored-data or protocol migration. Roll back the formatter and CSS rules together if live verification reveals a host-time or unsupported-window regression; no persisted state requires cleanup.
