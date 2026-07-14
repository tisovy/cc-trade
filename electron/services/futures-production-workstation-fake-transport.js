import {
    createFuturesWorkstationFakeTransport,
} from './futures-workstation-fake-transport.js';
import {
    FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
} from './futures-production-workstation-fixtures.js';

export const createFuturesProductionWorkstationFakeTransport = ({ clock } = {}) => (
    createFuturesWorkstationFakeTransport({
        fixture: FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ...(clock ? { clock } : {}),
    })
);
