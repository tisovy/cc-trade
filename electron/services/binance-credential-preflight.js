export const BINANCE_CREDENTIAL_PREFLIGHT_VERSION = 2

export const BINANCE_STARTUP_STATES = Object.freeze({
    READY: 'READY',
    CONFIG_ERROR: 'CONFIG_ERROR',
})

export const BINANCE_STARTUP_CODES = Object.freeze({
    READY: 'READY',
    MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
    MISSING_API_KEY: 'MISSING_API_KEY',
    MISSING_API_SECRET: 'MISSING_API_SECRET',
    RETIRED_CREDENTIALS: 'RETIRED_CREDENTIALS',
})

export const BINANCE_MARKETS = Object.freeze({
    SPOT: 'spot',
    FUTURES: 'futures',
})

export const BINANCE_SPOT_CREDENTIAL_FIELDS = Object.freeze(['BK', 'BS'])
export const BINANCE_FUTURES_CREDENTIAL_FIELDS = Object.freeze(['BFK', 'BFS'])
export const BINANCE_SUPPORTED_CREDENTIAL_FIELDS = Object.freeze([
    ...BINANCE_SPOT_CREDENTIAL_FIELDS,
    ...BINANCE_FUTURES_CREDENTIAL_FIELDS,
])

// Spot and USDⓈ-M Futures authenticate with independent key pairs so a key can
// carry only the permissions its market needs. Neither pair is ever a fallback
// for the other: silently signing Futures requests with the Spot key would hide
// exactly the misconfiguration this preflight exists to surface.
const MARKET_CREDENTIALS = Object.freeze([
    Object.freeze({
        market: BINANCE_MARKETS.SPOT,
        label: 'Spot',
        keyField: 'BK',
        secretField: 'BS',
        requiredFields: BINANCE_SPOT_CREDENTIAL_FIELDS,
    }),
    Object.freeze({
        market: BINANCE_MARKETS.FUTURES,
        label: 'Futures',
        keyField: 'BFK',
        secretField: 'BFS',
        requiredFields: BINANCE_FUTURES_CREDENTIAL_FIELDS,
    }),
])

const RETIRED_PREFIXES = Object.freeze([
    'FUTURES_TESTNET_',
    'FUTURES_READ_',
    'FUTURES_PRODUCTION_',
])
const MAX_RETIRED_FIELDS = 16
const ENVIRONMENT_FIELD_PATTERN = /^[A-Z][A-Z0-9_]{0,95}$/

const isConfigured = value => typeof value === 'string' && value.trim().length > 0

const listRetiredFields = (environment) => Object.freeze(
    Object.keys(environment ?? {})
        .filter(name => ENVIRONMENT_FIELD_PATTERN.test(name))
        .filter(name => RETIRED_PREFIXES.some(prefix => name.startsWith(prefix)))
        .sort()
        .slice(0, MAX_RETIRED_FIELDS),
)

const marketErrorMessage = (descriptor, code) => {
    switch (code) {
        case BINANCE_STARTUP_CODES.MISSING_API_KEY:
            return `Binance ${descriptor.label} API key is not configured. `
                + `Set ${descriptor.keyField} and restart the application.`
        case BINANCE_STARTUP_CODES.MISSING_API_SECRET:
            return `Binance ${descriptor.label} API secret is not configured. `
                + `Set ${descriptor.secretField} and restart the application.`
        default:
            return `Binance ${descriptor.label} credentials are not configured. `
                + `Set ${descriptor.keyField} and ${descriptor.secretField}, `
                + 'then restart the application.'
    }
}

const evaluateMarketCredentials = (environment, descriptor) => {
    const hasApiKey = isConfigured(environment?.[descriptor.keyField])
    const hasApiSecret = isConfigured(environment?.[descriptor.secretField])
    const missingFields = Object.freeze([
        ...(!hasApiKey ? [descriptor.keyField] : []),
        ...(!hasApiSecret ? [descriptor.secretField] : []),
    ])

    if (hasApiKey && hasApiSecret) {
        return Object.freeze({
            market: descriptor.market,
            label: descriptor.label,
            state: BINANCE_STARTUP_STATES.READY,
            code: BINANCE_STARTUP_CODES.READY,
            ready: true,
            requiredFields: descriptor.requiredFields,
            missingFields,
            message: `Binance ${descriptor.label} credentials are configured.`,
        })
    }

    const code = hasApiKey
        ? BINANCE_STARTUP_CODES.MISSING_API_SECRET
        : hasApiSecret
            ? BINANCE_STARTUP_CODES.MISSING_API_KEY
            : BINANCE_STARTUP_CODES.MISSING_CREDENTIALS

    return Object.freeze({
        market: descriptor.market,
        label: descriptor.label,
        state: BINANCE_STARTUP_STATES.CONFIG_ERROR,
        code,
        ready: false,
        requiredFields: descriptor.requiredFields,
        missingFields,
        message: marketErrorMessage(descriptor, code),
    })
}

export const evaluateBinanceCredentialPreflight = (environment = process.env) => {
    const [spot, futures] = MARKET_CREDENTIALS
        .map(descriptor => evaluateMarketCredentials(environment, descriptor))
    const markets = Object.freeze({ spot, futures })

    const retiredFields = listRetiredFields(environment)
    const missingFields = Object.freeze([...spot.missingFields, ...futures.missingFields])
    // Ready answers one question only — may any workspace start at all. Every
    // construction gate reads markets.<market>.ready instead.
    const ready = spot.ready || futures.ready

    if (ready) {
        const unavailable = spot.ready ? (futures.ready ? null : futures) : spot
        return Object.freeze({
            version: BINANCE_CREDENTIAL_PREFLIGHT_VERSION,
            state: BINANCE_STARTUP_STATES.READY,
            code: BINANCE_STARTUP_CODES.READY,
            ready: true,
            requiredFields: BINANCE_SUPPORTED_CREDENTIAL_FIELDS,
            missingFields,
            retiredFields,
            markets,
            message: unavailable
                ? unavailable.message
                : 'Binance production credentials are configured.',
            retryable: false,
        })
    }

    const bothPairsAbsent = spot.code === BINANCE_STARTUP_CODES.MISSING_CREDENTIALS
        && futures.code === BINANCE_STARTUP_CODES.MISSING_CREDENTIALS
    const code = bothPairsAbsent && retiredFields.length > 0
        ? BINANCE_STARTUP_CODES.RETIRED_CREDENTIALS
        : bothPairsAbsent
            ? BINANCE_STARTUP_CODES.MISSING_CREDENTIALS
            : spot.code !== BINANCE_STARTUP_CODES.MISSING_CREDENTIALS
                ? spot.code
                : futures.code

    const message = code === BINANCE_STARTUP_CODES.RETIRED_CREDENTIALS
        ? 'Retired Futures credential names were detected. '
            + 'Migrate to BK/BS for Spot and BFK/BFS for Futures, then restart.'
        : bothPairsAbsent
            ? 'Binance credentials are not configured. '
                + 'Set BK/BS for Spot and BFK/BFS for Futures, then restart the application.'
            : `${spot.message} ${futures.message}`

    return Object.freeze({
        version: BINANCE_CREDENTIAL_PREFLIGHT_VERSION,
        state: BINANCE_STARTUP_STATES.CONFIG_ERROR,
        code,
        ready: false,
        requiredFields: BINANCE_SUPPORTED_CREDENTIAL_FIELDS,
        missingFields,
        retiredFields,
        markets,
        message,
        retryable: false,
    })
}

const createMarketEnvelope = market => Object.freeze({
    market: market.market,
    label: market.label,
    state: market.state,
    code: market.code,
    ready: market.ready,
    requiredFields: market.requiredFields,
    missingFields: market.missingFields,
    message: market.message,
})

export const createBinanceStartupEnvelope = (preflight) => Object.freeze({
    type: 'startup_status',
    version: BINANCE_CREDENTIAL_PREFLIGHT_VERSION,
    state: preflight.state,
    code: preflight.code,
    ready: preflight.ready,
    requiredFields: BINANCE_SUPPORTED_CREDENTIAL_FIELDS,
    missingFields: preflight.missingFields,
    retiredFields: preflight.retiredFields,
    markets: Object.freeze({
        spot: createMarketEnvelope(preflight.markets.spot),
        futures: createMarketEnvelope(preflight.markets.futures),
    }),
    message: preflight.message,
    retryable: false,
})
