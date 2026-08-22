// What the desk already read of the income record, kept between runs.
//
// The reading itself is cheap now — six requests answer a week — but a desk
// that is relaunched twelve times in ninety minutes pays that cold start twelve
// times for a record that did not change. The operator's journal for
// 2026-08-20 is exactly that shape: twelve `bootstrap` account reads and seven
// `stream` settled reads in an hour and a half, on a desk meant to bootstrap
// once. Every save under `electron/**` relaunches it.
//
// So this is a way of not asking again for what was already answered. It is
// never an authority. Everything it hands back is re-verified against the
// exchange within the hour, and anything the exchange no longer states is
// dropped — a recomputed reading that is wrong is wrong until the next pass,
// while a kept one is wrong until somebody notices.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
    DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
    FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
    canonicalFuturesIncomeRow,
    createFuturesSettledIncomeLane,
    createFuturesSettledIncomeResource,
    restoreFuturesSettledIncomeResource,
    serializeFuturesSettledIncomeResource,
} from '../../src/utils/futuresSettledIncomeResource.js';
import { futuresIncomeRowKey } from './futures-settled-income-walk.js';

// Version one is retained for the legacy load/save API. New integrations use
// loadResource/saveResource and persist the canonical resource version.
export const FUTURES_SETTLED_STORE_VERSION = 1;
export const FUTURES_SETTLED_RESOURCE_STORE_VERSION = FUTURES_SETTLED_INCOME_RESOURCE_VERSION;
export const FUTURES_SETTLED_STORE_FILE = 'futures-settled-income.json';

// Which account this reading belongs to, stated so that the credential cannot be
// recovered from it. A desk started against another account must not be shown
// the previous one's money, and the only thing on hand that tells two accounts
// apart is the key — which is why what is written is a digest of it and never
// any part of the key itself.
export const futuresAccountFingerprint = (credential) => {
    if (typeof credential !== 'string' || credential.length === 0) return null;
    return createHash('sha256').update(credential).digest('hex').slice(0, 16);
};

const isFiniteNumber = value => Number.isFinite(value);

// The walk's own definition of a complete reading, restated where the merge can
// reach it: coverage that reaches the start of the window asked for.
const coversWindow = (from, windowFrom) => (
    isFiniteNumber(from) && isFiniteNumber(windowFrom) && from <= windowFrom
);

const migrateLegacyFuturesSettledPayload = (payload, {
    incomeTypes,
    windowFrom,
    now,
}) => {
    if (!Array.isArray(payload?.rows)) return null;
    if (!isFiniteNumber(payload.from) || !isFiniteNumber(payload.to)) return null;
    if (payload.from > payload.to || payload.to > now) return null;

    const types = incomeTypes.map(value => String(value).toUpperCase());
    const laneRows = Object.fromEntries(types.map(type => [type, new Map()]));
    for (const raw of payload.rows) {
        const row = canonicalFuturesIncomeRow(raw);
        if (row === null || laneRows[row.incomeType] === undefined) continue;
        if (row.time < windowFrom || row.time > now) continue;
        laneRows[row.incomeType].set(row.identity, row);
    }

    const lanes = Object.fromEntries(types.map(type => [
        type,
        createFuturesSettledIncomeLane(type, {
            rows: laneRows[type],
            // A v1 file stated one union span. It cannot prove that every type
            // enumerated every page in that span, so migration deliberately
            // carries rows but no per-type coverage or successful timestamp.
            coveredFrom: null,
            coveredTo: null,
            targetTo: payload.to,
            status: 'stale',
            attemptedAt: isFiniteNumber(payload.verifiedAt) ? payload.verifiedAt : null,
            successfulAt: null,
            complete: false,
            error: {
                code: 'LEGACY_UNVERIFIED',
                message: 'Stored v1 union requires a per-income-type verification pass',
            },
        }),
    ]));
    const resource = createFuturesSettledIncomeResource({ lanes, generation: 0 });
    resource.migration = 'legacy-unverified';
    return resource;
};

export const createFuturesSettledIncomeStore = ({ directory, logger = console } = {}) => {
    const file = directory ? path.join(directory, FUTURES_SETTLED_STORE_FILE) : null;

    return {
        file,

        /**
         * The reading held for this account, bounded to the window asked for.
         *
         * Null for every reason a file can fail to be a reading: absent,
         * unreadable, written by a scheme this desk no longer uses, belonging to
         * another account, or unable to state the span it covers. A file that
         * cannot say what it covers cannot be told from a complete record, which
         * is the one failure every rule on this path exists to prevent — and
         * writing it down makes it permanent.
         */
        load({ fingerprint, windowFrom, now }) {
            if (file === null || fingerprint === null) return null;
            let parsed = null;
            try {
                parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    logger.warn?.('[futures-settled] kept reading unreadable:', error?.message);
                }
                return null;
            }
            if (parsed?.version !== FUTURES_SETTLED_STORE_VERSION) return null;
            if (parsed.fingerprint !== fingerprint) return null;
            if (!Array.isArray(parsed.rows)) return null;
            if (!isFiniteNumber(parsed.from) || !isFiniteNumber(parsed.to)) return null;
            if (parsed.from > parsed.to) return null;
            // An edge in the future is a clock that moved, not a reading. Trusting
            // it would leave the tail unread from an instant that has not happened.
            if (parsed.to > now) return null;

            const rows = new Map();
            for (const row of parsed.rows) {
                // The window slides. A file carrying a week that has aged out
                // would state money against positions the desk can no longer
                // read the other side of.
                if (!isFiniteNumber(row?.time) || row.time < windowFrom || row.time > now) continue;
                rows.set(futuresIncomeRowKey(row), row);
            }
            return {
                rows,
                // Coverage below the window is coverage of nothing. Raising the
                // claim to the window's start is what keeps a reading that was
                // complete when it was written complete now.
                from: Math.max(parsed.from, windowFrom),
                to: parsed.to,
                slice: isFiniteNumber(parsed.slice) && parsed.slice > 0 ? parsed.slice : null,
                // Never restored. A chunk half-read when the desk went down is
                // state that can be wrong about coverage, and the walk finds the
                // same gap again from `from` and `to` alone.
                gap: null,
                verifiedAt: isFiniteNumber(parsed.verifiedAt) ? parsed.verifiedAt : null,
            };
        },

        /**
         * Writes the reading, replacing whatever was there.
         *
         * Through a temporary file and a rename: a desk killed mid-write would
         * otherwise leave a truncated file, and a truncated reading that still
         * parses is the one failure mode worse than no file at all.
         *
         * Synchronously, on the main process, on purpose. Measured at the walk's
         * own ceiling of 24 000 rows it is 2.95 MB in **10.9 ms**; the operator's
         * account holds 46 rows, which is about seven kilobytes. A handful of
         * passes an hour at that cost is not worth the failure modes of doing it
         * asynchronously beside a file that must never be half-written.
         */
        save({ fingerprint, held, verifiedAt = null }) {
            if (file === null || fingerprint === null) return false;
            if (!held || !(held.rows instanceof Map)) return false;
            if (!isFiniteNumber(held.from) || !isFiniteNumber(held.to)) return false;
            const payload = {
                version: FUTURES_SETTLED_STORE_VERSION,
                fingerprint,
                from: held.from,
                to: held.to,
                slice: isFiniteNumber(held.slice) ? held.slice : null,
                verifiedAt,
                rows: [...held.rows.values()],
            };
            const temporary = `${file}.writing`;
            try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(temporary, JSON.stringify(payload));
                fs.renameSync(temporary, file);
                return true;
            } catch (error) {
                logger.warn?.('[futures-settled] kept reading not written:', error?.message);
                try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
                return false;
            }
        },

        /**
         * Loads the canonical v2 resource. A v1 union is accepted only as stale,
         * unverified migration input: its rows survive, but none of its shared
         * coverage or success claims are promoted into a per-type lane.
         */
        loadResource({
            fingerprint,
            windowFrom,
            now,
            incomeTypes = DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
        }) {
            if (file === null || fingerprint === null) return null;
            if (!Number.isSafeInteger(windowFrom)
                || !Number.isSafeInteger(now)
                || windowFrom > now) return null;
            let parsed = null;
            try {
                parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    logger.warn?.('[futures-settled] kept resource unreadable:', error?.message);
                }
                return null;
            }
            if (parsed?.fingerprint !== fingerprint) return null;
            if (parsed.version === FUTURES_SETTLED_STORE_VERSION) {
                return migrateLegacyFuturesSettledPayload(parsed, {
                    incomeTypes,
                    windowFrom,
                    now,
                });
            }
            if (parsed.version !== FUTURES_SETTLED_RESOURCE_STORE_VERSION) return null;
            return restoreFuturesSettledIncomeResource(parsed, {
                incomeTypes,
                windowFrom,
                now,
            });
        },

        /**
         * Atomically writes a canonical resource. Its digest is checked before
         * touching disk so a caller cannot persist a mutated Map under the old
         * generation and make an amount correction invisible after restart.
         */
        saveResource({ fingerprint, resource }) {
            if (file === null || fingerprint === null) return false;
            if (resource?.version !== FUTURES_SETTLED_RESOURCE_STORE_VERSION) return false;
            const serialized = serializeFuturesSettledIncomeResource(resource);
            if (resource.digest !== serialized.digest) return false;
            const payload = {
                ...serialized,
                fingerprint,
            };
            const temporary = `${file}.writing`;
            try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(temporary, JSON.stringify(payload));
                fs.renameSync(temporary, file);
                return true;
            } catch (error) {
                logger.warn?.('[futures-settled] kept resource not written:', error?.message);
                try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
                return false;
            }
        },

        forget() {
            if (file === null) return;
            try { fs.unlinkSync(file); } catch { /* nothing to forget */ }
        },
    };
};

/**
 * What the desk holds after a verification pass.
 *
 * A verification walks from nothing so that the exchange can contradict what is
 * held — and that is the whole hazard. What the fresh walk does not reach, it
 * has not contradicted, and adopting it wholesale throws away rows nobody
 * disagreed with. Two ways that bites, and the second is the one that matters:
 *
 * - a walk that spends its page budget without reaching the window's start
 *   would shrink a complete reading to a partial one, and the shrunken version
 *   would then be written to disk and inherited by the next restart;
 * - a walk whose first request is **refused** would replace the whole reading
 *   with almost nothing. The walk keeps its own rows through a refusal for
 *   exactly this reason — "rows already held are money the desk can account
 *   for" — and starting it from nothing defeats that on the one path that
 *   starts it from nothing.
 *
 * So the exchange's answer stands only across the span it actually covered, the
 * held rows stand below it, and the coverage claimed is the union of the two —
 * but only where the two spans touch. Where they do not, the fresh reading
 * stands alone rather than claim a contiguous span across a hole in it.
 */
export const mergeVerifiedFuturesSettledReading = (held, fresh, windowFrom) => {
    if (!held || held.from === null || !(held.rows instanceof Map)) return fresh;
    if (!fresh || !(fresh.rows instanceof Map)) return held;
    // Refused part-way: not a verdict on anything. Keep what was held and take
    // whatever the attempt did bring back, since a row is a row.
    if (fresh.failed) {
        const rows = new Map(held.rows);
        for (const [key, row] of fresh.rows) rows.set(key, row);
        return {
            ...held,
            rows,
            to: Math.max(held.to, isFiniteNumber(fresh.to) ? fresh.to : held.to),
            slice: isFiniteNumber(fresh.slice) ? fresh.slice : held.slice,
            complete: coversWindow(held.from, windowFrom),
        };
    }
    if (!isFiniteNumber(fresh.from)) return held;
    // A hole between what was held and what was just read. Claiming the union
    // would claim the hole, which is the one thing a reading may never do.
    if (fresh.from > held.to) return fresh;
    const rows = new Map(fresh.rows);
    for (const [key, row] of held.rows) {
        // Inside the fresh span the exchange has spoken, including by silence.
        if (isFiniteNumber(row?.time) && row.time >= fresh.from) continue;
        rows.set(key, row);
    }
    const from = Math.min(held.from, fresh.from);
    return {
        ...fresh,
        rows,
        from,
        to: Math.max(held.to, fresh.to),
        // Recomputed, never carried over. `complete` is a statement about
        // `from`, and the merge is what moves `from` — a flag inherited from the
        // fresh walk would say "partial" over a reading that reaches the
        // window's start, which is the same lie in the other direction.
        complete: coversWindow(from, windowFrom),
    };
};

/**
 * What a fresh reading of the window says about the one that was held.
 *
 * Counted rather than reported in detail, because this runs into the desk's
 * record and that record carries no money. Only rows inside the span the fresh
 * read actually covered are judged: a held row older than that was not asked
 * about, and calling it missing would report the walk's own budget as the
 * exchange contradicting itself.
 */
export const compareFuturesSettledReadings = (held, fresh, coveredFrom) => {
    let missing = 0;
    let differing = 0;
    for (const [key, row] of held instanceof Map ? held : new Map()) {
        if (!isFiniteNumber(row?.time) || row.time < coveredFrom) continue;
        const answered = fresh instanceof Map ? fresh.get(key) : undefined;
        if (answered === undefined) {
            missing += 1;
            continue;
        }
        if (String(answered.income) !== String(row.income)) differing += 1;
    }
    return { missing, differing };
};
