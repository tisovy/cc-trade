## Purpose

Keep ordinary application launches focused on the trading interface while retaining explicit developer diagnostics.

## ADDED Requirements

### Requirement: Automatic DevTools opening is opt-in

The application SHALL leave DevTools closed by default for both packaged and development-server launches. Only an explicit recognized true ELECTRON_OPEN_DEVTOOLS flag SHALL automatically open them. Manual inspection SHALL remain available.

#### Scenario: Launch with a development server but no opt-in

- **WHEN** VITE_DEV_SERVER_URL is set and ELECTRON_OPEN_DEVTOOLS is absent
- **THEN** creating the application window does not automatically open DevTools

#### Scenario: Explicit diagnostic opt-in

- **WHEN** ELECTRON_OPEN_DEVTOOLS is a recognized true value
- **THEN** automatic DevTools opening remains available

#### Scenario: Explicit false or unrecognized value

- **WHEN** ELECTRON_OPEN_DEVTOOLS is false, empty or unrecognized
- **THEN** DevTools remain closed unless the operator opens them manually
