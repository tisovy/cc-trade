## Why

`enforce-order-limits-on-every-path` established that the desk does not
evaluate the exchange's price band locally: `minPrice`, `maxPrice`, the
percent-price band and the maximum open order count are Binance's to refuse.
While confirming that, one contradiction of it was found in the tree.

`src/utils/operations.js` still carries a legacy renderer order-entry path that
no longer has any caller:

- `buysell` builds a Spot order, evaluates `minPrice`/`maxPrice` and `minQty`/
  `maxQty` against a local `calculatePrecision` copy of the filters, reports the
  violation through a blocking `alert()`, retries on a bare `setTimeout` when
  the balance looks short, and sends an untyped `buyOrder`/`sellOrder` frame.
- `cancel` and `cancelAll` send untyped cancellation frames; `cancelAll` has an
  empty body and does nothing at all.
- `serverDialog` and `balanceUpdate` are orphans of the same generation.

None of them is imported anywhere: the only names the codebase takes from this
module are `formatVolumeShort`, and `calculatePrecision`/`precisionTruncate`,
which it re-exports from `src/utils/precision.js`.

Dead code is not harmless here. It states the opposite of the contract the desk
now holds — a local band check with an `alert()` — and it bypasses typed command
validation, command identity and the risk ceiling. Left in place it reads as an
available path to whoever finds it next, including the next audit.

## What Changes

- The unreachable legacy order-entry and cancellation functions are deleted from
  `src/utils/operations.js`, leaving the module to the presentation helpers that
  are actually used.
- The guarantee is stated so the absence is a property of the system rather than
  a fact about today's tree: no unreachable trading-submission path may exist in
  the renderer.

## Capabilities

### Modified Capabilities

- `trading-command-integrity`: every trading submission in the renderer is
  reachable and goes through the validated command path; no parallel legacy
  path exists.

## Impact

- `src/utils/operations.js` loses `buysell`, `cancel`, `cancelAll`,
  `serverDialog` and `balanceUpdate`; `formatVolumeShort` and the
  `calculatePrecision`/`precisionTruncate` re-export are untouched, so every
  current importer is unaffected.
- New repository guard `scripts/check-trading-command-path.mjs`, run as
  `npm run check:command-path`, so the property is machine-checked rather than
  reviewed: a renderer module that composes a trading frame outside
  `src/utils/tradingCommands.js` fails the check.
- No runtime behaviour changes: the deleted functions have no callers.
- Depends on nothing and blocks nothing; it is cleanup carried out of
  `enforce-order-limits-on-every-path` rather than folded into it, so a
  futures-scoped change does not silently delete Spot code.
