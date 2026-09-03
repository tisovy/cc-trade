# Tasks

## 0. Measured first, 2026-09-02 (see proposal.md)

- 0 sequence gaps; 50 `DEPTH_RANGE_SHORT`; 101 `CROSSED_ORDER_BOOK`; 34
  `DEPTH_BOOK_DOWN` in 3.6 h on AKEUSDT. Operator: «хранить ВСЁ, а показывать
  только то что указано в интерфейсе».

## 1. The book (main process)

- [ ] 1.1 `futures-workstation-order-book.js`: remove `RETAINED_LEVELS_PER_SIDE`,
      `EVICTION_SLACK`, `trimSide`; parsed-decimal bound follows the book;
      cached best per side (recompute only on best deleted / nearer inserted);
      `band` kept as the bootstrap page for `whole` only; `holdsMarket`,
      `rangeShortfall`, `FUTURES_WORKSTATION_BAND_ROOM_SHARE` removed; reach
      from the retained book, stated on every delivery.
- [ ] 1.2 `futures-production-workstation-service.js`: remove
      `ensureDepthCovers`, `deepenDepthPage` and their four call sites;
      bootstrap and recovery read `DEPTH_1000`; `depthRange` bounds delivery
      only; `DEPTH_RANGE_SHORT`/`DEPTH_BAND_WALKED` leave `recoverBook`'s
      vocabulary and the record's closed set; `stale` means gap-in-recovery
      or unbridged only.
- [ ] 1.3 Crossing evidence: `CROSSED_ORDER_BOOK` fault carries
      `lastUpdateId`, `U`, `u`, `pu`, `crossedLevels` (declared fields,
      asserted through `describeDeskDiagnosticEvent`).
- [ ] 1.4 Transport close: `closeCode`, `closedBy`; session `lastUpstreamMs`;
      both on the `status` line for `SOCKET_CLOSED` and the reconnect fault.
- [ ] 1.5 Grep the canon and comments for «deeper page», «band», «ladder»
      stated as behaviour (a rule lives in more than one place); amend the
      summary tool's fault vocabulary.

## 2. Renderer

- [ ] 2.1 The book panel reads the reach on every delivery (no «deepest page»
      condition); the `whole` marker unchanged.

## 3. Tests that bite, then the suite

- [ ] 3.1 Against a `git archive` copy of HEAD first: a market walking out of
      the page produces no read (HEAD: `DEPTH_RANGE_SHORT` read); a grouping
      step past the page produces no read (HEAD: deepen); 20 000 levels a
      side retained with none evicted (HEAD: 10 500); reach stated at the
      first delivery (HEAD: null until deepest); crossing fault carries the
      identities; close line carries code and lag. Name guards as guards.
- [ ] 3.2 Replay stand: the recorded 2026-08-14 diff capture (or a synthetic
      chain) at 10 diffs/s on a 20 000-level side — per-diff cost under the
      2026-08-14 10 000-level figure; delivery cost unchanged.
- [ ] 3.3 Full suite, eslint, the four guards, build; scope by grep.

## 4. Operator verification (runbook, live)

- [ ] 4.1 A thin contract (AKEUSDT-class) through a spike: the book stays
      live, rows agree with Binance at every grouping step, no
      `DEPTH_RANGE_SHORT` line; `CROSSED_ORDER_BOOK` ≤ a few per hour and
      each with evidence.
- [ ] 4.2 Ten minutes on one contract: the book's stated reach grows with the
      stream; far rows marked not whole beyond the page.
- [ ] 4.3 Journal read: public-budget depth reads = bootstraps + proven gaps;
      every `SOCKET_CLOSED` line carries a cause and the lag before it.
