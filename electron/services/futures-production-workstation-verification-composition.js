import {
    FuturesProductionWorkstationService,
    readFuturesProductionWorkstationHeldContracts,
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
        heldContracts: readFuturesProductionWorkstationHeldContracts(),
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
    // A test's own answering store; the deterministic runtime itself has none.
    candleStore,
    clock,
    onInternalError,
    onTiming,
    heldContracts,
} = {}) => {
    const service = new FuturesProductionWorkstationService({
        transport,
        ...(candleStore ? { candleStore } : {}),
        ...(clock ? { clock } : {}),
        ...(onInternalError ? { onInternalError } : {}),
        ...(onTiming ? { onTiming } : {}),
        ...(heldContracts === undefined ? {} : { heldContracts }),
    });
    return Object.freeze({ transport, service, close: () => service.stop() });
};
