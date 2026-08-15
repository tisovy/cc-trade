## Why

The desk record states that a command was refused. It does not state why.

On 2026-08-11 the operator's own record held two of them:

```
2026-08-11T16:30:07.537Z  trade.placeOrder  rejected  FUTURES_API_ERROR  CYSUSDT  f-msovm6gw-qakfy99m
2026-08-11T16:30:13.080Z  trade.placeOrder  rejected  FUTURES_API_ERROR  CYSUSDT  f-msovmash-z1m4j0u5
```

`FUTURES_API_ERROR` is the desk's own word for "the exchange said no", and it is
the same word for every refusal there is. Whether the margin was short, the price
was outside the band, the contract was reduce-only, or the order was simply too
small, the record reads identically — and it is the one place the answer would
have survived, because the message on screen is gone the moment the panel
refreshes.

The exchange's own code was deliberately left out of the record when it was
built: the field it travels in (`details.binanceCode`) sits beside prices and
sizes, and the rule was to copy nothing that could carry an amount. That rule was
right and stays. But the code itself is `-2019`, or `ECONNRESET` — a small signed
integer or an uppercase transport identifier. Neither can spell a decimal, and
either can be checked against a pattern that refuses one.

So the caution cost the record its most useful field for the one event class the
operator most needs explained, and it bought nothing.

## What Changes

- **A refusal names the code the exchange gave it.** The `outcome` line gains one
  optional field carrying the exchange's own code, from the same `binanceCode`
  the rejection already puts in front of the operator.
- **The field cannot carry an amount, and that is enforced, not intended.** It
  accepts a signed integer of bounded width or an uppercase identifier, and
  nothing else. A value shaped like a price refuses the field the way every other
  field in the record already refuses one.
- **The summary counts refusals by that code.** "Nine orders refused, all
  -2019" is the reading the operator actually wants; "nine `FUTURES_API_ERROR`"
  is what they get today.
- **Spot and Futures are the same road.** Both already build the field
  (`spotBinanceCode`, `describeFuturesApiError`'s companion), and both reach the
  record through the same outcome envelope.

## Trade-offs this accepts

- **A code, not a message.** `describeFuturesApiError` produces sentences meant
  for a human, and a sentence is exactly the shape that can quote a quantity back
  ("Order's notional must be no smaller than 20"). The number is kept and the
  sentence is not. The operator looks the number up once.
- **Nothing else about the refusal is added.** Not the price that was refused,
  not the size, not the balance that was short. What the record answers is *which
  refusal happened, how often, and on what* — enough to know whether an evening
  of rejections was one cause or five.

## Capabilities

### Modified Capabilities

- `desk-diagnostic-record`: a refusal in the record names the code the exchange
  gave for it, under a rule that still cannot carry an amount.

## Impact

- `electron/services/desk-diagnostic-record.js` — one field on the `outcome`
  kind, its pattern, and its extraction from the rejection envelope.
- `scripts/read-desk-record.mjs` — refusals grouped by exchange code in the
  summary.
- Not touched: `electron/services/binance-connection.js` already carries
  `binanceCode` on every rejection envelope it emits, for both markets. This
  change reads what is already there.
