# Retired Futures Testnet path manifest

Source revision: `f1b5d7eba661afe92406749965bb539c9ba4d3f4`

## Electron main and services

- `electron/main-futures-testnet-execution.test.js`
- `electron/services/futures-trading-adapter.js`
- `electron/services/futures-trading-adapter.test.js`
- `electron/services/futures-readonly-fixtures.js`
- `electron/services/futures-readonly-service.js`
- `electron/services/futures-readonly-service.test.js`
- `electron/services/futures-readonly-transport.js`
- `electron/services/futures-readonly-transport.test.js`
- `electron/services/futures-testnet-execution-composition.js`
- `electron/services/futures-testnet-execution-composition.test.js`
- `electron/services/futures-testnet-execution-config.js`
- `electron/services/futures-testnet-execution-config.test.js`
- `electron/services/futures-testnet-execution-coordinator.js`
- `electron/services/futures-testnet-execution-coordinator.test.js`
- `electron/services/futures-testnet-execution-decimal.js`
- `electron/services/futures-testnet-execution-decimal.test.js`
- `electron/services/futures-testnet-execution-facade.js`
- `electron/services/futures-testnet-execution-facade.test.js`
- `electron/services/futures-testnet-execution-json.js`
- `electron/services/futures-testnet-execution-key-protection.js`
- `electron/services/futures-testnet-execution-key-protection.test.js`
- `electron/services/futures-testnet-execution-ledger.js`
- `electron/services/futures-testnet-execution-ledger.test.js`
- `electron/services/futures-testnet-execution-production-exclusion.test.js`
- `electron/services/futures-testnet-execution-protocol.js`
- `electron/services/futures-testnet-execution-protocol.test.js`
- `electron/services/futures-testnet-execution-read-request.js`
- `electron/services/futures-testnet-execution-read-request.test.js`
- `electron/services/futures-testnet-execution-risk-reader.js`
- `electron/services/futures-testnet-execution-risk-reader.test.js`
- `electron/services/futures-testnet-execution-risk.js`
- `electron/services/futures-testnet-execution-risk.test.js`
- `electron/services/futures-testnet-execution-sanitizer.js`
- `electron/services/futures-testnet-execution-sanitizer.test.js`
- `electron/services/futures-testnet-execution-service.js`
- `electron/services/futures-testnet-execution-service.test.js`
- `electron/services/futures-testnet-execution-session-protocol.js`
- `electron/services/futures-testnet-execution-session-protocol.test.js`
- `electron/services/futures-testnet-workstation-composition.js`
- `electron/services/futures-testnet-workstation-fake-transport.js`
- `electron/services/futures-testnet-workstation-fixtures.js`
- `electron/services/futures-testnet-workstation-service.js`
- `electron/services/futures-testnet-workstation-transport.js`
- `electron/services/futures-testnet-workstation-verification-composition.js`

## Renderer

- `src/components/features/futures/FuturesReadOnlyPanel.css`
- `src/components/features/futures/FuturesReadOnlyPanel.jsx`
- `src/components/features/futures/FuturesReadOnlyPanel.test.jsx`
- `src/components/features/futures/FuturesTestnetExecutionTicket.css`
- `src/components/features/futures/FuturesTestnetExecutionTicket.jsx`
- `src/components/features/futures/FuturesTestnetExecutionTicket.test.jsx`
- `src/components/features/futures/FuturesTestnetWorkstation.jsx`
- `src/hooks/useFuturesReadOnly.js`
- `src/hooks/useFuturesReadOnly.test.js`
- `src/hooks/useFuturesTestnetExecution.js`
- `src/hooks/useFuturesTestnetExecution.test.js`
- `src/hooks/useFuturesTestnetWorkstation.js`
- `src/hooks/useFuturesTestnetWorkstationConnection.js`
- `src/utils/futuresReadOnlyProtocol.js`
- `src/utils/futuresReadOnlyProtocol.test.js`
- `src/utils/futuresTestnetExecutionProtocol.js`
- `src/utils/futuresTestnetExecutionProtocol.test.js`
- `src/utils/futuresTestnetWorkstationProtocol.js`

## E2E and documentation

- `tests/futures_read_only.spec.js`
- `docs/futures_phase6_testnet_execution_design.md`

Mixed production/shared files are not archived wholesale. Their Testnet imports, cases, aliases, styling, and assertions are removed in the retirement change while their Spot/production coverage remains active.
