import { createHmac } from 'node:crypto';
import {
    compareExactDecimals,
    parsePositiveExactDecimal,
} from './futures-testnet-execution-decimal.js';

export const FUTURES_TESTNET_EXECUTION_REST_ORIGIN = 'https://demo-fapi.binance.com';

export const FUTURES_TESTNET_EXECUTION_ENV_KEYS = Object.freeze({
    ENABLED: 'FUTURES_TESTNET_EXECUTION_ENABLED',
    ALLOWED_SYMBOLS: 'FUTURES_TESTNET_EXECUTION_ALLOWED_SYMBOLS',
    MAX_NOTIONAL_USDT: 'FUTURES_TESTNET_EXECUTION_MAX_NOTIONAL_USDT',
    MAX_LEVERAGE: 'FUTURES_TESTNET_EXECUTION_MAX_LEVERAGE',
    MIN_LIQUIDATION_DISTANCE_BPS: 'FUTURES_TESTNET_EXECUTION_MIN_LIQUIDATION_DISTANCE_BPS',
    MIN_AVAILABLE_BALANCE_USDT: 'FUTURES_TESTNET_EXECUTION_MIN_AVAILABLE_BALANCE_USDT',
});

export const FUTURES_TESTNET_EXECUTION_CONFIG_CODES = Object.freeze({
    ENABLED: 'FUTURES_EXECUTION_ENABLED',
    DISABLED: 'FUTURES_EXECUTION_DISABLED',
    ENVIRONMENT_REJECTED: 'FUTURES_EXECUTION_ENVIRONMENT_REJECTED',
    CREDENTIALS_REJECTED: 'FUTURES_EXECUTION_CREDENTIALS_REJECTED',
    CONFIG_REJECTED: 'FUTURES_EXECUTION_CONFIG_REJECTED',
    E2E_DISABLED: 'FUTURES_EXECUTION_E2E_DISABLED',
});

const CREDENTIAL_KEYS = Object.freeze([
    'FUTURES_TESTNET_API_KEY',
    'FUTURES_TESTNET_API_SECRET',
]);
const EXECUTION_KEYS = Object.freeze(Object.values(FUTURES_TESTNET_EXECUTION_ENV_KEYS));
const MAX_NOTIONAL = parsePositiveExactDecimal('10000');
const ALLOWED_SYMBOLS_PATTERN = /^[A-Z0-9]{2,20}(,[A-Z0-9]{2,20}){0,15}$/;

const isBoundedCredentialText = (value) => (
    typeof value === 'string'
    && /^[\x21-\x7e]{1,128}$/.test(value)
    && Buffer.byteLength(value, 'utf8') <= 128
);

const freezeCredentials = (apiKey, apiSecret) => Object.freeze({ apiKey, apiSecret });

const createDisabled = ({ code, credentials = null, policy = null, reason }) => Object.freeze({
    environment: 'testnet',
    enabled: false,
    code,
    reason,
    restOrigin: FUTURES_TESTNET_EXECUTION_REST_ORIGIN,
    credentials,
    policy,
});

const parsePolicy = (captured) => {
    const allowedSymbolsText = captured[FUTURES_TESTNET_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS];
    if (typeof allowedSymbolsText !== 'string'
        || Buffer.byteLength(allowedSymbolsText, 'utf8') < 2
        || Buffer.byteLength(allowedSymbolsText, 'utf8') > 335
        || !ALLOWED_SYMBOLS_PATTERN.test(allowedSymbolsText)) {
        return null;
    }
    const allowedSymbols = allowedSymbolsText.split(',');
    if (new Set(allowedSymbols).size !== allowedSymbols.length) return null;

    const maxNotionalUsdt = captured[FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_NOTIONAL_USDT];
    const minAvailableBalanceUsdt = captured[
        FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_AVAILABLE_BALANCE_USDT
    ];
    let parsedMaximum;
    try {
        parsedMaximum = parsePositiveExactDecimal(maxNotionalUsdt);
        parsePositiveExactDecimal(minAvailableBalanceUsdt);
    } catch {
        return null;
    }
    if (compareExactDecimals(parsedMaximum, MAX_NOTIONAL) > 0) return null;

    const leverageText = captured[FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_LEVERAGE];
    if (!/^[1-3]$/.test(leverageText ?? '')) return null;

    const liquidationText = captured[
        FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS
    ];
    if (!/^[1-9][0-9]{3,4}$/.test(liquidationText ?? '')) return null;
    const liquidationBps = BigInt(liquidationText);
    if (liquidationBps < 1000n || liquidationBps > 10000n) return null;

    return Object.freeze({
        allowedSymbols: Object.freeze([...allowedSymbols]),
        maxNotionalUsdt,
        maxLeverage: Number(leverageText),
        minAvailableBalanceUsdt,
        minLiquidationDistanceBps: liquidationText,
    });
};

const captureAndDelete = (environment) => {
    const captured = Object.create(null);
    const unknownExecutionKeys = [];
    for (const key of Object.keys(environment)) {
        if (!key.startsWith('FUTURES_TESTNET_EXECUTION_')) continue;
        if (!EXECUTION_KEYS.includes(key)) unknownExecutionKeys.push(key);
        captured[key] = environment[key];
        delete environment[key];
    }
    for (const key of CREDENTIAL_KEYS) {
        captured[key] = environment[key];
        delete environment[key];
    }
    return { captured, unknownExecutionKeys };
};

export const captureFuturesTestnetExecutionConfig = ({
    environment = process.env,
    futuresReadMode,
    forceDisabled = false,
} = {}) => {
    const { captured, unknownExecutionKeys } = captureAndDelete(environment);
    const apiKey = captured.FUTURES_TESTNET_API_KEY;
    const apiSecret = captured.FUTURES_TESTNET_API_SECRET;
    const credentials = isBoundedCredentialText(apiKey) && isBoundedCredentialText(apiSecret)
        ? freezeCredentials(apiKey, apiSecret)
        : null;
    const policy = unknownExecutionKeys.length === 0 ? parsePolicy(captured) : null;

    if (forceDisabled) {
        return createDisabled({
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.E2E_DISABLED,
            reason: 'e2e-disabled',
        });
    }
    if (captured[FUTURES_TESTNET_EXECUTION_ENV_KEYS.ENABLED] !== 'true') {
        return createDisabled({
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.DISABLED,
            credentials,
            policy,
            reason: 'flag-disabled',
        });
    }
    if (futuresReadMode !== 'testnet') {
        return createDisabled({
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.ENVIRONMENT_REJECTED,
            credentials,
            reason: 'read-environment-rejected',
        });
    }
    if (!credentials) {
        return createDisabled({
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.CREDENTIALS_REJECTED,
            reason: 'credentials-rejected',
        });
    }
    if (unknownExecutionKeys.length > 0) {
        return createDisabled({
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.CONFIG_REJECTED,
            credentials,
            reason: 'unknown-execution-config',
        });
    }

    if (!policy) {
        return createDisabled({
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.CONFIG_REJECTED,
            credentials,
            reason: 'invalid-execution-config',
        });
    }

    return Object.freeze({
        environment: 'testnet',
        enabled: true,
        code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.ENABLED,
        reason: null,
        restOrigin: FUTURES_TESTNET_EXECUTION_REST_ORIGIN,
        credentials,
        policy,
    });
};

export const createFuturesTestnetCredentialBinding = ({ apiKey, apiSecret }) => (
    createHmac('sha256', apiSecret)
        .update(FUTURES_TESTNET_EXECUTION_REST_ORIGIN)
        .update('\0')
        .update(apiKey)
        .digest('hex')
);
