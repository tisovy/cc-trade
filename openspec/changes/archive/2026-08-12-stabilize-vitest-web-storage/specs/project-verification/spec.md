## MODIFIED Requirements

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
