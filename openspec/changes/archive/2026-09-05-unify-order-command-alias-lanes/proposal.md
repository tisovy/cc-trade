## Why

Audit F10 shows one order entering concurrent modify/cancel lanes when one command uses its exchange ID and another its original client ID. The existing per-order concurrency guarantee assumes every caller spells identity the same way, which the validated contract does not require.

## What Changes

- Type order/client lane keys and learn scoped alias pairs only from main-owned exchange reports/snapshots, not untrusted command assertions.
- Wait on all currently known aliases, including a placement's client lane after an ACK/private observation supplies its exchange ID.
- Unknown or contradictory target identity takes the existing contract-wide barrier. Known unrelated orders remain concurrent; scopes remain account/market/symbol-specific.
- Bound alias retention and keep active-lane dependencies safe during expiry/eviction. Preserve deduplication, recorded outcomes and no automatic retries.

## Capabilities

### New Capabilities

- `order-command-alias-serialization`: conservative alias-aware in-memory mutation ordering.

## Impact

Trading command registry and its main-process observation hooks/tests. No exchange reads added, no new mutations, no queue persisted across restart, no exactly-once claim. Learning private identity must not record private traffic as a command's replayable outcome.
