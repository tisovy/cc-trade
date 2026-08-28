# Read the history in the exchange's alphabet

## Why

The operator's terminal, 2026-08-28, minutes after opening 龙虾USDT with
standing orders on it (placed from the Binance app — the desk's execution path
deliberately will not):

    [futures-history] 龙虾USDT request failed: A valid expected trade-history symbol is required

— five times in a burst after every aggregate rebuild, retried forever. The
account provably holds trades on the listing; the desk's own read side refused
the symbol before a single request left the machine.
`normalizeFuturesTradeHistorySymbol` read `/^[A-Z0-9_]+$/` — the sixth ASCII
edge a unicode listing has found, and the second on a read-only path (the
diagnostics journal was the first).

The transport under it was already sound: signed queries are built and signed
from the same percent-encoded string (`toQueryString` → HMAC), so a unicode
symbol signs and travels correctly. Only the admission pattern refused.

## What Changes

- `normalizeFuturesTradeHistorySymbol` reads the identity alphabet the
  workstation protocol reads — uppercase, titlecase and caseless letters and
  numbers, with the delivery-dated underscore — and keeps refusing anything
  that could spell an amount. The 32-character bound stays.
- The money boundaries stay exactly as they were: a page row whose contract is
  not the expected one is still refused (`FOREIGN_TRADE_SYMBOL`), assets stay
  ASCII, and the execution path's alphabet does not move.

## What stays, deliberately

Placing and cancelling orders on such listings from the desk. Reading the
account's history is not executing against it; the LISTING readiness gate
continues to say so on the ticket.
