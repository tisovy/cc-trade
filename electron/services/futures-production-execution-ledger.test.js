import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS,
    FuturesProductionExecutionLedgerError,
    addFuturesProductionExactDecimals,
    compareFuturesProductionExactDecimals,
    createFuturesProductionExecutionAuditRecord,
    createFuturesProductionExecutionLedger,
    replayFuturesProductionExecutionAudit,
} from './futures-production-execution-ledger.js';

const roots = [];
const key = Buffer.alloc(32, 7);
const dayOne = Date.UTC(2026, 6, 13, 23, 59, 59, 900);
const dayTwo = Date.UTC(2026, 6, 14, 0, 0, 0, 0);

const makeDirectory = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-phase7-ledger-'));
    roots.push(root);
    return path.join(root, 'futures-production-execution', 'v1');
};

const audit = (overrides = {}) => ({
    eventType: 'received_command',
    category: 'command',
    outcome: 'received',
    observedAt: dayOne,
    requestId: '0123456789abcdef0123456789abcdef',
    operationId: 'prod-operation-1',
    commandDigest: 'a'.repeat(64),
    action: 'futures.production.placeOrder',
    accountAlias: 'production-main',
    accountFingerprint: 'b'.repeat(64),
    credentialBinding: 'c'.repeat(64),
    symbol: 'BTCUSDT',
    state: 'pending',
    safeDetail: 'fixed-safe-detail',
    ...overrides,
});

afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('Futures production execution ledger', () => {
    it('creates owner-only storage and durably defaults the kill switch to engaged', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({
            directory,
            integrityKey: key,
            now: () => dayOne,
        });
        await ledger.open();

        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
        expect(ledger.getRevision()).toBe('1');
        expect(ledger.getReplaySnapshot()).toMatchObject({
            healthy: true,
            killSwitch: 'engaged',
            killSwitchEngaged: true,
        });
        const paths = ledger.getPaths();
        expect((await fs.stat(paths.journalPath)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(paths.anchorPath)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(paths.lockPath)).mode & 0o777).toBe(0o600);
        await ledger.close();

        const replay = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await replay.open();
        expect(replay.getRevision()).toBe('1');
        expect(replay.getReplaySnapshot().killSwitchEngaged).toBe(true);
        await replay.close();
    });

    it('persists explicit kill-switch transitions without treating them as exchange actions', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(audit({
            eventType: 'intent_consumed',
            category: 'intent',
            outcome: 'accepted',
            requestId: 'arm-live-request',
            operationId: 'arm-live-request',
            intentId: 'arm-live-request',
            action: 'futures.production.disengageKillSwitch',
            commandDigest: 'd'.repeat(64),
            state: 'consumed',
        }));
        expect(ledger.getActiveOperations()).toHaveLength(1);
        await ledger.setKillSwitch({
            engaged: false,
            observedAt: dayOne,
            requestId: 'arm-live-request',
            operationId: 'arm-live-request',
            intentId: 'arm-live-request',
            action: 'futures.production.disengageKillSwitch',
            commandDigest: 'd'.repeat(64),
            code: 'FUTURES_PRODUCTION_LIVE_ARMED',
        });
        expect(ledger.getReplaySnapshot().killSwitch).toBe('disengaged');
        expect(ledger.getActiveOperations()).toHaveLength(1);
        await ledger.append(audit({
            eventType: 'acknowledgement',
            category: 'safety',
            outcome: 'accepted',
            requestId: 'arm-live-request',
            operationId: 'arm-live-request',
            action: 'futures.production.disengageKillSwitch',
            commandDigest: 'd'.repeat(64),
            state: 'kill_switch_disengaged',
            code: 'FUTURES_PRODUCTION_LIVE_ARMED',
        }));
        expect(ledger.getActiveOperations()).toEqual([]);
        await ledger.setKillSwitch({
            engaged: true,
            observedAt: dayOne + 1,
            action: 'futures.production.engageKillSwitch',
            code: 'OPERATOR_ENGAGED',
        });
        expect(ledger.getReplaySnapshot().killSwitch).toBe('engaged');
        expect(ledger.getRecords().filter(value => value.eventType === 'exchange_request'))
            .toHaveLength(0);
        await ledger.close();
    });

    it('uses exact arithmetic and accepts equality while rejecting one unit over', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.reserveDailyNotional({
            utcDay: '2026-07-13',
            serverTime: dayOne,
            exactNotional: '99.99999999',
            maximumDailyNotional: '100',
            dispatchAt: dayOne,
            requestId: 'request-one',
            operationId: 'operation-one',
            action: 'futures.production.placeOrder',
            credentialBinding: 'c'.repeat(64),
        });
        const equality = await ledger.reserveDailyNotional({
            utcDay: '2026-07-13',
            serverTime: dayOne,
            exactNotional: '0.00000001',
            maximumDailyNotional: '100.00000000',
            dispatchAt: dayOne + 1,
            requestId: 'request-two',
            operationId: 'operation-two',
            action: 'futures.production.placeOrder',
            credentialBinding: 'c'.repeat(64),
        });
        expect(equality).toMatchObject({ reserved: '100', remaining: '0' });
        await expect(ledger.reserveDailyNotional({
            utcDay: '2026-07-13',
            serverTime: dayOne,
            exactNotional: '0.00000001',
            maximumDailyNotional: '100',
            dispatchAt: dayOne + 2,
        })).rejects.toMatchObject({ code: 'DAILY_NOTIONAL_EXCEEDED' });
        expect(ledger.getReplaySnapshot().dailyReservations).toEqual({ '2026-07-13': '100' });
        await ledger.close();
    });

    it('persists a verified reducing dispatch without increasing the daily exposure counter', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.reserveDailyNotional({
            utcDay: '2026-07-13',
            serverTime: dayOne,
            exactNotional: '0',
            maximumDailyNotional: '100',
            dispatchAt: dayOne,
            requestId: 'reducing-exit',
            operationId: 'reducing-exit',
            action: 'futures.production.placeOrder',
            positionEffect: 'EXIT',
        });
        expect(ledger.getReplaySnapshot()).toMatchObject({
            dailyReservations: { '2026-07-13': '0' },
            dispatchTimes: [dayOne],
        });
        await expect(ledger.reserveDailyNotional({
            utcDay: '2026-07-13',
            serverTime: dayOne,
            exactNotional: '0',
            maximumDailyNotional: '100',
            dispatchAt: dayOne + 1,
            requestId: 'invalid-zero-entry',
            positionEffect: 'ENTRY',
        })).rejects.toMatchObject({ code: 'INVALID_DAILY_RESERVATION' });
        await ledger.close();
    });

    it('serializes concurrent gross reservations and never refunds rejected capacity', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        const reservations = await Promise.allSettled([
            ledger.reserveDailyNotional({
                utcDay: '2026-07-13', serverTime: dayOne, exactNotional: '60',
                maximumDailyNotional: '100', dispatchAt: dayOne,
                requestId: 'concurrent-one', operationId: 'concurrent-operation-one',
            }),
            ledger.reserveDailyNotional({
                utcDay: '2026-07-13', serverTime: dayOne, exactNotional: '60',
                maximumDailyNotional: '100', dispatchAt: dayOne + 1,
                requestId: 'concurrent-two', operationId: 'concurrent-operation-two',
            }),
        ]);
        expect(reservations.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(ledger.getReplaySnapshot().dailyReservations).toEqual({ '2026-07-13': '60' });
        await ledger.append(audit({
            eventType: 'exchange_response',
            category: 'exchange',
            outcome: 'rejected',
            observedAt: dayOne + 2,
            state: 'exchange_rejected',
        }));
        expect(ledger.getReplaySnapshot().dailyReservations).toEqual({ '2026-07-13': '60' });
        await ledger.close();
    });

    it('rolls over only at canonical UTC midnight and fails closed on regression', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.reserveDailyNotional({
            utcDay: '2026-07-13', serverTime: dayOne, exactNotional: '10',
            maximumDailyNotional: '10', dispatchAt: dayOne,
            requestId: 'rollover-one', operationId: 'rollover-operation-one',
        });
        await ledger.reserveDailyNotional({
            utcDay: '2026-07-14', serverTime: dayTwo, exactNotional: '10',
            maximumDailyNotional: '10', dispatchAt: dayTwo,
            requestId: 'rollover-two', operationId: 'rollover-operation-two',
        });
        expect(ledger.getReplaySnapshot({ serverTime: dayTwo })).toMatchObject({
            dailyReservations: { '2026-07-13': '10', '2026-07-14': '10' },
            lastUtcDay: '2026-07-14',
            lastServerTime: dayTwo,
        });
        await expect(ledger.reserveDailyNotional({
            utcDay: '2026-07-13', serverTime: dayOne, exactNotional: '1',
            maximumDailyNotional: '100', dispatchAt: dayTwo + 1,
        })).rejects.toMatchObject({ code: 'CLOCK_REGRESSED' });
        await ledger.close();
    });

    it('does not double-count matching reservation and dispatch-intent audit records', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.reserveDailyNotional({
            utcDay: '2026-07-13',
            serverTime: dayOne,
            exactNotional: '1',
            maximumDailyNotional: '10',
            dispatchAt: dayOne,
            requestId: 'dedupe-request',
            operationId: 'dedupe-operation',
        });
        await ledger.append(audit({
            eventType: 'dispatch_intent',
            category: 'dispatch',
            outcome: 'pending',
            requestId: 'dedupe-request',
            operationId: 'dedupe-operation',
            dispatchAt: dayOne,
            state: 'dispatched',
        }));
        expect(ledger.getOrderRateState().dispatchTimes).toEqual([dayOne]);
        expect(ledger.getReplaySnapshot().dailyReservations).toEqual({ '2026-07-13': '1' });
        await ledger.close();
    });

    it('replays dispatch counters, pauses, active unknown operations, and credential binding', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.reserveDailyNotional({
            utcDay: '2026-07-13', serverTime: dayOne, exactNotional: '1',
            maximumDailyNotional: '10', dispatchAt: dayOne,
            requestId: 'request-active', operationId: 'operation-active',
            clientOrderId: 'cc7-order-active', credentialBinding: 'c'.repeat(64),
            action: 'futures.production.placeOrder', symbol: 'BTCUSDT', side: 'BUY',
            orderType: 'LIMIT', timeInForce: 'GTC', quantity: '0.001', price: '70000',
            reduceOnly: false, commandDigest: 'd'.repeat(64),
        });
        await ledger.append(audit({
            eventType: 'response_classified',
            category: 'exchange',
            outcome: 'unknown',
            requestId: 'request-active',
            operationId: 'operation-active',
            clientOrderId: 'cc7-order-active',
            state: 'result_unknown',
        }));
        await ledger.persistRatePause({ pauseUntil: dayOne + 30_000, observedAt: dayOne });
        const state = ledger.getOrderRateState();
        expect(state).toMatchObject({
            dispatchTimes: [dayOne],
            pauseUntil: dayOne + 30_000,
            dailyReservations: { '2026-07-13': '1' },
        });
        expect(ledger.findRequest('request-active')).toMatchObject({ outcome: 'unknown' });
        expect(ledger.findClientOrder('cc7-order-active')).toMatchObject({ outcome: 'unknown' });
        expect(ledger.getActiveOperations()).toEqual([
            expect.objectContaining({
                operationId: 'operation-active',
                state: 'result_unknown',
                dispatchAt: dayOne,
                action: 'futures.production.placeOrder',
                quantity: '0.001',
            }),
        ]);
        await ledger.append(audit({
            eventType: 'received_command',
            category: 'command',
            outcome: 'received',
            requestId: 'request-active',
            operationId: 'operation-active',
            state: 'received',
        }));
        expect(ledger.getActiveOperations()).toEqual([
            expect.objectContaining({ state: 'result_unknown', dispatchAt: dayOne }),
        ]);
        await ledger.append(audit({
            eventType: 'reconciliation_result',
            category: 'reconciliation',
            outcome: 'confirmed',
            requestId: 'request-active',
            operationId: 'operation-active',
            exchangeOrderId: '9223372036854775807',
            state: 'confirmed_open',
        }));
        expect(ledger.getActiveOperations()).toEqual([
            expect.objectContaining({
                state: 'confirmed_open',
                dispatchAt: dayOne,
                clientOrderId: 'cc7-order-active',
                exchangeOrderId: '9223372036854775807',
            }),
        ]);
        await ledger.append(audit({
            eventType: 'reconciliation_result',
            category: 'reconciliation',
            outcome: 'confirmed',
            requestId: 'request-active',
            operationId: 'operation-active',
            state: 'confirmed_filled',
        }));
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(ledger.getReplaySnapshot().credentialBinding).toBe('c'.repeat(64));
        await ledger.close();
    });

    it('fsyncs and exactly replays bounded production-origin weight reservations', async () => {
        const directory = await makeDirectory();
        let localNow = dayOne + 2;
        const ledger = createFuturesProductionExecutionLedger({
            directory,
            integrityKey: key,
            now: () => localNow,
        });
        await ledger.open();
        await ledger.persistOriginWeightReservation({
            observedAt: dayOne,
            requestWeight: 26,
            endpointId: 'exchange-info',
        });
        await ledger.persistOriginWeightReservation({
            observedAt: dayOne + 1,
            requestWeight: FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRequestWeight,
            endpointId: 'query-order',
        });
        expect(ledger.getOrderRateState()).toMatchObject({
            originWeightReservations: [
                { observedAt: dayOne, requestWeight: 26 },
                {
                    observedAt: dayOne + 1,
                    requestWeight: FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRequestWeight,
                },
            ],
            lastOriginWeightObservedAt: dayOne + 1,
        });
        expect(ledger.getRecords().filter(record => record.eventType === 'rate_counter'))
            .toEqual([
                expect.objectContaining({
                    category: 'rate',
                    outcome: 'accepted',
                    observedAt: dayOne,
                    requestWeight: 26,
                    state: 'reserved',
                }),
                expect.objectContaining({
                    observedAt: dayOne + 1,
                    requestWeight: FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRequestWeight,
                }),
            ]);
        await ledger.close();

        localNow = dayOne + 3;
        const replay = createFuturesProductionExecutionLedger({
            directory,
            integrityKey: key,
            now: () => localNow,
        });
        await replay.open();
        expect(replay.getOrderRateState()).toMatchObject({
            originWeightReservations: [
                { observedAt: dayOne, requestWeight: 26 },
                {
                    observedAt: dayOne + 1,
                    requestWeight: FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRequestWeight,
                },
            ],
            lastOriginWeightObservedAt: dayOne + 1,
        });
        await replay.close();
    });

    it('fails closed for invalid, regressed, future, and corrupted origin-weight records', async () => {
        const validRateRecord = {
            eventType: 'rate_counter',
            category: 'rate',
            outcome: 'accepted',
            observedAt: dayOne,
            requestWeight: 1,
            endpointId: 'server-time',
            state: 'reserved',
        };
        for (const requestWeight of [
            undefined,
            0,
            -1,
            1.5,
            FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRequestWeight + 1,
        ]) {
            expect(() => createFuturesProductionExecutionAuditRecord({
                ...validRateRecord,
                requestWeight,
            })).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_RECORD' }));
        }
        expect(() => createFuturesProductionExecutionAuditRecord(audit({ requestWeight: 1 })))
            .toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_RECORD' }));
        expect(() => createFuturesProductionExecutionAuditRecord({
            ...validRateRecord,
            endpointId: null,
        })).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_RECORD' }));
        for (const endpointId of [
            'user-data-stream-start',
            'user-data-stream-keepalive',
            'user-data-stream-close',
            'all-symbol-config',
            'all-open-orders',
            'all-open-algo-orders',
        ]) {
            expect(createFuturesProductionExecutionAuditRecord({
                ...validRateRecord,
                endpointId,
            })).toMatchObject({ endpointId, requestWeight: 1 });
        }
        expect(() => createFuturesProductionExecutionAuditRecord({
            ...validRateRecord,
            endpointId: 'caller-controlled-endpoint',
        })).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_RECORD' }));
        expect(() => createFuturesProductionExecutionAuditRecord({
            ...validRateRecord,
            state: null,
        })).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_RECORD' }));
        expect(() => replayFuturesProductionExecutionAudit([
            validRateRecord,
            { ...validRateRecord, observedAt: dayOne - 1 },
        ], { originWeightNow: dayOne + 1 })).toThrowError(
            expect.objectContaining({ code: 'CLOCK_REGRESSED' }),
        );
        expect(() => replayFuturesProductionExecutionAudit([
            validRateRecord,
        ], { originWeightNow: dayOne - 1 })).toThrowError(
            expect.objectContaining({ code: 'CLOCK_IN_FUTURE' }),
        );

        const directory = await makeDirectory();
        let localNow = dayOne + 10;
        const ledger = createFuturesProductionExecutionLedger({
            directory,
            integrityKey: key,
            now: () => localNow,
        });
        await ledger.open();
        await ledger.persistOriginWeightReservation({
            observedAt: dayOne,
            requestWeight: 7,
            endpointId: 'server-time',
        });
        await expect(ledger.persistOriginWeightReservation({
            observedAt: dayOne - 1,
            requestWeight: 1,
            endpointId: 'server-time',
        })).rejects.toMatchObject({ code: 'CLOCK_REGRESSED' });
        await expect(ledger.persistOriginWeightReservation({
            observedAt: localNow + 1,
            requestWeight: 1,
            endpointId: 'server-time',
        })).rejects.toMatchObject({ code: 'CLOCK_IN_FUTURE' });
        await ledger.close();

        localNow = dayOne - 1;
        const futureReplay = createFuturesProductionExecutionLedger({
            directory,
            integrityKey: key,
            now: () => localNow,
        });
        await expect(futureReplay.open()).rejects.toMatchObject({ code: 'CLOCK_IN_FUTURE' });

        const corruptDirectory = await makeDirectory();
        const corruptLedger = createFuturesProductionExecutionLedger({
            directory: corruptDirectory,
            integrityKey: key,
            now: () => dayOne,
        });
        await corruptLedger.open();
        await corruptLedger.persistOriginWeightReservation({
            requestWeight: 7,
            endpointId: 'server-time',
        });
        const { journalPath } = corruptLedger.getPaths();
        await corruptLedger.close();
        const bytes = await fs.readFile(journalPath);
        const marker = Buffer.from('"requestWeight":7', 'utf8');
        const offset = bytes.indexOf(marker);
        expect(offset).toBeGreaterThanOrEqual(0);
        bytes[offset + marker.byteLength - 1] = '8'.charCodeAt(0);
        await fs.writeFile(journalPath, bytes, { mode: 0o600 });
        const corruptReplay = createFuturesProductionExecutionLedger({
            directory: corruptDirectory,
            integrityKey: key,
            now: () => dayOne,
        });
        await expect(corruptReplay.open()).rejects.toMatchObject({ code: 'CORRUPT_JOURNAL' });
    });

    it('enforces a fixed audit schema and rejects secret keys and values before persistence', async () => {
        const record = createFuturesProductionExecutionAuditRecord(audit());
        expect(Object.keys(record).sort()).toEqual(Object.keys(
            createFuturesProductionExecutionAuditRecord({
                eventType: 'storage_health',
                category: 'storage',
                outcome: 'healthy',
                observedAt: dayOne,
            }),
        ).sort());
        expect(() => createFuturesProductionExecutionAuditRecord({
            ...audit(), apiSecret: 'forbidden',
        })).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIT_RECORD' }));

        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({
            directory,
            integrityKey: key,
            secretValues: ['live-secret'],
        });
        await ledger.open();
        await expect(ledger.append(audit({ safeDetail: 'live-secret' }))).rejects.toMatchObject({
            code: 'AUDIT_SECRET_REJECTED',
        });
        await ledger.append(audit({ safeDetail: '[redacted]' }));
        const bytes = await fs.readFile(ledger.getPaths().journalPath);
        expect(bytes.toString('utf8')).not.toContain('live-secret');
        await ledger.close();
    });

    it('prevents concurrent owners and detects lease replacement before mutation', async () => {
        const directory = await makeDirectory();
        const first = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        const second = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await first.open();
        await expect(second.open()).rejects.toMatchObject({ code: 'LEASE_UNAVAILABLE' });
        const { lockPath } = first.getPaths();
        await fs.writeFile(lockPath, `${process.pid} ${'f'.repeat(32)}\n`, { mode: 0o600 });
        await expect(first.append(audit())).rejects.toMatchObject({ code: 'LEASE_LOST' });
        expect(first.getHealth()).toMatchObject({ poisoned: true, healthy: false });
        await first.close();
    });

    it('repairs only an incomplete tail and fails closed on HMAC or anchor rollback', async () => {
        const directory = await makeDirectory();
        const ledger = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await ledger.open();
        await ledger.append(audit());
        const { journalPath, anchorPath } = ledger.getPaths();
        const oldAnchor = await fs.readFile(anchorPath);
        const sealedSize = (await fs.stat(journalPath)).size;
        await ledger.close();
        await fs.appendFile(journalPath, Buffer.from([0, 1]));
        const repaired = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await repaired.open();
        expect((await fs.stat(journalPath)).size).toBe(sealedSize);
        await repaired.append(audit({ requestId: 'second-request' }));
        await repaired.close();

        await fs.writeFile(anchorPath, oldAnchor, { mode: 0o600 });
        const rolledBack = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await expect(rolledBack.open()).rejects.toMatchObject({
            code: 'UNANCHORED_COMPLETE_RECORD',
        });

        const otherDirectory = await makeDirectory();
        const other = createFuturesProductionExecutionLedger({ directory: otherDirectory, integrityKey: key });
        await other.open();
        const otherJournal = other.getPaths().journalPath;
        await other.close();
        const bytes = await fs.readFile(otherJournal);
        bytes[10] ^= 1;
        await fs.writeFile(otherJournal, bytes, { mode: 0o600 });
        const corrupt = createFuturesProductionExecutionLedger({
            directory: otherDirectory,
            integrityKey: key,
        });
        await expect(corrupt.open()).rejects.toBeInstanceOf(FuturesProductionExecutionLedgerError);
    });

    it('rejects symlinked storage and the 64 MiB capacity boundary before reading', async () => {
        const directory = await makeDirectory();
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const target = path.join(path.dirname(directory), 'outside.bin');
        await fs.writeFile(target, '', { mode: 0o600 });
        await fs.symlink(target, path.join(directory, 'journal.bin'));
        const symlinked = createFuturesProductionExecutionLedger({ directory, integrityKey: key });
        await expect(symlinked.open()).rejects.toBeInstanceOf(FuturesProductionExecutionLedgerError);

        const capacityDirectory = await makeDirectory();
        await fs.mkdir(capacityDirectory, { recursive: true, mode: 0o700 });
        const journalPath = path.join(capacityDirectory, 'journal.bin');
        await fs.writeFile(journalPath, '', { mode: 0o600 });
        await fs.truncate(
            journalPath,
            FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumJournalBytes + 1,
        );
        const oversized = createFuturesProductionExecutionLedger({
            directory: capacityDirectory,
            integrityKey: key,
        });
        await expect(oversized.open()).rejects.toMatchObject({
            code: 'JOURNAL_CAPACITY_EXCEEDED',
        });
    });

    it('exports deterministic exact helpers without binary floating point', () => {
        expect(addFuturesProductionExactDecimals('0.1', '0.2')).toBe('0.3');
        expect(compareFuturesProductionExactDecimals('100.00000000', '100')).toBe(0);
        expect(compareFuturesProductionExactDecimals('100.00000001', '100')).toBe(1);
    });
});
