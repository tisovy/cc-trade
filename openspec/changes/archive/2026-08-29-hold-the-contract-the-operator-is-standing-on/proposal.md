# Hold the contract the operator is standing on

## Why

**Binance lists USDⓈ-M perpetuals whose tickers are CJK words.** On 2026-08-28
`fapi/v1/exchangeInfo` carries three, all `TRADING` `PERPETUAL`: `币安人生USDT`
(onboarded 2025-10-20), `我踏马来了USDT` (2026-01-21) and `龙虾USDT`
(2026-03-09). The workstation's market-data path was built for this — the
protocol and the catalog normalizer both read the identity alphabet
`[\p{Lu}\p{Lt}\p{Lo}\p{N}]` and the catalog marks such contracts
`tradable: false` because the execution path is deliberately ASCII. The operator
opened 龙虾USDT on 2026-08-28 and traded around it all evening. The market data
carried: aggTrade, kline and depth streams for the percent-encoded CJK name all
flow on the desk's own routes (probed live through the desk's proxy, 2026-08-28
18:57Z–19:00Z).

Three edges never learned the alphabet, and each failed as silence:

1. **The symbol history read ASCII** (`/^[A-Z0-9]{4,20}$/`). A CJK contract
   could not become `lastSymbol` or enter the recent list, so every workspace
   remount reopened the *previous* ASCII pair. Measured live: the desk restart
   at 18:44:38Z opened VELVETUSDT while the operator was working 龙虾USDT, and
   again at 18:45:25Z — the operator's complaint, word for word: «показывается
   другая пара (прошлая), а потом снова прогружается текущая».

2. **The diagnostic record read ASCII** (`/^[A-Z0-9]{1,24}$/`), and `symbol` is
   mandatory on a `status` line, so *every* line about the pair lost itself to
   the malformed-field rule. `desk-2026-08-28-002.jsonl` holds **zero** matches
   for 龙虾 across a day the operator traded it — while that pair's session
   resynchronized every 15–20 seconds (`CROSSED_ORDER_BOOK` → full
   `aggregate-ready` rebuild, 1.6–2.3 s each), spent the request budget to its
   ceiling (`deferred` lines at 770–800 of 800/min) and held the operator's
   urgent commands behind it for seconds. The record showed the cycles and could
   not say whose they were: faults and phase timings carry no symbol.

3. **The ticket's refusal lied by generality.** `tradable: false` fell into the
   CONTRACT gate — "Select an active USDⓈ-M contract" — while the operator stood
   on an active contract whose chart was live. The complaint: «я сейчас не могу
   даже ордер поставить». The desk refuses these listings *on purpose*; the
   refusal owed its reason.

And underneath all three, the day's two blind spots: the workspace remounted
twice in a minute with nothing recording why (the local renderer socket's
lifecycle is journaled nowhere), and 812 doubled frame-reporter lines ran
15:47Z–17:58Z with nothing counting the sockets they implied.

## What Changes

- **The symbol history reads the protocol's identity alphabet** — CJK listings
  and dated delivery names persist and restore; a remount reopens the contract
  the operator was standing on.
- **The diagnostic record reads the same alphabet** in every `symbol` field.
  A storm on a CJK listing writes exactly the lines an ASCII one does.
- **Session-scoped faults and the aggregate timing name their contract**
  (`symbol` on `fault` and `timing`, optional): the next fifteen-second rebuild
  cycle names itself.
- **The renderer reports display transitions** (`display` kind:
  `symbol-shown` with `from` and a `cause` of `operator` or `restored`,
  `workspace-mounted`, `workspace-unmounted`), so a remount that reopens a
  stored contract is distinguishable from a selection.
- **The local link's lifecycle is recorded** (`link` kind:
  `renderer-connected` / `renderer-disconnected` with the open-socket count).
- **The ticket names the listing gate**: a live, perpetual, catalogued contract
  with `tradable: false` reads LISTING — "Binance lists this contract, but its
  ticker is outside the desk's execution path — orders from the desk are
  disabled for it" — instead of CONTRACT's "select an active contract".

## What stays, deliberately

The execution path stays ASCII and these listings stay untradable from this
desk. Widening execution to the unicode alphabet touches order signing, the
REST execution routes' encoding and client-order-id minting, and whether to
trade such listings at all is the operator's call — a separate change if ever
wanted. This change makes the refusal honest and the desk's behaviour around
such listings survivable: the pair stays selected, the journal can see it, and
the ticket says why it is dark.
