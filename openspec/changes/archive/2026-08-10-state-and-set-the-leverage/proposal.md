## Why

Nothing on the Futures desk stated the leverage a trade is entered at, and nothing
could change it. The operator noticed the second and the first at once: they had no
way to know what multiple they were trading BICO at, and no way to set it without
leaving for the exchange's own site.

It is not a display oversight. `/fapi/v3/positionRisk` stopped reporting `leverage`
and `marginType`, so the read every position row is built from no longer carries
either. The desk had honestly shown nothing rather than guess — the ROE fell back to
the margin Binance reports and the margin mode was inferred from the isolated
wallet — but "nothing" is the wrong answer for the one number that decides how far a
position is from liquidation. The same absence made the order ticket's margin
estimate meaningless: it divided by a hardcoded `1`, so an entry appeared to cost
its whole notional.

## What Changes

- The leverage and margin mode of a contract are **read from
  `/fapi/v1/symbolConfig`**, per contract: for the contract in hand whenever the
  desk changes contract, and for every symbol holding a position after each account
  refresh. They are merged into the position rows, so every surface reads one
  answer.
- The multiple is **shown where it is carried** — beside the contract on the order
  ticket and beside each position's symbol — and **each badge is the control**.
- A **leverage panel** opens at the cursor: the stops Binance offers, bounded by the
  contract's own bracket ceiling; a slider; what the wallet can carry at that
  multiple; the bracket's notional cap where the exchange reports one; and a warning
  when a position on that contract is already open, because changing leverage moves
  the price it liquidates at.
- `trade.setLeverage` → `POST /fapi/v1/leverage`, after which the config **and** the
  account are re-read: the exchange lowers a setting a position is too large for
  rather than refusing it, so the figure on screen must be the one it applied.
- The ticket states **Est. margin** for the draft, `notional ÷ leverage`.

## Decisions

**An unreported leverage is absent, not `1×`.** A leverage nobody stated is exactly
the number an operator must not be shown beside their own money. The badge reads
`Lev` until the read lands, and the margin estimate falls back to the whole
notional — which overstates the cost and never understates it.

**Leverage names its contract explicitly.** Like a margin transfer and unlike every
other command, the symbol has no fallback to the contract on screen: applied to the
wrong contract it reprices every position on it.

**Setting leverage is a write, so pausing stops it.** Pausing trading exists to stop
risk being taken. Raising leverage on an open position takes risk, in the most
direct way available: the same position standing behind less margin.

**The ceiling comes from the exchange, not from a constant.** Bracket 1 of
`/fapi/v1/leverageBracket` is the contract's own maximum; offering a stop above it
is offering a refusal. The command still refuses anything outside 1–125 before
spending a signed request.

**Sizing is left measured against the wallet.** The ticket's percent slider still
means "a position worth this share of the available balance", not "of the balance
times the leverage". Leverage now reports what an entry costs, but widening the size
ceiling twentyfold is a risk decision for the operator to take deliberately, not a
side effect of reading a number correctly. The leverage panel states what the wallet
can carry, so the possibility is visible without being armed.
