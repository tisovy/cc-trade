# Tasks

## 1. Re-verify both flaws before touching anything

- [x] 1.1 Re-read the current script. Both flaws present, at the audited sites:
  `summarizeDeskDiagnosticRecord` keyed `answers` by `line.action` alone
  (`scripts/read-desk-record.mjs`, the `kind === 'answer'` branch), and
  `readArguments` knew only `--dir`/`--day`/`--list`, dropping every other
  argument on the floor before `runDeskRecordSummary` fell back to the latest
  day.

- [x] 1.2 Re-verify (a) against the operator's real record (read-only). On
  2026-08-16 the day's `trade.placeOrder` answers span both markets; the
  3285 ms sample is spot, not futures:

  ```
  {"at":"2026-08-16T17:39:57.902Z","kind":"answer","action":"trade.placeOrder",
   "market":"spot","durationMs":3285,"outcome":"ok","symbol":"BTCUSDT",
   "identity":"s-msw3b795-9n5yf9l9"}
  ```

  Run through the pre-fix script (fixture of three real-shaped rows, two
  futures 739/729 ms + this spot row), the summary printed one merged row and
  attributed the spot re-read to the whole action:

  ```
  How long commands took to answer
    trade.placeOrder       n=    3  median    739ms  slowest   3285ms at 2026-08-16T17:39:57.902Z
  ```

- [x] 1.3 Reproduce (b) with a fixture. Two days on disk (2026-08-01,
  2026-08-02); asked for the *older* day's file by the positional path the
  runbook documents. The pre-fix script printed the other day, exit 0, no
  warning:

  ```
  $ node scripts/read-desk-record.mjs --dir <fixtures> <fixtures>/desk-2026-08-01-000.jsonl
  Desk record for 2026-08-02 — 2 events
  ...
  exit=0
  ```

## 2. Fix the reader

- [x] 2.1 Key every answer distribution by `action[market]` —
  `trade.placeOrder[futures]`, `trade.placeOrder[spot]` — never merged; a day
  with one market prints only that market's groups. The section carries its own
  rule on the page: `each market is its own distribution; the two do not
  measure the same span`. A market torn out of a hand-edited line groups as
  `[-]` rather than failing the summary (the writer itself cannot omit it:
  `market` is a required field of `answer` in
  `electron/services/desk-diagnostic-record.js`).

- [x] 2.2 Honor a positional file path (one or more segment files; the day
  heading is read off the file names). A file that cannot be read is refused
  with `Cannot read <path>: <code>` and exit 1, printing nothing — never the
  latest day. A call mixing a named file with `--dir`/`--day`/`--list` is
  refused whole, and so is an unknown `--flag` (a misspelling used to steer
  the reader to the wrong day exactly like a positional path did).
  `--dir`, `--day`, `--list` unchanged when no file is named. Verified by
  hand post-fix: named older file → that day; missing file → `Cannot read …:
  ENOENT`, exit 1; `--dya` → `Unknown option --dya. …`, exit 1.

## 3. Tests that bite

- [x] 3.1 Extend `scripts/read-desk-record.test.mjs`. New answer fixtures are
  rows the writer actually emits — field-for-field the shape of
  `answer` in `electron/services/desk-diagnostic-record.js`, values lifted
  from the real 2026-08-16 record. Mixed-market day where the slowest answer
  is the spot 3285 ms row: asserts three groups, and that
  `trade.placeOrder[futures]` holds `count 2, slowest 739ms at
  2026-08-16T07:23:32.604Z` — the spot sample appears only under spot. Plus:
  single-market day prints no other market; a market-less (hand-damaged)
  answer line does not throw; named file honored over the latest day;
  multiple segments read as one day; missing file refused with the path and
  no summary printed; file+`--day` refused; unknown option refused.

- [x] 3.2 Prove the bite: `git stash push -- scripts/read-desk-record.mjs`
  (tests kept), run, **7 failed | 20 passed**, then `git stash pop` → 27
  passed. The failures, pre-fix:

  ```
  × times each market apart, never folding their answers together
      AssertionError: expected [ …(2) ] to deeply equal [ { …(6) }, { …(6) }, { …(6) } ]
  × prints just the one market a day held
      AssertionError: expected [ { key: 'trade.cancelOrder', …(5) } ] to deeply equal [ { …(6) } ]
  × reads the file it was named, not the latest day
      AssertionError: expected 'Desk record for 2026-08-19 — 683 even…' to contain 'Desk record for 2026-08-09 — 17 events'
  × reads every segment it is handed as one day
      AssertionError: expected 'Desk record for 2026-08-19 — 683 even…' to contain 'Desk record for 2026-08-10 — 18 events'
  × refuses a file it cannot read rather than substituting the latest day
      AssertionError: expected true to be false
  × refuses to be asked for a file and a day at once
      AssertionError: expected 'No desk record for 2026-08-10 in /hom…' to contain 'not both'
  × refuses an option it does not know rather than reading the wrong thing
      AssertionError: expected true to be false
  ```

  The third and fourth lines are the audit's finding reproduced by the test
  itself: with the positional path ignored, the pre-fix reader walked to the
  default directory and printed the operator's real latest day —
  `2026-08-19 — 683 events` — in place of the named fixture.

## 4. Green

- [x] 4.1 `npx vitest run scripts/read-desk-record.test.mjs` — 27 passed (27).
- [x] 4.2 `npx eslint scripts/read-desk-record.mjs
  scripts/read-desk-record.test.mjs` — clean.

## 5. Spec delta

- [x] 5.1 `specs/desk-diagnostic-record/spec.md`: MODIFIED *The record can be
  read back* (scenario **A named record file is read or refused, never
  substituted**) and *A command's answer is recorded beside it* (scenario
  **Answer spans are summarized per market**). Both carry the full updated
  requirement text.
