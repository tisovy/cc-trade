import { describe, expect, it, vi } from 'vitest';
import {
    FuturesProductionExecutionKeyProtectionError,
    createElectronSafeStorageProductionIntegrityKeyProtection,
} from './futures-production-execution-key-protection.js';

const fakeSafeStorage = (backend = 'gnome_libsecret') => ({
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => backend),
    encryptString: vi.fn(value => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn(value => value.toString('utf8').replace(/^sealed:/, '')),
});

describe('Futures production safeStorage key protection', () => {
    it('purpose-binds and round-trips only a 32-byte integrity key', () => {
        const safeStorage = fakeSafeStorage();
        const protection = createElectronSafeStorageProductionIntegrityKeyProtection({ safeStorage });
        const key = Buffer.alloc(32, 7);
        const sealed = protection.seal(key);

        expect(sealed.equals(key)).toBe(false);
        expect(safeStorage.encryptString.mock.calls[0][0]).toContain(
            'cc-trade/futures-production-execution-integrity/v1',
        );
        expect(protection.open(sealed)).toEqual(key);
        expect(protection.generate()).toHaveLength(32);
        expect(Object.keys(protection).sort()).toEqual(['generate', 'open', 'seal']);
    });

    it.each([
        [false, 'gnome_libsecret'],
        [true, 'basic_text'],
    ])('fails closed when availability=%s and backend=%s', (available, backend) => {
        const safeStorage = fakeSafeStorage(backend);
        safeStorage.isEncryptionAvailable.mockReturnValue(available);
        expect(() => createElectronSafeStorageProductionIntegrityKeyProtection({ safeStorage }))
            .toThrow(FuturesProductionExecutionKeyProtectionError);
    });

    it('rejects malformed ciphertext, wrong purpose, and invalid plaintext keys', () => {
        const safeStorage = fakeSafeStorage();
        const protection = createElectronSafeStorageProductionIntegrityKeyProtection({ safeStorage });
        expect(() => protection.seal(Buffer.alloc(31))).toThrow();
        expect(() => protection.open(Buffer.alloc(0))).toThrow();
        safeStorage.decryptString.mockReturnValue(JSON.stringify({
            version: 1,
            purpose: 'testnet',
            key: Buffer.alloc(32).toString('base64'),
        }));
        expect(() => protection.open(Buffer.from('sealed'))).toThrow();
        safeStorage.decryptString.mockImplementation(() => { throw new Error('backend details'); });
        expect(() => protection.open(Buffer.from('sealed'))).toThrowError(
            expect.objectContaining({ code: 'KEY_DECRYPTION_FAILED' }),
        );
    });
});
