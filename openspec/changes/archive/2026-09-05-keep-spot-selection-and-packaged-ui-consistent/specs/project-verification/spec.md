## ADDED Requirements

### Requirement: A distribution contains the runtime and not the checkout

The normal packaged application SHALL contain its production main and preload,
renderer entry and referenced renderer assets, and required production
dependencies. Installer output SHALL be separate from renderer build output.
The package SHALL exclude secret environment files, tests, source checkout,
OpenSpec documents, archived implementations, and generated development data.
A verification gate SHALL inspect the actual packaged application archive and
fail packaging if this contract is violated, without launching the application
or contacting an exchange.

#### Scenario: Package the normal production build
- **WHEN** the operator runs the normal distribution command
- **THEN** the packaged main can find its renderer entry and assets at the same relative paths used by the production loader

#### Scenario: The checkout contains private or development files
- **WHEN** packaging runs with environment files, documentation, archives, or source tests in the checkout
- **THEN** those files do not enter the packaged application

#### Scenario: A packaged renderer entry or asset is missing
- **WHEN** the archive lacks the renderer entry or one of its local build assets
- **THEN** the packaging verification fails rather than reporting a usable distribution

#### Scenario: Verify without a trading session
- **WHEN** the archive verification runs
- **THEN** it reads the package contents only and neither launches Electron nor sends exchange requests
