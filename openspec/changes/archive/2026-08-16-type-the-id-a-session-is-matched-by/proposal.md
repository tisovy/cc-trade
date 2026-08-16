## Why

The workstation protocol validates an exact key set, canonical decimals, exchange
identities, timestamps and level counts — and does not check that `requestId` is
a string. Both call sites read it the same way:

```js
!REQUEST_ID_PATTERN.test(value.requestId ?? '')     // lines 654 and 788
```

`RegExp.prototype.test` coerces its argument, and `??` intercepts only `null` and
`undefined`. Every other `.test(` in `futuresWorkstationProtocolShared.js` — all
nine of them — is preceded by an explicit `typeof value === 'string'`. These two
are the exceptions.

Measured against the module rather than read off it. The same request frame,
varying only how `requestId` is spelled on the wire:

| `requestId` on the wire | before `5881142` | today |
|---|---|---|
| `"r1"` | accepted, string | accepted, string |
| `12345` | accepted, **number** | accepted, number |
| `true` | accepted, **boolean** | accepted, boolean |
| `[1]` | accepted, **array** | accepted, array |
| `1e2` | refused `INVALID_JSON_NUMBER` | **accepted as `100`** |
| `100000000000000000000` | refused `UNSAFE_JSON_INTEGER` | **accepted** |
| `9007199254740993` | refused `UNSAFE_JSON_INTEGER` | **accepted, stored as `9007199254740992`** |

`requestId` is the key a session is matched by. Ten strict comparisons rest on it
— eight in `futures-production-workstation-service.js`, two in
`useFuturesProductionWorkstation.js` — all of the form
`session.requestId !== request.requestId`, deciding whether a request belongs to
the session it names, whether a frame belongs to the subscription that is
listening, and whether an unsubscribe releases the contract on screen.

Two facts sit on top of each other here and they should not be confused:

- **The type hole predates `5881142`.** `12345`, `true` and `[1]` were accepted
  before the parser swap and are accepted after it. That change did not open it,
  and the review of that change was right not to claim it did.
- **`5881142` widened what reaches it, and the last row has teeth.** A request
  whose id is `9007199254740993` used to be refused outright; it is now accepted
  under an id the sender never wrote. Any two integers past 2^53 that round to
  the same double now share one session identity.

## What this is not

Not a live vulnerability, and the change should not be sold as one. The only
party that can send a request is the desk's own renderer, over a socket bound to
`127.0.0.1` and gated by a session token, and it sends string ids
(`f-msvhaj6h-fpezm8wh`). Nothing reaches this from outside the desk.

It is a hole the boundary keeps shut. The reason to close it anyway is that the
boundary is the only thing closing it: the rule the protocol is written to — that
what a frame is permitted to contain is decided by the validators and not by the
transport — is not true of this field today, and every reader of that file has
been entitled to believe it is.

## What Changes

- `requestId` is required to be a string in both `validateFuturesWorkstationRequest`
  and `validateFuturesWorkstationEvent`, in the same shape the other nine `.test(`
  sites already use.
- A frame whose `requestId` is a number, a boolean or an array is refused with the
  identity code it should always have had, rather than accepted under the string
  its coercion happens to produce.

## What it costs

One `typeof` per frame, on a field that is already pattern-tested. Nothing on the
book's path changes.

## Impact

- `src/utils/futuresWorkstationProtocolShared.js` — two lines.
- Adds a requirement to `futures-workstation-presentation`.
- Found by the `/security-review` that task 4.6 of
  `carry-execution-ahead-of-market-data` asked for; the finding and the before/
  after table are recorded there, and this change is what that record points at.
