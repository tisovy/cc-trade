import {
    createHash,
    createHmac,
    timingSafeEqual,
} from 'node:crypto';
import {
    compareExactDecimals,
    parsePositiveExactDecimal,
} from './futures-production-execution-decimal.js';

export const FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN = 'https://fapi.binance.com';
export const FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT = (
    'I_UNDERSTAND_REAL_USDT_FUTURES'
);
export const FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY = (
    'v1-persistent-block-new-exposure'
);

export const FUTURES_PRODUCTION_EXECUTION_ENV_KEYS = Object.freeze({
    ENABLED: 'FUTURES_PRODUCTION_EXECUTION_ENABLED',
    OPERATOR_ACKNOWLEDGEMENT: 'FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT',
    ACCOUNT_ALIAS: 'FUTURES_PRODUCTION_EXECUTION_ACCOUNT_ALIAS',
    API_KEY_FINGERPRINT: 'FUTURES_PRODUCTION_EXECUTION_API_KEY_FINGERPRINT',
    ALLOWED_SYMBOLS: 'FUTURES_PRODUCTION_EXECUTION_ALLOWED_SYMBOLS',
    MAX_LEVERAGE: 'FUTURES_PRODUCTION_EXECUTION_MAX_LEVERAGE',
    MAX_ORDER_NOTIONAL_USDT: 'FUTURES_PRODUCTION_EXECUTION_MAX_ORDER_NOTIONAL_USDT',
    MAX_DAILY_NOTIONAL_USDT: 'FUTURES_PRODUCTION_EXECUTION_MAX_DAILY_NOTIONAL_USDT',
    MIN_AVAILABLE_BALANCE_USDT: 'FUTURES_PRODUCTION_EXECUTION_MIN_AVAILABLE_BALANCE_USDT',
    MIN_LIQUIDATION_DISTANCE_BPS: (
        'FUTURES_PRODUCTION_EXECUTION_MIN_LIQUIDATION_DISTANCE_BPS'
    ),
    KILL_SWITCH_POLICY: 'FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY',
    API_KEY: 'FUTURES_PRODUCTION_API_KEY',
    API_SECRET: 'FUTURES_PRODUCTION_API_SECRET',
    RECOVERY_AUTHORIZATION: 'FUTURES_PRODUCTION_RECOVERY_AUTHORIZATION',
});

export const FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES = Object.freeze({
    ENABLED: 'FUTURES_PRODUCTION_EXECUTION_ENABLED',
    DISABLED: 'FUTURES_PRODUCTION_EXECUTION_DISABLED',
    ACKNOWLEDGEMENT_REJECTED: 'FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENT_REJECTED',
    LIVE_AUTHORIZATION_REJECTED: 'FUTURES_PRODUCTION_EXECUTION_LIVE_AUTHORIZATION_REJECTED',
    CREDENTIALS_REJECTED: 'FUTURES_PRODUCTION_EXECUTION_CREDENTIALS_REJECTED',
    ACCOUNT_REJECTED: 'FUTURES_PRODUCTION_EXECUTION_ACCOUNT_REJECTED',
    CONFIG_REJECTED: 'FUTURES_PRODUCTION_EXECUTION_CONFIG_REJECTED',
    E2E_DISABLED: 'FUTURES_PRODUCTION_EXECUTION_E2E_DISABLED',
});

export const FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS = Object.freeze({
    maxLeverage: 1,
    maxOrderNotionalUsdt: '10',
    maxDailyNotionalUsdt: '50',
});

const ENVIRONMENT_KEYS = Object.freeze(Object.values(FUTURES_PRODUCTION_EXECUTION_ENV_KEYS));
const ENVIRONMENT_KEY_SET = new Set(ENVIRONMENT_KEYS);
const MAX_ORDER_NOTIONAL = parsePositiveExactDecimal(
    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxOrderNotionalUsdt,
);
const MAX_DAILY_NOTIONAL = parsePositiveExactDecimal(
    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxDailyNotionalUsdt,
);
const SYMBOLS_PATTERN = /^[A-Z0-9]{2,20}(,[A-Z0-9]{2,20}){0,15}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const ACCOUNT_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const isBoundedVisibleAscii = (value, minimumBytes, maximumBytes) => (
    typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= minimumBytes
    && Buffer.byteLength(value, 'utf8') <= maximumBytes
    && /^[\x21-\x7e]+$/.test(value)
);

const freezeCredentials = (apiKey, apiSecret) => Object.freeze({ apiKey, apiSecret });

const createDisabled = ({
    code,
    reason,
    configured = false,
    liveAuthorized = false,
    account = null,
    policy = null,
} = {}) => Object.freeze({
    environment: 'production',
    enabled: false,
    configured,
    liveAuthorized,
    code,
    reason,
    restOrigin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
    credentials: null,
    recoveryAuthorization: null,
    account,
    policy,
});

const captureAndDelete = (environment) => {
    const captured = Object.create(null);
    const unknownProductionKeys = [];
    for (const key of Object.keys(environment)) {
        if (!key.startsWith('FUTURES_PRODUCTION_')) continue;
        if (!ENVIRONMENT_KEY_SET.has(key)) unknownProductionKeys.push(key);
        captured[key] = environment[key];
        delete environment[key];
    }
    for (const key of ENVIRONMENT_KEYS) {
        if (!Object.hasOwn(captured, key)) {
            captured[key] = Object.hasOwn(environment, key) ? environment[key] : undefined;
        }
        delete environment[key];
    }
    return { captured, unknownProductionKeys };
};

export const createFuturesProductionApiKeyFingerprint = (apiKey) => {
    if (!isBoundedVisibleAscii(apiKey, 1, 128)) return null;
    return createHash('sha256').update(apiKey, 'ascii').digest('hex');
};

const fingerprintsMatch = (configured, actual) => {
    if (!FINGERPRINT_PATTERN.test(configured ?? '')
        || !FINGERPRINT_PATTERN.test(actual ?? '')) return false;
    return timingSafeEqual(Buffer.from(configured, 'hex'), Buffer.from(actual, 'hex'));
};

const parseAccount = (captured, apiKey) => {
    const alias = captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ACCOUNT_ALIAS];
    const fingerprint = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_KEY_FINGERPRINT
    ];
    const actualFingerprint = createFuturesProductionApiKeyFingerprint(apiKey);
    if (typeof alias !== 'string'
        || Buffer.byteLength(alias, 'utf8') > 64
        || !ACCOUNT_ALIAS_PATTERN.test(alias)
        || !fingerprintsMatch(fingerprint, actualFingerprint)) return null;
    return Object.freeze({ alias, fingerprint });
};

const parsePolicy = (captured) => {
    const symbolsText = captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS];
    if (typeof symbolsText !== 'string'
        || Buffer.byteLength(symbolsText, 'utf8') < 2
        || Buffer.byteLength(symbolsText, 'utf8') > 335
        || !SYMBOLS_PATTERN.test(symbolsText)) return null;
    const allowedSymbols = symbolsText.split(',');
    if (new Set(allowedSymbols).size !== allowedSymbols.length) return null;

    const orderText = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_ORDER_NOTIONAL_USDT
    ];
    const dailyText = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_DAILY_NOTIONAL_USDT
    ];
    const balanceText = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MIN_AVAILABLE_BALANCE_USDT
    ];
    let orderMaximum;
    let dailyMaximum;
    try {
        orderMaximum = parsePositiveExactDecimal(orderText);
        dailyMaximum = parsePositiveExactDecimal(dailyText);
        parsePositiveExactDecimal(balanceText);
    } catch {
        return null;
    }
    if (compareExactDecimals(orderMaximum, MAX_ORDER_NOTIONAL) > 0
        || compareExactDecimals(dailyMaximum, MAX_DAILY_NOTIONAL) > 0
        || compareExactDecimals(orderMaximum, dailyMaximum) > 0) return null;

    const leverageText = captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_LEVERAGE];
    if (!/^[1-3]$/.test(leverageText ?? '')) return null;

    const liquidationText = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS
    ];
    if (!/^[1-9][0-9]{3,4}$/.test(liquidationText ?? '')) return null;
    const liquidationBps = BigInt(liquidationText);
    if (liquidationBps < 1000n || liquidationBps > 10000n) return null;

    const killSwitchPolicy = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.KILL_SWITCH_POLICY
    ];
    if (killSwitchPolicy !== FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY) return null;

    return Object.freeze({
        allowedSymbols: Object.freeze([...allowedSymbols]),
        maxLeverage: Number(leverageText),
        maxOrderNotionalUsdt: orderText,
        maxDailyNotionalUsdt: dailyText,
        minAvailableBalanceUsdt: balanceText,
        minLiquidationDistanceBps: liquidationText,
        killSwitchPolicy,
    });
};

export const captureFuturesProductionExecutionConfig = ({
    environment = process.env,
    forceDisabled = false,
    liveAuthorized = false,
} = {}) => {
    const { captured, unknownProductionKeys } = captureAndDelete(environment);
    if (forceDisabled) {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.E2E_DISABLED,
            reason: 'force-disabled',
        });
    }

    if (captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ENABLED] !== 'true') {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.DISABLED,
            liveAuthorized: liveAuthorized === true,
            reason: 'flag-disabled',
        });
    }
    if (captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.OPERATOR_ACKNOWLEDGEMENT]
        !== FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT) {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.ACKNOWLEDGEMENT_REJECTED,
            liveAuthorized: liveAuthorized === true,
            reason: 'operator-acknowledgement-rejected',
        });
    }

    const apiKey = captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_KEY];
    const apiSecret = captured[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_SECRET];
    const recoveryAuthorization = captured[
        FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.RECOVERY_AUTHORIZATION
    ];
    const credentialsAreValid = isBoundedVisibleAscii(apiKey, 1, 128)
        && isBoundedVisibleAscii(apiSecret, 1, 128)
        && isBoundedVisibleAscii(recoveryAuthorization, 32, 128);
    if (!credentialsAreValid) {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.CREDENTIALS_REJECTED,
            liveAuthorized: liveAuthorized === true,
            reason: 'credentials-rejected',
        });
    }

    const account = parseAccount(captured, apiKey);
    if (!account) {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.ACCOUNT_REJECTED,
            liveAuthorized: liveAuthorized === true,
            reason: 'account-identity-rejected',
        });
    }
    const policy = unknownProductionKeys.length === 0 ? parsePolicy(captured) : null;
    if (!policy
        || policy.maxLeverage > FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxLeverage) {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.CONFIG_REJECTED,
            liveAuthorized: liveAuthorized === true,
            reason: unknownProductionKeys.length > 0
                ? 'unknown-production-config'
                : 'invalid-production-config',
            account,
        });
    }
    if (liveAuthorized !== true) {
        return createDisabled({
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.LIVE_AUTHORIZATION_REJECTED,
            reason: 'live-authorization-rejected',
            configured: true,
            account,
            policy,
        });
    }

    return Object.freeze({
        environment: 'production',
        enabled: true,
        configured: true,
        liveAuthorized: true,
        code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.ENABLED,
        reason: null,
        restOrigin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
        credentials: freezeCredentials(apiKey, apiSecret),
        recoveryAuthorization,
        account,
        policy,
    });
};

export const createFuturesProductionCredentialBinding = ({ apiKey, apiSecret }) => (
    createHmac('sha256', apiSecret)
        .update(FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN)
        .update('\0')
        .update(apiKey)
        .digest('hex')
);
