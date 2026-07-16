import {
    FuturesProductionWorkstationService,
} from './futures-production-workstation-service.js';
import {
    createFuturesProductionWorkstationReviewedTransport,
} from './futures-production-workstation-transport.js';

// The normal operator composition is source-pinned to the reviewed public-read
// transport. Safe development and automated verification replace this whole
// composition at build time with the separately named deterministic module.
export const FUTURES_PRODUCTION_WORKSTATION_PUBLIC_READ_AUTHORIZED = true;

export const createFuturesProductionWorkstationRuntime = ({ onTiming } = {}) => {
    const transport = createFuturesProductionWorkstationReviewedTransport({ onTiming });
    const service = new FuturesProductionWorkstationService({ transport, onTiming });
    return Object.freeze({
        mode: 'reviewed-public-read',
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
