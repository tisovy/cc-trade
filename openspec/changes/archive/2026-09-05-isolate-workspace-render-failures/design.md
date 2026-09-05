## Context and decisions

Keep NotificationProvider/GatewayProvider and market selection above the outer boundary. A caught outer failure does not imply a disconnected backend or an empty account; show local socket and market-activation facts separately from unverified account/order visibility. Outer recovery explicitly reloads the interface, requiring the existing startup/activation gates; no automatic recovery loop.

Keep Spot DataProvider/alert/drawing owners and the Futures useFuturesTrading owner above their content boundaries. A manual content retry remounts only presentation, preserving unresolved command/account ownership and existing connection. Chart and analytics have smaller boundaries so their failure does not remove Spot order controls or command warnings.

Fallbacks do not render the exception message, stack or payload, and do not issue trading commands. They warn that exchange orders may still be active and must be checked before repeating a command. Generic panel retry is manual and affects only that subtree. Healthy rendering adds no wrapper DOM around children.

## Scope and limitations

Error boundaries handle React descendant rendering/lifecycle failures, not arbitrary event-handler errors, async promise rejection, a failure in Gateway itself, or main-process faults. A persistent bug can fail again after a manual retry. Reloading an outer failed workspace may lose in-memory warnings, so its fallback does not promise outcome certainty and explicitly warns against resubmission. This change does not erase local storage to recover.

## Impact and verification

Named graph impacts for React owners are empty; exact-file graph imports and JSX/source inspection establish main → App → workspace dependencies. These zeros are not safety proof. Production precedes tests. Inject render errors, verify shell/status and sibling controls survive, preserve account/trading owner across content retry, and assert no command side effects. Run existing lazy-workspace, Spot order, Futures lifecycle/burst suites and all local gates. Record graph limits and keep live acceptance pending.
