import {
    createFuturesWorkstationFakeTransport,
} from './futures-workstation-fake-transport.js';
import {
    FUTURES_TESTNET_WORKSTATION_FIXTURE,
} from './futures-testnet-workstation-fixtures.js';

export const createFuturesTestnetWorkstationFakeTransport = ({ clock } = {}) => (
    createFuturesWorkstationFakeTransport({
        fixture: FUTURES_TESTNET_WORKSTATION_FIXTURE,
        ...(clock ? { clock } : {}),
    })
);
