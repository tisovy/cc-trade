import {
    FuturesTestnetWorkstationService,
} from './futures-testnet-workstation-service.js';
import {
    createFuturesTestnetWorkstationFakeTransport,
} from './futures-testnet-workstation-fake-transport.js';

export const FUTURES_TESTNET_WORKSTATION_DETERMINISTIC_VERIFICATION = true;

export const createFuturesTestnetWorkstationRuntime = () => {
    const transport = createFuturesTestnetWorkstationFakeTransport();
    const service = new FuturesTestnetWorkstationService({ transport });
    return Object.freeze({
        mode: 'deterministic-fake',
        transport,
        service,
        close: () => service.stop(),
    });
};

export const createFuturesTestnetWorkstationRuntimeForTest = ({
    transport,
    clock,
    onInternalError,
} = {}) => {
    const service = new FuturesTestnetWorkstationService({
        transport,
        ...(clock ? { clock } : {}),
        ...(onInternalError ? { onInternalError } : {}),
    });
    return Object.freeze({ transport, service, close: () => service.stop() });
};
