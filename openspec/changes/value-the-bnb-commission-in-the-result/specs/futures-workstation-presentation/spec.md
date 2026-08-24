# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: A foreign-asset commission is valued in the result

When a commission is charged in an asset other than the settlement asset, the
desk SHALL value it in the settlement asset at the charge's own time and
include the valuation in the round's net and the open position's settled
money. The element SHALL name the charged quantity in its own asset, the
valuation, and the price used. When no price is readable for the charge's
time, the desk SHALL state the fee as not included rather than show a wrong
number. A window whose fees were charged partly in the settlement asset and
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
