## Why

Audit F05 identified vulnerable desktop, network and development dependencies. Electron 39 is now unsupported; treating it as dev-only would omit the platform actually shipped to operators.

## What Changes

- Move to the supported Electron 43 branch and current compatible patches/minors of the network, build and test dependencies.
- Raise declared security floors for Electron, ws, Vite, Vitest and electron-builder; regenerate the lockfile without forcing incompatible transitive overrides.
- Verify the actual installed SDK contracts, security boundaries and packaged archive; retain explicit dependency-security evidence and unresolved limitations.
- Add a local lockfile baseline check to prevent accidental reintroduction of the reviewed vulnerable versions without uploading project metadata.

## Capabilities

### New Capabilities

- `desktop-dependency-baseline`: a reproducible reviewed desktop/network/toolchain security baseline.

### Modified Capabilities

None. Trading behavior and renderer isolation contracts stay unchanged.

## Impact

Package manifest/lock, a local dependency guard, test/build/packaging checks and evidence. No production launch, credentials, real trade, deployment or forced platform removal. Repeating npm audit needs separate permission to disclose the dependency tree; public package metadata and advisories remain readable.
