import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    FUTURES_SETTLED_STORE_FILE,
    createFuturesSettledIncomeStore,
} from './futures-settled-income-store.js';
import {
    FUTURES_SETTLED_LANE_WALK,
    futuresSettledLaneNeedsAutomaticCooldown,
    walkFuturesSettledIncomeLanes,
} from './futures-settled-income-walk.js';
import { createFuturesSettledIncomeRowSnapshotCache } from './futures-settled-income-frame.js';
import {
    MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE,
    canonicalFuturesIncomeRow,
    classifyFuturesSettledIncompleteness,
    createFuturesSettledIncomeLane,
    createFuturesSettledIncomeResource,
    exactFuturesIncomeIdentifier,
    futuresSettledIncomeContentDigest,
    restoreFuturesSettledIncomeResource,
    sanitizeFuturesSettledIncomeError,
    serializeFuturesSettledIncomeResource,
} from '../../src/utils/futuresSettledIncomeResource.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const WINDOW_FROM = NOW - DAY;

// Semantic fixture labels are for test readability, not exchange protocol
// evidence. Map them to stable digit-only IDs before they cross the same strict
// canonical boundary as raw Binance rows.
const numericFixtureIncomeId = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const source = String(value);
    if (/^\d+$/.test(source)) return source;
    let hash = 14_695_981_039_346_656_037n;
    for (const character of source) {
        hash ^= BigInt(character.codePointAt(0));
        hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
    }
    return hash.toString();
};

const incomeRow = ({
    incomeType = 'FUNDING_FEE',
    id,
    time = NOW - 5 * MINUTE,
    income = '-1.00',
    symbol = 'BTCUSDT',
    asset = 'USDT',
}) => ({
    symbol,
    incomeType,
    income,
    asset,
    time,
    tranId: numericFixtureIncomeId(id),
    tradeId: '',
});

const walkOneLane = ({ rows, held = null, now = NOW } = {}) => (
    walkFuturesSettledIncomeLanes({
        now,
        windowFrom: WINDOW_FROM,
        held,
        incomeTypes: ['FUNDING_FEE'],
        readPage: async () => ({ rows }),
    })
);

describe('the canonical settled-income v2 resource', () => {
    it('keeps completeness local when one lane advances its target alone', () => {
        const funding = createFuturesSettledIncomeLane('FUNDING_FEE', {
            rows: [],
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            status: 'ready',
            attemptedAt: NOW,
            successfulAt: NOW,
            complete: true,
        });
        const creditTarget = NOW - MINUTE;
        const credit = createFuturesSettledIncomeLane('FEE_RETURN', {
            rows: [],
            coveredFrom: WINDOW_FROM,
            coveredTo: creditTarget,
            targetTo: creditTarget,
            status: 'ready',
            attemptedAt: NOW,
            successfulAt: NOW,
            complete: true,
        });

        const resource = createFuturesSettledIncomeResource({
            lanes: { FUNDING_FEE: funding, FEE_RETURN: credit },
        });

        expect(resource.targetTo).toBe(NOW);
        expect(resource.coveredTo).toBe(creditTarget);
        expect(resource.completeByType).toEqual({
            FEE_RETURN: true,
            FUNDING_FEE: true,
        });
        expect(resource.complete).toBe(false);
    });

    it('reuses sorted row references only within one activation/account/content revision', () => {
        const firstLane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            rows: [
                incomeRow({ id: 'later', time: NOW - MINUTE }),
                incomeRow({ id: 'earlier', time: NOW - 2 * MINUTE }),
            ],
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            status: 'ready',
            attemptedAt: NOW,
            successfulAt: NOW,
            complete: true,
        });
        const first = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: { FUNDING_FEE: firstLane },
            generation: 4,
        });
        const observationOnly = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    ...firstLane,
                    attemptedAt: NOW + MINUTE,
                    successfulAt: NOW + MINUTE,
                }),
            },
            generation: first.generation,
        });
        expect(observationOnly.digest).toBe(first.digest);

        const rowsForFrame = createFuturesSettledIncomeRowSnapshotCache();
        const firstSnapshot = rowsForFrame({
            activationGeneration: 7,
            accountFingerprint: '0123456789abcdef',
            resource: first,
        });
        const observedSnapshot = rowsForFrame({
            activationGeneration: 7,
            accountFingerprint: '0123456789abcdef',
            resource: observationOnly,
        });

        expect(observedSnapshot).toBe(firstSnapshot);
        expect(firstSnapshot.FUNDING_FEE.map(row => row.time))
            .toEqual([NOW - 2 * MINUTE, NOW - MINUTE]);
        expect(new Set(first.lanes.FUNDING_FEE.rows.values()))
            .toContain(firstSnapshot.FUNDING_FEE[0]);

        const changed = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    ...firstLane,
                    rows: [
                        incomeRow({ id: 'later', time: NOW - MINUTE, income: '-2.00' }),
                        incomeRow({ id: 'earlier', time: NOW - 2 * MINUTE }),
                    ],
                }),
            },
            generation: first.generation + 1,
        });
        expect(rowsForFrame({
            activationGeneration: 7,
            accountFingerprint: '0123456789abcdef',
            resource: changed,
        })).not.toBe(firstSnapshot);
        expect(rowsForFrame({
            activationGeneration: 8,
            accountFingerprint: '0123456789abcdef',
            resource: observationOnly,
        })).not.toBe(firstSnapshot);
        expect(rowsForFrame({
            activationGeneration: 7,
            accountFingerprint: 'fedcba9876543210',
            resource: observationOnly,
        })).not.toBe(firstSnapshot);
    });

    it.each(['idle', 'loading', 'stale', 'error'])(
        'forces retained %s evidence incomplete through serialization',
        (status) => {
            const lane = createFuturesSettledIncomeLane('FUNDING_FEE', {
                status,
                complete: true,
                coveredFrom: WINDOW_FROM,
                coveredTo: NOW,
                successfulAt: NOW - MINUTE,
                rows: [incomeRow({ id: `retained-${status}` })],
            });

            expect(lane.complete).toBe(false);
            const serialized = serializeFuturesSettledIncomeResource({
                generation: 1,
                lanes: { FUNDING_FEE: lane },
            });
            expect(serialized.lanes[0]).toMatchObject({ status, complete: false });
        },
    );

    it('allows only successfully observed ready evidence to retain complete coverage', () => {
        const lane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'ready',
            complete: true,
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            attemptedAt: NOW,
            successfulAt: NOW,
        });

        expect(lane.complete).toBe(true);
    });

    it('persists confirmation debt and prevents it from being constructed as ready', () => {
        const confirmationNotBefore = NOW + 2 * MINUTE;
        const lane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'ready',
            complete: true,
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            attemptedAt: NOW,
            successfulAt: NOW,
            confirmationNotBefore,
        });
        const resource = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: { FUNDING_FEE: lane },
            generation: 4,
        });
        const serialized = serializeFuturesSettledIncomeResource(resource);
        const restored = restoreFuturesSettledIncomeResource(serialized, {
            incomeTypes: ['FUNDING_FEE'],
            windowFrom: WINDOW_FROM,
            now: NOW,
        });

        expect(lane).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore,
        });
        expect(serialized.lanes[0].confirmationNotBefore).toBe(confirmationNotBefore);
        expect(restored?.lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore,
        });
        expect(restored?.digest).toBe(resource.digest);
    });

    it('keeps confirmation debt stale without rows or earlier coverage', () => {
        const confirmationNotBefore = NOW + 2 * MINUTE;
        const lane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'loading',
            targetTo: NOW,
            confirmationNotBefore,
        });
        const resource = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: { FUNDING_FEE: lane },
            generation: 4,
        });
        const restored = restoreFuturesSettledIncomeResource(
            serializeFuturesSettledIncomeResource(resource),
            { incomeTypes: ['FUNDING_FEE'], windowFrom: WINDOW_FROM, now: NOW },
        );

        expect(lane.rows.size).toBe(0);
        expect(lane.coveredFrom).toBeNull();
        expect(lane).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore,
        });
        expect(restored?.lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore,
        });
    });

    it('authenticates then degrades bounded future evidence while preserving debt', () => {
        const confirmationNotBefore = NOW + 2 * MINUTE;
        const lane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            rows: [incomeRow({ id: 'rollback-confirmed', time: NOW })],
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            status: 'stale',
            attemptedAt: NOW,
            successfulAt: NOW,
            confirmationNotBefore,
            complete: false,
            pending: {
                targetFrom: NOW - MINUTE,
                targetTo: NOW,
                nextPage: 2,
                rows: [incomeRow({ id: 'rollback-pending', time: NOW })],
            },
        });
        const resource = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: { FUNDING_FEE: lane },
            generation: 4,
        });
        const serialized = serializeFuturesSettledIncomeResource(resource);
        const restored = restoreFuturesSettledIncomeResource(serialized, {
            incomeTypes: ['FUNDING_FEE'],
            windowFrom: WINDOW_FROM,
            now: NOW - 1,
        });

        expect(restored?.lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW - 1,
            targetTo: NOW,
            attemptedAt: null,
            successfulAt: null,
            confirmationNotBefore,
            pending: null,
        });
        expect(restored?.lanes.FUNDING_FEE.rows.size).toBe(0);
        expect(restored?.generation).toBe(resource.generation + 1);
        expect(restored?.digest).not.toBe(resource.digest);

        // A change confined to evidence that clock degradation will remove must
        // still fail the original snapshot's digest before that evidence is cut.
        const tampered = structuredClone(serialized);
        tampered.lanes[0].rows[0].income = '-999.00';
        expect(restoreFuturesSettledIncomeResource(tampered, {
            incomeTypes: ['FUNDING_FEE'],
            windowFrom: WINDOW_FROM,
            now: NOW - 1,
        })).toBeNull();
    });

    it('rejects future authority without debt or beyond its persisted interval', () => {
        const ready = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    rows: [incomeRow({ id: 'future-ready', time: NOW })],
                    coveredFrom: WINDOW_FROM,
                    coveredTo: NOW,
                    targetTo: NOW,
                    status: 'ready',
                    attemptedAt: NOW,
                    successfulAt: NOW,
                    complete: true,
                }),
            },
            generation: 4,
        });
        expect(restoreFuturesSettledIncomeResource(
            serializeFuturesSettledIncomeResource(ready),
            { incomeTypes: ['FUNDING_FEE'], windowFrom: WINDOW_FROM, now: NOW - 1 },
        )).toBeNull();

        const debt = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    ...ready.lanes.FUNDING_FEE,
                    status: 'stale',
                    complete: false,
                    confirmationNotBefore: NOW + 2 * MINUTE,
                }),
            },
            generation: 5,
        });
        expect(restoreFuturesSettledIncomeResource(
            serializeFuturesSettledIncomeResource(debt),
            {
                incomeTypes: ['FUNDING_FEE'],
                windowFrom: WINDOW_FROM,
                now: NOW - 2 * MINUTE - 1,
            },
        )).toBeNull();
    });

    it('fails closed when ready state has no success proof or still has pending work', () => {
        const missingObservation = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'ready',
            complete: true,
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
        });
        expect(missingObservation).toMatchObject({ status: 'stale', complete: false });

        const pending = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'ready',
            complete: true,
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            attemptedAt: NOW,
            successfulAt: NOW,
            pending: {
                targetFrom: WINDOW_FROM,
                targetTo: NOW,
                nextPage: 2,
                rows: [],
            },
        });
        expect(pending).toMatchObject({ status: 'loading', complete: false });
        expect(pending.pending).not.toBeNull();
    });

    it('rejects negative epoch evidence and degrades a regressed constructor clock', () => {
        const regressed = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'ready',
            complete: true,
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            attemptedAt: NOW - 1,
            successfulAt: NOW,
        });
        expect(regressed).toMatchObject({
            status: 'stale',
            complete: false,
            attemptedAt: null,
            successfulAt: NOW,
        });

        const negative = createFuturesSettledIncomeLane('FUNDING_FEE', {
            status: 'ready',
            complete: true,
            coveredFrom: -1,
            coveredTo: NOW,
            targetTo: -1,
            attemptedAt: -1,
            successfulAt: -1,
            pending: {
                targetFrom: -1,
                targetTo: NOW,
                nextPage: 2,
                rows: [],
            },
        });
        expect(negative).toMatchObject({
            status: 'idle',
            complete: false,
            coveredFrom: null,
            coveredTo: null,
            targetTo: null,
            attemptedAt: null,
            successfulAt: null,
            pending: null,
        });
        expect(canonicalFuturesIncomeRow(incomeRow({ time: -1 }))).toBeNull();
    });

    it.each(['FUNDING_FEE', 'INSURANCE_CLEAR'])(
        'rejects symbol-less contract-scoped %s rows',
        (incomeType) => {
            expect(canonicalFuturesIncomeRow(incomeRow({
                incomeType,
                id: `blank-${incomeType}`,
                symbol: ' ',
            }))).toBeNull();
            expect(canonicalFuturesIncomeRow(incomeRow({
                incomeType,
                id: `missing-${incomeType}`,
                symbol: null,
            }))).toBeNull();
        },
    );

    it('preserves a valid symbol-less account-level credit', () => {
        expect(canonicalFuturesIncomeRow(incomeRow({
            incomeType: 'REFERRAL_KICKBACK',
            id: '41',
            symbol: ' ',
            income: '0.25',
        }))).toMatchObject({
            symbol: '',
            incomeType: 'REFERRAL_KICKBACK',
            income: '0.25',
            asset: 'USDT',
            tranId: '41',
        });
    });

    it.each([
        ['income type', { incomeType: 'FUNDING FEE' }],
        ['symbol', { symbol: 'BTC/USDT' }],
        ['asset', { asset: 'USD T' }],
    ])('rejects a non-canonical %s token', (_label, override) => {
        expect(canonicalFuturesIncomeRow(incomeRow({
            id: `malformed-${_label}`,
            ...override,
        }))).toBeNull();
    });

    it.each([
        ['padded income type', { incomeType: ' FUNDING_FEE' }],
        ['lowercase income type', { incomeType: 'funding_fee' }],
        ['Unicode-foldable income type', { incomeType: '\u0131NSURANCE_CLEAR' }],
        ['padded symbol', { symbol: ' BTCUSDT' }],
        ['lowercase symbol', { symbol: 'btcusdt' }],
        ['Unicode-foldable symbol', { symbol: 'BTCU\u017FDT' }],
        ['padded asset', { asset: ' USDT' }],
        ['lowercase asset', { asset: 'usdt' }],
        ['Unicode-foldable asset', { asset: 'U\u017FDT' }],
    ])('rejects a %s without lossy token normalization', (_label, override) => {
        expect(canonicalFuturesIncomeRow({
            ...incomeRow({ id: '404' }),
            ...override,
        })).toBeNull();
    });

    it.each([
        ['tranId', { tranId: 'not-an-integer' }],
        ['tradeId', { tradeId: '42.5' }],
    ])('rejects a malformed present %s instead of treating it as absent', (_label, override) => {
        expect(canonicalFuturesIncomeRow({
            ...incomeRow({ id: '405' }),
            ...override,
        })).toBeNull();
    });

    it('gives equivalent decimal spellings one exact fallback identity', () => {
        const variants = ['.5', '+0.500', '000.50'].map(income => (
            canonicalFuturesIncomeRow(incomeRow({ id: null, income }))
        ));

        expect(variants.map(row => row.income)).toEqual(['0.5', '0.5', '0.5']);
        expect(new Set(variants.map(row => row.identity)).size).toBe(1);
        expect(canonicalFuturesIncomeRow(incomeRow({
            id: null,
            income: '-0.000',
        })).income).toBe('0');
        const exact = `0.${'1234567890'.repeat(6)}1234`;
        expect(canonicalFuturesIncomeRow(incomeRow({ id: null, income: exact })).income)
            .toBe(exact);
    });

    it('rejects numeric income before exact identity and digest construction', () => {
        expect(canonicalFuturesIncomeRow(incomeRow({ income: 0 }))).toBeNull();
        expect(canonicalFuturesIncomeRow(incomeRow({
            income: Number('9007199254740993.12'),
        }))).toBeNull();
    });

    it('preserves a safe HTTP status without leaking request credentials', async () => {
        const refusal = Object.assign(
            new Error(
                'GET https://fapi.binance.com/fapi/v1/income?signature=private '
                + 'apiKey=private authorization=private',
            ),
            { code: -1000, response: { status: '503' } },
        );
        const sanitized = sanitizeFuturesSettledIncomeError(refusal);

        expect(sanitized).toEqual({
            code: '-1000',
            message: 'Income history read failed [credentials redacted]',
            status: 503,
        });
        expect(sanitized.message).not.toContain('private');

        const unsafeDiagnostic = sanitizeFuturesSettledIncomeError(Object.assign(
            new Error('authorization=Bearer private-token'),
            { code: 'authorization=Bearer private-code' },
        ));
        expect(unsafeDiagnostic).toMatchObject({
            code: 'READ_FAILED',
            message: 'Income history read failed [credentials redacted]',
        });
        expect(JSON.stringify(unsafeDiagnostic)).not.toContain('private');

        const walked = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes: ['FUNDING_FEE'],
            readPage: async () => { throw refusal; },
        });
        const serialized = serializeFuturesSettledIncomeResource(walked.resource);

        expect(serialized.lanes[0].error).toEqual(sanitized);
        const restored = restoreFuturesSettledIncomeResource(serialized, {
            incomeTypes: ['FUNDING_FEE'],
            windowFrom: WINDOW_FROM,
            now: NOW,
        });
        expect(restored?.lanes.FUNDING_FEE.error).toEqual(sanitized);

        const statusTampered = structuredClone(serialized);
        statusTampered.lanes[0].error.status = 429;
        expect(restoreFuturesSettledIncomeResource(statusTampered, {
            incomeTypes: ['FUNDING_FEE'],
            windowFrom: WINDOW_FROM,
            now: NOW,
        })).toBeNull();
    });

    it('preserves int64 identifiers as exact strings', async () => {
        const tranId = '90071992547409931234';
        const tradeId = '92233720368547758070';
        const canonical = canonicalFuturesIncomeRow({
            ...incomeRow({ id: tranId }),
            tradeId,
        });

        expect(canonical.tranId).toBe(tranId);
        expect(canonical.tradeId).toBe(tradeId);
        expect(canonical.identity).toContain(tranId);

        const walked = await walkOneLane({ rows: [canonical, canonical] });
        const serialized = JSON.parse(JSON.stringify(
            serializeFuturesSettledIncomeResource(walked.resource),
        ));
        expect(serialized.lanes[0].rows).toHaveLength(1);
        expect(serialized.lanes[0].rows[0].tranId).toBe(tranId);
        expect(serialized.lanes[0].rows[0].tradeId).toBe(tradeId);
    });

    it.each([
        ['income text', { income: '1'.repeat(257) }],
        ['income coefficient', { income: '1'.repeat(129) }],
        ['income scale', { income: `0.${'1'.repeat(65)}` }],
        ['transaction identity', { tranId: '1'.repeat(65) }],
        ['trade identity', { tradeId: '1'.repeat(65) }],
        ['symbol', { symbol: 'S'.repeat(65) }],
        ['asset', { asset: 'A'.repeat(33) }],
        ['income type', { incomeType: 'T'.repeat(65) }],
    ])('rejects an oversized %s before resource construction', (unused, override) => {
        const raw = { ...incomeRow({ id: '42' }), ...override };

        expect(canonicalFuturesIncomeRow(raw)).toBeNull();
    });

    it('bounds the exact identifier helper without narrowing int64 strings', () => {
        expect(exactFuturesIncomeIdentifier('9223372036854775807'))
            .toBe('9223372036854775807');
        expect(exactFuturesIncomeIdentifier('1'.repeat(65))).toBeNull();
    });

    it('rejects malformed, duplicate, wrong-lane, and pending persisted rows atomically', async () => {
        const confirmed = await walkOneLane({ rows: [incomeRow({ id: 'stored' })] });
        const serialized = serializeFuturesSettledIncomeResource(confirmed.resource);
        const stored = serialized.lanes[0].rows[0];
        const wrongLane = canonicalFuturesIncomeRow({
            ...incomeRow({ incomeType: 'INSURANCE_CLEAR', id: 'wrong-lane' }),
        });
        const corruptions = [
            { ...stored, tranId: 'malformed-extra', identity: 'not-canonical', asset: '' },
            stored,
            wrongLane,
        ];

        for (const corruption of corruptions) {
            const candidate = structuredClone(serialized);
            candidate.lanes[0].rows.push(corruption);
            expect(restoreFuturesSettledIncomeResource(candidate, {
                incomeTypes: ['FUNDING_FEE'],
                windowFrom: WINDOW_FROM,
                now: NOW,
            })).toBeNull();
        }

        for (const override of [
            { symbol: ' BTCUSDT' },
            { symbol: 'btcusdt' },
            { symbol: 'BTCU\u017FDT' },
            { incomeType: ' funding_fee' },
            { asset: 'usdt' },
            { tranId: 'not-an-integer' },
            { tradeId: '42.5' },
        ]) {
            const candidate = structuredClone(serialized);
            candidate.lanes[0].rows[0] = { ...stored, ...override };
            expect(restoreFuturesSettledIncomeResource(candidate, {
                incomeTypes: ['FUNDING_FEE'],
                windowFrom: WINDOW_FROM,
                now: NOW,
            })).toBeNull();
        }

        const pendingLane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            rows: [stored],
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW - MINUTE,
            targetTo: NOW,
            status: 'loading',
            attemptedAt: NOW,
            successfulAt: NOW - MINUTE,
            complete: false,
            pending: {
                targetFrom: NOW - 2 * MINUTE,
                targetTo: NOW,
                nextPage: 2,
                rows: [stored],
            },
        });
        const pendingResource = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: { FUNDING_FEE: pendingLane },
        });
        const corruptPending = serializeFuturesSettledIncomeResource(pendingResource);
        corruptPending.lanes[0].pending.rows.push({ ...stored, asset: '' });

        expect(restoreFuturesSettledIncomeResource(corruptPending, {
            incomeTypes: ['FUNDING_FEE'],
            windowFrom: WINDOW_FROM,
            now: NOW,
        })).toBeNull();
    });

    it('rejects contradictory ready clocks, ready pending work, and oversized stored lanes', async () => {
        const confirmed = await walkOneLane({ rows: [incomeRow({ id: 'bounded-ready' })] });
        const serialized = serializeFuturesSettledIncomeResource(confirmed.resource);
        const corruptions = [];

        for (const attemptedAt of [null, ' ', -1, NOW - 1]) {
            const candidate = structuredClone(serialized);
            candidate.lanes[0].attemptedAt = attemptedAt;
            corruptions.push(candidate);
        }
        const missingSuccess = structuredClone(serialized);
        missingSuccess.lanes[0].successfulAt = null;
        corruptions.push(missingSuccess);

        const pendingReady = structuredClone(serialized);
        pendingReady.lanes[0].pending = {
            targetFrom: WINDOW_FROM,
            targetTo: NOW,
            nextPage: 2,
            rows: [],
        };
        corruptions.push(pendingReady);

        const oversized = structuredClone(serialized);
        oversized.lanes[0].rows = new Array(
            MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE + 1,
        );
        corruptions.push(oversized);

        for (const candidate of corruptions) {
            expect(restoreFuturesSettledIncomeResource(candidate, {
                incomeTypes: ['FUNDING_FEE'],
                windowFrom: WINDOW_FROM,
                now: NOW,
            })).toBeNull();
        }
    });

    it('changes generation for same-count amount and identity corrections, not identical input', async () => {
        const initialRows = [
            incomeRow({ id: '11', income: '-1.25' }),
            incomeRow({ id: '12', income: '-2.50', time: NOW - 4 * MINUTE }),
        ];
        const initial = await walkOneLane({ rows: [...initialRows, initialRows[0]] });
        expect(initial.rows.size).toBe(2);

        const identical = await walkOneLane({ rows: [...initialRows].reverse(), held: initial.resource });
        expect(identical.rows.size).toBe(2);
        expect(identical.digest).toBe(initial.digest);
        expect(identical.generation).toBe(initial.generation);

        const amountCorrected = await walkOneLane({
            held: identical.resource,
            rows: [
                incomeRow({ id: '11', income: '-9.75' }),
                initialRows[1],
            ],
        });
        expect(amountCorrected.rows.size).toBe(2);
        expect(amountCorrected.digest).not.toBe(identical.digest);
        expect(amountCorrected.generation).toBe(identical.generation + 1);
        expect([...amountCorrected.rows.values()].find(row => row.tranId === '11')?.income)
            .toBe('-9.75');

        const identityCorrected = await walkOneLane({
            held: amountCorrected.resource,
            rows: [
                incomeRow({ id: '11', income: '-9.75' }),
                incomeRow({ id: '13', income: '-2.50', time: NOW - 4 * MINUTE }),
            ],
        });
        const identities = [...identityCorrected.rows.values()].map(row => row.tranId).sort();
        expect(identities).toEqual(['11', '13']);
        expect(identityCorrected.rows.size).toBe(amountCorrected.rows.size);
        expect(identityCorrected.generation).toBe(amountCorrected.generation + 1);
    });
});

// The desk announced "Wallet-adjustment refresh failed … press \u21bb to retry"
// after every close, because every state short of complete was one state. It
// is two: a pass whose only shortfall is a charge the exchange announced and
// has not yet written is a wait that resolves itself, and a pass that failed
// or missed its target is what the retry ask exists for.
describe('telling an announced charge apart from a short read', () => {
    const completeLane = (incomeType, overrides = {}) => createFuturesSettledIncomeLane(
        incomeType,
        {
            rows: [],
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW,
            targetTo: NOW,
            status: 'ready',
            attemptedAt: NOW,
            successfulAt: NOW,
            complete: true,
            ...overrides,
        },
    );

    it('names an outstanding confirmation debt, and does not call it short', () => {
        const debtDeadline = NOW + 2 * MINUTE;
        const lanes = [
            completeLane('FUNDING_FEE'),
            completeLane('FEE_RETURN', {
                complete: false,
                status: 'stale',
                confirmationNotBefore: debtDeadline,
            }),
        ];

        expect(classifyFuturesSettledIncompleteness(lanes)).toEqual({
            failed: false,
            short: false,
            awaitingConfirmation: ['FEE_RETURN'],
            nextConfirmationAt: debtDeadline,
        });
    });

    it('reports the nearest deadline when several lanes owe a confirmation', () => {
        const lanes = [
            completeLane('FUNDING_FEE', {
                complete: false,
                status: 'stale',
                confirmationNotBefore: NOW + 4 * MINUTE,
            }),
            completeLane('FEE_RETURN', {
                complete: false,
                status: 'stale',
                confirmationNotBefore: NOW + MINUTE,
            }),
        ];

        const classified = classifyFuturesSettledIncompleteness(lanes);
        expect(classified.short).toBe(false);
        expect(classified.awaitingConfirmation.sort()).toEqual(['FEE_RETURN', 'FUNDING_FEE']);
        expect(classified.nextConfirmationAt).toBe(NOW + MINUTE);
    });

    it('calls a lane short when it is incomplete for any reason other than the debt', () => {
        const uncovered = classifyFuturesSettledIncompleteness([
            completeLane('FUNDING_FEE'),
            completeLane('FEE_RETURN', {
                complete: false,
                status: 'stale',
                coveredTo: NOW - MINUTE,
            }),
        ]);
        expect(uncovered).toMatchObject({
            failed: false,
            short: true,
            awaitingConfirmation: [],
        });

        const errored = classifyFuturesSettledIncompleteness([
            completeLane('FUNDING_FEE', {
                complete: false,
                status: 'error',
                error: { code: 'ECONNRESET', message: 'pooled socket reset' },
            }),
        ]);
        expect(errored).toMatchObject({ failed: true, short: true });
    });

    // An error on one lane and a debt on another is not a wait. The debt is
    // still named — the operator's next pass owes that row either way — but a
    // failure anywhere keeps the failure announcement.
    it('keeps failure the verdict when a debt and an error stand together', () => {
        const classified = classifyFuturesSettledIncompleteness([
            completeLane('FUNDING_FEE', {
                complete: false,
                status: 'stale',
                confirmationNotBefore: NOW + 2 * MINUTE,
            }),
            completeLane('FEE_RETURN', {
                complete: false,
                status: 'error',
                error: { code: '-1002', message: 'rebate permission refused' },
            }),
        ]);
        expect(classified.failed).toBe(true);
        expect(classified.short).toBe(true);
        expect(classified.awaitingConfirmation).toEqual(['FUNDING_FEE']);
    });

    // A page checkpoint is unfinished work of this pass, not the exchange's
    // write lag. A lane carrying both must not read as a self-resolving wait.
    it('calls a debt lane short while its own page walk is unfinished', () => {
        const lane = createFuturesSettledIncomeLane('FUNDING_FEE', {
            rows: [],
            coveredFrom: WINDOW_FROM,
            coveredTo: NOW - MINUTE,
            targetTo: NOW,
            status: 'stale',
            attemptedAt: NOW,
            successfulAt: NOW - MINUTE,
            confirmationNotBefore: NOW + 2 * MINUTE,
            pending: {
                targetFrom: WINDOW_FROM,
                targetTo: NOW,
                nextPage: 2,
                rows: [],
            },
        });
        expect(lane.pending).not.toBeNull();

        const classified = classifyFuturesSettledIncompleteness([lane]);
        expect(classified.short).toBe(true);
        expect(classified.awaitingConfirmation).toEqual(['FUNDING_FEE']);
    });
});

describe('the explicit per-income-type page walker', () => {
    it('produces the same resource from ascending, descending, and out-of-order pages', async () => {
        const rows = [
            incomeRow({ id: '1', time: WINDOW_FROM }),
            incomeRow({ id: '2', time: NOW - 8 * HOUR }),
            incomeRow({ id: '3', time: NOW - 2 * HOUR }),
            incomeRow({ id: '4', time: NOW - MINUTE }),
        ];
        const limits = {
            ...FUTURES_SETTLED_LANE_WALK,
            PAGE_LIMIT: 3,
            MAX_PAGES_PER_LANE: 3,
        };
        const run = async (pages) => {
            const asked = [];
            const walked = await walkFuturesSettledIncomeLanes({
                now: NOW,
                windowFrom: WINDOW_FROM,
                incomeTypes: ['FUNDING_FEE'],
                limits,
                readPage: async (request) => {
                    asked.push(request);
                    return { rows: pages[request.page - 1] ?? [] };
                },
            });
            return { asked, walked };
        };

        const ascending = await run([rows.slice(0, 3), rows.slice(3)]);
        const descending = await run([
            rows.slice(0, 3).reverse(),
            rows.slice(3).reverse(),
        ]);
        const unordered = await run([[rows[2], rows[0], rows[1]], [rows[3]]]);

        for (const result of [ascending, descending, unordered]) {
            expect(result.asked.map(request => request.page)).toEqual([1, 2]);
            expect(result.asked.every(request => (
                request.startTime === WINDOW_FROM && request.endTime === NOW
            ))).toBe(true);
            expect(result.walked.coveredFrom).toBe(WINDOW_FROM);
            expect(result.walked.coveredTo).toBe(NOW);
            expect(result.walked.complete).toBe(true);
        }
        expect(descending.walked.digest).toBe(ascending.walked.digest);
        expect(unordered.walked.digest).toBe(ascending.walked.digest);
        expect([...unordered.walked.rows.values()].map(row => row.tranId).sort())
            .toEqual(['1', '2', '3', '4']);
    });

    it('keeps over 1000 timestamp peers and deduplicates a repeated page boundary', async () => {
        const sameMillisecond = NOW - HOUR;
        const firstPage = Array.from({ length: 1000 }, (unused, index) => incomeRow({
            id: String(index + 1),
            time: sameMillisecond,
        }));
        const boundaryDuplicate = firstPage.at(-1);
        const finalPeer = incomeRow({ id: '1001', time: sameMillisecond });
        const asked = [];

        const walked = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes: ['FUNDING_FEE'],
            readPage: async (request) => {
                asked.push(request);
                return { rows: request.page === 1 ? firstPage : [boundaryDuplicate, finalPeer] };
            },
        });

        expect(asked.map(request => request.page)).toEqual([1, 2]);
        expect(new Set(asked.map(request => `${request.startTime}:${request.endTime}`)).size).toBe(1);
        expect(walked.rows.size).toBe(1001);
        expect([...walked.rows.values()].filter(row => row.tranId === '1000')).toHaveLength(1);
        expect([...walked.rows.values()].some(row => row.tranId === '1001')).toBe(true);
        expect(walked.complete).toBe(true);
    });

    it('stops a dense multi-pass lane at the cumulative row ceiling', async () => {
        const limits = {
            ...FUTURES_SETTLED_LANE_WALK,
            PAGE_LIMIT: 2,
            MAX_PAGES_PER_LANE: 1,
            MAX_ROWS_PER_LANE: 5,
        };
        const asked = [];
        const readPage = async ({ page }) => {
            asked.push(page);
            return {
                rows: [0, 1].map(offset => incomeRow({
                    id: String((page * 2) + offset),
                    time: NOW - ((page * 2 + offset) * MINUTE),
                })),
            };
        };
        const first = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage,
        });
        const second = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: first.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage,
        });
        const limited = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            held: second.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage,
        });
        const lane = limited.lanes.FUNDING_FEE;
        const serialized = serializeFuturesSettledIncomeResource(limited.resource).lanes[0];

        expect(asked).toEqual([1, 2, 3]);
        expect(first.queuedIncomeTypes).toEqual(['FUNDING_FEE']);
        expect(second.queuedIncomeTypes).toEqual(['FUNDING_FEE']);
        expect(limited.failed).toBe(true);
        expect(limited.queued).toBe(false);
        expect(limited.queuedIncomeTypes).toEqual([]);
        expect(lane.rows.size).toBe(limits.MAX_ROWS_PER_LANE);
        expect(lane.coveredFrom).toBeNull();
        expect(lane.coveredTo).toBeNull();
        expect(lane.status).toBe('error');
        expect(lane.complete).toBe(false);
        expect(lane.error?.code).toBe('ROW_LIMIT_REACHED');
        expect(lane.pending).toBeNull();
        expect(futuresSettledLaneNeedsAutomaticCooldown(lane)).toBe(true);
        expect(serialized.rows).toHaveLength(limits.MAX_ROWS_PER_LANE);
        expect(serialized.pending).toBeNull();
    });

    it('stops repeated full duplicate pages at the cumulative target page ceiling', async () => {
        const confirmed = await walkOneLane({
            rows: [incomeRow({ id: 'confirmed', time: NOW - 5 * MINUTE })],
        });
        const retained = confirmed.lanes.FUNDING_FEE;
        const later = NOW + HOUR;
        const duplicate = incomeRow({ id: 'duplicate', time: NOW + MINUTE });
        const limits = {
            ...FUTURES_SETTLED_LANE_WALK,
            PAGE_LIMIT: 1,
            MAX_PAGES_PER_LANE: 1,
            MAX_PAGES_PER_TARGET: 3,
            MAX_ROWS_PER_LANE: 100,
        };
        const asked = [];
        const readPage = async (request) => {
            asked.push(request);
            return { rows: [duplicate] };
        };

        const first = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: confirmed.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage,
        });
        const second = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: first.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage,
        });
        const limited = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: second.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage,
        });
        const lane = limited.lanes.FUNDING_FEE;

        expect(asked.map(request => request.page)).toEqual([1, 2, 3]);
        expect(new Set(asked.map(request => `${request.startTime}:${request.endTime}`)).size).toBe(1);
        expect(first.queuedIncomeTypes).toEqual(['FUNDING_FEE']);
        expect(second.queuedIncomeTypes).toEqual(['FUNDING_FEE']);
        expect(limited.failed).toBe(true);
        expect(limited.queued).toBe(false);
        expect(limited.queuedIncomeTypes).toEqual([]);
        expect(lane.rows).toEqual(retained.rows);
        expect(lane.coveredFrom).toBe(retained.coveredFrom);
        expect(lane.coveredTo).toBe(retained.coveredTo);
        expect(lane.successfulAt).toBe(retained.successfulAt);
        expect(lane).toMatchObject({
            targetTo: later,
            status: 'stale',
            complete: false,
            pending: null,
            error: { code: 'PAGE_LIMIT_REACHED' },
        });
        expect(limited.complete).toBe(false);
        expect(futuresSettledLaneNeedsAutomaticCooldown(lane)).toBe(true);
    });

    it.each([
        {
            name: 'malformed amount',
            row: { ...incomeRow({ id: 'bad-amount' }), income: null },
            code: 'INVALID_INCOME_ROW',
        },
        {
            name: 'missing settlement asset',
            row: { ...incomeRow({ id: 'no-asset' }), asset: ' ' },
            code: 'INVALID_INCOME_ROW',
        },
        {
            name: 'another income lane',
            row: incomeRow({ incomeType: 'FEE_RETURN', id: 'wrong-lane', income: '0.5' }),
            code: 'INCOME_TYPE_MISMATCH',
        },
        {
            name: 'outside the frozen window',
            row: incomeRow({ id: 'future-row', time: NOW + HOUR + 1 }),
            code: 'OUT_OF_WINDOW_RESPONSE',
        },
    ])('fails a $name page without replacing confirmed evidence', async ({ row, code }) => {
        const confirmed = await walkOneLane({
            rows: [incomeRow({ id: 'held', time: NOW - 5 * MINUTE })],
        });
        const retained = confirmed.lanes.FUNDING_FEE;
        const later = NOW + HOUR;
        const validButUncommitted = incomeRow({ id: 'uncommitted', time: later - MINUTE });

        const walked = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: confirmed.resource,
            incomeTypes: ['FUNDING_FEE'],
            readPage: async () => ({ rows: [validButUncommitted, row] }),
        });
        const lane = walked.lanes.FUNDING_FEE;

        expect(walked).toMatchObject({
            requests: 1,
            failed: true,
            queued: false,
        });
        expect(lane.rows).toEqual(retained.rows);
        expect(lane.coveredFrom).toBe(retained.coveredFrom);
        expect(lane.coveredTo).toBe(retained.coveredTo);
        expect(lane.successfulAt).toBe(retained.successfulAt);
        expect(lane).toMatchObject({
            targetTo: later,
            status: 'stale',
            complete: false,
            pending: null,
            error: { code },
        });
        expect(walked.complete).toBe(false);
        expect([...lane.rows.values()].some(item => item.tranId === 'uncommitted')).toBe(false);
    });

    it.each([
        { incomeType: 'FUNDING_FEE', symbol: ' ' },
        { incomeType: 'INSURANCE_CLEAR', symbol: null },
    ])('fails a symbol-less $incomeType page transactionally', async ({
        incomeType,
        symbol,
    }) => {
        const initial = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes: [incomeType],
            readPage: async () => ({ rows: [incomeRow({ incomeType, id: 'held' })] }),
        });
        const retained = initial.lanes[incomeType];
        const later = NOW + HOUR;

        const walked = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: initial.resource,
            incomeTypes: [incomeType],
            readPage: async () => ({
                rows: [
                    incomeRow({ incomeType, id: 'uncommitted', time: later - MINUTE }),
                    incomeRow({ incomeType, id: 'symbol-less', symbol, time: later - MINUTE }),
                ],
            }),
        });
        const lane = walked.lanes[incomeType];

        expect(walked.failed).toBe(true);
        expect(lane.rows).toEqual(retained.rows);
        expect(lane.coveredFrom).toBe(retained.coveredFrom);
        expect(lane.coveredTo).toBe(retained.coveredTo);
        expect(lane.successfulAt).toBe(retained.successfulAt);
        expect(lane).toMatchObject({
            targetTo: later,
            status: 'stale',
            complete: false,
            pending: null,
            error: { code: 'INVALID_INCOME_ROW' },
        });
        expect([...lane.rows.values()].some(item => item.tranId === 'uncommitted')).toBe(false);
    });

    it('rejects conflicting reliable income identities within and across continuation pages', async () => {
        const confirmed = await walkOneLane({
            rows: [incomeRow({ id: 'held', time: NOW - 5 * MINUTE })],
        });
        const retained = confirmed.lanes.FUNDING_FEE;
        const later = NOW + HOUR;
        const first = incomeRow({ id: '777', income: '-1', time: later - MINUTE });
        const conflicting = { ...first, income: '-9' };

        const samePage = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: confirmed.resource,
            incomeTypes: ['FUNDING_FEE'],
            readPage: async () => ({ rows: [first, conflicting] }),
        });
        expect(samePage.lanes.FUNDING_FEE).toMatchObject({
            rows: retained.rows,
            coveredFrom: retained.coveredFrom,
            coveredTo: retained.coveredTo,
            status: 'stale',
            complete: false,
            pending: null,
            error: { code: 'CONFLICTING_INCOME_IDENTITY' },
        });

        const limits = {
            ...FUTURES_SETTLED_LANE_WALK,
            PAGE_LIMIT: 1,
            MAX_PAGES_PER_LANE: 1,
            MAX_PAGES_PER_TARGET: 4,
        };
        const firstPass = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: confirmed.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage: async () => ({ rows: [first] }),
        });
        expect(firstPass.lanes.FUNDING_FEE.pending?.rows.size).toBe(1);

        const resumed = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: firstPass.resource,
            incomeTypes: ['FUNDING_FEE'],
            limits,
            readPage: async () => ({ rows: [conflicting] }),
        });
        expect(resumed.lanes.FUNDING_FEE).toMatchObject({
            rows: retained.rows,
            coveredFrom: retained.coveredFrom,
            coveredTo: retained.coveredTo,
            status: 'stale',
            complete: false,
            pending: null,
            error: { code: 'CONFLICTING_INCOME_IDENTITY' },
        });
    });

    it.each([
        { status: 400, expected: true },
        { status: 408, expected: false },
        { status: 418, expected: false },
        { status: 429, expected: false },
        { status: 503, expected: false },
    ])('classifies HTTP $status per-lane automatic cooldown as $expected', ({
        status,
        expected,
    }) => {
        expect(futuresSettledLaneNeedsAutomaticCooldown({
            error: { code: 'EXCHANGE_REFUSAL', status },
        })).toBe(expected);
    });

    it('retains one failed lane transactionally while another lane advances', async () => {
        const incomeTypes = ['FUNDING_FEE', 'FEE_RETURN'];
        const initialRows = {
            FUNDING_FEE: [incomeRow({ id: '21' })],
            FEE_RETURN: [incomeRow({ incomeType: 'FEE_RETURN', id: '31', income: '0.20' })],
        };
        const initial = await walkFuturesSettledIncomeLanes({
            now: NOW,
            windowFrom: WINDOW_FROM,
            incomeTypes,
            readPage: async ({ incomeType }) => ({ rows: initialRows[incomeType] }),
        });
        const retained = initial.lanes.FEE_RETURN;
        const later = NOW + HOUR;

        const verified = await walkFuturesSettledIncomeLanes({
            now: later,
            windowFrom: WINDOW_FROM,
            held: initial.resource,
            incomeTypes,
            readPage: async ({ incomeType }) => {
                if (incomeType === 'FEE_RETURN') throw new Error('plain refusal');
                return {
                    rows: [
                        initialRows.FUNDING_FEE[0],
                        incomeRow({ id: '22', time: later - MINUTE }),
                    ],
                };
            },
        });

        expect(verified.failed).toBe(true);
        expect(verified.attemptsByType).toEqual({ FUNDING_FEE: 1, FEE_RETURN: 1 });
        expect(verified.lanes.FUNDING_FEE.coveredTo).toBe(later);
        expect(verified.lanes.FUNDING_FEE.rows.size).toBe(2);
        expect(verified.lanes.FEE_RETURN.status).toBe('stale');
        expect(verified.lanes.FEE_RETURN.rows).toEqual(retained.rows);
        expect(verified.lanes.FEE_RETURN.coveredFrom).toBe(retained.coveredFrom);
        expect(verified.lanes.FEE_RETURN.coveredTo).toBe(retained.coveredTo);
        expect(verified.lanes.FEE_RETURN.successfulAt).toBe(retained.successfulAt);
        expect(verified.status).toBe('stale');
        expect(verified.complete).toBe(false);
    });
});

describe('the canonical settled-income v2 store', () => {
    let directory;
    let store;
    const fingerprint = 'canonical-account-fingerprint';

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trade-income-v2-'));
        store = createFuturesSettledIncomeStore({ directory, logger: { warn: () => {} } });
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('round-trips exact identifiers, digest and generation', async () => {
        const tranId = '90071992547409931234';
        const walked = await walkOneLane({ rows: [incomeRow({ id: tranId })] });

        expect(store.saveResource({ fingerprint, resource: walked.resource })).toBe(true);
        const loaded = store.loadResource({
            fingerprint,
            windowFrom: WINDOW_FROM,
            now: NOW,
            incomeTypes: ['FUNDING_FEE'],
        });
        const written = JSON.parse(fs.readFileSync(
            path.join(directory, FUTURES_SETTLED_STORE_FILE),
            'utf8',
        ));

        expect(written.version).toBe(2);
        expect(written.lanes[0].rows[0].tranId).toBe(tranId);
        expect(loaded.digest).toBe(walked.digest);
        expect(loaded.generation).toBe(walked.generation);
        expect([...loaded.rows.values()][0].tranId).toBe(tranId);
    });

    it('rejects numeric money restored from the persisted store', async () => {
        const walked = await walkOneLane({
            rows: [incomeRow({ id: 'numeric-store-money', income: '-1.00' })],
        });
        expect(store.saveResource({ fingerprint, resource: walked.resource })).toBe(true);

        const file = path.join(directory, FUTURES_SETTLED_STORE_FILE);
        const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
        // A JSON number has already discarded its source decimal spelling. It
        // must not regain authority merely because its rounded value happens
        // to equal the canonical string and therefore the stored digest.
        persisted.lanes[0].rows[0].income = -1;
        fs.writeFileSync(file, JSON.stringify(persisted));

        expect(store.loadResource({
            fingerprint,
            windowFrom: WINDOW_FROM,
            now: NOW,
            incomeTypes: ['FUNDING_FEE'],
        })).toBeNull();
    });

    it('loads bounded rollback debt but rejects the same future ready authority', () => {
        const confirmationNotBefore = NOW + 2 * MINUTE;
        const debt = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    rows: [incomeRow({ id: 'store-rollback', time: NOW })],
                    coveredFrom: WINDOW_FROM,
                    coveredTo: NOW,
                    targetTo: NOW,
                    status: 'stale',
                    attemptedAt: NOW,
                    successfulAt: NOW,
                    confirmationNotBefore,
                    complete: false,
                }),
            },
            generation: 7,
        });
        expect(store.saveResource({ fingerprint, resource: debt })).toBe(true);

        const restored = store.loadResource({
            fingerprint,
            windowFrom: WINDOW_FROM,
            now: NOW - 1,
            incomeTypes: ['FUNDING_FEE'],
        });
        expect(restored?.lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
            coveredTo: NOW - 1,
            targetTo: NOW,
            confirmationNotBefore,
        });
        expect(restored?.lanes.FUNDING_FEE.rows.size).toBe(0);

        const ready = createFuturesSettledIncomeResource({
            incomeTypes: ['FUNDING_FEE'],
            lanes: {
                FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                    ...debt.lanes.FUNDING_FEE,
                    status: 'ready',
                    confirmationNotBefore: null,
                    complete: true,
                }),
            },
            generation: 8,
        });
        expect(store.saveResource({ fingerprint, resource: ready })).toBe(true);
        expect(store.loadResource({
            fingerprint,
            windowFrom: WINDOW_FROM,
            now: NOW - 1,
            incomeTypes: ['FUNDING_FEE'],
        })).toBeNull();
    });

    it('serializes each source row once while still rejecting a stale digest', async () => {
        const walked = await walkOneLane({ rows: [incomeRow({ id: 'save-once' })] });
        const resource = walked.resource;
        const lane = resource.lanes.FUNDING_FEE;
        const canonical = [...lane.rows.values()][0];
        let incomeReads = 0;
        const observed = {
            ...canonical,
            get income() {
                incomeReads += 1;
                return canonical.income;
            },
        };
        lane.rows = new Map([[canonical.identity, observed]]);
        resource.digest = futuresSettledIncomeContentDigest(resource);
        incomeReads = 0;

        expect(store.saveResource({ fingerprint, resource })).toBe(true);
        // Bounded canonicalization captures the source once. More reads would
        // mean another full-row canonicalization pass or a split validation.
        expect(incomeReads).toBe(1);
        const written = fs.readFileSync(path.join(directory, FUTURES_SETTLED_STORE_FILE), 'utf8');

        lane.rows.set('mutated-after-digest', incomeRow({ id: '9002' }));
        expect(store.saveResource({ fingerprint, resource })).toBe(false);
        expect(fs.readFileSync(path.join(directory, FUTURES_SETTLED_STORE_FILE), 'utf8'))
            .toBe(written);
    });

    it('rejects wholly expired and inverted cached coverage', async () => {
        const walked = await walkOneLane({ rows: [incomeRow({ id: '41' })] });
        expect(store.saveResource({ fingerprint, resource: walked.resource })).toBe(true);

        expect(store.loadResource({
            fingerprint,
            windowFrom: NOW + HOUR,
            now: NOW + 2 * HOUR,
            incomeTypes: ['FUNDING_FEE'],
        })).toBeNull();

        const inverted = JSON.parse(fs.readFileSync(
            path.join(directory, FUTURES_SETTLED_STORE_FILE),
            'utf8',
        ));
        inverted.lanes[0].coveredFrom = NOW;
        inverted.lanes[0].coveredTo = NOW - 1;
        fs.writeFileSync(
            path.join(directory, FUTURES_SETTLED_STORE_FILE),
            JSON.stringify(inverted),
        );
        expect(store.loadResource({
            fingerprint,
            windowFrom: WINDOW_FROM,
            now: NOW,
            incomeTypes: ['FUNDING_FEE'],
        })).toBeNull();
    });

    it('migrates a v1 union only as stale rows without promoted coverage', () => {
        const tranId = '90071992547409939999';
        fs.writeFileSync(path.join(directory, FUTURES_SETTLED_STORE_FILE), JSON.stringify({
            version: 1,
            fingerprint,
            rows: [incomeRow({ id: tranId })],
            from: WINDOW_FROM,
            to: NOW,
            verifiedAt: NOW - MINUTE,
        }));

        const migrated = store.loadResource({
            fingerprint,
            windowFrom: WINDOW_FROM,
            now: NOW,
        });

        expect(migrated.migration).toBe('legacy-unverified');
        expect(migrated.status).toBe('stale');
        expect(migrated.coveredFrom).toBeNull();
        expect(migrated.coveredTo).toBeNull();
        expect(migrated.successfulAt).toBeNull();
        expect(migrated.complete).toBe(false);
        expect([...migrated.rows.values()][0].tranId).toBe(tranId);
    });
});
