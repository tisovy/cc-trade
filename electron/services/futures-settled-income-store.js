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

import { futuresIncomeRowKey } from './futures-settled-income-walk.js';

export const FUTURES_SETTLED_STORE_VERSION = 1;
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

        forget() {
            if (file === null) return;
            try { fs.unlinkSync(file); } catch { /* nothing to forget */ }
        },
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
