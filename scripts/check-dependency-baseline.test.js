// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertDependencyBaseline, DEPENDENCY_BASELINE } from './check-dependency-baseline.mjs';

const fixture = () => ({
    lockfileVersion: 3,
    packages: Object.fromEntries(Object.entries(DEPENDENCY_BASELINE)
        .map(([name, version]) => [`node_modules/${name}`, { version }])),
});

describe('local dependency baseline', () => {
    it('accepts every reviewed floor and reports the exact locked inventory', () => {
        expect(assertDependencyBaseline(fixture())).toHaveLength(Object.keys(DEPENDENCY_BASELINE).length);
    });

    it('accepts newer patches and minors of reviewed majors', () => {
        const lock = fixture();
        lock.packages['node_modules/ws'].version = '8.22.0';
        lock.packages['node_modules/electron'].version = '43.6.1';
        expect(() => assertDependencyBaseline(lock)).not.toThrow();
    });

    it.each([
        ['electron', '39.8.10'], ['electron-builder', '26.0.12'],
        ['ws', '8.18.3'], ['vite', '7.2.2'], ['vitest', '4.0.13'],
        ['axios', '1.13.2'], ['tar', '6.2.1'], ['tar', '7.5.18'],
    ])('rejects the old %s version %s', (name, version) => {
        const lock = fixture();
        lock.packages[`node_modules/${name}`].version = version;
        expect(() => assertDependencyBaseline(lock)).toThrow(`node_modules/${name}`);
    });

    it('checks nested copies even when the top-level dependency is fixed', () => {
        const lock = fixture();
        lock.packages['node_modules/parent/node_modules/ws'] = { version: '8.18.3' };
        expect(() => assertDependencyBaseline(lock)).toThrow('node_modules/parent/node_modules/ws');
    });

    it('does not confuse similarly named packages with the reviewed package', () => {
        const lock = fixture();
        lock.packages['node_modules/ws-extra'] = { version: '0.0.1' };
        expect(() => assertDependencyBaseline(lock)).not.toThrow();
    });

    it.each(['44.0.0', '43.6.0-beta.1', '43.6', '^43.6.0', '043.6.0', '9007199254740993.0.0', null])(
        'requires review for unsupported or invalid versions: %s', (version) => {
            const lock = fixture();
            lock.packages['node_modules/electron'].version = version;
            expect(() => assertDependencyBaseline(lock)).toThrow('node_modules/electron');
        },
    );

    it('rejects missing and linked reviewed packages', () => {
        const lock = fixture();
        delete lock.packages['node_modules/electron'];
        expect(() => assertDependencyBaseline(lock)).toThrow('Missing reviewed dependency: electron');
        lock.packages['node_modules/electron'] = { version: '43.6.0', link: true };
        expect(() => assertDependencyBaseline(lock)).toThrow('node_modules/electron');
    });

    it.each([null, {}, { lockfileVersion: 2, packages: {} }, { lockfileVersion: 3, packages: [] }])(
        'rejects a missing or malformed lockfile', (lock) => {
            expect(() => assertDependencyBaseline(lock)).toThrow('Expected npm lockfile v3 packages');
        },
    );
});
