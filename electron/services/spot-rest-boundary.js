// Keep the SDK's signer, pooled agents and big-integer parser, but not its
// lossy HTTP error mapping or hidden GET/DELETE retry loop. This facade is
// installed on the shared REST client, including its public-data consumers.
const UNKNOWN_EXECUTION_CODES = new Set([-1000, -1006, -1007]);

export class SpotRestError extends Error {
    constructor(message, { status = null, exchangeCode = null, transport = 'response',
        indeterminate = true } = {}) {
        super(message);
        this.name = 'SpotRestError';
        this.status = status;
        this.exchangeCode = exchangeCode;
        this.code = exchangeCode;
        this.transport = transport;
        this.indeterminate = indeterminate;
        this.outcomeCertainty = indeterminate ? 'unknown' : 'rejected';
        // Do not attach the original error: Axios config/URL may contain keys
        // and signatures, and a JSON parser's message may contain the body.
    }
}

const numericExchangeCode = (value) => (
    typeof value === 'number' && Number.isSafeInteger(value) && value < 0 ? value : null
);

// The SDK parses large JSON integers as native BigInt. Preserve their exact
// value, but make the owned response safe for renderer frames and persistence.
// Walk in place: market/history bodies need no second full JSON allocation.
const makeJsonSafe = (value, depth = 0) => {
    if (typeof value === 'bigint') return value.toString();
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 64) throw new Error('Excessive response nesting');
    for (const key of Object.keys(value)) value[key] = makeJsonSafe(value[key], depth + 1);
    return value;
};

const checkedResponse = async (response) => {
    const status = Number.isInteger(response?.status) ? response.status : null;
    let data;
    try {
        data = makeJsonSafe(await response.data());
    } catch {
        throw new SpotRestError('Binance Spot returned an unreadable response.', { status });
    }
    const exchangeCode = numericExchangeCode(data?.code);
    const successfulStatus = status !== null && status >= 200 && status < 300;
    if (!successfulStatus || exchangeCode !== null) {
        const indeterminate = status === null || status < 400 || status >= 500
            || status === 409 || UNKNOWN_EXECUTION_CODES.has(exchangeCode)
            || exchangeCode === null;
        const message = typeof data?.msg === 'string' && data.msg.trim()
            ? data.msg.replace(/[\r\n\t]/g, ' ').slice(0, 500)
            : 'Binance Spot did not return a confirmed result.';
        throw new SpotRestError(message, { status, exchangeCode, indeterminate });
    }
    if (data === null || typeof data !== 'object') {
        throw new SpotRestError('Binance Spot returned an invalid response.', { status });
    }
    return { ...response, data: async () => data };
};

export const protectSpotRestApi = (restApi) => {
    if (!restApi?.configuration?.baseOptions) {
        throw new Error('Spot REST configuration is unavailable.');
    }
    restApi.configuration.retries = 0;
    restApi.configuration.baseOptions.validateStatus = () => true;
    // Signed requests must not be followed to another destination, and a
    // redirect must not become a second physical mutation.
    restApi.configuration.baseOptions.maxRedirects = 0;
    const methods = new Map();
    return new Proxy(restApi, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function' || property === 'constructor') return value;
            if (!methods.has(property)) {
                methods.set(property, async (...args) => {
                    let response;
                    try {
                        response = await Reflect.apply(target[property], target, args);
                    } catch (error) {
                        if (error?.name === 'NetworkError') {
                            // The installed SDK has erased the original code.
                            // Do not guess whether this was pre-send or after
                            // acceptance: only a lookup can settle the outcome.
                            throw new SpotRestError('Binance Spot network failure; execution is unconfirmed.', {
                                transport: 'sdk-network-details-unavailable',
                            });
                        }
                        // SDK parameter/signing validation precedes transport.
                        throw error;
                    }
                    return checkedResponse(response);
                });
            }
            return methods.get(property);
        },
    });
};
