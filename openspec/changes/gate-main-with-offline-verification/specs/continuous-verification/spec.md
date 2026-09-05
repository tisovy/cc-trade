## Purpose

Provide visible, repeatable verification of main-branch revisions without
requiring a live trading account or publishing an application distribution.

## ADDED Requirements

### Requirement: Main revisions receive a complete automated verification result

When hosted CI is enabled, each pushed main revision SHALL trigger the retained
test, lint, production-build, dependency-baseline and architecture checks,
followed by Linux x64 directory packaging with actual archive inspection.
A failed command MUST fail the job; a cancelled or skipped job MUST NOT count
as successful verification. Manual verification SHALL be limited to main.

#### Scenario: A main revision passes all gates
- **WHEN** a main revision completes every automated check and package inspection
- **THEN** CI reports successful verification for that revision
- **AND** the package inspection includes the full renderer build inventory

#### Scenario: A gate fails
- **WHEN** a test, lint, build, dependency, architecture or package gate fails
- **THEN** the job reports failure without suppressing that gate's exit status

#### Scenario: A revision is superseded
- **WHEN** a newer main revision cancels an unfinished verification run
- **THEN** the cancelled revision is not represented as verified
- **AND** the newer revision receives its own verification run

#### Scenario: A manual run targets another branch
- **WHEN** a manual verification request targets a ref other than main
- **THEN** the verification job does not execute that revision

### Requirement: Verification does not require operator account authority

CI SHALL run on an isolated hosted runner with read-only repository permission,
without operator account secrets, persisted checkout credentials, application
launch, signing or package publication. External actions MUST use immutable
revisions. Dependency installation SHALL use the committed lockfile. Dependency
downloads are permitted; automatic registry vulnerability reporting is excluded
from this workflow.

#### Scenario: A fresh hosted runner verifies the project
- **WHEN** a runner has no trading credentials or local application data
- **THEN** it can install locked dependencies and run the full verification job
- **AND** no command starts an interactive application or trading session

#### Scenario: CI builds an application package
- **WHEN** the verification job packages the normal production build
- **THEN** it inspects the local archive without executing it
- **AND** it does not sign, publish or upload the package

### Requirement: Local preparation is distinguished from hosted acceptance

Documentation SHALL distinguish checked-in configuration and local checks from
actual hosted execution, branch enforcement and operator acceptance. The change
MUST remain unarchived until the hosted result and operator acceptance are
recorded. Existing main-only development policy MUST remain unchanged.

#### Scenario: The workflow has only been committed locally
- **WHEN** local checks pass but the workflow has not run on the hosting service
- **THEN** status records remote verification and enforcement as unconfirmed
- **AND** it does not claim CI is protecting the remote branch

#### Scenario: Hosted acceptance is recorded
- **WHEN** the operator confirms an actual hosted run for a specific revision
- **THEN** the record includes the revision and run result
- **AND** the enforcement decision is recorded separately from successful CI
