import { describe, expect, it } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_CONFIG_CODES,
    FUTURES_TESTNET_EXECUTION_ENV_KEYS,
    FUTURES_TESTNET_EXECUTION_REST_ORIGIN,
    captureFuturesTestnetExecutionConfig,
    createFuturesTestnetCredentialBinding,
} from './futures-testnet-execution-config.js';

const validEnvironment = () => ({
    FUTURES_TESTNET_API_KEY: 'demo-key',
    FUTURES_TESTNET_API_SECRET: 'demo-secret',
    [FUTURES_TESTNET_EXECUTION_ENV_KEYS.ENABLED]: 'true',
    [FUTURES_TESTNET_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS]: 'BTCUSDT,ETHUSDT',
    [FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_NOTIONAL_USDT]: '10000',
    [FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_LEVERAGE]: '3',
    [FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS]: '1000',
    [FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_AVAILABLE_BALANCE_USDT]: '10.00',
    UNRELATED: 'retained',
});

describe('captureFuturesTestnetExecutionConfig', () => {
    it('captures an exact testnet gate and deletes every execution value', () => {
        const environment = validEnvironment();
        const config = captureFuturesTestnetExecutionConfig({
            environment,
            futuresReadMode: 'testnet',
        });

        expect(config).toMatchObject({
            enabled: true,
            environment: 'testnet',
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.ENABLED,
            restOrigin: FUTURES_TESTNET_EXECUTION_REST_ORIGIN,
            credentials: { apiKey: 'demo-key', apiSecret: 'demo-secret' },
            policy: {
                allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
                maxNotionalUsdt: '10000',
                maxLeverage: 3,
                minAvailableBalanceUsdt: '10.00',
                minLiquidationDistanceBps: '1000',
            },
        });
        expect(environment).toEqual({ UNRELATED: 'retained' });
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.policy.allowedSymbols)).toBe(true);
    });

    it.each([
        ['missing flag', undefined],
        ['case folded flag', 'TRUE'],
        ['whitespace flag', ' true'],
        ['numeric flag', '1'],
    ])('defaults disabled for %s', (_label, enabled) => {
        const environment = validEnvironment();
        if (enabled === undefined) delete environment.FUTURES_TESTNET_EXECUTION_ENABLED;
        else environment.FUTURES_TESTNET_EXECUTION_ENABLED = enabled;
        const config = captureFuturesTestnetExecutionConfig({ environment, futuresReadMode: 'testnet' });
        expect(config.enabled).toBe(false);
        expect(config.code).toBe(FUTURES_TESTNET_EXECUTION_CONFIG_CODES.DISABLED);
        expect(Object.keys(environment)).toEqual(['UNRELATED']);
    });

    it('rejects mock and production-like read modes without adding another host', () => {
        for (const futuresReadMode of [
            'mock',
            'production',
            '',
            undefined,
            'TESTNET',
            ' testnet',
            'testnet ',
        ]) {
            const config = captureFuturesTestnetExecutionConfig({
                environment: validEnvironment(),
                futuresReadMode,
            });
            expect(config.enabled).toBe(false);
            expect(config.code).toBe(FUTURES_TESTNET_EXECUTION_CONFIG_CODES.ENVIRONMENT_REJECTED);
            expect(config.restOrigin).toBe('https://demo-fapi.binance.com');
        }
    });

    it.each([
        ['empty symbols', FUTURES_TESTNET_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS, ''],
        ['duplicate symbols', FUTURES_TESTNET_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS, 'BTCUSDT,BTCUSDT'],
        ['symbol whitespace', FUTURES_TESTNET_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS, 'BTCUSDT, ETHUSDT'],
        ['notional leading zero', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_NOTIONAL_USDT, '010'],
        ['notional over ceiling', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_NOTIONAL_USDT, '10000.000000000000000001'],
        ['leverage zero', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_LEVERAGE, '0'],
        ['leverage too high', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MAX_LEVERAGE, '4'],
        ['liquidation below floor', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS, '999'],
        ['liquidation leading zero', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS, '01000'],
        ['balance zero', FUTURES_TESTNET_EXECUTION_ENV_KEYS.MIN_AVAILABLE_BALANCE_USDT, '0'],
    ])('fails closed for %s', (_label, key, value) => {
        const environment = validEnvironment();
        environment[key] = value;
        const config = captureFuturesTestnetExecutionConfig({ environment, futuresReadMode: 'testnet' });
        expect(config.enabled).toBe(false);
        expect(config.code).toBe(FUTURES_TESTNET_EXECUTION_CONFIG_CODES.CONFIG_REJECTED);
    });

    it('deletes and rejects unknown execution-prefixed values', () => {
        const environment = validEnvironment();
        environment.FUTURES_TESTNET_EXECUTION_HOST = 'https://example.invalid';
        const config = captureFuturesTestnetExecutionConfig({ environment, futuresReadMode: 'testnet' });
        expect(config.enabled).toBe(false);
        expect(config.reason).toBe('unknown-execution-config');
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it.each([
        ['empty API key', 'FUTURES_TESTNET_API_KEY', ''],
        ['API key control character', 'FUTURES_TESTNET_API_KEY', 'demo\nkey'],
        ['API key non-ASCII text', 'FUTURES_TESTNET_API_KEY', 'demo-é'],
        ['oversized API key', 'FUTURES_TESTNET_API_KEY', 'k'.repeat(129)],
        ['secret whitespace', 'FUTURES_TESTNET_API_SECRET', 'demo secret'],
        ['secret control character', 'FUTURES_TESTNET_API_SECRET', 'demo\rsecret'],
        ['oversized secret', 'FUTURES_TESTNET_API_SECRET', 's'.repeat(129)],
    ])('deletes and rejects %s', (_label, key, value) => {
        const environment = validEnvironment();
        environment[key] = value;
        const config = captureFuturesTestnetExecutionConfig({
            environment,
            futuresReadMode: 'testnet',
        });
        expect(config.enabled).toBe(false);
        expect(config.code).toBe(FUTURES_TESTNET_EXECUTION_CONFIG_CODES.CREDENTIALS_REJECTED);
        expect(config.credentials).toBeNull();
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it('forces E2E disabled and discards credentials even when inherited gate values are valid', () => {
        const environment = validEnvironment();
        const config = captureFuturesTestnetExecutionConfig({
            environment,
            futuresReadMode: 'testnet',
            forceDisabled: true,
        });
        expect(config).toMatchObject({
            enabled: false,
            code: FUTURES_TESTNET_EXECUTION_CONFIG_CODES.E2E_DISABLED,
            credentials: null,
            policy: null,
        });
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it('creates a stable opaque credential binding without returning either credential', () => {
        const binding = createFuturesTestnetCredentialBinding({
            apiKey: 'demo-key',
            apiSecret: 'demo-secret',
        });
        expect(binding).toMatch(/^[0-9a-f]{64}$/);
        expect(binding).not.toContain('demo-key');
        expect(binding).not.toContain('demo-secret');
        expect(binding).toBe(createFuturesTestnetCredentialBinding({
            apiKey: 'demo-key',
            apiSecret: 'demo-secret',
        }));
    });
});
