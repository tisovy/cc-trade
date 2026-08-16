## 1. Type The Field

- [x] 1.1 Require `typeof value.requestId === 'string'` in `validateFuturesWorkstationRequest` and `validateFuturesWorkstationEvent`, in the same shape the other nine `.test(` sites in the file already use. *(Both now call one `isFuturesWorkstationRequestId`, so the two sites cannot drift apart — a fix applied to one of them was the likelier mistake than no fix at all.)*
- [x] 1.2 Keep `REQUEST_ID_PATTERN` and the refusal codes exactly as they are. What changes is which values reach the pattern, not what the pattern says.
- [x] 1.3 Keep the `?? ''` or drop it, but state which and why. *(Dropped. With a `typeof` ahead of it nothing but `null` and `undefined` could ever reach it, and both are already refused by the type check — a guard that cannot fire is a second answer to a question that already has one.)*

## 2. Prove It Bites

- [x] 2.1 Prove by test that a request whose `requestId` is a number, a boolean or an array is refused with `INVALID_REQUEST_IDENTITY`, and that a string id is accepted exactly as before.
- [x] 2.2 Prove the same for an event, at the second call site.
- [x] 2.3 Run both against `git archive HEAD` in a copy before the fix. **Both fail there.** Neither is a guard.
- [x] 2.4 Include `9007199254740993` among the cases, and assert it is refused rather than accepted as `9007199254740992`.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [x] 3.2 No operator step. Nothing about this is observable on a running desk: the renderer has always sent string ids, so a correct desk behaves identically before and after. Saying so is better than inventing a check the operator cannot fail.

### Where this came from

The `/security-review` that `carry-execution-ahead-of-market-data` 4.6 asked for.
It found no HIGH or MEDIUM security finding; what it found instead was that
4.9's *argument* was wrong. That change stated three refusals it had given up and
reasoned that none of them could alter what a validated frame means, because
meaning is the validators' business. True of every field the validators
type-check — and `requestId` was not one of them.

The type hole itself is older than the change that surfaced it: `12345`, `true`
and `[1]` were accepted before the parser swap as well. What the swap widened is
the range that reaches it, and one row of that has teeth.
