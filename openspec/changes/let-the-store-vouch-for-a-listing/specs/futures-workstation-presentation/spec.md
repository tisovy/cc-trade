## MODIFIED Requirements

### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the workstation SHALL
request the next page of history behind it — from the nearest source that
holds the whole page, the exchange last — and prepend the result, keeping the
bars the operator is looking at in place rather than jumping the viewport. The
left-edge condition SHALL be re-evaluated whenever the oldest loaded candle
first appears or changes, so an asynchronously delivered live window and every
successfully prepended page remain loadable. Only one history request SHALL be
in flight at a time, and a request that can no longer be answered SHALL NOT
count as one: a read outstanding when the session behind it was rebuilt is not
travelling, and the renderer SHALL let it go rather than wait on it. When a
response returns fewer candles than requested, the chart SHALL treat that as
the start of the contract's history and SHALL stop requesting more. A read that
was not served SHALL NOT be treated as such a response: the chart SHALL
conclude that a contract's history has a start only from a page the exchange
actually sent, or from a page the local candle store vouches for — one whose
first stored minute is the contract's listing minute as the exchange's
catalogue states it, whose every missing minute lies before that listing, and
which holds every bucket from the listing to the page's end. A page the
exchange sent or the store vouched for SHALL be the only thing the renderer
takes for one — a resource restated under a state of the desk's own is not a
page, whatever it carries.

#### Scenario: The operator scrolls to the left edge
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator reaches the next left edge
- **WHEN** a full history page was prepended and the operator continues to the oldest candle in the enlarged series
- **THEN** another request is issued behind the new oldest candle rather than the first request disabling further paging

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the left edge is reached again before the outstanding response arrives
- **THEN** no second request is issued

#### Scenario: The contract's history is exhausted
- **WHEN** a history response from the exchange returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

#### Scenario: A page the local store holds whole
- **WHEN** the next page lies entirely within the local store's minutes for the contract
- **THEN** it is prepended from the store with no exchange request, and the next left edge is loadable as before

#### Scenario: A page reaches before a listing the store holds from its first minute
- **WHEN** the next page begins before the contract's listing minute as the exchange's catalogue states it, the store's first stored minute is that listing minute, and the store holds every bucket from the listing to the page's end
- **THEN** the store's short page is prepended with no exchange request, and the contract's history is concluded to start there, exactly as it would on the exchange's short page

#### Scenario: A page reaches before the store's own beginning
- **WHEN** the next page begins before the store's first stored minute and that minute is later than the contract's listing minute
- **THEN** the store's short answer is not served, and the exchange is asked for the page as before

#### Scenario: The read failed rather than came back short
- **WHEN** a read of older candles is not served at all
- **THEN** the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The desk states an outage over the last answer it holds
- **WHEN** a state of the desk's own restates the last history answer while a read is outstanding for it
- **THEN** the restatement is not taken for a page, the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The session is rebuilt under an outstanding read
- **WHEN** the connection recovers and the session is rebuilt while a read of older candles is outstanding
- **THEN** the next scroll issues a new read rather than waiting on an answer that can no longer arrive
