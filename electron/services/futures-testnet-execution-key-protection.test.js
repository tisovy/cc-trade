import { describe, expect, it, vi } from 'vitest'
import {
    createElectronSafeStorageIntegrityKeyProtection,
} from './futures-testnet-execution-key-protection.js'

const fakeSafeStorage = (backend = 'gnome_libsecret') => ({
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => backend),
    encryptString: vi.fn(value => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn(value => value.toString('utf8').replace(/^sealed:/, '')),
})

describe('Futures testnet safeStorage key protection', () => {
    it('round-trips only a 32-byte key through a non-plaintext backend', () => {
        const safeStorage = fakeSafeStorage()
        const protection = createElectronSafeStorageIntegrityKeyProtection({ safeStorage })
        const key = Buffer.alloc(32, 7)
        const sealed = protection.seal(key)

        expect(sealed.equals(key)).toBe(false)
        expect(protection.open(sealed)).toEqual(key)
        expect(Object.keys(protection).sort()).toEqual(['open', 'seal'])
    })

    it.each([
        [false, 'gnome_libsecret'],
        [true, 'basic_text'],
    ])('fails closed when availability=%s and backend=%s', (available, backend) => {
        const safeStorage = fakeSafeStorage(backend)
        safeStorage.isEncryptionAvailable.mockReturnValue(available)
        expect(() => createElectronSafeStorageIntegrityKeyProtection({ safeStorage })).toThrow()
    })

    it('rejects malformed sealed values and decrypted key material', () => {
        const safeStorage = fakeSafeStorage()
        const protection = createElectronSafeStorageIntegrityKeyProtection({ safeStorage })
        expect(() => protection.open(Buffer.alloc(0))).toThrow()
        safeStorage.decryptString.mockReturnValue('not-base64')
        expect(() => protection.open(Buffer.from('sealed'))).toThrow()
    })
})
