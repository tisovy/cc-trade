import {
    FuturesProductionWorkstationService,
} from './futures-production-workstation-service.js';
import {
    createFuturesProductionWorkstationFakeTransport,
} from './futures-production-workstation-fake-transport.js';

export const FUTURES_PRODUCTION_WORKSTATION_DETERMINISTIC_VERIFICATION = true;

export const createFuturesProductionWorkstationRuntime = ({ onTiming, onInternalError } = {}) => {
    const transport = createFuturesProductionWorkstationFakeTransport();
    const service = new FuturesProductionWorkstationService({
        transport,
        onTiming,
        ...(onInternalError ? { onInternalError } : {}),
    });
    return Object.freeze({
        mode: 'deterministic-fake',
        transport,
        service,
        close: () => service.stop(),
    });
};

export const createFuturesProductionWorkstationRuntimeForTest = ({
    transport,
    clock,
    onInternalError,
    onTiming,
    heldContracts,
} = {}) => {
    const service = new FuturesProductionWorkstationService({
        transport,
        ...(clock ? { clock } : {}),
        ...(onInternalError ? { onInternalError } : {}),
        ...(onTiming ? { onTiming } : {}),
        ...(heldContracts === undefined ? {} : { heldContracts }),
    });
    return Object.freeze({ transport, service, close: () => service.stop() });
};
