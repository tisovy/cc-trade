import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installFatalRuntimeHandlers } from './fatal-runtime.js';

const host = () => Object.assign(new EventEmitter(), { exit: vi.fn(), exitCode: 0 });
const fixture = (options = {}) => {
    const processHost = host();
    const writeDiagnostic = vi.fn(), recordFault = vi.fn(), exit = vi.fn();
    const dispose = installFatalRuntimeHandlers({ processHost, writeDiagnostic, recordFault, exit, ...options });
    return { processHost, writeDiagnostic, recordFault, exit, dispose };
};

describe('terminal main fault ownership', () => {
    it.each([
        ['uncaughtException', 'UNCAUGHT_EXCEPTION'],
        ['unhandledRejection', 'UNHANDLED_REJECTION'],
    ])('exits on %s with fixed diagnostics and a fallback when the injected Electron exit returns', (event, code) => {
        const f = fixture();
        f.processHost.emit(event, new Error('secret-like-request-data'));
        expect(f.processHost.exitCode).toBe(1);
        expect(f.writeDiagnostic).toHaveBeenCalledExactlyOnceWith({ phase: 'main-runtime', code });
        expect(f.recordFault).toHaveBeenCalledExactlyOnceWith({ phase: 'main-runtime', code });
        expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(f.processHost.exit).toHaveBeenCalledExactlyOnceWith(1);
        f.dispose();
    });

    it('retains the unhandled-rejection origin under strict Node policy', () => {
        const f = fixture();
        f.processHost.emit('uncaughtException', new Error('hidden'), 'unhandledRejection');
        expect(f.recordFault).toHaveBeenCalledWith({ phase: 'main-runtime', code: 'UNHANDLED_REJECTION' });
    });

    it.each(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'TLS'])('does not assume a globally unhandled %s was recovered', code => {
        const f = fixture();
        f.processHost.emit('uncaughtException', Object.assign(new Error(code), { code }));
        expect(f.exit).toHaveBeenCalledOnce();
        expect(JSON.stringify(f.writeDiagnostic.mock.calls)).not.toContain(code);
    });

    it('does not inspect hostile thrown values or invoke string conversion', () => {
        const inspected = vi.fn(() => { throw new Error('do not inspect'); });
        const reason = new Proxy({}, { get: inspected });
        const f = fixture();
        expect(() => f.processHost.emit('unhandledRejection', reason)).not.toThrow();
        expect(inspected).not.toHaveBeenCalled();
        expect(f.exit).toHaveBeenCalledOnce();
    });

    it('still exits when both diagnostic sinks throw', () => {
        const fail = () => { throw new Error('broken diagnostics'); };
        const f = fixture({ writeDiagnostic: fail, recordFault: fail });
        expect(() => f.processHost.emit('uncaughtException', new Error('hidden'))).not.toThrow();
        expect(f.exit).toHaveBeenCalledOnce();
        expect(f.processHost.exit).toHaveBeenCalledOnce();
    });

    it('falls back to Node exit if Electron exit throws', () => {
        const f = fixture({ exit: () => { throw new Error('exit adapter failed'); } });
        expect(() => f.processHost.emit('uncaughtException', null)).toThrow('exit adapter failed');
        expect(f.processHost.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('latches before diagnostics so reentrant or repeated faults cannot repeat exit', () => {
        const f = fixture();
        f.writeDiagnostic.mockImplementation(() => f.processHost.emit('unhandledRejection', 'nested'));
        f.processHost.emit('uncaughtException', 'first');
        f.processHost.emit('uncaughtException', 'later');
        expect(f.writeDiagnostic).toHaveBeenCalledOnce();
        expect(f.exit).toHaveBeenCalledOnce();
        expect(f.processHost.exit).toHaveBeenCalledOnce();
    });

    it('installs once and removes only owned listeners', () => {
        const processHost = host();
        const unrelated = vi.fn();
        processHost.on('uncaughtException', unrelated);
        const dispose = installFatalRuntimeHandlers({ processHost });
        expect(installFatalRuntimeHandlers({ processHost })).toBe(dispose);
        expect(processHost.listenerCount('uncaughtException')).toBe(2);
        expect(processHost.listenerCount('unhandledRejection')).toBe(1);
        expect(processHost.listeners('uncaughtException')[0]).not.toBe(unrelated);
        dispose(); dispose();
        expect(processHost.listeners('uncaughtException')).toEqual([unrelated]);
        expect(processHost.listenerCount('unhandledRejection')).toBe(0);
        const fresh = installFatalRuntimeHandlers({ processHost });
        expect(fresh).not.toBe(dispose);
        dispose(); // stale disposal must not withdraw a new installation
        expect(processHost.listenerCount('unhandledRejection')).toBe(1);
        fresh();
    });

    it('installs in main before executable startup and replaces both continue-running handlers', () => {
        const main = readFileSync(resolve('electron/main.js'), 'utf8');
        expect(main.indexOf('installFatalRuntimeHandlers({')).toBeLessThan(main.indexOf('if (configureLinuxSafeStorageBackend'));
        expect(main).toContain('exit: code => app.exit(code)');
        expect(main).toContain("recordFault: reading => deskDiagnosticRecord?.record('fault', reading)");
        expect(main).not.toMatch(/process\.on\(['"](?:uncaughtException|unhandledRejection)['"]/);
        expect(main).not.toContain("Don't exit - let the app continue running");
        expect(main).toContain("app.on('before-quit'"); // ordinary shutdown still exists
        expect(main).not.toContain('app.relaunch(');
    });
});

// Vite's DOM environment can rewrite import.meta.url to HTTP; children need
// the actual repo file URL, not the test browser's module URL.
const moduleUrl = pathToFileURL(resolve('electron/fatal-runtime.js')).href;
const runChild = (body, flags = [], setup = 'installFatalRuntimeHandlers();') => spawnSync(
    process.execPath,
    [...flags, '--input-type=module', '-e', `
        import { installFatalRuntimeHandlers } from ${JSON.stringify(moduleUrl)};
        ${setup}
        setTimeout(() => process.stdout.write('normal-work-resumed'), 50);
        ${body}
    `],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, env: { NODE_ENV: 'test' } },
);

describe('real isolated process termination (no Electron or exchange)', () => {
    it.each([
        ["setTimeout(() => { throw new Error('fixture-secret'); }, 0);", [], 'UNCAUGHT_EXCEPTION'],
        ["Promise.reject(new Error('fixture-secret'));", [], 'UNHANDLED_REJECTION'],
        ["Promise.reject(new Error('fixture-secret'));", ['--unhandled-rejections=strict'], 'UNHANDLED_REJECTION'],
        ["setTimeout(() => { throw Object.assign(new Error('fixture-secret'), { code: 'ECONNRESET' }); }, 0);", [], 'UNCAUGHT_EXCEPTION'],
    ])('exits before later work for %s', (body, flags, code) => {
        const child = runChild(body, flags);
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(1);
        expect(child.stdout).toBe('');
        expect(child.stderr).toContain(code);
        expect(child.stderr).toContain('Exchange orders may remain active');
        expect(child.stderr).not.toContain('fixture-secret');
    });

    it('still exits when reporting and the Electron exit adapter throw', () => {
        const child = runChild("Promise.reject('fixture-secret');", [], `
            installFatalRuntimeHandlers({
                writeDiagnostic: () => { throw new Error('stderr failed'); },
                recordFault: () => { throw new Error('record failed'); },
                exit: () => { throw new Error('Electron exit failed'); },
            });
        `);
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(1);
        expect(child.stdout).toBe('');
        expect(child.stderr).toBe('');
    });

    it('leaves a locally handled network refusal operational', () => {
        const child = runChild("Promise.reject(Object.assign(new Error('fixture-refusal'), { code: 'ECONNRESET' })).catch(() => {});");
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(0);
        expect(child.stdout).toBe('normal-work-resumed');
        expect(child.stderr).toBe('');
    });
});
