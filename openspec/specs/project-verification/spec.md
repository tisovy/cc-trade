# project-verification

## Purpose

Defines the supported automated verification and Electron build surface after browser-driven end-to-end automation is retired from the repository.

## Requirements

### Requirement: Playwright is absent from the executable project surface

The repository SHALL contain no reachable Playwright dependency or lockfile package node, runner configuration, executable suite, helper, generated-report convention, or ad-hoc project-local probe in its supported install, build, test, or runtime surface. Optional peer metadata owned by a retained tool SHALL NOT count as a reachable package node when the named adapter and its runner dependencies are absent from the install graph.

#### Scenario: Install from the committed dependency contract

- **WHEN** a developer installs dependencies from the committed package manifest and lockfile
- **THEN** no `playwright`, `playwright-core`, or `@playwright/test` package is installed

#### Scenario: Inspect the supported repository surface

- **WHEN** a developer inventories tracked configuration, scripts, executable test sources, and project-local verification probes
- **THEN** no Playwright runner, import, launch path, suite, helper, report directory, or report-specific ignore rule remains

### Requirement: The Electron build has no browser-automation-only composition

The Electron and Vite configuration SHALL NOT expose a build mode, main-process entry, environment route, mock WebSocket adapter, or test-only message fixture whose sole consumer is the removed browser automation path.

#### Scenario: Build the normal application

- **WHEN** the normal production build runs
- **THEN** it selects the normal Electron main process and production workstation compositions without evaluating any retired browser-automation branch

#### Scenario: Use a retained deterministic verification composition

- **WHEN** Vitest, safe-development, or bounded smoke verification selects deterministic workstation compositions
- **THEN** the shared deterministic compositions and their network guards remain available without a browser-automation build mode

### Requirement: Supported automated verification remains callable

The project SHALL retain Vitest, lint, the normal build, and static architecture and safety checks as supported automated verification commands. The aggregate verification command, if retained, SHALL invoke only supported non-browser checks and SHALL NOT download or launch a browser. The package manifest and current setup guidance SHALL declare the same Node.js support range. On a declared supported Node.js version, the standard Vitest command SHALL provide deterministic Storage-method-compatible `localStorage` and `sessionStorage` and SHALL NOT require external process flags or machine-global storage configuration.

#### Scenario: Run the aggregate verification command

- **WHEN** a developer invokes the repository's aggregate verification command
- **THEN** it completes using the retained unit, static, lint, and build gates without invoking browser automation

#### Scenario: Run an individual retained gate

- **WHEN** a developer invokes Vitest, lint, the normal build, or a retained static boundary check directly
- **THEN** that command remains independently usable after the removal

#### Scenario: Run Vitest when Node exposes ambient Web Storage

- **WHEN** a developer invokes the standard Vitest command on a declared supported Node.js version that exposes an experimental or unavailable ambient Web Storage global
- **THEN** tests receive deterministic Storage-method-compatible `localStorage` and `sessionStorage` without `NODE_OPTIONS`, a storage-file flag, or another external workaround

#### Scenario: Storage state is isolated between tests

- **WHEN** one test writes browser storage and a later test begins
- **THEN** the later test cannot observe the earlier test's storage state unless that state is explicitly provided by the test

#### Scenario: Read the Node.js prerequisite

- **WHEN** a developer compares `package.json` with the current README prerequisite
- **THEN** both declare the same Node.js range accepted by the installed Vite toolchain

### Requirement: Removal does not introduce a replacement browser runner

The project SHALL NOT replace Playwright with another browser-driving or Electron-driving automation framework as part of this change.

#### Scenario: Review the post-removal dependency and command surface

- **WHEN** the implementation is reviewed after dependency and script cleanup
- **THEN** no new browser automation dependency, download step, launch command, or equivalent runner configuration has been added

### Requirement: Current operational guidance matches the supported verification surface

Current README, testing guidance, automation, and developer commands SHALL NOT advertise the removed runner, suites, build mode, or reports as supported workflows. Historical audit records MAY retain factual descriptions of past evidence only when they are not presented as current commands or acceptance gates.

#### Scenario: Follow current verification documentation

- **WHEN** a developer follows the current README or testing guide
- **THEN** every documented verification command exists and uses only the retained verification stack

#### Scenario: Read a historical audit record

- **WHEN** a historical record mentions evidence produced before this removal
- **THEN** the mention is clearly historical and cannot be mistaken for an available project command or required current gate

### Requirement: A completion mark states only what was performed
A task marked complete SHALL correspond to work that was actually performed. An
operator confirmation SHALL be marked only after the operator confirmed the
behaviour on live data. Work that shipped without its live confirmation SHALL be
recorded as outstanding in a single ledger that names the change, the unverified
behaviour, the reason verification did not happen, the date it was recorded,
and its subsequent status.

#### Scenario: A change ships before it can be confirmed live
- **WHEN** code is archived but the operator has not confirmed it on live data
- **THEN** the confirmation item stays unchecked and the outstanding verification is recorded in the ledger with its date and status

#### Scenario: A false historical completion mark is found
- **WHEN** an archived task is checked while its own record says the live verification was left to the operator
- **THEN** only that task is made unchecked with a dated ledger reference, and the archived change is neither reopened nor moved

#### Scenario: The operator confirms later
- **WHEN** the operator confirms the behaviour on live data
- **THEN** the ledger entry is closed with the date of the confirmation

### Requirement: The verification commands declare the runtime they require
The repository SHALL declare the Node version range its verification commands
support and SHALL select one exact, measured version for the ordinary repository
workflow. The exact version SHALL be chosen only after the supported versions
installed on the verification host have completed the repository checks. The
deterministic storage contract the suite relies on is owned by
`stabilize-vitest-web-storage`.

#### Scenario: An undeclared runtime
- **WHEN** a contributor runs the suite on a version outside the declared range
- **THEN** the tooling states the requirement rather than failing obscurely

#### Scenario: A contributor selects the repository runtime
- **WHEN** a contributor uses `.nvmrc`
- **THEN** it selects an exact Node version inside `package.json.engines` that completed the recorded verification run

### Requirement: The production guards run with the ordinary verification
The guard checks that protect the production boundary — the runtime-mock layer,
the futures workstation boundary and the trading command path — SHALL run as
part of the repository's ordinary verification command. The runtime-mock guard
SHALL cover every source that can bridge the mock layer into the renderer,
including the preload bridge.

#### Scenario: Verification is run before committing
- **WHEN** the verification command runs
- **THEN** lint, the suite and all three guards run, and any failure fails the command

#### Scenario: The preload bridge imports the mock layer
- **WHEN** `electron/preload.cjs` references the runtime mock layer
- **THEN** the runtime-mock guard fails

### Requirement: A capability specification states its purpose
Every capability specification SHALL describe the behaviour boundary it owns
instead of retaining an archive-generated `TBD` placeholder.

#### Scenario: A contributor opens a capability specification
- **WHEN** the contributor reads its Purpose section
- **THEN** the section identifies the capability and the user-visible outcome its requirements govern


### Requirement: A timing assertion holds under the condition it is run in
A test that enforces a measured latency bound SHALL either take its calibration
under the condition the suite runs it in, or refuse to enforce the bound on a run
that could not sustain the conditions the measurement assumed.

A run that failed to hold its own input cadence is not evidence about the desk in
either direction, and SHALL be reported as an inconclusive run rather than as a
failure. A timing test that fails when the machine is busy is re-run until it
passes, and that habit is what makes a real regression invisible.

#### Scenario: The suite runs on a loaded machine
- **WHEN** a burst case cannot deliver its frames at the cadence its bound was measured against
- **THEN** it says the run was inconclusive rather than failing on a bound that was never measured under that load

#### Scenario: The desk genuinely slows down
- **WHEN** the cadence was held and the execution still lands outside the bound
- **THEN** the case fails, because that is the regression it exists to catch

#### Scenario: A wait that is not the measurement
- **WHEN** a case waits for the desk to become ready before the part it measures begins
- **THEN** the wait allows for a busy machine, so that a desk which is genuinely slow fails on the measured number and not on a readiness wait that gave up first
