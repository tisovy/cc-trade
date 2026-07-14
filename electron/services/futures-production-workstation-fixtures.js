import { createFuturesWorkstationFixture } from './futures-workstation-fixture-builder.js';

export const FUTURES_PRODUCTION_WORKSTATION_FIXTURE = createFuturesWorkstationFixture({
    timeOffset: 60_000,
    priceOffsetCents: 2_500n,
});
