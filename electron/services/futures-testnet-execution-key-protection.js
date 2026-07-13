const SEALED_MAX_BYTES = 16 * 1024

export class FuturesTestnetExecutionKeyProtectionError extends Error {
    constructor(code) {
        super('Futures testnet integrity-key protection is unavailable')
        this.name = 'FuturesTestnetExecutionKeyProtectionError'
        this.code = code
    }
}

const fail = (code) => {
    throw new FuturesTestnetExecutionKeyProtectionError(code)
}

export const createElectronSafeStorageIntegrityKeyProtection = ({ safeStorage } = {}) => {
    if (!safeStorage
        || typeof safeStorage.isEncryptionAvailable !== 'function'
        || typeof safeStorage.encryptString !== 'function'
        || typeof safeStorage.decryptString !== 'function'
        || safeStorage.isEncryptionAvailable() !== true) {
        fail('SAFE_STORAGE_UNAVAILABLE')
    }
    const backend = typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : null
    if (backend === 'basic_text') fail('UNSAFE_STORAGE_BACKEND')

    const seal = (key) => {
        if (!Buffer.isBuffer(key) || key.byteLength !== 32) fail('INVALID_KEY')
        const sealed = safeStorage.encryptString(key.toString('base64'))
        if (!Buffer.isBuffer(sealed)
            || sealed.byteLength === 0
            || sealed.byteLength > SEALED_MAX_BYTES) {
            fail('INVALID_SEALED_KEY')
        }
        return Buffer.from(sealed)
    }

    const open = (sealed) => {
        if (!Buffer.isBuffer(sealed)
            || sealed.byteLength === 0
            || sealed.byteLength > SEALED_MAX_BYTES) {
            fail('INVALID_SEALED_KEY')
        }
        let encoded
        try {
            encoded = safeStorage.decryptString(sealed)
        } catch {
            fail('KEY_DECRYPTION_FAILED')
        }
        if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
            fail('INVALID_KEY')
        }
        const key = Buffer.from(encoded, 'base64')
        if (key.byteLength !== 32 || key.toString('base64') !== encoded) fail('INVALID_KEY')
        return key
    }

    return Object.freeze({ seal, open })
}
