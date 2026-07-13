import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFuturesTestnetExecutionRuntime } from './futures-testnet-execution-composition.js';

const roots = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const disabled = Object.freeze({
    enabled: false,
    code: 'FUTURES_EXECUTION_DISABLED',
    credentials: null,
    policy: null,
});
const enabled = Object.freeze({
    ...disabled,
    enabled: true,
    code: 'FUTURES_EXECUTION_ENABLED',
    credentials: Object.freeze({ apiKey: 'key', apiSecret: 'secret' }),
    policy: Object.freeze({
        allowedSymbols: Object.freeze(['BTCUSDT']),
        maxNotionalUsdt: '100',
        maxLeverage: 3,
        minAvailableBalanceUsdt: '10',
        minLiquidationDistanceBps: '1000',
    }),
});
const keyProtection = Object.freeze({
    seal: key => Buffer.from(key.toString('base64'), 'utf8'),
    open: sealed => Buffer.from(sealed.toString('utf8'), 'base64'),
});
const coordinator = Object.freeze({
    beginPreflight: vi.fn(),
    restoreOrderState: vi.fn(),
});

describe('futures testnet execution composition', () => {
    it('starts a process service without touching durable storage when disabled', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-disabled-'));
        roots.push(root);
        const directory = path.join(root, 'futures-testnet-execution', 'v1');
        const runtime = await createFuturesTestnetExecutionRuntime({
            config: disabled,
            storageDirectory: directory,
            coordinator: null,
        });
        expect(runtime.durable).toBe(false);
        expect(runtime.service.isStarted()).toBe(true);
        await expect(fs.access(directory)).rejects.toThrow();
        await runtime.service.shutdown();
    });

    it('keeps the backend-only recovery method off the renderer projection', async () => {
        const runtime = await createFuturesTestnetExecutionRuntime({ config: disabled });
        expect(typeof runtime.service.recoverTestnetAttempt).toBe('function');
        expect(runtime).not.toHaveProperty('capability');
        expect(runtime).not.toHaveProperty('credentials');
        await runtime.service.shutdown();
    });

    it('fails closed before network when enabled durable composition lacks a coordinator', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-enabled-'));
        roots.push(root);
        const fetchImpl = vi.fn();
        const runtime = await createFuturesTestnetExecutionRuntime({
            config: enabled,
            storageDirectory: path.join(root, 'futures-testnet-execution', 'v1'),
            coordinator: null,
            fetchImpl,
        });
        expect(runtime.durable).toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
        await runtime.service.shutdown();
    });

    it('persists only a sealed owner-only integrity key for durable live and recovery runtimes', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-durable-'));
        roots.push(root);
        const directory = path.join(root, 'futures-testnet-execution', 'v1');
        const runtime = await createFuturesTestnetExecutionRuntime({
            config: enabled,
            storageDirectory: directory,
            coordinator,
            keyProtection,
            fetchImpl: vi.fn(),
        });
        expect(runtime.durable).toBe(true);
        const sealedPath = path.join(directory, 'integrity-key.sealed');
        const sealed = await fs.readFile(sealedPath);
        expect(sealed.byteLength).toBeGreaterThan(32);
        expect((await fs.stat(sealedPath)).mode & 0o777).toBe(0o600);
        await expect(fs.access(path.join(directory, 'integrity.key'))).rejects.toThrow();
        await runtime.service.shutdown();

        const recovery = await createFuturesTestnetExecutionRuntime({
            config: { ...enabled, enabled: false },
            storageDirectory: directory,
            coordinator,
            keyProtection,
            fetchImpl: vi.fn(),
        });
        expect(recovery.durable).toBe(true);
        await recovery.service.shutdown();
    });
});
