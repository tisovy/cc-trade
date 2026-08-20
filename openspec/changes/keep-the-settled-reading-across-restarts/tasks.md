## 1. The store

- [x] 1.1 A module that loads and saves the settled reading, under the desk's own
  data directory, beside the diagnostics record. One file, stated once in
  `main.js`, because a store the operator cannot find is a store they cannot
  delete when it is wrong.
- [x] 1.2 Keyed by a fingerprint of the futures credential — a digest, never the
  key, never a prefix of it. A desk started against another account starts from
  nothing.
- [x] 1.3 The file carries the span it covers and the rows it holds under the
  same identity the walk keys them by. A file that cannot state its own coverage
  is discarded rather than shown.
- [x] 1.4 Rows outside the desk's window are dropped on load. The window slides;
  the file must not carry a week that has aged out.

## 2. Verification

- [x] 2.1 The hourly reconciliation reads the window from nothing rather than
  from the held edge, and compares. A whole window is six requests, so this is
  the same cost as the tail read it replaces.
- [x] 2.2 The exchange wins every disagreement, and the count is recorded on the
  `settled` line so the operator can see whether the file has ever been wrong.

## 3. Proof

- [x] 3.1 A restart with a kept reading reads only the tail. Run against the
  implementation before this change first.
- [x] 3.2 A different credential is not shown the previous account's money.
- [x] 3.3 A file with no coverage, or a corrupt one, is discarded rather than
  loaded.
- [x] 3.4 A verification pass replaces a held row the exchange no longer states.
- [x] 3.5 The written file contains neither key nor secret.

## 4. Operator gate

- [ ] 4.1 After a restart the settled column is complete from the first frame,
  and the `settled` line for that start shows a tail read rather than a cold one.
- [ ] 4.2 The first verification of the session records no disagreements.

## 5. What building it found

- [x] 5.1 **The first verification nearly undid the whole change.** Checking a
  reading the desk had just built from the exchange is checking the exchange
  against itself, and the way it was first written that check landed on the
  *second* pass of every session — so a cold start became two cold starts, in
  the direction this change exists to remove. A reading only needs verifying
  when it came off disk. Caught by an unrelated test whose queue jammed on the
  extra requests, not by any test of this change.
- [x] 5.2 The comparison judges only the span the fresh read actually reached.
  A held row older than that was never asked about, and counting it as missing
  would print the walk's own page budget as the exchange contradicting itself —
  which is the number an operator would read as "the file cannot be trusted".
- [x] 5.3 A half-read chunk is never restored. `slice` is what the account
  taught about its own density and is worth carrying; `gap` is a position inside
  a walk that was interrupted, and restoring it wrong is a claim about coverage.
  The walk finds the same gap again from `from` and `to` alone.
- [x] 5.4 The operator's refresh now costs six more admissions than it did,
  because it asks for the settled reading as well. They land behind the account
  read rather than instead of it, and one test had to be given the clock to say
  so out loud.
