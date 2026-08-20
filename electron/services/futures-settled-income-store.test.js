import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    FUTURES_SETTLED_STORE_FILE,
    compareFuturesSettledReadings,
    createFuturesSettledIncomeStore,
    futuresAccountFingerprint,
} from './futures-settled-income-store.js';
import { futuresIncomeRowKey } from './futures-settled-income-walk.js';

const NOW = Date.parse('2026-08-20T20:00:00.000Z');
const WINDOW_FROM = NOW - 7 * 24 * 60 * 60 * 1000;
const KEY = 'a-futures-api-key-that-must-never-be-written';
const SECRET = 'a-futures-api-secret-that-must-never-be-written';

const row = (time, tranId, income = '-1.5') => ({
    symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income, asset: 'USDT', time, tranId,
});

const heldOf = (rows, { from = WINDOW_FROM, to = NOW, slice = null } = {}) => ({
    rows: new Map(rows.map(entry => [futuresIncomeRowKey(entry), entry])),
    from,
    to,
    slice,
});

describe('the settled income store', () => {
    let directory = null;
    let store = null;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trade-store-'));
        store = createFuturesSettledIncomeStore({ directory, logger: { warn: () => {} } });
    });
    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    const fingerprint = futuresAccountFingerprint(KEY);

    it('hands back what it was given, keyed the way the walk keys it', () => {
        const rows = [row(NOW - 3_600_000, 'one'), row(NOW - 7_200_000, 'two')];
        expect(store.save({ fingerprint, held: heldOf(rows), verifiedAt: NOW })).toBe(true);

        const loaded = store.load({ fingerprint, windowFrom: WINDOW_FROM, now: NOW });
        expect(loaded.rows.size).toBe(2);
        expect(loaded.from).toBe(WINDOW_FROM);
        expect(loaded.to).toBe(NOW);
        expect(loaded.verifiedAt).toBe(NOW);
        // The walk resumes rather than restarts, and a half-read chunk is not
        // resumed at all: coverage it could be wrong about is coverage it must
        // find again.
        expect(loaded.gap).toBeNull();
    });

    // The one rule that cannot be got wrong once. A desk started against another
    // account showing the previous one's money is not a stale figure, it is
    // somebody else's money on the screen.
    it('will not hand one account the reading of another', () => {
        store.save({ fingerprint, held: heldOf([row(NOW - 3_600_000, 'one')]), verifiedAt: NOW });
        const other = futuresAccountFingerprint('a-different-key');
        expect(other).not.toBe(fingerprint);
        expect(store.load({ fingerprint: other, windowFrom: WINDOW_FROM, now: NOW })).toBeNull();
    });

    it('writes a digest of the credential and no part of the credential', () => {
        store.save({ fingerprint, held: heldOf([row(NOW - 3_600_000, 'one')]), verifiedAt: NOW });
        const written = fs.readFileSync(path.join(directory, FUTURES_SETTLED_STORE_FILE), 'utf8');
        expect(written).not.toContain(KEY);
        expect(written).not.toContain(SECRET);
        // Not a prefix of it either — a fingerprint that leaks eight characters
        // of a key is a leak of eight characters of a key.
        for (let length = 6; length <= 16; length += 1) {
            expect(written).not.toContain(KEY.slice(0, length));
        }
        expect(written).toContain(fingerprint);
    });

    // A file that cannot state the span it covers cannot be told from a complete
    // record. That is the failure every rule on this path exists to prevent, and
    // a file makes it permanent.
    it.each([
        ['no coverage', { version: 1, fingerprint, rows: [] }],
        ['a start after its end', { version: 1, fingerprint, rows: [], from: NOW, to: NOW - 1 }],
        ['an edge in the future', { version: 1, fingerprint, rows: [], from: WINDOW_FROM, to: NOW + 60_000 }],
        ['a scheme this desk no longer uses', { version: 99, fingerprint, rows: [], from: WINDOW_FROM, to: NOW }],
        ['rows that are not rows', { version: 1, fingerprint, rows: 'plenty', from: WINDOW_FROM, to: NOW }],
    ])('discards a kept reading with %s', (unused, payload) => {
        fs.writeFileSync(path.join(directory, FUTURES_SETTLED_STORE_FILE), JSON.stringify(payload));
        expect(store.load({ fingerprint, windowFrom: WINDOW_FROM, now: NOW })).toBeNull();
    });

    it('discards a file that is not readable at all', () => {
        fs.writeFileSync(path.join(directory, FUTURES_SETTLED_STORE_FILE), '{"version":1,');
        expect(store.load({ fingerprint, windowFrom: WINDOW_FROM, now: NOW })).toBeNull();
    });

    // The window slides. A file carrying a week that has aged out would state
    // money against positions whose other side the desk can no longer read.
    it('drops what has aged out of the window', () => {
        const rows = [row(NOW - 3_600_000, 'inside'), row(WINDOW_FROM - 60_000, 'aged-out')];
        store.save({ fingerprint, held: heldOf(rows, { from: WINDOW_FROM - 120_000 }), verifiedAt: NOW });

        const loaded = store.load({ fingerprint, windowFrom: WINDOW_FROM, now: NOW });
        expect([...loaded.rows.values()].map(entry => entry.tranId)).toEqual(['inside']);
        // And the claim comes up to the window rather than staying below it, so
        // a reading that was complete when it was written is complete now.
        expect(loaded.from).toBe(WINDOW_FROM);
    });

    it('is absent, not empty, before anything has been kept', () => {
        expect(store.load({ fingerprint, windowFrom: WINDOW_FROM, now: NOW })).toBeNull();
    });
});

describe('comparing a kept reading against the exchange', () => {
    const held = new Map([
        ['FUNDING_FEE:one', row(NOW - 3_600_000, 'one')],
        ['FUNDING_FEE:two', row(NOW - 7_200_000, 'two')],
        ['FUNDING_FEE:old', row(NOW - 9 * 3_600_000, 'old')],
    ]);

    it('names a row the exchange no longer states', () => {
        const fresh = new Map([['FUNDING_FEE:one', row(NOW - 3_600_000, 'one')]]);
        expect(compareFuturesSettledReadings(held, fresh, NOW - 8 * 3_600_000))
            .toEqual({ missing: 1, differing: 0 });
    });

    it('names a row the exchange restates differently', () => {
        const fresh = new Map([
            ['FUNDING_FEE:one', row(NOW - 3_600_000, 'one', '-9.99')],
            ['FUNDING_FEE:two', row(NOW - 7_200_000, 'two')],
        ]);
        expect(compareFuturesSettledReadings(held, fresh, NOW - 8 * 3_600_000))
            .toEqual({ missing: 0, differing: 1 });
    });

    // A held row older than the span the fresh read reached was never asked
    // about. Counting it as missing reports the walk's own budget as the
    // exchange contradicting itself — and that number would be read as a store
    // that cannot be trusted.
    it('judges only what the fresh read actually covered', () => {
        const fresh = new Map([
            ['FUNDING_FEE:one', row(NOW - 3_600_000, 'one')],
            ['FUNDING_FEE:two', row(NOW - 7_200_000, 'two')],
        ]);
        expect(compareFuturesSettledReadings(held, fresh, NOW - 8 * 3_600_000))
            .toEqual({ missing: 0, differing: 0 });
    });
});
