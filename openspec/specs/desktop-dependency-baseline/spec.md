# desktop-dependency-baseline Specification

## Purpose

Keep the desktop runtime and tools on a reviewed dependency baseline while stating the scope and permissions of security verification.

## Requirements

### Requirement: The desktop ships a reviewed supported dependency baseline

The repository SHALL lock a supported Electron release and reviewed fixed versions of its network and development dependencies. Electron SHALL be included in runtime risk assessment even though it is installed as a development dependency. An update SHALL preserve renderer isolation, private-stream ownership and uncertain-command outcome semantics.

#### Scenario: Dependency update is verified

- **WHEN** the dependency baseline changes
- **THEN** installed-SDK, private-wire and renderer-security contracts, full regression/build checks and an actual packaged-archive check are run before integration

#### Scenario: A reviewed vulnerable version returns

- **WHEN** a lockfile change restores a version below a recorded dependency security floor
- **THEN** a local verification guard fails without transmitting the project dependency tree

### Requirement: Dependency evidence states its coverage and permissions

Security evidence SHALL distinguish local version-floor checks from a fresh vulnerability scan and packaged-file inspection from runtime acceptance. It SHALL NOT claim an unperformed audit or silently bypass a denied metadata disclosure.

#### Scenario: Registry audit is not authorized

- **WHEN** sending project dependency metadata to the registry has not been authorized
- **THEN** the update uses public advisory/version information and local checks, records the rescan as outstanding, and does not claim zero vulnerabilities

#### Scenario: A transitive chain cannot be upgraded compatibly

- **WHEN** a fixed transitive version is unavailable within the supported parent's contract
- **THEN** evidence identifies the chain and remaining risk instead of installing an unreviewed incompatible override
