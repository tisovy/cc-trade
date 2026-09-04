# Tasks

## 1. The catalogue

- [ ] 1.1 `normalizeFuturesWorkstationExchangeInfo` keeps `onboardDate` on the contract object: a safe integer as the exchange states it, `null` when absent (D4). Test: a symbol with and without `onboardDate`; the frozen shape of every other field unchanged.

## 2. The store client

- [ ] 2.1 `readCandles` accepts `listedAt` (`null` or a safe positive integer; anything else `INVALID_STORE_SELECTION`); the window mode ignores it (D1).
- [ ] 2.2 `servePage` implements the vouch (D2): first minute equals `ceilMinute(listedAt)`, `from < first`, `gap_count === minutesBetween(from, first)`, `actual_to >= to`, rows contiguous from the bucket containing `first` to `to`.
- [ ] 2.3 Tests, each asserting the address on the wire and the rows served or refused, against the store's own loopback server:
      - a 15m page on a contract listed inside the page (MARSCOINUSDT's shape: `actual_from` = listing minute, `gap_count` = minutes before it, 244 rows) → served, `candle-store-page ok hit`;
      - the same answer with `actual_from` one minute after the listing → `miss NOT_COVERED`;
      - the same answer with one inner minute missing (`gap_count` + 1) → `miss NOT_COVERED`;
      - `from >= first` with a short answer → `miss NOT_COVERED` (the existing rule);
      - `listedAt === null` with a short answer → `miss NOT_COVERED` (USELESSUSDT at the fill boundary);
      - a 1h page where the listing minute is not bucket-aligned (09:45 on 1h) → the first row opens 09:00 and is served.
      Bite: every test must fail on the tree before 2.2.

## 3. The service

- [ ] 3.1 `readStorePage` passes `listedAt: session.contract?.onboardDate ?? null` (D1). Test: the store receives the session contract's `onboardDate`; a session whose contract lacks it passes `null`.
- [ ] 3.2 A vouched page reaches the renderer through `emitCandleHistory` as a short page and ends the history (`exhausted`), the same as the exchange's short page. Test on the service with the mock store answering short-with-vouch: the renderer frame carries `total < limit`.

## 4. Verification

- [ ] 4.1 `npm run -s check:circular check:runtime-mock check:futures-production check:command-path`, `npx vite build`, `npx vitest run`, `npx eslint`.
- [ ] 4.2 Live, with the desk stopped for the deploy (`pgrep -x electron` = 0): open MARSCOINUSDT (or the newest listing) on 15m, 5m and 4h and scroll to the contract's start — the journal shows `candle-store-page ok hit` and no `candle-history` timing for the page that reaches before the listing; USELESSUSDT on 1h scrolled past 2026-07-16 still shows `miss NOT_COVERED` followed by `candle-history`.
- [ ] 4.3 Journal read after the sitting: pages from the store rise by the vouched pages; the exchange's short pages for young listings are gone.
