## Why

`bound-depth-delivery` bounds routine depth deliveries to one per 200 ms and
lets state transitions bypass the bound, so the operator hears that the book
became stale on the diff that made it stale. The code keys that bypass on the
delivery state's *value*, not on its change: any delivery whose state is not
`live` goes out immediately.

The service's own comments name a regime where that value stands: a band bought
at the deepest page and short of the rows reports the same shortfall above 1
for the rest of the session. `ensureDepthCovers` correctly buys nothing — there
is no rung left — so every applied diff computes `stale`, and every one of them
skips the bound. Demonstrated in a test against the current code: three
in-sequence diffs inside one 200 ms window produced three full renders and
three deliveries (expected 1, got 3). That is a full-book sort (~6200 levels on
a watched book) at the exchange's 100 ms cadence, for as long as the contract
stays open — exactly the loaded regime the bound was built for, granted a
permanent exemption from it.

The spec already says the right thing — "Depth state transitions ... SHALL
bypass the routine delay", and its scenario grants immediacy when the book
*becomes* stale — but it never states the complement, which is how the
value-keyed reading survived review.

## What Changes

- Key the bypass on a transition: remember the state the renderer last heard,
  and deliver immediately when the computed state differs from it (live→stale,
  stale→live). A state that matches — stale included — rides the routine bound,
  latest-wins.
- Explicit immediacy is unchanged: session start, selection hand-over,
  configure, recovery completion and the freshness monitor's stale marking all
  pass `immediate` already, so the transition into stale is never delayed and
  the first delivery of a session goes out at once.
- State the complement in the spec: a state that merely persists does not
  bypass, with a scenario for a book that stays stale across consecutive diffs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Grant delivery immediacy to depth-state
  transitions only; a book that stays stale delivers on the same routine bound
  as a live one.

## Impact

- `electron/services/futures-production-workstation-service.js` — the bypass
  condition, one remembered state per session.
- `electron/services/futures-workstation-service.test.js` — one standing-stale
  case beside the existing bound cases.
- No change to what is delivered or to its state; only to when a delivery whose
  state did not change is built.
