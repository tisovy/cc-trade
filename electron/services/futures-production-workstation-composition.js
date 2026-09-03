import {
    FuturesProductionWorkstationService,
    readFuturesProductionWorkstationHeldContracts,
} from './futures-production-workstation-service.js';
import {
    createFuturesProductionWorkstationReviewedTransport,
} from './futures-production-workstation-transport.js';
import { createFuturesWorkstationCandleStore } from './futures-workstation-candle-store.js';

// The normal operator composition is source-pinned to the reviewed public-read
// transport. Safe development and automated verification replace this whole
// composition at build time with the separately named deterministic module.
export const FUTURES_PRODUCTION_WORKSTATION_PUBLIC_READ_AUTHORIZED = true;

// `onInternalError` carries the reason for every fault the desk absorbs without
// resynchronizing — a book that could not bridge, a recovery, a rejected frame.
// Left unwired it defaults to a no-op, which is how the operator came to watch a
// bootstrap fail four times a cycle with nothing in the log saying why.
export const createFuturesProductionWorkstationRuntime = ({ onTiming, onInternalError } = {}) => {
    const transport = createFuturesProductionWorkstationReviewedTransport({ onTiming });
    // The machine's own closed minutes, read over loopback before the exchange
    // is asked (2026-09-03). Off, unreachable or short, the exchange answers as
    // it always did.
    const candleStore = createFuturesWorkstationCandleStore({ onTiming });
    const service = new FuturesProductionWorkstationService({
        transport,
        candleStore,
        onTiming,
        heldContracts: readFuturesProductionWorkstationHeldContracts(),
        ...(onInternalError ? { onInternalError } : {}),
    });
    return Object.freeze({
        mode: 'reviewed-public-read',
        transport,
        service,
        close: () => service.stop(),
    });
};

export const createFuturesProductionWorkstationRuntimeForTest = ({
    transport,
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
