## MODIFIED Requirements

### Requirement: Executions are reported as the positions they formed
The trade history SHALL report closed round trips rather than fills: a position opens when exposure is taken and closes when that same position key returns to flat. A position key SHALL be `{symbol, LONG}` or `{symbol, SHORT}` for hedge-mode fills and `{symbol, BOTH}` for one-way fills. Each round SHALL be reported with its contract, position leg, side, closed size, average entry and exit, and exchange-reported realized PnL in one `PnL` column. The glance value SHALL be rounded to cents from the bounded exact decimal without converting it through a JavaScript `Number`; a non-zero sub-cent amount that would render as zero SHALL keep its exact text. The element SHALL retain the exact exchange decimal, proven settlement asset, canonical additive or qualified wallet outcome, and fee/funding/insurance/credit/coverage detail in its accessible title; those details SHALL NOT become standalone `Gross`, `NET`, fee, or funding columns.

The size SHALL be stated in USDT, valued at the price the round was entered at, because that is what every other size on this desk is stated in and a contract count cannot be compared across contracts. The count of contracts SHALL remain available on the element.

A position that is proven not to have returned to flat SHALL NOT appear in this history. A position whose opening boundary has not been read SHALL be unresolved until older fills or the current account position prove its state; an unresolved sequence SHALL NOT be invented as either a closed round or an opposite open position. A recovered entry MAY be shown only when exchange-reported realized PnL determines it unambiguously, and SHALL be labelled recovered.

#### Scenario: One close arrives as several fills
- **WHEN** one position leg is closed by an order that fills in several parts
- **THEN** the tab shows one row for that position leg whose single `PnL` cell carries the summed exchange-reported realized PnL, while fees remain in the same element's wallet detail rather than being added to the visible PnL

#### Scenario: Realized PnL requires exact display precision
- **WHEN** the exchange-reported realized PnL is a bounded decimal that would round to signed zero or lose precision as a JavaScript `Number`
- **THEN** Closed Positions shows its cents-rounded value in the single `PnL` cell unless that would hide a non-zero sub-cent amount as zero, and exposes the unchanged exact signed decimal plus proven asset on that element

#### Scenario: The position is still open
- **WHEN** the fills and current snapshot prove that a position key has not returned to flat
- **THEN** no row is shown for it in the closed-position history

#### Scenario: The position was opened before the window
- **WHEN** the oldest fills reduce a position whose opening boundary has not yet been read
- **THEN** the sequence remains unresolved until backfill or unambiguous exchange evidence establishes its round

#### Scenario: A recovered entry is displayed
- **WHEN** unambiguous exchange evidence establishes an entry price for a position opened before the visible fill window
- **THEN** the entry cell visibly and accessibly identifies that price as recovered without relying on hover

#### Scenario: A fill flips the position
- **WHEN** a `BOTH` fill reduces more than the signed exposure holds and opens the opposite side
- **THEN** the closed side is reported with the realized PnL made on the way out, and the leftover opens a distinct live round

#### Scenario: Two contracts were traded in the same window
- **WHEN** the window holds fills on more than one contract
- **THEN** each contract's position keys are folded independently, and a fill on one never changes another

#### Scenario: Both hedge legs are open
- **WHEN** a contract has simultaneous `LONG` and `SHORT` fills
- **THEN** neither leg closes, reduces, or changes the round state of the other

#### Scenario: Both hedge legs expose row actions
- **WHEN** simultaneous LONG and SHORT position rows expose size, margin, or close actions for one contract
- **THEN** each action's accessible name identifies its leg so assistive-technology users cannot select the opposite position by mistake

#### Scenario: A closed round is sized
- **WHEN** the closed-position history lists a resolved round
- **THEN** its size is what the position was worth in USDT at its entry, and the contract count is on the element

## ADDED Requirements

### Requirement: A closed position is proven per leg and coverage window
Durable fill-acquisition coverage SHALL describe the contract window actually enumerated by `/userTrades`. The renderer SHALL project that proof to every same-generation position key named by retained fills or the authoritative position snapshot, including a current key with no retained fills, and SHALL preserve its retention, page-limit, and continuity state. Each position key SHALL additionally carry whether a flat boundary was proven and whether the current terminal exposure agrees with the account snapshot.

The authoritative snapshot SHALL contain at most one valid exact-quantity row for each canonical `{symbol, leg}` key. A duplicate key or present malformed quantity SHALL invalidate terminal reconciliation for that key rather than using input order, last-write-wins, or absence-as-zero semantics.

A full response at the exchange page limit SHALL be treated as potentially truncated. The system SHALL read older bounded fill windows only for keys that need a boundary, stopping when it proves flat or reaches an explicit retention or request bound. A flat-boundary early stop SHALL require reverse reconciliation from an authoritative current position snapshot belonging to the same Futures activation through a fully enumerated contiguous newest suffix. Every canonical position key encountered for the contract SHALL reach exact zero at the same slice boundary; absence from a current complete snapshot MAY state terminal zero, but a stale/loading snapshot, malformed quantity, mixed position topology, or stream/topology activity during the read SHALL NOT. A zero observed by forward-folding an unknown left edge SHALL NOT qualify. If proof cannot be obtained, the fixed bounded target SHALL remain unchanged, the result SHALL stay unresolved, and page-limit, retention, cancellation, or race evidence SHALL state why.

A successful reverse-flat early stop SHALL retain the original frozen target and SHALL NOT claim that the unenumerated older portion is complete. It SHALL publish the enumerated suffix with its explicit flat boundary, cease only the now-unnecessary older continuation, and remain vouched only while the same authenticated stream proof is current.

Each canonical fill SHALL preserve the settlement asset reported by Binance. A resolved round SHALL have one consistent settlement asset across all contributing fills. Missing or conflicting settlement-asset evidence SHALL keep the affected round unresolved, and the application SHALL NOT infer the asset from a symbol suffix or commission asset. Persisted fills that predate settlement-asset evidence SHALL trigger bounded reacquisition rather than being accepted through their old cursor.

The persistent contract cache SHALL retain at most the declared contract bound for the currently authenticated fingerprint across the entire IndexedDB store. Records without that fingerprint, including legacy symbol-keyed records and records from a previous credential fingerprint, SHALL be removed when the active account is persisted. Reads SHALL remain account-isolated, and removing obsolete namespaces SHALL NOT reduce the active account's own per-contract or contract-count bounds.

Each composite persistent-history update SHALL read the latest stored contracts, merge endpoint-specific evidence, apply global pruning, and write the resulting changes within one IndexedDB read/write transaction. Concurrent renderer or store instances SHALL therefore serialize at the database transaction boundary rather than overwriting evidence from an earlier read. A failed transaction SHALL expose none of its deletes or writes, and each opened database connection SHALL be closed after its transaction completes, aborts, or fails. Injected non-IndexedDB adapters MAY retain the legacy read/write/remove contract for deterministic tests and alternate persistence.

Reported-PnL consistency checks SHALL use exact decimal values and contract precision. A percentage of notional SHALL NOT be treated as rounding tolerance, and a zero-realized fill SHALL NOT by itself prove whether it opened or closed exposure.

Exchange decimal fields SHALL be bounded before regular-expression and `BigInt` work. A scientific-notation JavaScript number SHALL NOT be rounded into an apparently exact fixed-scale fill; unsupported numeric evidence SHALL leave the affected fill/round unresolved.

The REST trade boundary SHALL preserve missing realized-PnL, commission, quantity, price, time, and settlement-asset evidence as missing. It SHALL NOT manufacture a numeric zero or epoch timestamp for an absent exchange field. Before a `/userTrades` response can advance coverage, a cursor, renderer state, or persistent history, every row SHALL have bounded canonical symbol, trade/order identities, side, position side, positive fixed-decimal price and quantity, fixed-decimal realized PnL, non-negative fixed-decimal commission, safe time, and settlement asset. Commission asset MAY be absent only when commission is exactly zero. Missing, oversized, scientific, wrong-type, foreign-contract, or otherwise non-canonical essential evidence SHALL reject the whole page transactionally. Malformed evidence retained from an older schema or another bounded source MAY remain visible as unresolved evidence, but it SHALL NOT make a Closed Positions NET exact.

Optional `/userTrades` request time bounds SHALL distinguish absence from invalid evidence. Undefined, null, or blank optional bounds SHALL be omitted from the query; a present non-integer, negative, unsafe, oversized, or inverted bound SHALL be rejected before any request is sent. A bounded window whose contract is known SHALL reject a response row for another contract before mutating acquired rows or coverage.

The same dependency-free canonical trade validator SHALL govern endpoint admission, bounded-window admission, and v2 persistent-history restore. A restored row with malformed essential evidence MAY remain visible for audit and unresolved-round diagnosis, but it SHALL clear that contract's trade cursor and coverage proof so the old record cannot vouch for exact NET or suppress bounded reacquisition.

A bounded trade-history page SHALL advance contiguous coverage only when its row count is no greater than the admitted page size and every returned row has a reliable trade identity, a valid in-window timestamp, and immutable evidence consistent with any repeated copy of that identity in the same acquisition. An oversized answer SHALL fail with `OVERSIZED_TRADE_PAGE` before row iteration or candidate-map mutation. Invalid rows or conflicting duplicate payloads SHALL fail the pass without committing partial coverage.

Injected trade-window limits MAY reduce the production page size or request allowance for a narrower caller or deterministic test, but SHALL be clamped to at least one and no greater than the declared `FUTURES_TRADE_HISTORY_WINDOW` ceilings. Caller-supplied limits SHALL NOT expand the production memory or request budget.

An unreadable retained fill SHALL be a continuity barrier for its canonical position key. It SHALL NOT be omitted while another round at or after that evidence is promoted to exact. A valid canonical copy with the same reliable trade identity MAY replace an incomplete projection; if the unreadable fill has no provable position key, the supplied batch SHALL remain unresolved because its ownership cannot be established.

Repeated canonical copies of one reliable trade identity SHALL merge only when all evidence present in both copies agrees. Missing optional evidence MAY be enriched by a compatible copy. Conflicting present topology, money, or asset evidence SHALL be a continuity barrier and SHALL NOT be resolved by input order or last-write-wins replacement.

The bounded persistent-history cache SHALL deduplicate equivalent copies of one reliable trade identity but SHALL preserve distinct payload variants for that identity. Its physical trade-row bound SHALL count those retained variants, while its forward cursor SHALL remain the highest reliable exchange identity. Restoring or rewriting the cache SHALL NOT erase a previously observed identity conflict or make its outcome depend on arrival order.

When restored rows contain distinct canonical variants for one reliable contract/trade identity, the rows SHALL remain available as unresolved audit evidence but the restored trade cursor and acquisition coverage SHALL be cleared. The next authenticated basis acquisition SHALL therefore use bounded replacement rather than trusting the conflicted seam or paging only beyond it.

Exact decimal evidence parsed by the fold SHALL remain exact for terminal reconciliation even when a derived JavaScript presentation number would use exponent notation. Rejecting scientific notation at the raw exchange boundary SHALL NOT make an already parsed bounded ratio unreconciled.

Commission-asset evidence SHALL be normalized once at the canonical fill boundary. Commission completeness, exact fee ownership, and subtraction from settlement-asset NET SHALL use that same canonical asset; whitespace or case differences SHALL NOT create a second phantom asset or omit a settlement fee.

#### Scenario: Latest page contains exactly the limit
- **WHEN** the newest account-trade response contains 1000 fills for a contract and no flat boundary is present
- **THEN** the key is marked potentially truncated and older fills are requested within the bound before any exact round is shown

#### Scenario: A trade-history window omits a time bound
- **WHEN** a bounded account-trade read receives a null, blank, non-integer, or inverted start/end time
- **THEN** the read is rejected rather than coercing the missing edge to the Unix epoch

#### Scenario: A fill carries unsafe decimal evidence
- **WHEN** a quantity, price, realized PnL, or commission has an oversized decimal representation or arrives as a scientific number requiring lossy rounding
- **THEN** the parser performs no unbounded integer expansion and the affected fill/round cannot be reported as exact

#### Scenario: A REST fill omits a monetary field
- **WHEN** a user-trade response omits realized PnL, commission, price, quantity, time, or settlement asset
- **THEN** normalization preserves the absence for diagnosis, but the response page is rejected before it advances coverage, cursor state, or persistent history instead of substituting zero or the Unix epoch

#### Scenario: Optional account-trade bounds are omitted or malformed
- **WHEN** an optional `/userTrades` start/end bound is undefined, null, or blank, or is present but non-integer, negative, unsafe, oversized, or inverted
- **THEN** absent bounds are omitted from the request while malformed present bounds reject the request before transport, and neither case becomes an epoch query

#### Scenario: A user-trade row is not bounded canonical evidence
- **WHEN** one response row has an oversized field, a scientific or wrong-type decimal, a non-positive price or quantity, a negative commission, a missing required asset, an invalid side or position side, or a non-exact identity/time
- **THEN** the whole response is rejected before any row, cursor, complete coverage, or persistent record is committed

#### Scenario: A user-trade response names another contract
- **WHEN** a bounded BTCUSDT trade read receives a canonical ETHUSDT row
- **THEN** the page is rejected transactionally and cannot prove BTCUSDT empty or complete

#### Scenario: A persisted v2 trade is no longer canonical
- **WHEN** a restored contract contains a trade with settlement asset but malformed identity, topology, money, or time evidence
- **THEN** the row remains available as unresolved audit evidence while its restored trade cursor and coverage are cleared for bounded reacquisition

#### Scenario: A trade-history page contains invalid or conflicting identity evidence
- **WHEN** a bounded user-trade response contains an unnamed trade, an out-of-window timestamp, or two different payloads for one reliable trade identity
- **THEN** the acquisition does not advance contiguous coverage or publish a newly exact Closed Positions NET from that page

#### Scenario: A trade-history answer exceeds its admitted page size
- **WHEN** a `/userTrades` answer contains more rows than the page size admitted for that bounded read
- **THEN** the reader rejects it atomically with `OVERSIZED_TRADE_PAGE` before iterating or retaining rows, and coverage/checkpoint state does not advance

#### Scenario: A caller injects larger trade-window limits
- **WHEN** a caller supplies `PAGE_SIZE` or `MAX_REQUESTS` above the declared production ceilings
- **THEN** the reader clamps them to the production ceilings, while smaller positive injected limits may still narrow deterministic work

#### Scenario: A retained malformed fill sits inside one position key
- **WHEN** a retained fill has a reliable position key but an unreadable price, quantity, side, or time and no valid canonical copy replaces it
- **THEN** that key's subsequent fold remains unresolved and no exact Closed Positions NET is calculated around the omitted execution

#### Scenario: Repeated canonical trade identity conflicts
- **WHEN** two retained copies of one reliable symbol and trade ID report different present quantity, price, side, time, realized PnL, commission, position leg, or asset evidence
- **THEN** the position key remains unresolved instead of choosing whichever copy happened to arrive last

#### Scenario: A conflicting trade identity crosses a renderer restart
- **WHEN** two distinct bounded payloads for one reliable symbol and trade ID are persisted, restored, and folded after a renderer restart
- **THEN** both variants remain available as order-invariant conflict evidence, the cache remains within its physical row bound, and Closed Positions cannot publish an exact NET from either variant

#### Scenario: Restored conflict cannot vouch a forward cursor
- **WHEN** a v2 contract cache restores individually canonical but conflicting variants of one reliable trade identity beside previously complete coverage
- **THEN** both rows remain visible, but the restored trade cursor and coverage are null so the authenticated bounded replacement path can heal the contract

#### Scenario: An incomplete duplicate contradicts its valid copy
- **WHEN** one retained copy of a reliable symbol and trade ID is incomplete but another field still present on it conflicts with a valid canonical copy
- **THEN** the valid copy does not erase the contradiction and the affected position key remains unresolved until clean canonical reacquisition replaces both inputs

#### Scenario: A malformed duplicate money field is not sparse evidence
- **WHEN** one otherwise canonical copy of a reliable symbol and trade ID carries a present but malformed realized-PnL, commission, commission-asset, or settlement-asset value while another copy carries a valid value
- **THEN** the malformed value is retained as a continuity conflict and the affected Closed Positions NET remains qualified instead of borrowing the valid copy's money or asset

#### Scenario: A malformed asset reaches the round fold directly
- **WHEN** retained, streamed, injected, or future fill evidence carries an empty, oversized, wrong-type, or non-canonical settlement or commission asset despite optimistic complete coverage metadata
- **THEN** the round fold rejects that asset as money evidence and cannot emit a resolved Closed Positions NET or exact fee bucket denominated in it

#### Scenario: A small exact entry is rendered with an exponent
- **WHEN** bounded string fill evidence derives an exact terminal entry such as `0.0000001` and JavaScript presents its numeric view as `1e-7`
- **THEN** terminal reconciliation compares the bounded derived decimal and does not report a snapshot mismatch solely because of exponent notation

#### Scenario: Commission asset needs canonical casing and whitespace
- **WHEN** a valid fill reports the settlement commission asset with surrounding whitespace or non-canonical case
- **THEN** coverage and fee allocation use one trimmed uppercase asset and exact settlement NET subtracts the commission once

#### Scenario: Backfill reaches flat
- **WHEN** progressive older windows reach a fill after which the position key is known flat
- **THEN** the subsequent fills are folded as resolved rounds without reading older history

#### Scenario: Backfill reaches retention without flat
- **WHEN** the available retention ends before a flat boundary is proven
- **THEN** the affected sequence remains unresolved and no exact wallet result is claimed

#### Scenario: Retention ends before a current leg has a retained fill
- **WHEN** contract acquisition is retention-limited and the authoritative snapshot names an open position key for which no retained fill can be folded
- **THEN** that key remains unresolved with the contract's retention-limited coverage and no exact fill-owned PnL or commission is emitted

#### Scenario: A forward fold happens to return to zero
- **WHEN** fills return a leg to zero while the sequence before the oldest covered fill is still unknown
- **THEN** that zero does not stop older acquisition unless same-generation reverse terminal reconciliation proves it at a fully enumerated slice boundary

#### Scenario: Reverse-flat proof races account activity
- **WHEN** the authoritative position snapshot is stale/loading or a fill, reconnect, activation change, or stream-topology change occurs while a candidate newest suffix is being enumerated
- **THEN** the candidate flat boundary is rejected, older work remains tied to the original fixed target and bounded checkpoint, and no early-stopped coverage is promoted to exact

#### Scenario: One contract contains more than one position key
- **WHEN** the contiguous suffix contains `LONG`, `SHORT`, or `BOTH` evidence for more than one canonical position key
- **THEN** older acquisition stops only when reverse reconciliation proves every encountered key exactly flat at the same enumerated boundary

#### Scenario: A reverse-flat proof stops before the frozen target edge
- **WHEN** a current same-activation snapshot and contiguous suffix prove every contract key flat above the original target start
- **THEN** the suffix records its flat boundary and stops older continuation without claiming the unenumerated part of the frozen target is complete

#### Scenario: A break-even close starts the visible window
- **WHEN** the first visible fill realizes zero while closing exposure opened before the window
- **THEN** it is not presented as an opposite opening merely because its realized PnL is zero

#### Scenario: Ordinary PnL differs by less than one percent of notional
- **WHEN** a possible reversal's reported PnL differs from the tentative round by an amount larger than contract precision but smaller than one percent of notional
- **THEN** the difference is not dismissed as rounding and the tentative reversal is not accepted on that basis

#### Scenario: Reconstructed exposure disagrees with snapshot
- **WHEN** a supposedly complete round set implies a different leg, signed quantity, or entry basis from the current account position
- **THEN** that key becomes unresolved and the stale persisted round is not attached to the current position

#### Scenario: The authoritative snapshot duplicates a position key
- **WHEN** two snapshot rows normalize to the same `{symbol, leg}` key, whether their quantities agree or conflict
- **THEN** that key cannot terminal-reconcile or prove a reverse-flat boundary, and permuting the duplicate rows does not change the unresolved outcome

#### Scenario: A round settles in USDC
- **WHEN** every fill of a resolved round reports `marginAsset=USDC`
- **THEN** the round's realized PnL and settlement-denominated fee are identified as USDC and are never labelled USDT

#### Scenario: Settlement-asset evidence conflicts
- **WHEN** contributing fills omit `marginAsset` or report different settlement assets for one tentative round
- **THEN** the round remains unresolved and no exact settlement-asset total is emitted

#### Scenario: Stored fills predate margin asset
- **WHEN** a restored contract has fills or coverage that cannot prove their settlement asset
- **THEN** its old cursor is not treated as proof and a bounded frozen-window reacquisition begins

#### Scenario: Persistent history crosses a credential migration
- **WHEN** IndexedDB contains legacy symbol-keyed records or records for an earlier account fingerprint and the current authenticated account writes its history
- **THEN** obsolete namespaces are removed, no more than the current account's declared contract bound remains, and no cross-account row is restored

#### Scenario: Two store instances persist complementary evidence concurrently
- **WHEN** separate renderer or store instances concurrently persist order-only and trade-only evidence for the same authenticated contract
- **THEN** their IndexedDB transactions serialize, the later update merges from the latest committed record, and the final bounded record contains both evidence sets

#### Scenario: A persistent-history transaction fails
- **WHEN** a composite update aborts or one of its delete or put requests fails
- **THEN** no partial prune or evidence update becomes visible and the database connection is closed after failure handling

### Requirement: Current position settlement does not depend on opening History
For every currently open position key, the desk SHALL acquire and maintain the minimum fill basis needed to state its realized PnL and commission since opening. Persisted fills SHALL be reused, new execution reports SHALL be folded idempotently, and any detected gap SHALL schedule one coalesced targeted read. Opening an order-history or Closed Positions view SHALL NOT be required to update current position settlement.

Shared income-backed traded-symbol discovery SHALL publish monotonically across concurrent renderer sessions. A discovery issued earlier SHALL NOT replace a cache candidate committed by a later-issued successful request, and clearing the active account history SHALL fence all discovery work issued before that reset. This publication ordering SHALL NOT weaken renderer activation, session-disposal, or account-fingerprint admission.

Each renderer's acquisition checkpoints SHALL be retained only while another bounded continuation is eligible. Reaching the declared failure or post-gap retry bound SHALL remove the checkpoint and arm no automatic retry while preserving the final additive/incomplete response. A later explicit request MAY start a fresh checkpoint for its current target.

The renderer SHALL recompute the bounded fill-to-round index only when canonical fills, their coverage generation, or the position fields used for terminal reconciliation (`symbol`, leg, signed quantity, entry basis) change. Mark price, unrealized PnL, margin, and other account-snapshot metadata SHALL NOT repeat the fill fold.

A frozen Full/cold acquisition SHALL consume no more than 16 successful `/userTrades` pages across all of its passes. Each continuation SHALL receive only the checkpoint's remaining page allowance. Exhausting that allowance without proving the frozen window SHALL mark the evidence retention-limited and incomplete, remove the checkpoint, and schedule no further automatic request.

#### Scenario: Fresh profile starts with an open position
- **WHEN** the app starts without held fills and the account reports an open position
- **THEN** a targeted basis read begins for that position key without the operator opening History

#### Scenario: A partial close executes
- **WHEN** an execution report partially closes an open position
- **THEN** its realized PnL and gross commission update once without a history-tab action

#### Scenario: Only order history changes
- **WHEN** an accepted history response updates orders, discovery clocks, or other non-trade metadata without changing canonical fills or their coverage
- **THEN** the held order review updates while retaining the untouched fill/folded collections and without rebuilding the fill-to-round index or Closed wallet reconciliation

#### Scenario: Persisted fills are restored before another exchange event
- **WHEN** a v2 history snapshot with canonical fills is restored into an otherwise empty renderer session
- **THEN** restore advances the trade-evidence revision and Closed rounds plus wallet reconciliation are rebuilt immediately without waiting for a later REST response or stream fill

#### Scenario: A streamed fill names its margin asset
- **WHEN** an authenticated execution report carries `ma` or `marginAsset` for an actual fill
- **THEN** the held canonical fill preserves that settlement asset instead of downgrading the fill and requiring REST to recover the same field

#### Scenario: Execution delivery has a gap
- **WHEN** execution identity shows that one or more fills were missed
- **THEN** one coalesced targeted gap read reconciles the key and duplicate stream/REST fills do not double count

#### Scenario: A stream-only fill falls inside an older covered timestamp
- **WHEN** a held stream fill has not yet been absorbed by REST but its timestamp is no later than the contract window's previously proven right edge
- **THEN** only that position key's proven right edge is capped before the fill, older resolved rounds remain visible, and no round touching the unconfirmed suffix becomes exact

#### Scenario: An order lifecycle event carries no fill
- **WHEN** the user stream reports `NEW`, cancellation, expiry, or another execution report without a traded quantity or trade identity
- **THEN** the event updates working-order state without invalidating proven fill-history coverage or scheduling a trade-history repair

#### Scenario: Stream reconnects during a frozen history read
- **WHEN** stream topology or activity changes while a frozen window or its forward gap is being acquired
- **THEN** the result remains additive and incomplete until a bounded REST continuation reaches every stream-observed fill identity

#### Scenario: Two renderers request history
- **WHEN** two renderer connections have independent Futures activations and one switches market or closes during a repair
- **THEN** its session is discarded without cancelling, stealing, or receiving the other renderer's repair

#### Scenario: Concurrent discoveries answer out of order
- **WHEN** an older renderer discovery answers after a later-issued discovery has already committed a different successful cache candidate
- **THEN** each renderer may receive its own valid response, but reconnect and rotation reads retain the later candidate and never regress to the older cache

#### Scenario: A discovery predates account-history reset
- **WHEN** shared history state is cleared while an earlier discovery request is still in flight
- **THEN** that request cannot restore the retired discovery cache even if its transport later succeeds

#### Scenario: Acquisition exhausts its retry budget
- **WHEN** a cold, Full, basis-gap, or post-gap acquisition uses its final allowed attempt without becoming complete
- **THEN** its final response remains additive/incomplete, its checkpoint and pending retry are removed, and no further automatic read is scheduled

#### Scenario: Operator retries after terminal acquisition
- **WHEN** a later explicit history request follows an exhausted acquisition
- **THEN** it starts with a new current target and a fresh bounded retry budget rather than resuming the terminal checkpoint

#### Scenario: Account refresh changes only valuation metadata
- **WHEN** a periodic account snapshot keeps every position's symbol, leg, signed quantity, and entry basis unchanged while mark, unrealized PnL, or margin fields change
- **THEN** live position presentation updates without recomputing the held fill-to-round index

#### Scenario: Dense frozen history exhausts its cumulative page allowance
- **WHEN** repeated full trade pages require more than 16 `/userTrades` requests across a Full or cold reacquisition and its continuations
- **THEN** no seventeenth page is requested for that checkpoint, coverage remains incomplete and retention-limited, the checkpoint is removed, and no automatic continuation remains armed

#### Scenario: Old and current positions reuse a symbol
- **WHEN** a persisted open round belongs to an older position but the current snapshot has a different leg, quantity, or entry basis
- **THEN** the old round is not used as the settlement start for the current position

#### Scenario: Closed review changes while an older local window is open
- **WHEN** new closed rounds prepend or the held round set shrinks while the operator is reading an older local window
- **THEN** the window preserves its first surviving round identity and clamps a removed anchor instead of silently drifting to different rows or reviving a stale offset later

#### Scenario: A previously read history view becomes unread
- **WHEN** account rotation or history reset clears the selected view's read identity while its tab remains open
- **THEN** the previous successful request does not suppress one new bounded read for the current account state

## REMOVED Requirements

### Requirement: A closed position is what was actually closed
**Reason**: The requirement asks heuristics over an incomplete left boundary to invent exact round state and tolerates up to one percent of notional as rounding, which can create phantom reversals and opposite positions.
**Migration**: Replace heuristic certainty with per-leg coverage, bounded backfill, precision-derived comparisons, snapshot reconciliation, and an explicit unresolved state.
