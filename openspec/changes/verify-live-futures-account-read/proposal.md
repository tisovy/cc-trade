## Why

Carried over from `restore-futures-trading-and-tune-tape` task 9.5, which was never performed and would otherwise be lost when that change is archived.

Every guarantee about account synchronization — independent per-resource states, account-wide regular and ALGO orders, stale-on-reconnect, sanitized errors — has so far been verified only against fixtures. No run has confirmed that a real authenticated account reaches `ready` on all four resources.

The verification is now more relevant than when it was first written, because two inputs changed since: Futures authenticates with a separate `BFK`/`BFS` pair, and the operator's key is IP-restricted to the proxy egress address. A misconfiguration in either shows up as the same `-2015` on every resource, which is precisely the failure this check would catch before it is mistaken for a code defect.

## What Changes

- Perform one authenticated **read-only** verification against the live Production account: balances, positions, regular open orders, ALGO open orders, and the user-data stream.
- Record which resources reach `ready`, and for any that do not, the sanitized category reported to the ticket.
- No order SHALL be placed, amended, cancelled, or closed as part of this verification.

## Capabilities

No capability specification changes. This change verifies existing requirements against a live account; it adds, modifies, and removes nothing.

## Impact

- Requires explicit operator approval before it runs, and an environment holding a complete `BFK`/`BFS` pair whose IP restriction matches the proxy egress address.
- Read-only. The only writes possible in the exercised paths are listen-key creation and renewal, which the user-data stream performs regardless.
- If `algoOrders` alone fails while the other three succeed, the cause is the ALGO endpoint or its key permission rather than credentials, and that distinction is the main diagnostic value of the run.
