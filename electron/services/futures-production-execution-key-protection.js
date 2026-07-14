import { randomBytes } from 'node:crypto';

const SEALED_MAX_BYTES = 16 * 1024;
const KEY_BYTES = 32;
const ENVELOPE_VERSION = 1;
const ENVELOPE_PURPOSE = 'cc-trade/futures-production-execution-integrity/v1';

export class FuturesProductionExecutionKeyProtectionError extends Error {
    constructor(code) {
        super('Futures production integrity-key protection is unavailable');
        this.name = 'FuturesProductionExecutionKeyProtectionError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesProductionExecutionKeyProtectionError(code);
};

const requireSafeStorage = (safeStorage) => {
    if (!safeStorage
        || typeof safeStorage.isEncryptionAvailable !== 'function'
        || typeof safeStorage.encryptString !== 'function'
        || typeof safeStorage.decryptString !== 'function'
        || safeStorage.isEncryptionAvailable() !== true) {
        fail('SAFE_STORAGE_UNAVAILABLE');
    }
    const backend = typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : null;
    if (backend === 'basic_text') fail('UNSAFE_STORAGE_BACKEND');
    return safeStorage;
};

const encodeKey = (key) => JSON.stringify({
    version: ENVELOPE_VERSION,
    purpose: ENVELOPE_PURPOSE,
    key: key.toString('base64'),
});

const decodeKey = (encoded) => {
    let envelope;
    try {
        envelope = JSON.parse(encoded);
    } catch {
        fail('INVALID_KEY_ENVELOPE');
    }
    if (envelope === null
        || typeof envelope !== 'object'
        || Array.isArray(envelope)
        || Object.getPrototypeOf(envelope) !== Object.prototype
        || Reflect.ownKeys(envelope).length !== 3
        || envelope.version !== ENVELOPE_VERSION
        || envelope.purpose !== ENVELOPE_PURPOSE
        || typeof envelope.key !== 'string'
        || !/^[A-Za-z0-9+/]{43}=$/.test(envelope.key)) {
        fail('INVALID_KEY_ENVELOPE');
    }
    const key = Buffer.from(envelope.key, 'base64');
    if (key.byteLength !== KEY_BYTES
        || key.toString('base64') !== envelope.key
        || encoded !== encodeKey(key)) {
        fail('INVALID_KEY_ENVELOPE');
    }
    return key;
};

export const createElectronSafeStorageProductionIntegrityKeyProtection = ({ safeStorage } = {}) => {
    const storage = requireSafeStorage(safeStorage);

    const seal = (key) => {
        if (!Buffer.isBuffer(key) || key.byteLength !== KEY_BYTES) fail('INVALID_KEY');
        let sealed;
        try {
            sealed = storage.encryptString(encodeKey(key));
        } catch {
            fail('KEY_ENCRYPTION_FAILED');
        }
        if (!Buffer.isBuffer(sealed)
            || sealed.byteLength === 0
            || sealed.byteLength > SEALED_MAX_BYTES) {
            fail('INVALID_SEALED_KEY');
        }
        return Buffer.from(sealed);
    };

    const open = (sealed) => {
        if (!Buffer.isBuffer(sealed)
            || sealed.byteLength === 0
            || sealed.byteLength > SEALED_MAX_BYTES) {
            fail('INVALID_SEALED_KEY');
        }
        let encoded;
        try {
            encoded = storage.decryptString(Buffer.from(sealed));
        } catch {
            fail('KEY_DECRYPTION_FAILED');
        }
        if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > 512) {
            fail('INVALID_KEY_ENVELOPE');
        }
        return decodeKey(encoded);
    };

    const generate = () => randomBytes(KEY_BYTES);

    return Object.freeze({ generate, open, seal });
};
