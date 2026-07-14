import {
    FuturesTestnetWorkstationService,
} from './futures-testnet-workstation-service.js';
import {
    createFuturesTestnetWorkstationFakeTransport,
} from './futures-testnet-workstation-fake-transport.js';
import {
    createFuturesTestnetWorkstationReviewedTransport,
} from './futures-testnet-workstation-transport.js';

// Phase 8 verification is deterministic. Enabling the reviewed public Testnet
// transport is a separate source-reviewed checkpoint, never a renderer option.
export const FUTURES_TESTNET_WORKSTATION_REVIEWED_READ_AUTHORIZED = false;

export const createFuturesTestnetWorkstationRuntime = () => {
    const transport = FUTURES_TESTNET_WORKSTATION_REVIEWED_READ_AUTHORIZED
        ? createFuturesTestnetWorkstationReviewedTransport()
        : createFuturesTestnetWorkstationFakeTransport();
    const service = new FuturesTestnetWorkstationService({ transport });
    return Object.freeze({
        mode: FUTURES_TESTNET_WORKSTATION_REVIEWED_READ_AUTHORIZED
            ? 'reviewed-public-read'
            : 'deterministic-fake',
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
