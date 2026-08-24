# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: A foreign-asset commission is valued in the result

When a commission is charged in an asset other than the settlement asset, the
desk SHALL value it in the settlement asset at the charge's own time and
include the valuation in the round's net and the open position's settled
money. The row face SHALL show one settlement-asset number and SHALL NOT
render the foreign-asset quantity as a visible second line; the element's
title SHALL name the charged quantity in its own asset, the valuation, and
the price used. When no price is readable for the charge's time, the desk
SHALL state the fee as not included rather than show a wrong number. A window whose fees were charged partly in the settlement asset and
partly in a foreign asset SHALL sum the settlement-asset fees exactly and
value only the foreign part. Per-asset wallet conservation SHALL remain
intact: the valuation is presentation onto the settlement-asset result, never
a mutation of the per-asset record.

#### Scenario: A round that paid its fees in BNB

- **WHEN** a closed round's fills carry `commissionAsset: "BNB"` on a USDT-settled contract
- **THEN** the round's net includes the BNB commission valued at the BNBUSDT price of the charge's time, and the row's title names the BNB quantity, the USDT valuation, and the price used

#### Scenario: The price for the charge's time is not readable

- **WHEN** a BNB commission's valuation price cannot be read
- **THEN** the fee is stated in BNB with "not included", the net excludes it, and nothing invents a price

#### Scenario: The BNB balance ran out mid-round

- **WHEN** a round's fills paid commission partly in BNB and partly in USDT
- **THEN** the USDT fees are summed exactly, only the BNB part is valued, and the title decomposes both

#### Scenario: The row face stays one number

- **WHEN** a closed round or an open position's settled money includes a BNB-charged commission
- **THEN** the cell renders a single settlement-asset figure with no visible BNB line, and the BNB quantity is readable only in the element's title

### Requirement: The fee reserve states its remaining worth

The desk SHALL show, once and globally rather than per row, the Futures
wallet's remaining fee-asset reserve: the BNB amount and its worth at the
current BNBUSDT price. When that worth falls below the low bound of
50 USDT equivalent, the readout SHALL be marked as low. When the reserve is
absent or its worth unreadable, the readout SHALL say so rather than show
zero as if it were a reading.

#### Scenario: The reserve runs low

- **WHEN** the Futures wallet's BNB balance is worth less than 50 USDT at the current BNBUSDT price
- **THEN** the reserve readout carries a low mark, warning ahead of Binance's silent revert to undiscounted USDT fees

#### Scenario: A healthy reserve

- **WHEN** the BNB balance is worth 50 USDT equivalent or more
- **THEN** the readout states the amount and worth unmarked, and no per-row surface repeats it
