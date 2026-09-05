## Decisions

1. Use Electron 43.6.0 within the supported 43 major, not EOL 39.8.10. Electron 44 additionally removes macOS 12 and 32-bit targets; avoid imposing that unrelated platform decision. Review published 40–43 breaking changes against main/preload/protocol usage.
2. Keep Vite 7 and Vitest 4; update the existing compatible ranges and transitive packages. Do not use audit fix --force or override incompatible majors just to reduce a report. Keep the Spot SDK in major 24 and prove the F02 facade contract against the resulting installed common/Axios versions.
3. Install with automatic audit and lifecycle scripts disabled. Download the selected Electron binary explicitly for packaging, not by launching the trading application. Native optional packages may use their supported fallback; any required rebuild is explicit and scoped.
4. Add a purely local check of reviewed version floors in package-lock.json, with a direct-dependency inventory and no network access. This guards regressions; it is not a vulnerability scanner or proof of zero advisories.
5. A permission check refused the repeated npm audit because it discloses the dependency tree. Do not circumvent it. Use the saved audit findings, primary public advisories and local dependency inspection; leave a fresh full-registry rescan explicitly outstanding until separately authorized.
6. Electron 43's npm package requires Node >=22.12; the current Vitest/jsdom support excludes Node 23. State the compatible development range honestly as ^22.12.0 or >=24.0.0, dropping the now-incompatible Node 20 promise. The packaged operator runtime includes its own Node; this does not require installing Node on an operator machine.
7. Retain eslint-plugin-react-hooks 7.0.1 exactly. Its new minor enables additional compiler/effect rules and produces 13 existing-code errors; adopting that policy requires separate React work. No existing lint rule is disabled or suppressed, and this plugin was not a reported F05 vulnerable package. Record the pin for deliberate future review.

## Risk and verification

Dependency changes affect the entire runtime despite graph zeroes on package.json and dynamic SDK factories. GitNexus createWindow found main (0.95) and a runtime registry reference (0.5), one process, LOW; package.json, assertPackagedApp and SDK/private factories returned empty LOW, treated as unresolved. Their actual imports/call sites and package scripts were inspected. Review main security, protocol and preload tests, real SDK/private wire tests, full test:all and an actual Linux directory package with its ASAR guard. Do not weaken renderer isolation or CSP to accommodate the update.

The package check is local build evidence, not a launched-window or account acceptance. Keep operator live confirmation pending and record any remaining vulnerable transitive chain with reachability and upgrade constraints.
