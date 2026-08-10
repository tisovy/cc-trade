## 1. Live Read-Only Account Verification

- [ ] 1.1 Obtain explicit operator approval to run against the live Production account, and confirm the launch environment carries a complete `BFK`/`BFS` pair and the proxy variables whose egress address matches the key's IP restriction.
- [ ] 1.2 Start the application, select the Futures workspace, and record which of balances, positions, regular orders, ALGO orders, and the user-data stream reach `ready`.
- [ ] 1.3 For any resource that does not reach `ready`, record the sanitized category and code shown in the ticket, and determine whether the cause is credentials, key permissions, IP restriction, or the endpoint itself.
- [ ] 1.4 Confirm account-wide order visibility: orders on a symbol other than the selected one remain listed after switching symbols.
- [ ] 1.5 Confirm no order was placed, amended, cancelled, or closed during the verification.
- [ ] 1.6 Record the outcome in `docs/futures_trading.md` if it changes any documented operator expectation.
