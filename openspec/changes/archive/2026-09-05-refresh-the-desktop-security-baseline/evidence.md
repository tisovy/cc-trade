# F05 dependency implementation evidence — 2026-09-04

This is the original implementation checkpoint. Its pending-audit/acceptance
wording is superseded by the later [registry audit](registry-audit-evidence.md)
and [operator acceptance](tasks.md). Historical results below are preserved;
they are not relabeled as the fresh scan or as independently observed live tests.

## Selected baseline

| Component | Before | Locked after |
| --- | --- | --- |
| Electron | 39.2.2 | 43.6.0 |
| electron-builder | 26.0.12 | 26.15.3 |
| ws | 8.18.3 | 8.21.3 |
| Axios | 1.13.2 | 1.20.0 |
| Vite | 7.2.2 | 7.3.6 |
| Vitest / mocker | 4.0.13 | 4.1.11 |
| tar | 6.2.1 | 7.5.22 |
| form-data | 4.0.5 | 4.0.6 |
| ip-address | 10.1.0 | 10.7.0 |
| picomatch | 2.3.1 / 4.0.3 | 4.0.7 |
| follow-redirects | 1.15.11 | 1.16.0 |
| diff | 8.0.2 | 8.0.4 |

All updates were within existing major ranges except the explicitly reviewed Electron 39→43 change. Manifest security floors are raised for Electron, builder, ws, Vite and Vitest. React/DOM resolve together to 19.2.8. Spot stays major 24 (24.0.1); its pinned common 2.0.1 remains nested while the direct common resolves to 2.4.8. Both share patched Axios/ws. The older common also brings build tooling (tsdown) into its runtime dependency tree; no incompatible override or SDK-major migration was imposed to hide that fact.

Electron 43 is supported under the latest-three-majors policy, whereas 39 is EOL. Version 44 removes macOS 12 and 32-bit targets; 43 avoids adding that platform removal to this fix. Reviewed 40–43 breaking changes against main: no clipboard module, PDF guest tracking, cookie-change cause dispatch, offscreen rendering, affected dialog options or frameless WCO. Main/preload/protocol/CSP/isolation source is unchanged. Electron's binary is now downloaded explicitly, not via npm postinstall. Development Node requirement is ^22.12.0 or >=24.0.0; packaged Node is bundled.

React Hooks lint-plugin 7.1.1 introduces extra effect/compiler checks and reported 13 existing-code errors. Kept 7.0.1 exactly, preserving the prior lint policy without disabling rules or adding suppressions. It was not a reported F05 vulnerable dependency; adopting new lint policy is separate work. ESLint 9 itself is now deprecated upstream; major-10 configuration migration remains deliberate follow-up, not claimed done here.

## Verification

- Final `npm run test:all`: **139 files / 3,262 tests passed**; lint, build and every architecture check passed.
- The local dependency guard has **24 tests**, checks every nested copy of seven reviewed components, rejects malformed/prerelease/unreviewed-major versions and fails if a reviewed package disappears. It runs at the start of test:all; the launch-contract test includes this non-browser gate.
- Installed-SDK F02 and private WebSocket F01 regressions remain green after actual dependency replacement; no network-error mapping assumptions were mocked away.
- Build: 333 main modules (1,498.07 kB), five preload modules (1.50 kB); renderer assets built successfully. Runtime graph 157 modules, circular graph 308 source files, Futures boundary 24 implementations, command gate 126 renderer modules.
- Actual `electron-builder --linux --dir --publish never` used the checksum-verified Electron 43.6.0 binary, rebuilt bufferutil/utf-8-validate and produced `release/security-baseline/linux-unpacked`. afterPack accepted **2,062 files / 10 renderer build files**. A separate check of the resulting app.asar also passed. No window, application main or trading session was launched; Windows/macOS packages were not built.
- Install commands used `--no-audit --ignore-scripts`; only the reviewed Electron installer and ordinary local package/native build were subsequently run explicitly. No publish, real credentials or real orders.
- Existing Babel large-file and an ESLint flat-config migration warning remain non-fatal. An initially stale test:all script assertion was updated after production change. Final checks, not these earlier failed experiments, establish the result.

## Coverage limitations and graph review

A repeated npm audit was refused by the permissions layer because it sends the project dependency tree externally. No workaround was used. Separate authorization was requested. **No fresh vulnerability total or zero-vulnerability claim is made.** The saved audit establishes the old 40 package records; public upstream advisories/version metadata and local npm ls establish the reviewed version changes. A local version floor does not find newly published advisories.

GitNexus repository `trade_ui_latest`, primary checkout, main baseline `4dd6aaf`; refreshed index 12,601 nodes / 20,073 edges / 300 flows. Pre-edit createWindow impact found main at 0.95 confidence plus a runtime-registry reference at 0.5, LOW, one process. Empty LOW results for manifest, SDK factories and package/baseline helpers were treated as unresolved and supplemented with source imports, scripts and full package verification. Dependency transitive risk is not modeled by the code graph; a zero here is not a safety conclusion. Staged all/compare-main graph analysis is recorded before commit; the large main test-file index cap persists but the file executes in full.

Staged MCP all and compare/main both report 13 changed files / 69 changed nodes / zero processes, LOW, no partial/truncated flag. Exact-path counts supplement the old per-file 20-node cap; source review covers lockfile/manifest/doc changes and the new pure guard. Zero process results cannot represent the real runtime dependency blast radius. Renderer build transformed 560 modules.

Operator packaged-window/live acceptance and authorized registry rescan stay open. No archive until the operator confirms. This does not close F06–F10 or constitute a release-safety attestation.

## Primary sources

- [Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines), [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes).
- [Electron isolation advisory](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x), [custom-protocol advisory](https://github.com/electron/electron/security/advisories/GHSA-v3j7-r9gq-3gjw).
- [ws fragmentation advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p), [Vitest UI advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).
- [Vite deny-list advisory](https://github.com/vitejs/vite/security/advisories/GHSA-v2wj-q39q-566r), [tar decompression advisory](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw).
