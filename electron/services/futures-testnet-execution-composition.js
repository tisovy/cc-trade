import fs from 'node:fs/promises';
import fsConstants from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
    createFuturesTestnetCredentialBinding,
} from './futures-testnet-execution-config.js';
import {
    createFuturesTestnetExecutionFacade,
} from './futures-testnet-execution-facade.js';
import {
    createFuturesTestnetExecutionLedger,
} from './futures-testnet-execution-ledger.js';
import {
    createFuturesTestnetExecutionReadRequest,
} from './futures-testnet-execution-read-request.js';
import {
    createFuturesTestnetExecutionRiskReader,
} from './futures-testnet-execution-risk-reader.js';
import {
    createFuturesTestnetExecutionService,
} from './futures-testnet-execution-service.js';

const KEY_FILE = 'integrity-key.sealed';
const MAX_SEALED_KEY_BYTES = 16 * 1024;

const createMemoryLedger = () => {
    const records = [];
    return Object.freeze({
        open: async () => {},
        close: async () => {},
        append: async (record) => {
            records.push(record);
            return { record };
        },
        getRecords: () => [...records],
        getRevision: () => String(records.length),
        getLatestAttempt: () => records.at(-1) ?? null,
        findRequest: requestId => (
            [...records].reverse().find(record => record.requestId === requestId) ?? null
        ),
        findClientOrder: clientOrderId => (
            [...records].reverse().find(record => record.clientOrderId === clientOrderId) ?? null
        ),
    });
};

const loadOrCreateIntegrityKey = async (directory, keyProtection) => {
    if (!keyProtection
        || typeof keyProtection.open !== 'function'
        || typeof keyProtection.seal !== 'function') {
        throw new Error('safeStorage key protection is required');
    }
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory()
        || (directoryStat.mode & 0o777) !== 0o700
        || (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid())) {
        throw new Error('unsafe integrity key directory');
    }
    const keyPath = path.join(directory, KEY_FILE);
    try {
        const stat = await fs.lstat(keyPath);
        if (!stat.isFile()
            || stat.nlink !== 1
            || (stat.mode & 0o777) !== 0o600
            || stat.size <= 0
            || stat.size > MAX_SEALED_KEY_BYTES
            || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
            throw new Error('unsafe integrity key');
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
        const key = await keyProtection.open(sealed);
        if (key.byteLength !== 32) throw new Error('invalid integrity key');
        return Buffer.from(key);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const flags = fsConstants.constants.O_CREAT
            | fsConstants.constants.O_EXCL
            | fsConstants.constants.O_WRONLY
            | (fsConstants.constants.O_NOFOLLOW || 0);
        const key = randomBytes(32);
        const sealed = await keyProtection.seal(key);
        if (!Buffer.isBuffer(sealed)
            || sealed.byteLength === 0
            || sealed.byteLength > MAX_SEALED_KEY_BYTES) {
            throw new Error('invalid sealed integrity key');
        }
        const handle = await fs.open(keyPath, flags, 0o600);
        try {
            await handle.writeFile(sealed);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.chmod(keyPath, 0o600);
        const directoryHandle = await fs.open(directory, fsConstants.constants.O_RDONLY);
        try {
            await directoryHandle.sync();
        } finally {
            await directoryHandle.close();
        }
        return key;
    }
};

const hasRecoveryJournal = async (directory) => {
    try {
        const stat = await fs.lstat(path.join(directory, 'journal.bin'));
        return stat.isFile();
    } catch {
        return false;
    }
};

export const createFuturesTestnetExecutionRuntime = async ({
    config,
    storageDirectory,
    coordinator,
    keyProtection,
    fetchImpl = globalThis.fetch,
    onInternalError = () => {},
} = {}) => {
    const credentials = config?.credentials;
    const canRecover = typeof storageDirectory === 'string'
        && path.isAbsolute(storageDirectory)
        && await hasRecoveryJournal(storageDirectory);
    const shouldUseDurableRuntime = Boolean(
        credentials
        && coordinator
        && (config.enabled || canRecover),
    );

    if (!shouldUseDurableRuntime) {
        const runtimeConfig = config?.enabled
            ? Object.freeze({ ...config, enabled: false, code: 'FUTURES_EXECUTION_DISABLED' })
            : config;
        const service = createFuturesTestnetExecutionService({
            config: runtimeConfig,
            credentialBinding: null,
            ledger: createMemoryLedger(),
            reader: null,
            facade: null,
            coordinator: null,
            onInternalError,
        });
        await service.start();
        return Object.freeze({ service, durable: false, coordinator });
    }

    const integrityKey = await loadOrCreateIntegrityKey(storageDirectory, keyProtection);
    const credentialBinding = createFuturesTestnetCredentialBinding(credentials);
    const ledger = createFuturesTestnetExecutionLedger({
        directory: storageDirectory,
        integrityKey,
    });
    const readTransport = createFuturesTestnetExecutionReadRequest({
        ...credentials,
        fetchImpl,
    });
    const allowedSymbols = config.policy?.allowedSymbols ?? [];
    if (allowedSymbols.length === 0) {
        throw new Error('Futures testnet recovery requires the original allowlist');
    }
    const facade = createFuturesTestnetExecutionFacade({
        ...credentials,
        allowedSymbols,
    }, {
        fetchImpl,
        now: readTransport.adjustedNow,
    });
    const reader = createFuturesTestnetExecutionRiskReader({
        request: readTransport.request,
        coordinator,
    });
    const service = createFuturesTestnetExecutionService({
        config,
        credentialBinding,
        ledger,
        reader,
        facade,
        coordinator,
        onInternalError,
    });
    await service.start();
    return Object.freeze({
        service,
        durable: true,
        coordinator,
        recoverTestnetAttempt: service.recoverTestnetAttempt,
    });
};
