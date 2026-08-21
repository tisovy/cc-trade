## ADDED Requirements

### Requirement: Every Futures wallet flow has one additive owner
Each canonical realized-PnL, fill-commission, funding, insurance-clear, or underivable commission-credit entry SHALL contribute to at most one additive owner. Fill-derived realized PnL and gross commission SHALL belong to the position leg and round named by the fill. An income entry with a reliable trade identity SHALL belong to the matching fill/round. Funding, insurance, or credit that cannot be reliably attributed to one leg/round SHALL remain in one contract-level or account-level shared bucket and SHALL NOT be copied into multiple row totals.

#### Scenario: Funding lands on a boundary between sequential rounds
- **WHEN** one funding entry shares the close/open timestamp of two sequential one-way rounds
- **THEN** it contributes once to a deterministic owner or one shared contract bucket, never to both round totals

#### Scenario: Both hedge legs overlap funding
- **WHEN** LONG and SHORT are simultaneously open for a contract when one funding entry occurs and the entry names no leg
- **THEN** the entry remains contract-shared and is not included in full in either leg-owned total

#### Scenario: A rebate names a trade
- **WHEN** an underivable commission credit carries a reliable trade identity matching one round
- **THEN** its signed amount is included once in that round's commission adjustment

#### Scenario: A rebate cannot be attributed
- **WHEN** an underivable commission credit lacks a reliable leg/round identity
- **THEN** it remains visible in a shared bucket rather than being discarded or guessed

#### Scenario: The same income row is read twice
- **WHEN** stream, tail read, and verification deliver the same canonical income identity
- **THEN** the ledger and every aggregate include it once

### Requirement: Wallet Net states component completeness
A per-position or per-round value SHALL be called wallet Net only when its trade, gross commission, and relevant income coverage are each complete for the stated interval and asset. Otherwise the surface SHALL report a qualified visible net or unknown result and SHALL identify the missing components. A non-USDT component SHALL remain denominated in its own asset and SHALL NOT be silently included in a USDT total.

#### Scenario: Opening commission is outside the fill window
- **WHEN** a closed round has a visible closing commission but its opening fill/commission is not covered
- **THEN** the row does not call the partial result the amount that reached the wallet and identifies trade/commission coverage as incomplete

#### Scenario: Income coverage stops before close
- **WHEN** a round closes after the newest fully covered income instant
- **THEN** its income component and wallet Net remain incomplete

#### Scenario: All components are covered
- **WHEN** trade, gross commission, and relevant income cover the entire resolved round in one asset
- **THEN** the row may state an exact wallet Net equal to those signed components

#### Scenario: Commission is paid in BNB
- **WHEN** a round has a BNB commission component and USDT realized PnL
- **THEN** USDT Net excludes the BNB amount and the BNB amount remains explicitly visible in its own denomination

### Requirement: Displayed Futures money conserves the canonical ledger
For any selected account scope and covered interval, the sum of leg/round-owned components plus each shared bucket exactly once SHALL equal the canonical ledger for that scope, asset, and interval. The application SHALL test this invariant independently of presentation order, timestamp ties, hedge overlap, and duplicate delivery.

#### Scenario: Two rounds share one contract adjustment
- **WHEN** two resolved rounds and one unallocated contract adjustment are displayed
- **THEN** the two owned results plus the adjustment equal the ledger and summing visible additive figures does not duplicate the adjustment

#### Scenario: Open and closed ownership meet at a boundary
- **WHEN** a position closes and another opens at the same timestamp
- **THEN** every fill and income identity belongs to exactly one owned/shared component across the boundary
