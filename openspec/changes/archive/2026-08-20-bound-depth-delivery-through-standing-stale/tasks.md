## 1. Re-verify the defect before touching code

- [x] 1.1 Read the bypass in `deliverDepth`: it tests `deliveryState !== LIVE` — the state's value, not a transition — while `depthDeliveryState` returns `stale` for a standing shortfall or a lost market band, both of which persist across diffs. The service's own comment names the standing regime: a band at the deepest page "reports the same shortfall above 1 for the rest of the session".
- [x] 1.2 Demonstrate it live: a manual-clock test with `depthPage = 3` and a stubbed standing `rangeShortfall = () => 4` fed three in-sequence diffs inside one 200 ms window against the unfixed service. All three rendered and delivered immediately — `AssertionError: expected [ 1784000001200, 1784000001250, …(1) ] to have a length of 1 but got 3` at the `expect(renderAt).toHaveLength(1)` assertion.

## 2. Production implementation

- [x] 2.1 Remember the delivery state the renderer last heard (`session.lastDepthDeliveredState`, recorded only on an emission that happened, `null` on session creation so the opening book is a transition by definition).
- [x] 2.2 Key the bypass on `deliveryState !== session.lastDepthDeliveredState` instead of `!== LIVE`. Explicit `immediate` call sites (session start, hand-over, configure, recovery completion, the freshness monitor's stale marking) are untouched, so the transition into stale is still delivered on its own instant.

## 3. Proof after implementation

- [x] 3.1 The new case `keeps a book that stays stale on the routine bound after the transition is stated` asserts (a) the diff that makes the book stale is delivered immediately at its own instant, and (b) two further diffs inside the window produce one pending slot, one trailing delivery carrying the newest book (`lastUpdateId '1004'`), and exactly two renders total.
- [x] 3.2 Prove the test bites: with the service file stashed (`git stash push electron/services/futures-production-workstation-service.js`) and the test kept, the case fails on the pre-fix code with `expected [ 1784000001200, 1784000001250, …(1) ] to have a length of 1 but got 3`; `git stash pop` restored the fix and the case passes.
- [x] 3.3 `npx vitest run electron/services/futures-workstation-service.test.js` — 101 passed, including the pre-existing bound, stale-bypass and release cases unchanged.
- [x] 3.4 Adjacent coverage: `futures-workstation-market-contract.test.js`, `futures-workstation-transport.test.js`, `desk-diagnostic-record.test.js` — 127 passed; `src/App.futures-stress.test.jsx`, `src/App.futures-burst.test.jsx` — 2 passed.
- [x] 3.5 `npx eslint` on the service and the test file — clean. `npm run check:futures-production` — boundary check passed.

## 4. Change completion

- [ ] 4.1 Operator review of the delivery cadence on a contract whose book stands stale (journal shows depth deliveries at the 200 ms bound, not per diff).
- [x] 4.2 Commit the completed change and archive it against the canonical
  spec. *(Done 2026-08-20 by the archive sweep commit that carries this
  checkmark: the delta's requirement replaced its canon section verbatim,
  grep-verified to appear exactly once, and the change moved to
  `archive/2026-08-20-bound-depth-delivery-through-standing-stale`.)*

## 5. Self-Audit Corrections (2026-08-20)

- [x] 5.1 The 3.1 case pins the bypass in only one direction: its
  transition diff arrives at exactly the 200 ms bound, where the routine
  path would also emit — so deleting the state-difference bypass outright
  (`if (immediate)` alone) left the entire 103-test suite green while a
  shortfall-driven stale landing mid-window would wait out the bound,
  against this change's own "stale marking is never delayed". A new case
  — *states a mid-window stale transition on its own instant, not the
  bound* — arms the bound, flips the regime 50 ms in, and asserts the
  stale emit at 1_784_000_001_250 with an empty slot and no trailing
  duplicate. Bite, by transient mutation (bypass deleted via sed, run,
  file restored byte-identical, `git diff --exit-code` clean; the desk was
  down): only the new case fails — `expected observedAt 1784000001250,
  received 1784000001200` — 103/104. With the real code: 104/104.
- [x] 5.2 Audit findings recorded open, no code change:
  (a) an oscillating delivery state (a level flickering at the proven-band
  edge flips shortfall 0↔n per diff) makes every diff a transition and
  re-opens the unbounded regime — spec-compliant, since the delta grants
  immediacy to every change of state; whether flapping deserves hysteresis
  is a spec decision waiting on 4.1's journal reading;
  (b) latent: the bypass clears the pending slot before an emit that can
  still return false (null depth view) — unreachable today only by three
  guards in three places;
  (c) `pendingDepthDelivery` stores no payload and the trailing emit
  recomputes the view — correct latest-wins today, silently replaces any
  future caller's explicit queued payload;
  (d) the timer re-entry pins `state: pending.state`, an invariant held by
  call-site adjacency, not enforced.
