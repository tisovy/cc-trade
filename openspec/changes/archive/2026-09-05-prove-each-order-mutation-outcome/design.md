## Evidence rules

1. Place: an identified query report with a recognized accepted/working/terminal-after-acceptance status proves existence. A rejection status is not accepted placement; unknown status does not establish success. Preserve existing placement resolution codes. Repeated explicit absence can settle a placement, but mixed failed reads and absence cannot.
2. Cancel: only CANCELED/CANCELLED confirms cancellation. NEW, PARTIALLY_FILLED and pending statuses do not. FILLED, EXPIRED, EXPIRED_IN_MATCH or REJECTED mean the order is terminal without proof of cancellation; emit an explicit terminal reason and never offer/replay a replacement. A query absence alone remains uncertain rather than claiming cancelled.
3. Modify: compare requested price and original quantity as decimal strings, not binary floats. Both must match for a recognized working/filled report to confirm the requested state. Old/missing parameters remain uncertain. An incompatible terminal report states the order closed without proving the requested amendment. Equivalent decimal formatting is accepted; malformed/non-finite/scientific inputs are not silently coerced into evidence.
4. The bounded reconciliation owner sends three read attempts with backoff and no new mutations. Futures owner-level retries are disabled for these reads so its loop, not a nested retry budget, bounds observations. Futures transport's existing timestamp/connection rules remain its own behavior; do not label three logical lookups as a strict bound on all internal physical sends.

## Main and renderer ownership

The pure evaluator lives with shared src/utils domain contracts, already consumed by main. It returns pending, confirmed or terminal-without-requested-result plus a fixed code/message/status. Query results may still update the displayed order while unresolved; that is not a success claim. Expected amendment price/quantity travel in the named uncertainty envelope. Spot query normalization must not invent NEW when status is absent, and client ids must survive normalized stream delivery.

Renderer execution traffic must both match identity and satisfy the held action's postcondition. Named explicit envelopes also require a matching action when both sides name one. Spot's two outcome fields are updated atomically so same-batch uncertainty then a late execution cannot be lost between effects; terminal reasons remain visible as command outcome messages. Futures uses its existing atomic state fold. Cancel-then-place watchers already require CANCELED; retain that rule and reject unknown statuses as unknown rather than inventing a refusal.

## Risk and boundaries

Implementation inspection also found Futures normalization inventing NEW when query/private status is absent. Both regular-order normalizers preserve UNKNOWN instead; this is required for the missing-evidence rule, not a transport change. Their empty graph callers were unresolved and the adapter query, mutation and private-event call sites were inspected in source.

GitNexus pre-edit reconcileAmbiguousFuturesCommand and reportFuturesCommandFailure are HIGH (placement/modify/cancel/dispatch paths); warned before code. reportSpotCommandFailure reaches placement/cancel/setup/typed dispatch/main; useFuturesTrading reaches FuturesWorkspace. Empty results for DataProvider, identity helper and Spot normalizer were unresolved and checked against source imports/calls. No architectural source move or trade retry redesign is bundled here.

A confirmed requested state does not prove which actor caused it. An amendment is not an exactly-once command ledger, and late old reports lack a universal exchange revision fence. Unknown outcomes remain visible and do not authorize retry. This change does not solve F09 account persistence or F10 alias serialization. No live acceptance is inferred from fixtures.

## Verification

Production first, then evaluator/normalizer/main/UI tests: cancel NEW/partial/CANCELED/FILLED/expired, delayed CANCELED, modify old/matching/missing decimal fields, bounded failed/absent reads, action/identity mismatch, late private report and no additional mutation. Preserve F01/F02/F08 and full Futures regression suites. Run full checks and exact graph/diff review before commit; archive only after operator live confirmation.
