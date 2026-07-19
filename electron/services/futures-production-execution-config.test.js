import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES,
    FUTURES_PRODUCTION_EXECUTION_ENV_KEYS,
    FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
    FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT,
    FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
    captureFuturesProductionExecutionConfig,
    createFuturesProductionApiKeyFingerprint,
    createFuturesProductionCredentialBinding,
} from './futures-production-execution-config.js';

const API_KEY = 'production-key-for-deterministic-fake-only-tests';
const operatorRunbook = readFileSync(
    'docs/futures_phase7_live_operator_runbook.md',
    'utf8',
);

const validEnvironment = () => ({
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ENABLED]: 'true',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.OPERATOR_ACKNOWLEDGEMENT]: (
        FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ACCOUNT_ALIAS]: 'reviewed-account-1',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_KEY_FINGERPRINT]: (
        createFuturesProductionApiKeyFingerprint(API_KEY)
    ),
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS]: 'BTCUSDT,ETHUSDT',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_LEVERAGE]: '2',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_ORDER_NOTIONAL_USDT]: '10',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_DAILY_NOTIONAL_USDT]: '50',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MIN_AVAILABLE_BALANCE_USDT]: '100.00',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS]: '1000',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.KILL_SWITCH_POLICY]: (
        FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY
    ),
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_KEY]: API_KEY,
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_SECRET]: 'fake-production-secret',
    [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.RECOVERY_AUTHORIZATION]: 'r'.repeat(32),
    UNRELATED: 'retained',
});

describe('captureFuturesProductionExecutionConfig', () => {
    it('keeps the operator runbook aligned with the compiled Hedge Isolated 2x profile', () => {
        expect(operatorRunbook).toContain('FUTURES_PRODUCTION_EXECUTION_MAX_LEVERAGE=2');
        expect(operatorRunbook).toContain(
            'ARM LIVE FUTURES HEDGE ISOLATED 2X 10 USDT 50 USDT DAILY',
        );
        expect(operatorRunbook).not.toContain('FUTURES_PRODUCTION_EXECUTION_MAX_LEVERAGE=1');
        expect(operatorRunbook).not.toContain('ARM LIVE FUTURES 1X');
    });

    it('requires the explicit non-environment authorization in addition to every operator gate', () => {
        const environment = validEnvironment();
        const config = captureFuturesProductionExecutionConfig({ environment });

        expect(config).toMatchObject({
            enabled: false,
            configured: true,
            liveAuthorized: false,
            environment: 'production',
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.LIVE_AUTHORIZATION_REJECTED,
            restOrigin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
            credentials: null,
            account: {
                alias: 'reviewed-account-1',
                fingerprint: createFuturesProductionApiKeyFingerprint(API_KEY),
            },
            policy: {
                allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
                maxLeverage: 2,
                maxOrderNotionalUsdt: '10',
                maxDailyNotionalUsdt: '50',
                killSwitchPolicy: FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
            },
        });
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it('enables only the deterministic explicitly authorized composition seam', () => {
        const environment = validEnvironment();
        const config = captureFuturesProductionExecutionConfig({
            environment,
            liveAuthorized: true,
        });
        expect(config).toMatchObject({
            enabled: true,
            configured: true,
            liveAuthorized: true,
            credentials: {
                apiKey: API_KEY,
                apiSecret: 'fake-production-secret',
            },
            recoveryAuthorization: 'r'.repeat(32),
        });
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.policy.allowedSymbols)).toBe(true);
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it.each([
        ['missing', undefined],
        ['case-folded', 'TRUE'],
        ['whitespace', ' true'],
        ['numeric', '1'],
        ['boolean', true],
    ])('defaults disabled for a %s operator flag', (_label, enabled) => {
        const environment = validEnvironment();
        if (enabled === undefined) delete environment[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ENABLED];
        else environment[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ENABLED] = enabled;
        const config = captureFuturesProductionExecutionConfig({
            environment,
            liveAuthorized: true,
        });
        expect(config.code).toBe(FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.DISABLED);
        expect(config.liveAuthorized).toBe(true);
        expect(config.credentials).toBeNull();
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it('requires the exact acknowledgement without trimming or aliases', () => {
        for (const acknowledgement of [
            undefined,
            'I_UNDERSTAND_REAL_FUTURES',
            ` ${FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT}`,
            FUTURES_PRODUCTION_EXECUTION_OPERATOR_ACKNOWLEDGEMENT.toLowerCase(),
        ]) {
            const environment = validEnvironment();
            if (acknowledgement === undefined) {
                delete environment[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.OPERATOR_ACKNOWLEDGEMENT];
            } else {
                environment[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.OPERATOR_ACKNOWLEDGEMENT] = acknowledgement;
            }
            const config = captureFuturesProductionExecutionConfig({
                environment,
                liveAuthorized: true,
            });
            expect(config.code).toBe(
                FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.ACKNOWLEDGEMENT_REJECTED,
            );
        }
    });

    it.each([
        ['duplicate symbols', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS, 'BTCUSDT,BTCUSDT'],
        ['lowercase symbol', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.ALLOWED_SYMBOLS, 'btcusdt'],
        ['leverage below compiled profile', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_LEVERAGE, '1'],
        ['leverage above ceiling', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_LEVERAGE, '3'],
        ['order cap above ceiling', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_ORDER_NOTIONAL_USDT, '10.000000000000000001'],
        ['daily cap above ceiling', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_DAILY_NOTIONAL_USDT, '50.000000000000000001'],
        ['order cap above daily cap', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MAX_DAILY_NOTIONAL_USDT, '9'],
        ['zero balance', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MIN_AVAILABLE_BALANCE_USDT, '0'],
        ['liquidation below floor', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.MIN_LIQUIDATION_DISTANCE_BPS, '999'],
        ['kill policy alias', FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.KILL_SWITCH_POLICY, 'persistent'],
    ])('fails closed for %s', (_label, key, value) => {
        const environment = validEnvironment();
        environment[key] = value;
        const config = captureFuturesProductionExecutionConfig({
            environment,
            liveAuthorized: true,
        });
        expect(config.code).toBe(FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.CONFIG_REJECTED);
        expect(config.enabled).toBe(false);
    });

    it('requires the configured full API-key fingerprint to match the captured key', () => {
        const environment = validEnvironment();
        environment[FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_KEY_FINGERPRINT] = 'a'.repeat(64);
        const config = captureFuturesProductionExecutionConfig({
            environment,
            liveAuthorized: true,
        });
        expect(config.code).toBe(FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.ACCOUNT_REJECTED);
    });

    it.each([
        [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_KEY, ''],
        [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.API_SECRET, 'fake\nsecret'],
        [FUTURES_PRODUCTION_EXECUTION_ENV_KEYS.RECOVERY_AUTHORIZATION, 'too-short'],
    ])('rejects and scrubs malformed secret input %s', (key, value) => {
        const environment = validEnvironment();
        environment[key] = value;
        const config = captureFuturesProductionExecutionConfig({
            environment,
            liveAuthorized: true,
        });
        expect(config.code).toBe(FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.CREDENTIALS_REJECTED);
        expect(config.credentials).toBeNull();
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it.each([
        ['FUTURES_PRODUCTION_EXECUTION_HOST', 'https://example.invalid'],
        ['FUTURES_PRODUCTION_EXECUTION_INTEGRITY_KEY', 'operator-must-not-supply-this'],
        ['FUTURES_PRODUCTION_PROXY', 'https://example.invalid'],
    ])('scrubs and rejects unknown production input %s', (key, value) => {
        const environment = validEnvironment();
        environment[key] = value;
        const config = captureFuturesProductionExecutionConfig({
            environment,
            liveAuthorized: true,
        });
        expect(config.code).toBe(FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.CONFIG_REJECTED);
        expect(config.reason).toBe('unknown-production-config');
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it('force-disables and discards every captured value even with an authorized fake seam', () => {
        const environment = validEnvironment();
        const config = captureFuturesProductionExecutionConfig({
            environment,
            forceDisabled: true,
            liveAuthorized: true,
        });
        expect(config).toMatchObject({
            enabled: false,
            configured: false,
            liveAuthorized: false,
            code: FUTURES_PRODUCTION_EXECUTION_CONFIG_CODES.E2E_DISABLED,
            credentials: null,
            recoveryAuthorization: null,
            account: null,
            policy: null,
        });
        expect(environment).toEqual({ UNRELATED: 'retained' });
    });

    it('creates a stable production-only opaque credential binding', () => {
        const binding = createFuturesProductionCredentialBinding({
            apiKey: API_KEY,
            apiSecret: 'fake-production-secret',
        });
        expect(binding).toMatch(/^[0-9a-f]{64}$/);
        expect(binding).not.toContain(API_KEY);
        expect(binding).toBe(createFuturesProductionCredentialBinding({
            apiKey: API_KEY,
            apiSecret: 'fake-production-secret',
        }));
    });
});
