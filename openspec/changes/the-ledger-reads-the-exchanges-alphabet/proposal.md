# The ledger reads the exchange's alphabet

## Why

The operator's word, 2026-08-29: trading on 龙虾USDT is live and confirmed —
nine placements and two cancels in this morning's journal, every answer `ok`,
two positions standing. A full audit of the alphabet saga then swept every
remaining symbol pattern in the desk and found the seventh ASCII edge: the
money and history bookkeeping *behind* the now-open execution path still
spells symbols in a private ASCII alphabet, in four places, each failing
silently.

Measured before writing:

- `futuresSettledIncomeResource` (`CANONICAL_SYMBOL_TEXT`) rejects the whole
  income row for a non-ASCII symbol, and `canonicalFuturesIncomeRows` skips
  rejected rows without an error. The pair's funding fees — money on an
  account holding two 龙虾USDT positions — would never reach the settled
  ledger, with no popup and no lane failure. The canon itself required this:
  «only uppercase ASCII letters, digits, and underscores».
- `futures-trade-history-reverse-flat` disqualifies the symbol before looking
  at a single row, so the pair's flat boundary is unprovable and its history
  read can never stop early.
- `trading-command-validation` drops the pair's entry from `coverage` on
  every `account.history` command, so the desk forgets what it has already
  read and re-reads the pair from scratch.
- `futuresBookView` refuses to remember how the operator reads the pair's
  book (side mode, grouping step).

## What Changes

- The canonical income **symbol** alphabet becomes the exchange's identity
  alphabet — uppercase, titlecase, and caseless letters, numbers, and
  underscores. No lowercase class exists in it, so the case-folding
  protections hold unchanged: padded, lowercase, long-s, dotless-I and
  ligature tokens are still rejected in their original form, and income
  canonicalization still never trims or uppercases a token into money.
- Reverse-flat reconciliation and history-coverage validation stop keeping
  private alphabets and reuse `normalizeFuturesTradeHistorySymbol` — the one
  spelling rule the history evidence itself is admitted under.
- The book-view store key accepts the same identity alphabet.

## What stays, deliberately

- Income **types** and settlement **assets**: ASCII, the exchange's own
  enums and the money boundary.
- The strictness stance of every boundary: income canonicalization refuses
  rather than normalizes; reverse-flat and coverage validation trim and
  uppercase exactly as they did for ASCII symbols.

## Operator acceptance

Funding on 龙虾USDT posts on the exchange's schedule; the next charge after
this deploy must appear in the settled ledger and the pair's closed rounds
must anchor. Nothing to press — the proof is the money showing up.
