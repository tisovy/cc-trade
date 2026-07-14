export class FuturesWorkstationFakeTransportError extends Error {
    constructor(code) {
        super('Futures workstation deterministic transport failed');
        this.name = 'FuturesWorkstationFakeTransportError';
        this.code = code;
    }
}

const abortError = () => {
    const error = new FuturesWorkstationFakeTransportError('ABORTED');
    error.name = 'AbortError';
    return error;
};

const throwIfAborted = (signal) => {
    if (signal?.aborted) throw abortError();
};

export const createFuturesWorkstationSystemClock = () => Object.freeze({
    now: () => Date.now(),
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: handle => clearInterval(handle),
});

export const createFuturesWorkstationFakeTransport = ({
    fixture,
    clock = createFuturesWorkstationSystemClock(),
    cycleDelayMs = 750,
} = {}) => {
    if (!fixture?.catalog || !fixture?.symbols
        || typeof clock?.now !== 'function'
        || typeof clock?.setInterval !== 'function'
        || typeof clock?.clearInterval !== 'function'
        || !Number.isSafeInteger(cycleDelayMs)
        || cycleDelayMs < 100
        || cycleDelayMs > 10_000) {
        throw new FuturesWorkstationFakeTransportError('INVALID_FAKE_TRANSPORT_CONFIG');
    }
    const activeIntervals = new Set();

    const readSymbol = (symbol) => {
        const value = fixture.symbols[symbol];
        if (!value) throw new FuturesWorkstationFakeTransportError('SYMBOL_UNAVAILABLE');
        return value;
    };

    return Object.freeze({
        kind: 'deterministic-fake',
        now: () => clock.now(),
        loadExchangeInfo: async ({ signal } = {}) => {
            throwIfAborted(signal);
            return fixture.catalog;
        },
        bootstrap: async ({ symbol, signal } = {}) => {
            throwIfAborted(signal);
            const value = readSymbol(symbol);
            await Promise.resolve();
            throwIfAborted(signal);
            return Object.freeze({
                depthSnapshot: value.depthSnapshot,
                contractKlines: value.contractKlines,
                markKlines: value.markKlines,
                indexKlines: value.indexKlines,
                premiumIndex: value.premiumIndex,
                ticker: value.ticker,
            });
        },
        connect: ({ symbol, interval: selectedInterval, onMessage, onDisconnect, signal } = {}) => {
            throwIfAborted(signal);
            const value = readSymbol(symbol);
            if (typeof onMessage !== 'function' || typeof onDisconnect !== 'function') {
                throw new FuturesWorkstationFakeTransportError('INVALID_FAKE_SUBSCRIBER');
            }
            let closed = false;
            let cycle = 0;
            onMessage(value.streams.bridgeDepth);
            const interval = clock.setInterval(() => {
                if (closed || signal?.aborted) return;
                cycle += 1;
                for (const frame of value.streams.makeCycle(cycle, selectedInterval)) onMessage(frame);
            }, cycleDelayMs);
            activeIntervals.add(interval);
            const close = () => {
                if (closed) return;
                closed = true;
                activeIntervals.delete(interval);
                clock.clearInterval(interval);
            };
            const handleAbort = () => {
                close();
                onDisconnect('ABORTED');
            };
            signal?.addEventListener?.('abort', handleAbort, { once: true });
            return Object.freeze({
                close: () => {
                    signal?.removeEventListener?.('abort', handleAbort);
                    close();
                },
            });
        },
        close: () => {
            for (const interval of activeIntervals) clock.clearInterval(interval);
            activeIntervals.clear();
        },
        getActiveTimerCount: () => activeIntervals.size,
    });
};
