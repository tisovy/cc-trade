import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FuturesTestnetExecutionLedgerError,
    createFuturesTestnetExecutionCommandDigest,
    createFuturesTestnetExecutionLedger,
} from './futures-testnet-execution-ledger.js';

const roots = [];
const key = Buffer.alloc(32, 7);
const command = (quantity = '0.001') => ({
    action: 'futures.execution.placeOrder',
    version: 1,
    requestId: '0123456789abcdef0123456789abcdef',
    marketType: 'futures',
    environment: 'testnet',
    symbol: 'BTCUSDT',
    side: 'SELL',
    orderType: 'LIMIT',
    quantity,
    price: '70000.0',
    timeInForce: 'GTC',
    positionSide: 'BOTH',
    marginType: 'ISOLATED',
    leverage: 3,
    reduceOnly: true,
    workingType: null,
    priceProtect: false,
    clientOrderId: 'cc6-0123456789abcdef0123456789abcdef',
});

const makeDirectory = async (suffix = 'packaged') => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-phase6-ledger-'));
    roots.push(root);
    return path.join(root, `futures-testnet-execution-${suffix}`, 'v1');
};

const record = (event, state, observedAt = 1783814400000) => ({
    event,
    state,
    observedAt,
    requestId: command().requestId,
    clientOrderId: command().clientOrderId,
    commandDigest: createFuturesTestnetExecutionCommandDigest(command()),
    credentialBinding: 'a'.repeat(64),
    command: command(),
});

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Futures testnet execution ledger', () => {
    it('fsyncs chained records, replays them, and reconstructs dispatch counters', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
        await ledger.append(record('queued', 'queued'));
        await ledger.append(record('dispatch_intent', 'dispatched', 1783814400100));
        expect(ledger.getRevision()).toBe('2');
        expect(ledger.getDispatchTimes()).toEqual([1783814400100]);
        await ledger.close();

        const replay = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await replay.open();
        expect(replay.getRecords()).toHaveLength(2);
        expect(replay.getActiveAttempt()).toMatchObject({ state: 'dispatched' });
        expect(replay.findRequest(command().requestId)).toMatchObject({ event: 'dispatch_intent' });
        expect(replay.findClientOrder(command().clientOrderId)).toMatchObject({ state: 'dispatched' });
        const paths = replay.getPaths();
        expect((await fs.stat(paths.journalPath)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(paths.anchorPath)).mode & 0o777).toBe(0o600);
        await replay.close();
    });

    it('prevents two process owners from acquiring the same lease', async () => {
        const directory = await makeDirectory();
        const first = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        const second = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await first.open();
        await expect(second.open()).rejects.toMatchObject({ code: 'LEASE_UNAVAILABLE' });
        await first.close();
        await expect(second.open()).resolves.toBeUndefined();
        await second.close();
    });

    it('recovers a stale lease through an inode-verified quarantine', async () => {
        const directory = await makeDirectory();
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.writeFile(
            path.join(directory, 'journal.lock'),
            `99999999 ${'a'.repeat(32)}\n`,
            { mode: 0o600 },
        );
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await expect(ledger.open()).resolves.toBeUndefined();
        await ledger.close();
        expect((await fs.readdir(directory)).some(name => name.includes('.stale-'))).toBe(false);
    });

    it('never deletes or acquires a lease replaced during stale-lock recovery', async () => {
        const directory = await makeDirectory();
        const lockPath = path.join(directory, 'journal.lock');
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.writeFile(lockPath, `99999999 ${'a'.repeat(32)}\n`, { mode: 0o600 });
        let replaced = false;
        const racingFs = new Proxy(fs, {
            get(target, property) {
                if (property !== 'rename') return Reflect.get(target, property);
                return async (source, destination) => {
                    if (!replaced && source === lockPath && destination.includes('.stale-')) {
                        replaced = true;
                        await target.unlink(source);
                        await target.writeFile(
                            source,
                            `${process.pid} ${'b'.repeat(32)}\n`,
                            { mode: 0o600 },
                        );
                    }
                    return target.rename(source, destination);
                };
            },
        });
        const ledger = createFuturesTestnetExecutionLedger({
            directory,
            integrityKey: key,
            fsImpl: racingFs,
        });
        await expect(ledger.open()).rejects.toMatchObject({ code: 'LEASE_UNAVAILABLE' });
        const quarantined = (await fs.readdir(directory)).filter(name => name.includes('.stale-'));
        expect(quarantined).toHaveLength(1);
        expect(await fs.readFile(path.join(directory, quarantined[0]), 'utf8'))
            .toContain('b'.repeat(32));
    });

    it('repairs only a provably incomplete trailing frame after the sealed anchor', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(record('queued', 'queued'));
        const { journalPath } = ledger.getPaths();
        await ledger.close();
        const originalSize = (await fs.stat(journalPath)).size;
        await fs.appendFile(journalPath, Buffer.from([0, 1]));

        const replay = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await replay.open();
        expect((await fs.stat(journalPath)).size).toBe(originalSize);
        expect(replay.getRecords()).toHaveLength(1);
        await replay.close();
    });

    it('fails closed on a complete unanchored record rollback', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(record('queued', 'queued'));
        const { anchorPath } = ledger.getPaths();
        const oldAnchor = await fs.readFile(anchorPath);
        await ledger.append(record('dispatch_intent', 'dispatched'));
        await ledger.close();
        await fs.writeFile(anchorPath, oldAnchor, { mode: 0o600 });

        const replay = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await expect(replay.open()).rejects.toMatchObject({ code: 'UNANCHORED_COMPLETE_RECORD' });
    });

    it('fails closed on record HMAC corruption and a wrong integrity key', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(record('queued', 'queued'));
        const { journalPath } = ledger.getPaths();
        await ledger.close();
        const bytes = await fs.readFile(journalPath);
        bytes[8] ^= 1;
        await fs.writeFile(journalPath, bytes, { mode: 0o600 });

        const corrupt = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await expect(corrupt.open()).rejects.toBeInstanceOf(FuturesTestnetExecutionLedgerError);

        const otherDirectory = await makeDirectory('dev');
        const other = createFuturesTestnetExecutionLedger({ directory: otherDirectory, integrityKey: key });
        await other.open();
        await other.append(record('queued', 'queued'));
        await other.close();
        const wrongKey = createFuturesTestnetExecutionLedger({
            directory: otherDirectory,
            integrityKey: Buffer.alloc(32, 8),
        });
        await expect(wrongKey.open()).rejects.toMatchObject({ code: 'CORRUPT_ANCHOR' });
    });

    it('rejects symlinked journal storage', async () => {
        const directory = await makeDirectory();
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const target = path.join(path.dirname(directory), 'outside.bin');
        await fs.writeFile(target, 'outside', { mode: 0o600 });
        await fs.symlink(target, path.join(directory, 'journal.bin'));
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await expect(ledger.open()).rejects.toBeInstanceOf(FuturesTestnetExecutionLedgerError);
    });

    it('rejects an oversized journal before reading it into memory', async () => {
        const directory = await makeDirectory();
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const journalPath = path.join(directory, 'journal.bin');
        await fs.writeFile(journalPath, '', { mode: 0o600 });
        await fs.truncate(journalPath, (16 * 1024 * 1024) + 1);
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await expect(ledger.open()).rejects.toMatchObject({
            code: 'JOURNAL_CAPACITY_EXCEEDED',
        });
    });

    it('keeps development, packaged, and E2E namespaces isolated', async () => {
        const directories = await Promise.all([
            makeDirectory('packaged'),
            makeDirectory('dev'),
            makeDirectory('e2e'),
        ]);
        for (const [index, directory] of directories.entries()) {
            const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
            await ledger.open();
            await ledger.append(record('queued', index === 0 ? 'queued' : 'locally_rejected'));
            await ledger.close();
        }
        expect(new Set(directories).size).toBe(3);
        for (const directory of directories) {
            expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['anchor.json', 'journal.bin']));
        }
    });

    it('uses lexical command values in an unambiguous permanent digest', () => {
        const first = createFuturesTestnetExecutionCommandDigest(command('0.001'));
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(createFuturesTestnetExecutionCommandDigest(command('0.0010'))).not.toBe(first);
        expect(createFuturesTestnetExecutionCommandDigest(command('0.001'))).toBe(first);
    });

    it('marks only proven terminal states as inactive', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(record('queued', 'queued'));
        expect(ledger.getActiveAttempt()).not.toBeNull();
        await ledger.append(record('transition', 'confirmed_filled'));
        expect(ledger.getActiveAttempt()).toBeNull();
        await ledger.close();
    });

    it('serializes concurrent appends and completes every partial journal write', async () => {
        const directory = await makeDirectory();
        const partialWriteFs = new Proxy(fs, {
            get(target, property) {
                if (property !== 'open') return Reflect.get(target, property);
                return async (filePath, ...args) => {
                    const handle = await target.open(filePath, ...args);
                    if (filePath !== path.join(directory, 'journal.bin')) return handle;
                    return new Proxy(handle, {
                        get(handleTarget, handleProperty) {
                            if (handleProperty === 'write') {
                                return (buffer, offset, length, position) => handleTarget.write(
                                    buffer,
                                    offset,
                                    Math.min(length, 7),
                                    position,
                                );
                            }
                            const value = Reflect.get(handleTarget, handleProperty);
                            return typeof value === 'function' ? value.bind(handleTarget) : value;
                        },
                    });
                };
            },
        });
        const ledger = createFuturesTestnetExecutionLedger({
            directory,
            integrityKey: key,
            fsImpl: partialWriteFs,
        });
        await ledger.open();
        await Promise.all([
            ledger.append(record('queued', 'queued', 1783814400000)),
            ledger.append(record('dispatch_intent', 'dispatched', 1783814400100)),
            ledger.append(record('post_unknown', 'result_unknown', 1783814400200)),
        ]);
        expect(ledger.getRevision()).toBe('3');
        await ledger.close();

        const replay = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await replay.open();
        expect(replay.getRecords().map(value => value.event)).toEqual([
            'queued', 'dispatch_intent', 'post_unknown',
        ]);
        await replay.close();
    });

    it('poisons the ledger permanently after an anchor failure', async () => {
        const directory = await makeDirectory();
        let failRename = false;
        const failingFs = new Proxy(fs, {
            get(target, property) {
                if (property !== 'rename') return Reflect.get(target, property);
                return async (...args) => {
                    if (failRename) throw new Error('injected rename failure');
                    return target.rename(...args);
                };
            },
        });
        const ledger = createFuturesTestnetExecutionLedger({
            directory,
            integrityKey: key,
            fsImpl: failingFs,
        });
        await ledger.open();
        failRename = true;
        await expect(ledger.append(record('queued', 'queued'))).rejects.toMatchObject({
            code: 'PERSISTENCE_FAILED',
        });
        await expect(ledger.append(record('queued', 'queued'))).rejects.toMatchObject({
            code: 'LEDGER_FAILED_CLOSED',
        });
        failRename = false;
        await ledger.close();

        const replay = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await expect(replay.open()).rejects.toMatchObject({
            code: 'UNANCHORED_COMPLETE_RECORD',
        });
    });

    it('detects lease replacement before every mutation', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        const { lockPath } = ledger.getPaths();
        await fs.writeFile(lockPath, `${process.pid} ${'f'.repeat(32)}\n`, { mode: 0o600 });

        await expect(ledger.append(record('queued', 'queued'))).rejects.toMatchObject({
            code: 'LEASE_LOST',
        });
        await expect(ledger.append(record('queued', 'queued'))).rejects.toMatchObject({
            code: 'LEDGER_FAILED_CLOSED',
        });
        await ledger.close();
        const quarantinedReplacement = (await fs.readdir(directory))
            .find(name => name.startsWith(`${path.basename(lockPath)}.closed-`));
        expect(quarantinedReplacement).toBeDefined();
        expect(await fs.readFile(path.join(directory, quarantinedReplacement), 'utf8'))
            .toContain('f'.repeat(32));
    });

    it('restores rate state and keeps an older unknown globally active', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesTestnetExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(record('dispatch_intent', 'dispatched', 1783814400100));
        await ledger.append({
            ...record('post_unknown', 'result_unknown', 1783814400200),
            pauseUntil: 1783814700000,
        });
        await ledger.append({
            ...record('locally_rejected', 'locally_rejected', 1783814400300),
            requestId: 'fedcba9876543210fedcba9876543210',
            clientOrderId: 'cc6-fedcba9876543210fedcba9876543210',
        });

        expect(ledger.getOrderRateState()).toEqual({
            dispatchTimes: [1783814400100],
            pauseUntil: 1783814700000,
        });
        expect(ledger.getLatestAttempt()).toMatchObject({ state: 'locally_rejected' });
        expect(ledger.getActiveAttempt()).toMatchObject({
            requestId: command().requestId,
            state: 'result_unknown',
        });
        await ledger.close();
    });
});
