## ADDED Requirements

### Requirement: The desk's budget does not hold spend the exchange has released
Where the desk carries an exchange-observed used-weight sample as a baseline in
its own read budget, that baseline SHALL NOT outlive the exchange interval it
was observed in. The exchange's minute counter resets at the minute boundary;
a baseline observed late in one minute SHALL stop deferring admissions once the
counter has rolled, rather than being carried a full window from the moment of
observation.

The conservative directions SHALL both be kept: the budget never counts less
than locally booked work whose answers have not arrived, and an observed sample
never expires piecemeal beneath the observation that set it.

#### Scenario: The exchange's counter rolls while the baseline stands
- **WHEN** a heavy spend is observed near the end of one exchange minute and a small request arrives early in the next, after the exchange's own counter has reset
- **THEN** the request is admitted against the new interval rather than deferred against the old one

#### Scenario: Locally booked work is still unanswered
- **WHEN** the minute rolls while locally admitted requests have not yet answered
- **THEN** their booked weight is still counted, and only the expired observed baseline is released
