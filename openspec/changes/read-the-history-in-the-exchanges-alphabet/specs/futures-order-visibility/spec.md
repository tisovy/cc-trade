## ADDED Requirements

### Requirement: History evidence reads the exchange's identity alphabet

The trade-history evidence contract SHALL accept contract symbols in the
identity alphabet the workstation protocol reads — uppercase, titlecase and
caseless letters and numbers, with the delivery-dated underscore form — and
SHALL continue to refuse anything that could spell an amount. The read side
narrower than the account it reads refused every request for 龙虾USDT on
2026-08-28 — «A valid expected trade-history symbol is required», in a burst
after every aggregate rebuild, retried forever — while the account held real
trades and standing orders on the listing.

Reading is not executing: this requirement does not move the execution path's
alphabet, and the foreign-contract refusal stays.

#### Scenario: The account traded a unicode listing

- **WHEN** the history window is read with a CJK-ticker contract as the expected symbol
- **THEN** the request is issued and its rows are admitted, symbol intact

#### Scenario: A foreign row against a unicode expectation

- **WHEN** a page row names a contract other than the expected unicode listing
- **THEN** the read is refused as `FOREIGN_TRADE_SYMBOL`, exactly as for ASCII contracts

#### Scenario: An amount offered as a symbol

- **WHEN** a symbol field holds a decimal, lowercase remainder after canonicalization, or empty text
- **THEN** it is refused exactly as before
