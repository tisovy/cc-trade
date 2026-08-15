## MODIFIED Requirements

### Requirement: The last traded price has a source the tape cannot filter
The last-print row between the two book sides, the market header's `Last`, the
grouping step's share-of-price readout and the reference the pressure reach is
measured against SHALL all read one resolved last traded price. That price SHALL
be taken from the newest print the contract made, delivered on a path the tape's
own display settings do not stand in — the minimum displayed notional and the
throttle timeout decide what the tape shows and SHALL NOT be able to hold the
price still. It SHALL fall back to the newest live candle's close, which is the
same figure at the kline stream's cadence, and only then to the newest displayed
trade.

A print SHALL NOT restate the price more often than the operator can read it,
and SHALL NOT be taken as proof that the mark, the funding and the rest of the
header beside it are current — a contract can print while its mark feed is dead.

#### Scenario: Tape filter excludes every recent print
- **WHEN** the operator's minimum displayed trade excludes the prints that are actually trading, so the tape delivers no new row
- **THEN** the last traded price keeps moving with those prints, which the filter never applied to

#### Scenario: Prints arrive faster than they can be read
- **WHEN** a burst of prints arrives inside one repaint window
- **THEN** the price is restated once for the window rather than once per print

#### Scenario: No print has arrived for the contract
- **WHEN** no print has been delivered for the selected contract
- **THEN** the newest live candle's close is shown, which is the same last traded price at the kline stream's cadence

#### Scenario: Candles are not live
- **WHEN** no print has arrived and no live candle is available for the selected interval
- **THEN** the newest displayed trade is shown, the tape being the last resort rather than the first

#### Scenario: One price on screen
- **WHEN** the last traded price is resolved
- **THEN** the market header, the book's last-print row and the step-share readout state the same number rather than three separately sourced ones
