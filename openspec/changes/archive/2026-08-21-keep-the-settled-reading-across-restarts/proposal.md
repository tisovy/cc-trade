# Keep the settled reading across restarts

## Why

The operator asked for it, and their own journal now says why. Measured from
`~/.config/cc-trade/diagnostics/desk-2026-08-20-000.jsonl`, across the ninety
minutes after the narrowed read went live:

| | passes | weight | per minute |
|---|---|---|---|
| account reads | 40 | 2 795 | **28.0** |
| settled income | 15 | 4 500 | **45.3** |

Neither of those is polling any more. Look at what the passes are *for*: twelve
`bootstrap` account reads and seven `stream` settled reads in ninety minutes,
against a desk that is meant to bootstrap once. Each of those is a **restart** —
this session alone edited `electron/**` a dozen times, and every save relaunches
the desk — and every restart pays a cold start of 12 reads and 360 weight for a
record that had not changed.

That is the shape the file fixes. Not the steady state, which is now six reads
per settlement; the *start*. The desk throws away a complete reading of the
week every time it is relaunched and buys the identical rows again.

The argument against it, made in `read-only-the-income-the-desk-cannot-derive`,
was that persistence is worth its risk when the thing it saves is expensive, and
a 360-weight cold start is not. That was an argument about one restart. It is
wrong about a day of them, and the operator — who watches the desk restart under
their hands — was reading a number the argument did not contain.

## What Changes

- **The reading is kept on disk and extended rather than re-read.** A restart
  loads the week it already had and reads only the tail since.
- **The hourly reconciliation becomes a verification.** A whole-window re-read
  is six requests now, so it is affordable to do the honest thing: read the
  window from nothing, compare it to what is held, and let the exchange win
  every disagreement. That is what makes a kept reading safe rather than a
  stored guess — the file is checked against the source every hour it survives.
- **The store is keyed to a fingerprint of the credential**, so a desk started
  against another account cannot show the previous one's money.

## What this does not change

The exchange remains the only source of record. The file is a way of not asking
again for what was already answered — never an authority, never preferred, and
discarded whenever it cannot state what it covers.

## Impact

- `electron/services/futures-settled-income-store.js` — new.
- `electron/services/binance-connection.js` — load on activation, save on a
  pass, verify on the hour.
- `electron/services/futures-trading-adapter.js` — a fingerprint of the
  credential, never the credential.
- `electron/main.js` — the directory, stated once beside the diagnostics one.
