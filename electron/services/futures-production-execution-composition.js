import fs from 'node:fs/promises';
import fsConstants from 'node:fs';
import path from 'node:path';
import {
    createFuturesProductionCredentialBinding,
} from './futures-production-execution-config.js';
import {
    createFuturesProductionExecutionCoordinator,
} from './futures-production-execution-coordinator.js';
import {
    createFuturesProductionExecutionFacade,
} from './futures-production-execution-facade.js';
import {
    createFuturesProductionExecutionAuditRecord,
    createFuturesProductionExecutionLedger,
} from './futures-production-execution-ledger.js';
import {
    createFuturesProductionExecutionService,
} from './futures-production-execution-service.js';

export const FUTURES_PRODUCTION_LIVE_AUTHORIZED = false;

const KEY_FILE = 'integrity-key.sealed';
const MAX_SEALED_KEY_BYTES = 16 * 1024;
const INITIAL_GLOBAL_FETCH = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
const CAN_ISSUE_FAKE_TRANSPORT_AUTHORIZATION = process.env.NODE_ENV === 'test'
    && process.env.VITEST === 'true';
const fakeTransportAuthorizations = new WeakMap();

const isGlobalFetch = fetchImpl => (
    fetchImpl === INITIAL_GLOBAL_FETCH
    || (typeof globalThis.fetch === 'function' && fetchImpl === globalThis.fetch)
);

export const createFuturesProductionFakeTransportAuthorizationForTests = (fetchImpl) => {
    if (!CAN_ISSUE_FAKE_TRANSPORT_AUTHORIZATION) {
        throw new Error('Production fake transport authorization is available only to tests');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('A deterministic fake fetch is required');
    if (isGlobalFetch(fetchImpl)) {
        throw new TypeError('The process-global fetch cannot be authorized as a production fake');
    }
    const authorization = Object.freeze(Object.create(null));
    fakeTransportAuthorizations.set(authorization, fetchImpl);
    return authorization;
};

const createMemoryLedger = ({ startupFailureCode = null } = {}) => {
    const records = [];
    let opened = false;
    const append = async (input) => {
        if (!opened) throw new Error('memory production ledger is closed');
        const record = createFuturesProductionExecutionAuditRecord(input);
        records.push(record);
        return { sequence: String(records.length), record };
    };
    return Object.freeze({
        open: async () => {
            if (startupFailureCode !== null) {
                const error = new Error('Production durable runtime failed closed');
                error.code = startupFailureCode;
                throw error;
            }
            opened = true;
            if (records.length === 0) {
                await append({
                    eventType: 'kill_switch_transition',
                    category: 'safety',
                    outcome: 'engaged',
                    observedAt: Date.now(),
                    state: 'engaged',
                    code: 'DEFAULT_ENGAGED',
                });
            }
        },
        close: async () => { opened = false; },
        append,
        reserveDailyNotional: async () => { throw new Error('disabled memory runtime'); },
        persistOriginWeightReservation: async () => {
            throw new Error('disabled memory runtime');
        },
        persistRatePause: async () => { throw new Error('disabled memory runtime'); },
        setKillSwitch: async () => { throw new Error('disabled memory runtime'); },
        assertHealthy: async () => ({ healthy: opened }),
        getHealth: () => ({ healthy: opened, opened, poisoned: false, leaseHeld: opened }),
        getRecords: () => [...records],
        getRevision: () => String(records.length),
        findRequest: requestId => (
            [...records].reverse().find(record => record.requestId === requestId) ?? null
        ),
        findClientOrder: clientOrderId => (
            [...records].reverse().find(record => record.clientOrderId === clientOrderId) ?? null
        ),
        getActiveOperations: () => [],
        getReplaySnapshot: () => ({
            healthy: opened,
            killSwitch: 'engaged',
            killSwitchEngaged: true,
            dailyReservations: {},
            lastUtcDay: null,
            lastServerTime: null,
            dispatchTimes: [],
            originWeightReservations: [],
            lastOriginWeightObservedAt: null,
            pauseUntil: 0,
            credentialBinding: null,
            activeOperations: [],
        }),
        getOrderRateState: () => ({
            dispatchTimes: [],
            originWeightReservations: [],
            lastOriginWeightObservedAt: null,
            pauseUntil: 0,
            dailyReservations: {},
            lastUtcDay: null,
            lastServerTime: null,
        }),
    });
};

const ensurePrivateDirectory = async (directory) => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory()
        || (stat.mode & 0o777) !== 0o700
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        throw new Error('unsafe production integrity-key directory');
    }
};

const fsyncDirectory = async (directory) => {
    const handle = await fs.open(
        directory,
        fsConstants.constants.O_RDONLY | (fsConstants.constants.O_DIRECTORY || 0),
    );
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

const loadOrCreateIntegrityKey = async (directory, keyProtection) => {
    if (!keyProtection
        || typeof keyProtection.generate !== 'function'
        || typeof keyProtection.open !== 'function'
        || typeof keyProtection.seal !== 'function') {
        throw new Error('production safeStorage key protection is required');
    }
    await ensurePrivateDirectory(directory);
    const keyPath = path.join(directory, KEY_FILE);
    try {
        const stat = await fs.lstat(keyPath);
        if (!stat.isFile()
            || stat.nlink !== 1
            || (stat.mode & 0o777) !== 0o600
            || stat.size <= 0
            || stat.size > MAX_SEALED_KEY_BYTES
            || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
            throw new Error('unsafe production integrity key');
        }
        const handle = await fs.open(
            keyPath,
            fsConstants.constants.O_RDONLY | (fsConstants.constants.O_NOFOLLOW || 0),
        );
        let sealed;
        try {
            sealed = await handle.readFile();
        } finally {
            await handle.close();
        }
        const key = keyProtection.open(sealed);
        if (!Buffer.isBuffer(key) || key.byteLength !== 32) throw new Error('invalid integrity key');
        return Buffer.from(key);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const key = keyProtection.generate();
        if (!Buffer.isBuffer(key) || key.byteLength !== 32) throw new Error('invalid generated key');
        const sealed = keyProtection.seal(key);
        if (!Buffer.isBuffer(sealed)
            || sealed.byteLength === 0
            || sealed.byteLength > MAX_SEALED_KEY_BYTES) {
            throw new Error('invalid sealed production integrity key');
        }
        const handle = await fs.open(
            keyPath,
            fsConstants.constants.O_CREAT
                | fsConstants.constants.O_EXCL
                | fsConstants.constants.O_WRONLY
                | (fsConstants.constants.O_NOFOLLOW || 0),
            0o600,
        );
        try {
            await handle.writeFile(sealed);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.chmod(keyPath, 0o600);
        await fsyncDirectory(directory);
        return Buffer.from(key);
    }
};

const isFakeAuthorization = (value, candidateFetch) => {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null;
    const ownedFetch = fakeTransportAuthorizations.get(value);
    if (typeof ownedFetch !== 'function' || isGlobalFetch(ownedFetch)) return null;
    if (candidateFetch !== undefined && candidateFetch !== ownedFetch) return null;
    return ownedFetch;
};

export const createFuturesProductionExecutionRuntime = async ({
    config,
    storageDirectory,
    spotCoordinator,
    getSpotAvailableWeight,
    productionExecutor,
    getProductionAvailableWeight,
    keyProtection,
    fetchImpl,
    fakeTransportAuthorization = null,
    startupFailureCode = null,
    onInternalError = () => {},
} = {}) => {
    const memoryLedger = createMemoryLedger({ startupFailureCode });
    const canUseLiveTransport = FUTURES_PRODUCTION_LIVE_AUTHORIZED === true
        && config?.liveAuthorized === true
        && typeof fetchImpl === 'function';
    const authorizedFakeFetch = isFakeAuthorization(fakeTransportAuthorization, fetchImpl);
    const canUseFakeTransport = typeof authorizedFakeFetch === 'function';
    const networkFetch = canUseFakeTransport
        ? authorizedFakeFetch
        : canUseLiveTransport
            ? fetchImpl
            : null;
    const canComposeDurably = Boolean(
        config?.enabled
        && config?.credentials
        && typeof storageDirectory === 'string'
        && path.isAbsolute(storageDirectory)
        && keyProtection
        && networkFetch
        && spotCoordinator
        && typeof productionExecutor === 'function',
    );

    const ledger = canComposeDurably
        ? createFuturesProductionExecutionLedger({
            directory: storageDirectory,
            integrityKey: await loadOrCreateIntegrityKey(storageDirectory, keyProtection),
            secretValues: [
                config.credentials.apiKey,
                config.credentials.apiSecret,
                config.recoveryAuthorization,
            ],
        })
        : memoryLedger;
    const coordinator = createFuturesProductionExecutionCoordinator({
        spotCoordinator,
        getSpotAvailableWeight,
        productionExecutor,
        getProductionAvailableWeight,
        persistOrderReservation: ledger.reserveDailyNotional,
        persistOriginWeightReservation: ledger.persistOriginWeightReservation,
        persistRatePause: ledger.persistRatePause,
    });

    const runtimeConfig = canComposeDurably ? config : Object.freeze({
        ...config,
        enabled: false,
        liveAuthorized: false,
        credentials: null,
        recoveryAuthorization: null,
    });
    const credentialBinding = canComposeDurably
        ? createFuturesProductionCredentialBinding(config.credentials)
        : null;
    const facade = canComposeDurably
        ? createFuturesProductionExecutionFacade({
            ...config.credentials,
            allowedSymbols: config.policy.allowedSymbols,
        }, { fetchImpl: networkFetch })
        : null;
    const service = createFuturesProductionExecutionService({
        config: runtimeConfig,
        credentialBinding,
        ledger,
        facade,
        coordinator,
        onInternalError,
    });
    await service.start();
    return Object.freeze({
        service,
        coordinator,
        durable: canComposeDurably,
        fakeBacked: canUseFakeTransport,
        recoverOperationally: service.recoverOperationally,
    });
};
