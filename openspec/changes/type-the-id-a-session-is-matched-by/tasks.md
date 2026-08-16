## 1. Type The Field

- [ ] 1.1 Require `typeof value.requestId === 'string'` in `validateFuturesWorkstationRequest` (line 654) and `validateFuturesWorkstationEvent` (line 788), in the same shape the other nine `.test(` sites in the file already use.
- [ ] 1.2 Keep `REQUEST_ID_PATTERN` and the refusal codes exactly as they are. What changes is which values reach the pattern, not what the pattern says.
- [ ] 1.3 Keep the `?? ''` or drop it, but state which and why: with a `typeof` guard ahead of it the fallback can no longer be reached by anything but `null`/`undefined`, and a guard that cannot fire is worth removing rather than leaving as a second answer to the same question.

## 2. Prove It Bites

- [ ] 2.1 Prove by test that a request whose `requestId` is a number, a boolean or an array is refused with `INVALID_REQUEST_IDENTITY`, and that a string id is accepted exactly as before.
- [ ] 2.2 Prove the same for an event, at the second call site. Two sites, two tests — a fix applied to one of them is the more likely mistake than no fix at all.
- [ ] 2.3 Run both against `git archive HEAD` in a copy before the fix. They must fail there. If either passes, it is a guard and must say so in its own title.
- [ ] 2.4 Include `9007199254740993` among the cases, and assert it is refused rather than accepted as `9007199254740992`. That is the one row of the table in the proposal where the coercion changes which session a frame is matched against, and it is the reason this is a change rather than a note.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 3.2 No operator step. Nothing about this is observable on a running desk: the renderer has always sent string ids, so a correct desk behaves identically before and after. Saying so is better than inventing a check the operator cannot fail.
