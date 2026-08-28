# The execution path reads the exchange's alphabet

## Why

The operator, 2026-08-28, standing on 龙虾USDT with 23 working orders and two
positions on the account, showing the ticket's LISTING gate: «торговля
заблокирована … именно на этой паре». The refusal being deliberate does not
make it right anymore — the operator has now said the word the gate was
waiting for.

Measured before writing: the refusal lives in exactly one expression. The
workstation protocol, the catalog admission, the journal, the symbol history
and (since today) the trade-history evidence all read the exchange's identity
alphabet already; the trading-command validation layer bounds symbols by
emptiness and length only; the signed transport builds and signs one
percent-encoded string (`toQueryString` → HMAC → same string on the wire), the
same mechanism the market and history reads already proved live against
Binance with this very ticker. Client order ids are never derived from the
symbol — the desk passes through the exchange's own ASCII ids — so Binance's
id charset rule is untouched. The only place the desk says «not this
contract» is `tradable: ASCII_EXECUTION_SYMBOL_PATTERN.test(...)` in the
catalog contract.

## What Changes

- `tradable` becomes what it already claims to be: the contract is catalogued
  (admission has spelled its symbol in the exchange's identity alphabet),
  its status is `TRADING`, and it is a `PERPETUAL`. The separate ASCII
  execution pattern is deleted — one alphabet, stated once, for the whole
  desk.
- The ticket's LISTING gate and its derivation stay in place unchanged, as
  the honest refusal for any future contract delivered catalogued, trading
  and perpetual yet not tradable — a divergence guard that is now expected
  never to fire.

## What stays, deliberately

- Client order ids: ASCII, per the exchange's own charset rule; never built
  from a symbol.
- Assets (`canonicalAsset`, fee/margin assets): ASCII — the money boundary.
- Everything the readiness ladder already gates: credentials, filters,
  leverage — a unicode listing passes the same gates as any contract, no
  special case.

## Operator acceptance

The first order on a CJK listing is the live proof the fixture cannot give:
place a minimum-size limit far from the market, see it in Orders, cancel it.
The history panel loading this pair's trades (deployed earlier today) already
proves signed requests carry the symbol correctly.
