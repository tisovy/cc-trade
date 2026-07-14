import {
    FuturesProductionWorkstationService,
} from './futures-production-workstation-service.js';
import {
    createFuturesProductionWorkstationFakeTransport,
} from './futures-production-workstation-fake-transport.js';
import {
    createFuturesProductionWorkstationReviewedTransport,
} from './futures-production-workstation-transport.js';

// No real production read was authorized for Phase 8 implementation or
// automated verification. This source interlock is not environment-selectable.
export const FUTURES_PRODUCTION_WORKSTATION_PUBLIC_READ_AUTHORIZED = false;

export const createFuturesProductionWorkstationRuntime = () => {
    const transport = FUTURES_PRODUCTION_WORKSTATION_PUBLIC_READ_AUTHORIZED
        ? createFuturesProductionWorkstationReviewedTransport()
        : createFuturesProductionWorkstationFakeTransport();
    const service = new FuturesProductionWorkstationService({ transport });
    return Object.freeze({
        mode: FUTURES_PRODUCTION_WORKSTATION_PUBLIC_READ_AUTHORIZED
            ? 'reviewed-public-read'
            : 'deterministic-fake',
        transport,
        service,
        close: () => service.stop(),
    });
};

export const createFuturesProductionWorkstationRuntimeForTest = ({
    transport,
    clock,
    onInternalError,
} = {}) => {
    const service = new FuturesProductionWorkstationService({
        transport,
        ...(clock ? { clock } : {}),
        ...(onInternalError ? { onInternalError } : {}),
    });
    return Object.freeze({ transport, service, close: () => service.stop() });
};
