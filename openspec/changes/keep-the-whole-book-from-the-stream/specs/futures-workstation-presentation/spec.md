## REMOVED Requirements

### Requirement: The book is bought at the page the reading needs
**Reason**: The exchange's protocol reads the book once and maintains it from the diff stream; buying a page again for the rows on screen collided with diffs in flight and rebuilt the book 34 times in one evening on AKEUSDT without a single proven sequence gap.
**Migration**: A session bootstraps at the deepest page once; the panel's stated range bounds delivery only. Superseded by «The book is one page and then the stream».

### Requirement: The book states the band it can prove
**Reason**: The band drove re-reads (walked out, short of the rows) that the protocol does not call for. What it proved is kept as the row marker only.
**Migration**: Superseded by «The book is one page and then the stream» and «A row beyond the page says so».

### Requirement: The book states how far it reaches
**Reason**: The reach was withheld until the deepest page was bought; there is no page to wait for.
**Migration**: Superseded by «The book states how far it holds».

## ADDED Requirements

### Requirement: The book is one page and then the stream
A contract's order book SHALL be built from one depth snapshot at the deepest
page the exchange serves in one read, bridged by the exchange's own rule for
the first diff, and SHALL thereafter be maintained from the diff stream alone.
Every level the stream states SHALL be applied wherever it rests and kept
until the stream states it gone; the desk SHALL NOT bound how many levels it
keeps, and the work of applying a diff or delivering the rows SHALL be bounded
by the rows delivered, not by the levels held.

The desk SHALL read the book from the exchange again only when the diff chain
proves a gap, when a chained diff leaves the book crossed, when a bootstrap
cannot be bridged, or when the stream that carries the book reconnected. The
market moving past the page, the rows on screen reaching past it at the
operator's grouping step, or a change of grouping step SHALL NOT cause a read.
The range the panel states SHALL bound what is delivered and nothing else.

#### Scenario: A contract is opened
- **WHEN** a session bootstraps its book
- **THEN** one snapshot is read at the deepest page one read returns, the buffered diffs are bridged by the exchange's rule, and no further snapshot is read while the chain holds

#### Scenario: The market walks out of the page
- **WHEN** trading moves the best price beyond the span the snapshot proved
- **THEN** no snapshot is read; the levels the stream has stated on the far side are drawn, and the rows beyond the page are marked as such

#### Scenario: The operator coarsens the step
- **WHEN** the grouping step's rows span more than the snapshot proved
- **THEN** no snapshot is read; the rows are grouped from the whole book in hand

#### Scenario: The chain proves a gap
- **WHEN** a diff's previous-final identity does not match the book's last identity
- **THEN** the book is rebuilt from a fresh snapshot under `DEPTH_SEQUENCE_GAP`, on the recovery cooldown

#### Scenario: A far level is held for the session
- **WHEN** the stream states a level far from the market and never states it again
- **THEN** it is held, and drawn whenever the rows reach it, for as long as the session runs

#### Scenario: Twenty thousand levels a side
- **WHEN** the stream has stated twenty thousand levels on one side
- **THEN** every one is kept, and applying the next diff costs no more than applying it did at ten thousand

### Requirement: A row beyond the page says so
The page a book was bootstrapped from SHALL remain recorded as the span every
level of which the snapshot named. A delivered row SHALL state whether it is
whole — whether the page named every price the row could be holding — and a
grouped row SHALL be judged by the end of its bucket furthest from the market.
The marker SHALL NOT change what the row states: every level in it was named
by the exchange and is exact; what may be missing is levels nobody has
restated since the page was read. A book with no page SHALL call no row whole.

#### Scenario: A diff touches a level outside the page
- **WHEN** a depth diff carries a level beyond the span the snapshot covered
- **THEN** the level is kept and drawn, and the row carrying it is marked as beyond what the page accounted for

#### Scenario: A bucket straddles the edge of the page
- **WHEN** a grouped row covers prices on both sides of the page's edge
- **THEN** it is not whole

#### Scenario: A level nobody has touched
- **WHEN** a price outside the page has rested untouched since the snapshot was taken
- **THEN** nothing is drawn for it, because the book has never been told about it and does not guess

### Requirement: The book states how far it holds
A delivered book SHALL state how far past the best price the book the desk
holds reaches on each side, in the contract's own quote currency, measured from
the levels it holds with a stated share of each side's furthest levels left
outside the reading, and SHALL state it on every delivery.

#### Scenario: The first delivery
- **WHEN** the book is delivered after its bootstrap
- **THEN** it states how far it holds on each side

#### Scenario: The stream widens the book
- **WHEN** the stream has stated levels beyond the page on one side
- **THEN** the stated reach on that side grows with them

## MODIFIED Requirements

### Requirement: Bounded order-book delivery orders only the levels it can send
When a valid stated range bounds delivery to fewer levels than the retained
side, the workstation SHALL select the exact nearest levels required by the
range, the delivery floor, and the protocol limit before fully ordering the
selected result. It SHALL NOT fully order the unread retained tail.

The delivered bids and asks, their nearest-first order, the inclusive range
edge, the minimum-level floor, the maximum-level limit, and the reported spread
SHALL remain exactly equivalent to a full exact-decimal ordering of the retained
book. Price selection and ordering SHALL preserve decimal strings of different
scales and magnitudes beyond safe binary-number precision without lossy numeric
coercion. No level SHALL be synthesized.

An absent, invalid, non-positive, or effectively unbounded range SHALL continue
to deliver up to the protocol ceiling. The retained book SHALL NOT be trimmed
to make delivery cheap: the retained side is unbounded, and delivery's cost is
bounded by what it selects.

#### Scenario: A realistic range reads a fraction of the retained book
- **WHEN** a valid range reaches roughly two hundred and twenty of one thousand retained levels on each side
- **THEN** only the bounded nearest subset is fully ordered, and the delivered bytes match the full exact-decimal reference for both bids and asks

#### Scenario: A narrow range falls below the delivery floor
- **WHEN** fewer levels lie inside the valid range than the minimum delivered level count
- **THEN** the nearest levels needed to reach the floor are selected and ordered exactly, without ordering the remaining retained tail

#### Scenario: Exact decimal prices have mixed scales and wide magnitudes
- **WHEN** retained prices use different decimal scales, include values wider than safe binary-number precision, and arrive in different insertion orders
- **THEN** bounded selection returns the same price strings, quantities, side order, and spread as the full exact-decimal reference

#### Scenario: The stated range covers the retained side
- **WHEN** a valid range reaches every retained level on a side
- **THEN** every level up to the protocol limit is delivered in exact nearest-first order and none is invented

#### Scenario: The range does not provide a usable bound
- **WHEN** the range is absent, invalid, non-positive, or wide enough that the protocol ceiling is the effective bound
- **THEN** delivery keeps the existing ceiling behavior and exact nearest-first output

#### Scenario: Retained state exceeds its side limit
- **WHEN** depth updates carry a side past any count that used to be its retention ceiling
- **THEN** no level is discarded, and bounded delivery still selects and orders only the nearest levels it sends

### Requirement: Routine depth delivery is bounded and latest-wins
Consecutive routine order-book deliveries for the shown contract SHALL be separated by at least 200 milliseconds. The first eligible update MAY be delivered immediately; updates arriving before the next eligible instant SHALL occupy one replaceable pending slot, and the newest complete book SHALL be delivered at that trailing instant. The pending queue SHALL therefore remain bounded to one book and SHALL NOT lose the last state received during the spacing period.

Depth state transitions that tell the operator the book is stale, unavailable or resynchronizing, the first live depth after recovery, and the first delivery of a session SHALL bypass the routine delay. Immediacy belongs to the change of delivery state, not to its value: a delivery whose state matches the state last delivered — stale included — SHALL remain a routine delivery under the bound above. A book whose staleness stands across consecutive diffs SHALL therefore be delivered at the routine cadence, latest-wins, for as long as the state does not change, and the delivery that states the change itself SHALL NOT be delayed. Releasing, replacing or hiding the owning session SHALL cancel its pending timer and payload so no late book can be delivered under another owner.

#### Scenario: Several diffs arrive in one delivery window
- **WHEN** multiple valid depth diffs update the shown book within 200 milliseconds
- **THEN** an eligible leading book may be delivered immediately, exactly one newest book remains pending for the earliest instant at least 200 milliseconds later, no intermediate book is queued, and that trailing book contains the latest state

#### Scenario: A book failure occurs while a routine update is pending
- **WHEN** the book becomes stale or unavailable before a pending routine delivery fires
- **THEN** the non-live state is delivered immediately and is not delayed behind the routine book

#### Scenario: The book stays stale across consecutive diffs
- **WHEN** the shown book remains stale — a gap being recovered on its cooldown — while valid depth diffs keep arriving within one delivery window
- **THEN** the delivery that stated the transition into stale was immediate, and the deliveries that follow while the staleness persists remain bounded and latest-wins: one newest stale book at the trailing instant, no delivery per diff

#### Scenario: Book recovery completes while routine delivery is bounded
- **WHEN** a recovery rebuilds a live book
- **THEN** the recovered live state is delivered immediately rather than waiting for the ordinary depth window

#### Scenario: The depth owner is released
- **WHEN** a contract session with a pending depth delivery is released or replaced
- **THEN** its pending timer and book are discarded and nothing from that session is emitted later

### Requirement: A book that cannot be built costs the book, not the desk
A depth bootstrap that cannot be bridged SHALL NOT resynchronize the session.
The desk SHALL come live without the book — chart, candles, header and tape
delivering — with the book marked stale and rebuilt in the background on its own
cooldown, exactly as a live book already answers a sequence gap. The aggregate
timing SHALL distinguish a session that reached live with its book from one that
reached live without it.

The cooldown between rebuild rounds SHALL widen while rounds keep failing and
SHALL be bounded by a stated ceiling, and one bridged snapshot SHALL return it
to its floor. A round abandoned because the contract is being released or the
session is resynchronizing SHALL count as neither. A book that cannot be
bridged is one the exchange cannot serve a usable snapshot for, and asking at a
fixed rate for as long as that lasts spends the desk's read budget against the
exchange at exactly the moment it is refusing work.

#### Scenario: The book cannot be bridged at startup
- **WHEN** every snapshot attempt of a bootstrap fails to bridge
- **THEN** the session reports `live`, the header, candles and tape keep being delivered, and the book is reported stale rather than the workspace going to `RESYNCHRONIZING`

#### Scenario: The book is rebuilt afterwards
- **WHEN** a later recovery bridges a snapshot for a session that came live without its book
- **THEN** the book is delivered live to the panel without the session having been rebuilt

#### Scenario: The timing log is read afterwards
- **WHEN** a session comes live without its book
- **THEN** its aggregate timing says so, distinctly from a session that came live with one and from one that failed

#### Scenario: The exchange cannot serve a bridgeable snapshot
- **WHEN** rebuild rounds keep failing because no snapshot bridges
- **THEN** each failed round widens the pause before the next, up to the stated ceiling, instead of asking at the same rate for as long as the condition lasts

#### Scenario: The exchange recovers
- **WHEN** a snapshot bridges after a run of failed rounds
- **THEN** the pause returns to its floor, and the next broken sequence is answered at the ordinary cadence

### Requirement: A resynchronization names its cause
A resynchronization SHALL carry a reason that distinguishes a connection lost by
the exchange, a connection this desk closed on its own rule, and a resource that
went stale without a close. A stream that closed SHALL state who closed it — the
exchange, the desk, or the transport between them — with the close code the
socket carried, and the upstream lag of the last frame delivered before the
close, so that a close that followed seconds of a stalled route reads as what
it was.

#### Scenario: The desk closed the connection itself
- **WHEN** the desk terminates a stream because of its own limit
- **THEN** the reason shown to the operator names that limit rather than reporting a plain socket disconnect

#### Scenario: The desk refused a frame and kept the stream
- **WHEN** the desk drops an upstream frame that exceeds its own ceiling
- **THEN** the refusal is named on the workspace's reason line under a code of its own, the session stays live, and a burst of such frames is stated once rather than once per frame

#### Scenario: The route stalled and the socket closed
- **WHEN** frames arrive seconds late and the socket then closes without the desk's own rule
- **THEN** the resynchronization's record states who closed it, the close code, and how late the last frame before it was
