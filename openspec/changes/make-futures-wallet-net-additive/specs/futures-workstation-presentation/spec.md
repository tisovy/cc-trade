## ADDED Requirements

### Requirement: Shared and multi-asset Futures money is visible without hover
The positions and Closed Positions surfaces SHALL present leg-owned amounts separately from contract/account-shared adjustments. Partial, shared, or non-USDT components SHALL be visible in the rendered row/group and accessible by keyboard and touch; a `title` attribute or dotted underline alone SHALL NOT carry the qualification. An empty partial reading SHALL NOT be described as proof that nothing settled.

#### Scenario: A contract has shared funding
- **WHEN** funding cannot be attributed between overlapping hedge legs
- **THEN** the contract group shows the funding once as shared and neither leg row claims it as its own wallet Net

#### Scenario: The only component is BNB
- **WHEN** the only settled component is `-0.003 BNB`
- **THEN** the visible surface states `-0.003 BNB` or an equivalent accessible multi-asset indicator instead of a bare dash

#### Scenario: A partial read contains no rows
- **WHEN** a bounded income read has no rows but does not completely cover the interval
- **THEN** the surface states that the result is partial rather than `Nothing settled`

#### Scenario: Qualification receives keyboard focus
- **WHEN** a keyboard or touch operator reaches a partial/shared result
- **THEN** the missing coverage or ownership explanation is available without hover

### Requirement: Closed history states scope and measure precisely
Closed Positions SHALL state fill reach and completeness per contract/position key, including when the visible result is empty. A cumulative quantity SHALL be named `Closed volume`; a primary value named `Position size` SHALL represent peak position size rather than cumulative turnover. Day headings and their tests SHALL accept the product locale rather than assuming one punctuation format.

#### Scenario: One contract is truncated and another is complete
- **WHEN** the review has complete fills for one contract and a page-limited window for another
- **THEN** each contract states its own reach and only the affected rows are qualified

#### Scenario: Empty review has incomplete discovery
- **WHEN** no closed round is shown but contract discovery or fill coverage is incomplete
- **THEN** the empty state states that more history may exist

#### Scenario: A round scales out and re-enters
- **WHEN** cumulative closed contracts exceed the maximum simultaneous exposure
- **THEN** the cumulative figure is labelled `Closed volume` and is not labelled position size

#### Scenario: Date punctuation differs by locale
- **WHEN** the runtime locale formats a day as `07/14` instead of `14.07`
- **THEN** the day remains a valid accessible heading and verification does not fail solely on punctuation order
