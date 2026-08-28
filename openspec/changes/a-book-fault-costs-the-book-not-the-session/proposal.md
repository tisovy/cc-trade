# A book fault costs the book, not the session

## Why

The evening 2026-08-28 journal, minutes after the desk first saw its own
unicode listing by name: the workspace on 龙虾USDT left `live` for a full
resynchronization every 20 to 60 seconds — `resynchronizing
MALFORMED_STREAM_FRAME`, half a second of `loading`, ~1.6–2 s of rebuild,
repeat (19:51:16, 19:51:33, 19:52:33, 19:53:26, 19:53:54, 19:53:58). The
operator read it as the chart jerking back and forth, and it was: candles,
book, tape and header re-bootstrapped each round, ~90 weight a round against
the read budget.

The chain, line by line: the pair pumps; the book's proven band walks
(`DEPTH_BAND_WALKED`, every ~11 s) and re-centres quietly, as designed; during
the move a diff leaves the book crossed, and the book fails closed —
`fail('CROSSED_ORDER_BOOK')` out of `applyDelta`, phase `RESYNC_REQUIRED`
already set, asking for a quiet rebuild. The service's catch then decides
*what kind of problem this is* by reading the frame's stream name against
`/"stream"\s*:\s*"[a-z0-9_]{1,32}@depth/`. The listing's stream name is
`龙虾usdt@depth@100ms` — the exchange spells it raw — so the depth frame reads
as not-a-depth-frame, and a book problem escalates to
`scheduleResync(MALFORMED_STREAM_FRAME)`: the whole session pays for a fault
the book had already contained. On an ASCII contract the same cross recovers
the book quietly and the workspace never blinks; the difference is only the
alphabet of the name.

This is the fifth ASCII edge the listings found (history, journal schema,
ticket gate, and the journal's own symbol field were the first four —
`hold-the-contract-the-operator-is-standing-on`), and the second time the
lesson is the same: the classification was by the frame's spelling when the
error's own identity was already in hand.

## What Changes

- The catch in `handleStreamFrame` routes by the error first: a
  `FuturesWorkstationOrderBookError` — crossed book, an update the book's
  rules refuse — recovers the book under the fault's own code
  (`CROSSED_ORDER_BOOK` on the reason line, not the generic
  `MALFORMED_DEPTH_FRAME`), whatever stream the frame arrived on and however
  its name is spelled. The session stays live around it.
- The depth-stream classifier reads the exchange's own spelling: the stream
  name is anything up to the quote that ends it (raw unicode or JSON `\u`
  escapes), bounded, ending in `@depth`. A malformed depth frame on a unicode
  listing now costs the book, exactly as it always has on an ASCII contract.
- A malformed frame from the traded streams — price, candles, tape — still
  resynchronizes the session. That rule does not move.

## What stays, deliberately

The band walks themselves. A pumping listing re-centres its book every ~11 s
because the market genuinely leaves the proven band; each re-centre is a
cheap, quiet snapshot and is the design working. Whether the band should be
wider for fast movers is a budget question for its own change, measured from
the now symbol-named journal — not a correctness one.
