## Context

See [proposal.md](proposal.md) for the motivation and
[the presentation delta](specs/futures-workstation-presentation/spec.md) for
the required behavior.

The narrow Futures workstation is assembled by
`FuturesProductionWorkstation`, `FuturesWorkstationView`, and
`FuturesTradingTicket`. The production container owns account-resource state,
the view owns the contract rail plus order book and aggregate tape, and the
ticket owns sizing, confirmation, command feedback, and account failures.
Routine market state and account synchronization are currently rendered in
more than one of those layers.

Recent symbols are persisted independently of the asynchronously loaded
catalogue. The first render can therefore contain recent symbols for which only
the symbol string is known. Ticket feedback also currently mixes passive
acknowledgements with safety-critical failures, so removing status chrome must
be selective rather than a blanket removal of feedback rendering.

The change is renderer-only. It must preserve the existing IPC boundary,
command state machine, exchange quantization, account-resource retries, and
non-persistent backend pause enforcement. The affected components participate
in the production Futures workstation flow; the pre-proposal GitNexus result
was MEDIUM upstream risk for `FuturesWorkstationView` and LOW for the other two
components, with no HIGH or CRITICAL result.

## Goals / Non-Goals

**Goals:**

- Recover vertical space without reducing market-data density or order-entry
  safety.
- Derive recent-contract pills and active-search results deterministically,
  showing no second catalogue list in empty-search mode and no duplicate symbols
  in active-search mode.
- Give `LIVE`/`SYNC` one owner while preserving non-routine market-state and
  actionable failure disclosure.
- Preserve keyboard and assistive-technology meaning after visible table-like
  headings and last-print labels are removed.
- Keep the tape rows mounted and independent of the settings disclosure so
  collapsing settings cannot reset tape state or scroll position.

**Non-Goals:**

- Changing Binance adapters, Electron IPC, persistence formats, trading gates,
  command semantics, sizing mathematics, or exchange-filter quantization.
- Removing mouse gestures themselves; only their persistent help/status chrome
  is removed.
- Removing rejection, unresolved-outcome, locally-unsent, account-sync-failure,
  or disabled-action reasons and retry paths.
- Persisting the tape-settings disclosure state or the backend pause state.
- Archiving the change before the operator verifies it with live data.

## Decisions

### 1. Derive recent pills separately from active-search results

When search is empty, `FuturesWorkstationView` will resolve persisted history
against catalogue entries and render it as a most-recent-first wrapping pill
group. A symbol missing from the catalogue will use its pending representation
and remain selectable. No ordinary catalogue list will render beneath this
group. When search is non-empty, the pill group will not render; one
deduplicated matching list will contain catalogue-backed matches and pending
recent matches, so a new contract remains discoverable without duplicating a
recent one. `FuturesProductionWorkstation` will fold its active starting symbol
into an otherwise empty persisted history before the view's first render, so
removing the idle catalogue cannot leave a fresh installation with no pills.

Each pill will be a small compound control: selecting the contract and toggling
its favorite remain separate accessible actions, while selected/favorite state
is exposed programmatically. CSS flex wrapping and content-sized pills are used
instead of a fixed column count because symbols vary in length and the Electron
rail can be resized. The pill container will use its wrapped content height while
the rail has spare vertical room; a fixed short `max-height` must not create a
scrollbar above an otherwise empty lower rail. The rail layout will constrain
the group and enable internal overflow only once its content and the execution
ticket together consume the available column height.

Alternatives considered:

- Keeping a second full-width catalogue beneath the pills would duplicate the
  same contract-navigation purpose and spend the vertical space the compact
  rail is intended to recover.
- A fixed CSS grid would create unused space or truncation for longer symbols.

### 2. Pass an explicit account-synchronizing signal to the view

`FuturesProductionWorkstation` will derive one boolean from the authenticated
Futures account resources and pass it to `FuturesWorkstationView`. The identity
badge will display `SYNC` only when the market state would otherwise be `LIVE`
and that boolean is true. Once synchronization settles, it displays `LIVE`
again. Disconnected, stale, unavailable, and other non-routine market states
retain precedence and their existing reason disclosure. The duplicate catalogue
state badge is removed.

An explicit boolean keeps account-state interpretation in the container that
owns those resources and prevents the presentation component from depending on
the whole execution-state shape. Using `aggregateState` alone was rejected
because market transport health and authenticated account synchronization are
different concerns. Replacing every state with `SYNC` was rejected because it
would hide more important market failures.

### 3. Use an allowlist for execution-ticket feedback

The ticket will remove its readiness/pause header, passive shortcut/action
label, percentage anchors, derived quantity summary, shortcut legend, positive
submission/cancellation feedback, and passive last-execution acknowledgement.
The slider remains the single percentage control and keeps its percentage and
whole-USDT readout. The confirmation remains the source of the exact
exchange-quantized quantity before send.

Feedback rendering will be organized around actionable conditions that remain
allowed: a contextual disabled-action reason, locally unsent command, exchange
rejection, unresolved command outcome, and account synchronization failure with
its valid retry action. Existing readiness and backend pause gates continue to
control the actions even though their routine header is absent. This explicit
allowlist is safer than hiding a shared status container with CSS, which could
also conceal a future rejection or retry path.

The backend pause command and enforcement are left intact. The renderer simply
stops offering a routine pause/resume control in this ticket; this avoids
expanding a density change into a command-protocol change.

### 4. Remove visual headings while adding row-level accessible names

The order-book and aggregate-tape heading rows will be removed from the visual
DOM. Each interactive book level will receive an accessible name containing
side, price, level notional in USDT, and cumulative notional in USDT. Each tape
row will receive an accessible name containing price, trade notional in USDT,
and time. Numeric column layout remains defined by the existing row grid so
visual alignment does not depend on a heading row.

The last-print separator will render only the price. Its visual color continues
to follow price change, while its accessible name states last traded price and
up/down/neutral direction. Divider borders are removed, vertical margin is
reduced to two pixels, and vertical padding is reduced by two pixels from its
current value. Direction state is still reset on contract change and preserved
across equal prints.

Keeping hidden duplicate heading rows was rejected because they would still
complicate layout and testing. Row-level labels make every numeric row
self-contained for assistive technology.

### 5. Keep tape data outside a native disclosure

The aggregate-tape settings will use a semantic `details`/`summary` disclosure,
closed by default. Pause, throttle, timeout, minimum-trade, apply, and effective
settings live in the disclosed body; interactive controls will not be nested in
the summary. The trade list remains a sibling outside `details`, so toggling the
disclosure neither remounts the list nor resets its scroll position, incoming
updates, pause value, applied values, or drafts.

A native disclosure is preferred over bespoke open-state and ARIA wiring. The
entire tape panel cannot be collapsed because the requirement is to recover
control height while keeping market prints visible.

### 6. Verify behavior at component boundaries and the supported rail width

Component tests will assert the two recency modes, `LIVE`/`SYNC` precedence,
selective ticket feedback, exact quantity in confirmation, accessible book/tape
rows, compact last print, and default-closed settings whose toggle does not
reset tape content. Production integration tests will confirm the container's
account-sync derivation reaches the identity badge. The repository lint, build,
Futures boundary checks, and command-path checks will guard the renderer/main
boundary and trading flow.

## Risks / Trade-offs

- [A broad status cleanup hides an actionable failure] → Remove passive states
  by explicit semantic branch and test every retained failure/retry case.
- [`SYNC` masks a market outage] → Allow the account-sync override only when
  the underlying market state is `LIVE`; non-routine state always wins.
- [Long recent symbols reduce the number of pills per line] → Use intrinsic
  pill width, wrapping, and content-first bounded overflow; test ordinary and
  long symbols at the supported narrow Electron width and at heights both above
  and below the point where internal scrolling is required.
- [Favorite and select actions interfere inside a compact pill] → Keep them
  as separate controls, stop favorite activation from selecting, and test both
  pointer and accessible names/states.
- [A session was already paused before this renderer update] → Perform a
  full application/backend restart during rollout, or explicitly verify the
  non-persistent pause state is clear before relying on the removed control.
- [Concurrent work touches the same workstation files] → Re-read current
  files immediately before editing, stay on `master`, preserve unrelated
  changes, and use GitNexus change detection plus `git diff` to review scope.

## Migration Plan

1. Re-run GitNexus impact analysis immediately before editing each affected
   component symbol; stop and warn the operator if risk becomes HIGH or
   CRITICAL.
2. Implement the renderer and CSS changes in small component-aligned steps,
   updating tests and `tasks.md` with each completed step.
3. Run targeted component tests, repository lint/build, Futures production
   boundary checks, command-path checks, OpenSpec validation, and GitNexus
   change detection before commit.
4. Roll out with a full application/backend restart so a non-persistent paused
   session cannot be stranded without its former ticket control.
5. Have the operator verify the narrow Electron layout and live account refresh,
   including `LIVE` ↔ `SYNC`, retained safety failures, recency/search, and tape
   disclosure behavior. Archive only after that confirmation.

There is no stored-data migration. Rollback is the renderer commit reversal;
the persisted recency and all command/account data remain compatible.
