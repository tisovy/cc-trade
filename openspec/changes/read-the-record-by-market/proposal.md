# Read the record by market

## Why

Two flaws in `scripts/read-desk-record.mjs`, found by the 2026-08-19 audit, and
both of the same species: the reader answered a different question than the one
it was asked, and nothing on the page said so.

**The answer summary merged two markets that do not measure the same span.**
An `answer` line times a command from validation to the end of handling it, and
that span is not the same work on both markets: a futures answer is the
command's round trip, a spot answer is the round trip plus the account re-read
behind it. The summary keyed the distributions by action alone, so both markets
fell into one row. On the real record of 2026-08-16 the merged
`trade.placeOrder` row reported **slowest 3285ms** over a day dominated by
futures orders — and that sample is the spot placement at 17:39:57.902Z, whose
number is mostly the account re-read. The number was true; the reading of it
was not. This is the exact trap the project has already written down once —
"строка `answer` в журнале меряет РАЗНОЕ на разных рынках, сравнивать их
напрямую нельзя" — re-introduced by new code.

**A named file was silently ignored.** The verification runbook
(`time-the-fill-to-the-screen` §7.1, archived) tells the operator to name a
day's file: `node scripts/read-desk-record.mjs
~/.config/cc-trade/diagnostics/desk-<YYYY-MM-DD>-000.jsonl`. The argument
parser knew only `--dir`, `--day` and `--list`; a positional path — or a
misspelled flag — was dropped on the floor, and the script printed the latest
day with exit 0. Reproduced against a fixture: asking for the file of
2026-08-01 printed the summary of 2026-08-02, no warning. A summary of the
wrong day reads exactly like a summary of the right one.

## What Changes

- Every `answer` statistic is kept per market. The group is keyed
  `action[market]` — `trade.placeOrder[futures]`, `trade.placeOrder[spot]` —
  and the two distributions are never merged: each market's count, median,
  slowest and its time are its own. A day that held only one market prints
  only that market's groups. The section states its own rule: *each market is
  its own distribution; the two do not measure the same span*.
- The reader honors a positional file path, as the runbook has documented all
  along. A file it cannot read is refused with an error naming the file and a
  nonzero exit — never the latest day instead. A call that names a file *and*
  asks the directory (`--dir`, `--day`, `--list`) is contradicting itself and
  is refused whole. An option the reader does not know stops it instead of
  steering it.
- `--dir`, `--day` and `--list` keep working exactly as before when no file is
  named.

## What this is not

Not a change to the writer or to the record's shape: every `answer` line
already carries its market (`electron/services/desk-diagnostic-record.js`
requires it), so old records read back per market with no migration. And not a
correction of either market's number — both spans stay what they were; they
are only no longer presented as one.

## Impact

- `scripts/read-desk-record.mjs` — answer grouping, argument parsing, the
  named-file path.
- `scripts/read-desk-record.test.mjs` — mixed-market day, single-market day,
  named-file honored/refused, contradictory and unknown arguments.
- Modifies two requirements of `desk-diagnostic-record`: *The record can be
  read back* and *A command's answer is recorded beside it*.
- Raised by the 2026-08-19 audit (Codex series), items (a) and (b) of the
  reader defect.
