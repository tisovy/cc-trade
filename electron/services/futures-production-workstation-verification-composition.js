import {
    FuturesProductionWorkstationService,
} from './futures-production-workstation-service.js';
import {
    createFuturesProductionWorkstationFakeTransport,
} from './futures-production-workstation-fake-transport.js';

export const FUTURES_PRODUCTION_WORKSTATION_DETERMINISTIC_VERIFICATION = true;

export const createFuturesProductionWorkstationRuntime = ({ onTiming } = {}) => {
    const transport = createFuturesProductionWorkstationFakeTransport();
    const service = new FuturesProductionWorkstationService({ transport, onTiming });
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
} = {}) => {
    const service = new FuturesProductionWorkstationService({
        transport,
        ...(clock ? { clock } : {}),
        ...(onInternalError ? { onInternalError } : {}),
        ...(onTiming ? { onTiming } : {}),
    });
    return Object.freeze({ transport, service, close: () => service.stop() });
};
