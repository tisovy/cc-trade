## Purpose

Defines the supported automated verification and Electron build surface after browser-driven end-to-end automation is retired from the repository.

## ADDED Requirements

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

The project SHALL retain Vitest, lint, the normal build, and static architecture and safety checks as supported automated verification commands. The aggregate verification command, if retained, SHALL invoke only supported non-browser checks and SHALL NOT download or launch a browser.

#### Scenario: Run the aggregate verification command

- **WHEN** a developer invokes the repository's aggregate verification command
- **THEN** it completes using the retained unit, static, lint, and build gates without invoking browser automation

#### Scenario: Run an individual retained gate

- **WHEN** a developer invokes Vitest, lint, the normal build, or a retained static boundary check directly
- **THEN** that command remains independently usable after the removal

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
