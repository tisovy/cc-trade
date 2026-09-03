import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
    DESK_DIAGNOSTIC_RECORD,
    DESK_DIAGNOSTICS_UNRECORDED,
    createDeskDiagnosticRecord,
    describeDeskDiagnosticEvent,
    readDeskDiagnosticCommandEvent,
    readDeskDiagnosticOutboundEvent,
} from './desk-diagnostic-record.js';

const DIRECTORY = '/desk/userData/diagnostics';
const AT = Date.parse('2026-08-11T14:20:31.482Z');

// A disk that states each file's size rather than deriving it, so a bound
// measured in megabytes can be reached without writing megabytes.
const createMemoryDisk = ({ failOn = new Set() } = {}) => {
    const files = new Map();
    const streams = [];
    const refuse = (stage, code) => {
        if (failOn.has(stage)) throw Object.assign(new Error(stage), { code });
    };
    const nameOf = target => path.basename(target);
    return {
        files,
        streams,
        seed: (name, { text = '', declared = null } = {}) => files.set(name, { text, declared }),
        contents: name => files.get(name)?.text ?? null,
        lines: name => (files.get(name)?.text ?? '')
            .split('\n')
            .filter(line => line !== '')
            .map(line => JSON.parse(line)),
        mkdirSync: () => {
            refuse('open', 'EACCES');
        },
        readdirSync: () => {
            refuse('list', 'EIO');
            return [...files.keys()];
        },
        statSync: (target) => {
            const file = files.get(nameOf(target));
            if (file === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return { size: file.declared ?? Buffer.byteLength(file.text, 'utf8') };
        },
        unlinkSync: (target) => {
            refuse('rotate', 'EPERM');
            files.delete(nameOf(target));
        },
        createWriteStream: (target) => {
            refuse('create', 'EMFILE');
            const name = nameOf(target);
            if (!files.has(name)) files.set(name, { text: '', declared: null });
            const handlers = new Map();
            const stream = {
                name,
                ended: false,
                stalled: false,
                write: (line) => {
                    refuse('write', 'ENOSPC');
                    const file = files.get(name);
                    files.set(name, { text: file.text + line, declared: file.declared });
                    // A stream past its buffer answers false and asks the writer
                    // to wait for `drain`.
                    return !stream.stalled;
                },
                drain: () => {
                    stream.stalled = false;
                    handlers.get('drain')?.();
                },
                end: () => {
                    stream.ended = true;
                },
                on: (event, handler) => {
                    handlers.set(event, handler);
                    return stream;
                },
                fail: error => handlers.get('error')?.(error),
            };
            streams.push(stream);
            return stream;
        },
    };
};

const createRecord = (disk, { at = AT, logger } = {}) => {
    const clock = { now: at };
    const warn = vi.fn();
    const record = createDeskDiagnosticRecord({
        directory: DIRECTORY,
        fileSystem: disk,
        now: () => clock.now,
        logger: logger ?? { warn },
    });
    return { record, clock, warn };
};

const TODAY = 'desk-2026-08-11-000.jsonl';

describe('describeDeskDiagnosticEvent', () => {
    it('keeps a fault under its declared fields and nothing else', () => {
        expect(describeDeskDiagnosticEvent('fault', {
            phase: 'book-recovery',
            code: 'DEPTH_SEQUENCE_GAP',
        })).toEqual({
            kind: 'fault',
            phase: 'book-recovery',
            code: 'DEPTH_SEQUENCE_GAP',
            symbol: null,
        });
    });

    // The answer to a command, which is what makes the command's own line
    // measurable rather than merely present.
    it('keeps a command answer under its declared fields and no amount beside it', () => {
        expect(describeDeskDiagnosticEvent('answer', {
            action: 'trade.placeOrder',
            market: 'futures',
            durationMs: 812,
            outcome: 'ok',
            symbol: 'TUTUSDT',
            identity: '1933678626',
            price: '0.0431',
        })).toEqual({
            kind: 'answer',
            action: 'trade.placeOrder',
            market: 'futures',
            durationMs: 812,
            outcome: 'ok',
            symbol: 'TUTUSDT',
            identity: '1933678626',
        });
        expect(describeDeskDiagnosticEvent('answer', {
            action: 'trade.placeOrder',
            market: 'futures',
            durationMs: -1,
            outcome: 'ok',
        })).toBeNull();
    });

    // The shape `RateLimiter.reserve` hands over, field for field. The risk this
    // covers is not that the limiter fails to call — it is that it calls with a
    // name or a word this file quietly drops, and the operator is left with the
    // same silence the record was added to end.
    it('keeps a deferred request under its declared fields', () => {
        expect(describeDeskDiagnosticEvent('deferred', {
            standing: 'urgent',
            waitedMs: 26_368,
            weight: 1,
            spent: 795,
            ceiling: 800,
        })).toEqual({
            kind: 'deferred',
            standing: 'urgent',
            waitedMs: 26_368,
            weight: 1,
            spent: 795,
            ceiling: 800,
        });
        // A standing this desk does not have is a call site that never stated
        // one, and losing the line is how the record says so.
        expect(describeDeskDiagnosticEvent('deferred', {
            standing: 'whenever',
            waitedMs: 26_368,
            weight: 1,
            spent: 795,
            ceiling: 800,
        })).toBeNull();
    });

    it('keeps only bounded physical-attempt aggregates from a Futures request', () => {
        expect(describeDeskDiagnosticEvent('request', {
            standing: 'urgent',
            attempts: 4,
            chargedWeight: 62,
            observedWeight: 781,
            backpressureMs: 2_000,
            connectionRetries: 1,
            networkRetries: 0,
            timestampRetries: 1,
            rateLimitResponses: 1,
            outcome: 'ok',
            status: 200,
            code: null,
            url: 'https://fapi.binance.com/private?signature=secret',
            headers: { authorization: 'secret' },
            body: { apiKey: 'secret' },
            amount: '123.45',
        })).toEqual({
            kind: 'request',
            standing: 'urgent',
            route: null,
            attempts: 4,
            chargedWeight: 62,
            observedWeight: 781,
            backpressureMs: 2_000,
            connectionRetries: 1,
            networkRetries: 0,
            timestampRetries: 1,
            rateLimitResponses: 1,
            outcome: 'ok',
            status: 200,
            code: null,
        });

        expect(describeDeskDiagnosticEvent('request', {
            standing: 'ordinary',
            attempts: 1,
            chargedWeight: 30,
            observedWeight: null,
            backpressureMs: 0,
            connectionRetries: 0,
            networkRetries: 0,
            timestampRetries: 0,
            rateLimitResponses: 0,
            outcome: 'error',
            status: 999,
            code: -1003,
        })).toBeNull();

        expect(describeDeskDiagnosticEvent('request', {
            standing: 'ordinary',
            attempts: 1,
            chargedWeight: 30,
            observedWeight: null,
            backpressureMs: 0,
            connectionRetries: 0,
            networkRetries: 0,
            timestampRetries: 0,
            rateLimitResponses: 0,
            outcome: 'error',
            status: 429,
            code: 'this field cannot repeat an exchange message',
        })).toMatchObject({ kind: 'request', status: 429, code: null });
    });

    // Why the desk went to the exchange for the signed account. Without it,
    // "the desk reads a lot" and "the desk reads when it must" are the same
    // number, and the operator has no way to tell which one they are looking at.
    it('keeps an account read under the reason the site stated', () => {
        expect(describeDeskDiagnosticEvent('read', {
            reason: 'unstated',
            resources: 2,
            weight: 10,
            balance: '1200.5',
        })).toEqual({
            kind: 'read',
            reason: 'unstated',
            resources: 2,
            weight: 10,
            heldBeats: null,
        });
        // A reason outside the vocabulary is a read site that never stated one.
        expect(describeDeskDiagnosticEvent('read', {
            reason: 'because it felt like it',
            resources: 4,
            weight: 90,
        })).toBeNull();
        expect(describeDeskDiagnosticEvent('read', {
            reason: null,
            resources: 4,
            weight: 90,
        })).toBeNull();
    });

    // Beats the desk held while the stream carried, stated on the pass that
    // ran next. Declared here because the record writes only declared fields:
    // asserted through the gate itself, a mocked record() proves nothing.
    it('keeps the held-beat count a read pass hands over', () => {
        expect(describeDeskDiagnosticEvent('read', {
            reason: 'refresh', resources: 4, weight: 90, heldBeats: 3,
        })).toEqual({
            kind: 'read', reason: 'refresh', resources: 4, weight: 90, heldBeats: 3,
        });
        // Present but malformed refuses the whole line, as any field does.
        expect(describeDeskDiagnosticEvent('read', {
            reason: 'refresh', resources: 4, weight: 90, heldBeats: -1,
        })).toBeNull();
        expect(describeDeskDiagnosticEvent('read', {
            reason: 'refresh', resources: 4, weight: 90, heldBeats: 2.5,
        })).toBeNull();
    });

    // What an open position has already been charged, counted but never priced.
    // The column built on this read was empty for a whole afternoon and the
    // record could not say whether the read had fired, been refused, or been
    // answered and sent to nobody.
    it('keeps a settled-income read as counts, and never the money it counted', () => {
        expect(describeDeskDiagnosticEvent('settled', {
            reason: 'refresh',
            order: 'ascending',
            pages: 1,
            reads: 6,
            attempts: 8,
            chargedWeight: 240,
            types: 6,
            lanes: 6,
            restored: 0,
            verified: 0,
            missing: 0,
            differing: 0,
            rows: 214,
            kept: 198,
            contracts: 6,
            fundingRows: 12,
            rebateRows: 9,
            rebateSymbolRows: 8,
            rebateTradeRows: 7,
            recipients: 1,
            coveredMs: 604800000,
            coverageGainedMs: 86400000,
            outcome: 'complete',
            code: null,
            funding: '-229.43',
            total: '-264.38',
        })).toEqual({
            kind: 'settled',
            reason: 'refresh',
            order: 'ascending',
            pages: 1,
            reads: 6,
            attempts: 8,
            chargedWeight: 240,
            types: 6,
            lanes: 6,
            restored: 0,
            verified: 0,
            missing: 0,
            differing: 0,
            rows: 214,
            kept: 198,
            contracts: 6,
            fundingRows: 12,
            rebateRows: 9,
            rebateSymbolRows: 8,
            rebateTradeRows: 7,
            recipients: 1,
            coveredMs: 604800000,
            coverageGainedMs: 86400000,
            outcome: 'complete',
            partialKind: null,
            awaitingLanes: null,
            code: null,
        });
    });

    // The fields a kind does not declare are dropped in silence: the payload
    // `recordSettled` builds carries `incomeTypes`, `generation` and `status`
    // too, and none of the three has ever reached the file. So the classifier
    // that tells an announced charge from a short read is asserted here, at the
    // boundary that decides what is written, and not only where the call site
    // hands its object over.
    it('writes which of the two states an incomplete settled pass was in', () => {
        const pass = (overrides = {}) => describeDeskDiagnosticEvent('settled', {
            reason: 'fill',
            order: 'descending',
            pages: 6,
            reads: 6,
            attempts: 6,
            chargedWeight: 180,
            types: 6,
            lanes: 6,
            restored: 0,
            verified: 0,
            missing: 0,
            differing: 0,
            rows: 77,
            kept: 77,
            contracts: 6,
            fundingRows: 12,
            rebateRows: 0,
            rebateSymbolRows: 0,
            rebateTradeRows: 0,
            recipients: 1,
            coveredMs: 604800000,
            coverageGainedMs: 0,
            outcome: 'partial',
            code: null,
            ...overrides,
        });

        expect(pass({ partialKind: 'debt-only', awaitingLanes: 1 })).toMatchObject({
            outcome: 'partial',
            partialKind: 'debt-only',
            awaitingLanes: 1,
        });
        expect(pass({ partialKind: 'short', awaitingLanes: 0 })).toMatchObject({
            partialKind: 'short',
            awaitingLanes: 0,
        });

        // A word this record does not know is a call site that classified
        // nothing, and losing the line is how it says so — the same rule the
        // reasons and outcomes are held to.
        expect(pass({ partialKind: 'maybe', awaitingLanes: 1 })).toBeNull();
        expect(pass({ partialKind: 'debt-only', awaitingLanes: -1 })).toBeNull();
    });

    // The account read's vocabulary has no word for a fill or a funding charge,
    // because neither is a reason to read the signed account. Sharing that list
    // would have dropped the two lines this record exists to carry.
    it('keeps the settled reasons the account read has no word for', () => {
        for (const reason of [
            'bootstrap',
            'stream',
            'fill',
            'funding',
            'settlement',
            'refresh',
            'confirm',
            'credit-confirm',
            'insurance',
            'insurance-confirm',
            'verification',
            'extension',
            'tick',
        ]) {
            expect(describeDeskDiagnosticEvent('settled', {
                reason,
                order: 'ascending',
                pages: 1,
                reads: 6,
                attempts: 6,
                chargedWeight: 180,
                types: 6,
                lanes: 6,
                restored: 0,
                verified: 0,
                missing: 0,
                differing: 0,
                rows: 0,
                kept: 0,
                contracts: 0,
                fundingRows: 0,
                rebateRows: 0,
                rebateSymbolRows: 0,
                rebateTradeRows: 0,
                recipients: 0,
                coveredMs: 0,
                coverageGainedMs: 0,
                outcome: 'complete',
                code: null,
            })).toMatchObject({ kind: 'settled', reason });
        }
        // And still a closed vocabulary: a caller cannot smuggle an unstated
        // scheduler path into the operator record.
        expect(describeDeskDiagnosticEvent('settled', {
            reason: 'not-a-scheduler-reason',
            order: 'ascending',
            pages: 1,
            reads: 6,
            attempts: 6,
            chargedWeight: 180,
            types: 6,
            lanes: 6,
            restored: 0,
            verified: 0,
            missing: 0,
            differing: 0,
            rows: 0,
            kept: 0,
            contracts: 0,
            fundingRows: 0,
            rebateRows: 0,
            rebateSymbolRows: 0,
            rebateTradeRows: 0,
            recipients: 0,
            coveredMs: 0,
            coverageGainedMs: 0,
            outcome: 'complete',
            code: null,
        })).toBeNull();
    });

    // The ordering the exchange answers in is the one fact the whole backward walk
    // rests on, and the endpoint documents it nowhere. A record that accepted any
    // word for it would answer the question with whatever the desk believed, which
    // is what it was believing already.
    it('keeps the measured wire ordering, and only the four it can mean', () => {
        for (const order of ['ascending', 'descending', 'flat', 'none']) {
            expect(describeDeskDiagnosticEvent('settled', {
                reason: 'refresh',
                order,
                pages: 1,
                reads: 6,
                attempts: 6,
                chargedWeight: 180,
                types: 6,
                lanes: 6,
                restored: 0,
                verified: 0,
                missing: 0,
                differing: 0,
                rows: 2,
                kept: 2,
                contracts: 1,
                fundingRows: 1,
                rebateRows: 0,
                rebateSymbolRows: 0,
                rebateTradeRows: 0,
                recipients: 1,
                coveredMs: 1000,
                coverageGainedMs: 1000,
                outcome: 'partial',
                code: null,
            })).toMatchObject({ order });
        }
        for (const order of ['unknown', 'oldest-first', '', 'ASCENDING']) {
            expect(describeDeskDiagnosticEvent('settled', {
                reason: 'refresh',
                order,
                pages: 1,
                reads: 6,
                attempts: 6,
                chargedWeight: 180,
                types: 6,
                lanes: 6,
                restored: 0,
                verified: 0,
                missing: 0,
                differing: 0,
                rows: 2,
                kept: 2,
                contracts: 1,
                fundingRows: 1,
                rebateRows: 0,
                rebateSymbolRows: 0,
                rebateTradeRows: 0,
                recipients: 1,
                coveredMs: 1000,
                coverageGainedMs: 1000,
                outcome: 'partial',
                code: null,
            })).toBeNull();
        }
    });

    // A refusal keeps its cause; a refusal the exchange named in a shape this
    // file will not repeat still keeps the fact that it happened.
    it('keeps why a settled read ended badly, and the line when it cannot', () => {
        expect(describeDeskDiagnosticEvent('settled', {
            reason: 'fill',
            order: 'ascending',
            pages: 2,
            reads: 12,
            attempts: 14,
            chargedWeight: 420,
            types: 6,
            lanes: 6,
            restored: 0,
            verified: 0,
            missing: 0,
            differing: 0,
            rows: 1000,
            kept: 0,
            contracts: 0,
            fundingRows: 0,
            rebateRows: 0,
            rebateSymbolRows: 0,
            rebateTradeRows: 0,
            recipients: 1,
            coveredMs: 604800000,
            coverageGainedMs: 86400000,
            outcome: 'failed',
            code: 'ETIMEDOUT',
        })).toMatchObject({ outcome: 'failed', code: 'ETIMEDOUT' });
        expect(describeDeskDiagnosticEvent('settled', {
            reason: 'fill',
            order: 'ascending',
            pages: 0,
            reads: 0,
            attempts: 0,
            chargedWeight: 0,
            types: 6,
            lanes: 6,
            restored: 0,
            verified: 0,
            missing: 0,
            differing: 0,
            rows: 0,
            kept: 0,
            contracts: 0,
            fundingRows: 0,
            rebateRows: 0,
            rebateSymbolRows: 0,
            rebateTradeRows: 0,
            recipients: 1,
            coveredMs: 604800000,
            coverageGainedMs: 0,
            outcome: 'abandoned',
            code: 'gave up',
        })).toMatchObject({ outcome: 'abandoned', code: null });
    });

    it('keeps only bounded basis-point estimate aggregates and counters', () => {
        expect(describeDeskDiagnosticEvent('estimate', {
            value: 'liquidation-price',
            compared: 2,
            unavailable: 1,
            deviationBps: 37,
            symbol: 'BTCUSDT',
        })).toEqual({
            kind: 'estimate',
            value: 'liquidation-price',
            compared: 2,
            unavailable: 1,
            deviationBps: 37,
            symbol: 'BTCUSDT',
        });
        expect(describeDeskDiagnosticEvent('estimate', {
            value: 'free-margin',
            compared: 0,
            unavailable: 1,
            deviationBps: null,
            symbol: null,
        })).not.toBeNull();

        for (const value of [37.5, -1, 1_000_001, '37']) {
            expect(describeDeskDiagnosticEvent('estimate', {
                value: 'notional', compared: 1, unavailable: 0,
                deviationBps: value, symbol: 'BTCUSDT',
            })).toBeNull();
        }
        // Estimate events are built for this record alone. Offering an amount
        // beside the ratio loses the whole line instead of merely stripping it.
        expect(describeDeskDiagnosticEvent('estimate', {
            value: 'notional', compared: 1, unavailable: 0,
            deviationBps: 0, symbol: 'BTCUSDT', price: '58400.25',
        })).toBeNull();
    });

    // The five marks a frame passes, written as the four gaps between them and
    // the whole. This is the line the operator's "the price crawled" complaint
    // gets answered from, so it has to say which step was slow and nothing about
    // what the frame was worth.
    it('keeps a frame timing as delays, and refuses an amount beside them', () => {
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'depth',
            symbol: 'ACEUSDT',
            upstreamMs: 345,
            queuedMs: 1,
            deliveredMs: 12,
            committedMs: 30,
            totalMs: 388,
        })).toEqual({
            kind: 'frame',
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'depth',
            symbol: 'ACEUSDT',
            upstreamMs: 345,
            queuedMs: 1,
            deliveredMs: 12,
            committedMs: 30,
            totalMs: 388,
            // A book is about a contract, not about an order. Stated as absent
            // rather than left off, so a reader never has to decide whether a
            // missing field means "no order" or "an older desk".
            identity: null,
            status: null,
        });
        // Built for this record alone, like an estimate: a price offered beside
        // the delays loses the whole line rather than being quietly dropped.
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'depth',
            symbol: 'ACEUSDT',
            upstreamMs: 345,
            queuedMs: 1,
            deliveredMs: 12,
            committedMs: 30,
            totalMs: 388,
            markPrice: '0.5321',
        })).toBeNull();
    });

    // The account lane's own line. The market lane answers "which step was slow";
    // this one has to answer "slow for which order, and did the screen change" —
    // and it has to do it without ever holding what the order was worth.
    it('names the order a frame was about, and what the exchange said about it', () => {
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'orders',
            symbol: 'TUTUSDT',
            upstreamMs: 210,
            queuedMs: 0,
            deliveredMs: 2,
            committedMs: 9,
            totalMs: 221,
            identity: 41,
            status: 'PARTIALLY_FILLED',
        })).toMatchObject({
            resource: 'orders',
            // Read as the `command` and `answer` lines read it, so a fill and
            // the order that was placed join without a second vocabulary.
            identity: '41',
            status: 'PARTIALLY_FILLED',
        });

        // A frame that arrived and left the screen as it was. Recorded, because
        // the absence of a line is what an operator reporting exactly this has
        // been up against.
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'UNCHANGED',
            resource: 'orders',
            symbol: 'TUTUSDT',
            upstreamMs: null,
            queuedMs: 0,
            deliveredMs: 1,
            committedMs: 4,
            totalMs: 5,
            identity: 'f-msyt8v4t-wwtt56je',
            status: 'FILLED',
        })).toMatchObject({ code: 'UNCHANGED', identity: 'f-msyt8v4t-wwtt56je' });

        // And the reading that is a fault: the exchange said something about an
        // order and the screen does not show it.
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'NOT_DRAWN',
            resource: 'orders',
            symbol: 'TUTUSDT',
            upstreamMs: 190,
            queuedMs: 0,
            deliveredMs: 1,
            committedMs: 2,
            totalMs: 193,
            identity: 41,
            status: 'PARTIALLY_FILLED',
        })).toMatchObject({ code: 'NOT_DRAWN', status: 'PARTIALLY_FILLED' });

        // The one thing this line may not become. A filled *quantity* is an
        // amount, and the state above is what a partial fill is read by instead.
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'orders',
            symbol: 'TUTUSDT',
            upstreamMs: 210,
            queuedMs: 0,
            deliveredMs: 2,
            committedMs: 9,
            totalMs: 221,
            identity: 41,
            status: 'PARTIALLY_FILLED',
            executedQty: '2.5',
        })).toBeNull();

        // A state in a shape this file will not repeat costs the whole line, as
        // every other sealed field does: half a fact is worse than none.
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'orders',
            symbol: 'TUTUSDT',
            upstreamMs: 210,
            queuedMs: 0,
            deliveredMs: 2,
            committedMs: 9,
            totalMs: 221,
            identity: 41,
            status: '0.5',
        })).toBeNull();
    });

    // A frame whose payload states no event time, and a frame whose stated event
    // time is ahead of when this process received it, are the same case: there is
    // no upstream leg to report. Both say so with null. Reporting 0 would claim
    // the exchange reached the desk instantly, which is the one answer that would
    // send someone looking in the wrong place.
    it('states an unmeasurable upstream leg as null and still marks the rest', () => {
        expect(describeDeskDiagnosticEvent('frame', {
            phase: 'frame',
            code: 'DELIVERED',
            resource: 'candles',
            symbol: 'ACEUSDT',
            upstreamMs: null,
            queuedMs: 0,
            deliveredMs: 4,
            committedMs: 9,
            totalMs: 13,
        })).toMatchObject({ upstreamMs: null, queuedMs: 0, deliveredMs: 4, committedMs: 9 });
        // Every other leg is measured on one clock, so absence there is a caller
        // that did not take the mark rather than a leg that cannot be timed.
        for (const missing of ['queuedMs', 'deliveredMs', 'committedMs', 'totalMs']) {
            expect(describeDeskDiagnosticEvent('frame', {
                phase: 'frame',
                code: 'DELIVERED',
                resource: 'depth',
                symbol: 'ACEUSDT',
                upstreamMs: 345,
                queuedMs: 1,
                deliveredMs: 12,
                committedMs: 30,
                totalMs: 388,
                [missing]: null,
            })).toBeNull();
        }
    });

    // The rule that lets a delay sit in this file at all: it is a count, and a
    // count cannot spell a decimal. The moment one of these accepted `0.5` it
    // would be a field an amount could arrive under.
    //
    // A guard, not a proof, and it is named one because it cannot be anything
    // else: run against the tree before the `frame` kind existed it passes, since
    // an unknown kind is refused whatever it carries. It bites only on a future
    // change that widens one of these fields off `count`, which is exactly the
    // change worth stopping.
    it('guards: refuses a delay that is not a whole count of milliseconds', () => {
        for (const bad of [0.5, -1, '12', Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
            expect(describeDeskDiagnosticEvent('frame', {
                phase: 'frame',
                code: 'DELIVERED',
                resource: 'depth',
                symbol: 'ACEUSDT',
                upstreamMs: 345,
                queuedMs: 1,
                deliveredMs: bad,
                committedMs: 30,
                totalMs: 388,
            })).toBeNull();
        }
    });

    it('names the byte count a refused frame reported', () => {
        expect(describeDeskDiagnosticEvent('timing', {
            phase: 'oversized-frame:40657',
            durationMs: 0,
            outcome: 'error',
            cache: null,
        })).toMatchObject({ phase: 'oversized-frame:40657', outcome: 'error', cache: null });
    });

    // Every shape below was observed coming out of the live desk. A vocabulary
    // narrower than what the desk actually states does not fail loudly — it
    // drops the line, which is how the exchange-info reads went missing while
    // every test still passed.
    it('accepts every shape the desk was seen to state', () => {
        for (const value of [
            { phase: 'exchange-info', durationMs: 1_705, outcome: 'ok', cache: 'miss' },
            { phase: 'exchange-info', durationMs: 0, outcome: 'ok', cache: 'hit' },
            { phase: 'contract-klines', durationMs: 351, outcome: 'ok', cache: null },
            { phase: 'index-klines', durationMs: 706, outcome: 'ok', cache: null },
            { phase: 'premium-index', durationMs: 707, outcome: 'ok', cache: null },
            { phase: 'ticker', durationMs: 708, outcome: 'ok', cache: null },
            { phase: 'upstream-streams', durationMs: 1_323, outcome: 'error', cache: null },
            { phase: 'depth', durationMs: 355, outcome: 'ok', cache: null },
            { phase: 'aggregate-ready', durationMs: 3_441, outcome: 'ok', cache: null },
        ]) {
            expect(describeDeskDiagnosticEvent('timing', value)).not.toBeNull();
        }
        for (const phase of [
            'bootstrap', 'stream', 'stream-frame', 'book-recovery', 'freshness',
            'candle-history', 'interval-bootstrap', 'release',
        ]) {
            expect(describeDeskDiagnosticEvent('fault', {
                phase, code: 'WORKSTATION_RESOURCE_REJECTED',
            })).not.toBeNull();
        }
        for (const state of ['loading', 'live', 'resynchronizing', 'disconnected', 'unavailable']) {
            expect(describeDeskDiagnosticEvent('status', {
                symbol: 'BTCUSDT', state, code: null,
            })).not.toBeNull();
        }
    });

    // What a renderer that fell behind was not sent. It is a count of frames,
    // never the frames themselves.
    it('keeps what a backlog superseded, what it dropped, and how deep it got', () => {
        expect(describeDeskDiagnosticEvent('backlog', {
            resource: 'depth',
            symbol: 'BTCUSDT',
            superseded: 19,
            dropped: 0,
            frames: 1,
            bytes: 118_000,
        })).toEqual({
            kind: 'backlog',
            resource: 'depth',
            symbol: 'BTCUSDT',
            superseded: 19,
            dropped: 0,
            frames: 1,
            bytes: 118_000,
        });
        // A frame nothing names — a ticker batch — states no resource and no
        // contract, and is still worth counting.
        expect(describeDeskDiagnosticEvent('backlog', {
            resource: 'ticker',
            symbol: null,
            superseded: 0,
            dropped: 5,
            frames: 5,
            bytes: 640,
        })).not.toBeNull();
        expect(describeDeskDiagnosticEvent('backlog', {
            resource: 'depth', symbol: 'BTCUSDT', superseded: '19', dropped: 0, frames: 1, bytes: 1,
        })).toBeNull();
        // The depth reading is not optional. A backlog line without it is the
        // line this change exists to stop writing.
        expect(describeDeskDiagnosticEvent('backlog', {
            resource: 'depth', symbol: 'BTCUSDT', superseded: 19, dropped: 0,
        })).toBeNull();
        // Counts, not amounts: the field that could carry a size is the one that
        // must refuse a decimal.
        expect(describeDeskDiagnosticEvent('backlog', {
            resource: 'depth', symbol: 'BTCUSDT', superseded: 0, dropped: 0, frames: 1, bytes: '0.5',
        })).toBeNull();
    });

    it('refuses a kind it does not keep', () => {
        expect(describeDeskDiagnosticEvent('console', { line: 'anything' })).toBeNull();
        expect(describeDeskDiagnosticEvent('toString', { phase: 'a', code: 'B' })).toBeNull();
    });

    it('refuses an event whose phase or code is not one the desk states', () => {
        expect(describeDeskDiagnosticEvent('fault', { phase: 'bootstrap' })).toBeNull();
        expect(describeDeskDiagnosticEvent('fault', {
            phase: 'bootstrap', code: 'lower case',
        })).toBeNull();
        // A decimal cannot pass as a code, which is what keeps an amount from
        // arriving under a field name meant for one.
        expect(describeDeskDiagnosticEvent('fault', {
            phase: 'bootstrap', code: '58400.25',
        })).toBeNull();
        expect(describeDeskDiagnosticEvent('fault', 'bootstrap failed')).toBeNull();
    });
});

describe('what may not reach the record', () => {
    it('drops a credential, a signature and a money value offered beside a fault', () => {
        const disk = createMemoryDisk();
        const { record } = createRecord(disk);
        record.record('fault', {
            phase: 'bootstrap',
            code: 'DEPTH_BOOTSTRAP_GAP',
            apiKey: 'BFK-live-9f2c',
            signature: 'd1e5c0ffee',
            price: '58400.25',
            quantity: '0.010',
            realizedPnl: '-12.5',
            headers: { 'X-MBX-APIKEY': 'BFK-live-9f2c' },
        });
        const written = disk.contents(TODAY);
        expect(written).not.toMatch(/BFK-live-9f2c|d1e5c0ffee|58400\.25|0\.010|-12\.5|X-MBX-APIKEY/);
        expect(disk.lines(TODAY)).toEqual([{
            at: '2026-08-11T14:20:31.482Z',
            kind: 'fault',
            phase: 'bootstrap',
            code: 'DEPTH_BOOTSTRAP_GAP',
            symbol: null,
        }]);
    });

    it('records a command by what it was and never by what it was worth', () => {
        const event = readDeskDiagnosticCommandEvent({
            action: 'trade.placeOrder',
            version: 1,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'f-m9x2k1-4a7bd0e2',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '58400.25',
            quantity: '0.010',
        });
        expect(event).toEqual({
            kind: 'command',
            action: 'trade.placeOrder',
            market: 'futures',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            identity: 'f-m9x2k1-4a7bd0e2',
        });
        expect(JSON.stringify(event)).not.toMatch(/58400|0\.010|GTC/);
    });

    // While an order rests the account is re-read every thirty seconds, and the
    // contract's configuration on every switch. Recorded, those two alone would
    // fill the record with lines saying only that the desk was running.
    it('keeps the commands that changed something and not the reads', () => {
        for (const action of ['account.refresh', 'account.history', 'account.symbolConfig']) {
            expect(readDeskDiagnosticCommandEvent({
                action, marketType: 'futures', symbol: 'BTCUSDT',
            })).toBeNull();
        }
        for (const action of [
            'trade.placeOrder', 'trade.cancelOrder', 'trade.replaceOrder', 'trade.cancelAll',
            'trade.setLeverage', 'trade.setMarginType', 'trade.adjustPositionMargin',
            'trade.setTradingPaused',
        ]) {
            expect(readDeskDiagnosticCommandEvent({
                action, marketType: 'futures', symbol: 'BTCUSDT', clientOrderId: 'f-1',
            })).toMatchObject({ kind: 'command', action });
        }
    });

    it('names the order a cancellation was aimed at', () => {
        expect(readDeskDiagnosticCommandEvent({
            action: 'trade.cancelOrder',
            marketType: 'futures',
            symbol: 'BTCUSDT',
            clientOrderId: 'f-command-id',
            orderId: 84213377,
        })).toMatchObject({ identity: '84213377' });
    });
});

describe('the events the desk states to the renderer', () => {
    it('reads the cause a resynchronization carried', () => {
        expect(readDeskDiagnosticOutboundEvent({
            channelId: 'futures-production-workstation',
            type: 'futures.production.workstation.resource',
            symbol: 'BTCUSDT',
            resource: 'status',
            state: 'resynchronizing',
            observedAt: AT,
            payload: { connected: false, reasonCode: 'DEPTH_SEQUENCE_GAP' },
        })).toEqual({
            kind: 'status',
            symbol: 'BTCUSDT',
            state: 'resynchronizing',
            code: 'DEPTH_SEQUENCE_GAP',
        });
    });

    it('reads how a command ended', () => {
        expect(readDeskDiagnosticOutboundEvent({
            command_unresolved: {
                request: 'trade.placeOrder',
                code: 'FUTURES_OUTCOME_UNKNOWN',
                message: 'Binance did not confirm this order either way.',
                details: {
                    marketType: 'futures',
                    symbol: 'BTCUSDT',
                    origClientOrderId: 'f-m9x2k1-4a7bd0e2',
                    reconciled: false,
                },
                timestamp: AT,
            },
        })).toEqual({
            kind: 'outcome',
            action: 'trade.placeOrder',
            result: 'unresolved',
            code: 'FUTURES_OUTCOME_UNKNOWN',
            market: 'futures',
            symbol: 'BTCUSDT',
            identity: 'f-m9x2k1-4a7bd0e2',
            cause: null,
            exchangeCode: null,
            requestedToLegBps: null,
        });
    });

    // 2026-09-02: two exits refused for exceeding the leg, and the record said
    // by name and not by how much. The ratio rides the line as a count; the
    // sizes themselves never do.
    it('carries the requested-to-leg ratio of a quantity refusal, and no size', () => {
        expect(readDeskDiagnosticOutboundEvent({
            command_rejected: {
                request: 'trade.placeOrder',
                code: 'FUTURES_REDUCTION_NOT_CONFIRMED',
                message: 'The requested quantity exceeds the open leg. Requested 120, open leg 100.',
                details: {
                    marketType: 'futures',
                    symbol: 'AKEUSDT',
                    cause: 'QUANTITY_EXCEEDS_LEG',
                    requestedQuantity: 120,
                    openQuantity: 100,
                    requestedToLegBps: 12_000,
                },
                timestamp: AT,
            },
        })).toEqual({
            kind: 'outcome',
            action: 'trade.placeOrder',
            result: 'rejected',
            code: 'FUTURES_REDUCTION_NOT_CONFIRMED',
            market: 'futures',
            symbol: 'AKEUSDT',
            identity: null,
            cause: 'QUANTITY_EXCEEDS_LEG',
            exchangeCode: null,
            requestedToLegBps: 12_000,
        });
    });

    // A command the renderer withheld is an outcome of its own, so an exit
    // that never left the renderer is a line and not a blank.
    it('keeps a withheld command under the outcome fields', () => {
        expect(describeDeskDiagnosticEvent('outcome', {
            action: 'trade.placeOrder',
            result: 'withheld',
            code: 'FUTURES_POSITION_UNCONFIRMED',
            market: 'futures',
            symbol: 'AKEUSDT',
            identity: null,
            cause: null,
            exchangeCode: null,
            requestedToLegBps: null,
        })).toEqual({
            kind: 'outcome',
            action: 'trade.placeOrder',
            result: 'withheld',
            code: 'FUTURES_POSITION_UNCONFIRMED',
            market: 'futures',
            symbol: 'AKEUSDT',
            identity: null,
            cause: null,
            exchangeCode: null,
            requestedToLegBps: null,
        });
    });

    // The route a physical attempt went on — a word of the desk's own, never a
    // path. A route this record will not repeat costs the route and not the
    // line, exactly as an exchange code does.
    it('names a request\'s route and refuses a path in its place', () => {
        const request = route => describeDeskDiagnosticEvent('request', {
            standing: 'ordinary',
            route,
            attempts: 1,
            chargedWeight: 5,
            observedWeight: 700,
            backpressureMs: 0,
            connectionRetries: 0,
            networkRetries: 0,
            timestampRetries: 0,
            rateLimitResponses: 0,
            outcome: 'ok',
            status: 200,
            code: null,
        });
        expect(request('history-trades')).toMatchObject({ kind: 'request', route: 'history-trades' });
        expect(request('/fapi/v1/userTrades?symbol=AKEUSDT')).toMatchObject({ kind: 'request', route: null });
        expect(request(undefined)).toMatchObject({ kind: 'request', route: null });
    });

    // A command held by the exchange's own limit is the one wait line a command
    // can produce; the desk's ceilings hold no command.
    it('keeps a command\'s wait under its own standing', () => {
        expect(describeDeskDiagnosticEvent('deferred', {
            standing: 'command',
            waitedMs: 1_803,
            weight: 1,
            spent: 2_380,
            ceiling: 2_380,
        })).toEqual({
            kind: 'deferred',
            standing: 'command',
            waitedMs: 1_803,
            weight: 1,
            spent: 2_380,
            ceiling: 2_380,
        });
    });

    // The desk's own refusal used to carry one code for five causes; the
    // 2026-08-24 close refusal had to be diagnosed from the lines around it.
    // The condition that failed now rides the outcome line, in the same
    // uppercase shape as a code, and one this record will not repeat costs the
    // cause and never the refusal.
    it('carries the named condition of a desk refusal, and drops one it cannot vouch for', () => {
        const refusal = cause => readDeskDiagnosticOutboundEvent({
            command_rejected: {
                request: 'trade.placeOrder',
                code: 'FUTURES_REDUCTION_NOT_CONFIRMED',
                message: 'The reduce-only order was not sent.',
                details: { marketType: 'futures', symbol: 'VELVETUSDT', cause },
                timestamp: AT,
            },
        });

        expect(refusal('NO_READING')).toMatchObject({
            kind: 'outcome',
            result: 'rejected',
            code: 'FUTURES_REDUCTION_NOT_CONFIRMED',
            cause: 'NO_READING',
        });
        expect(refusal('SIDE_MISMATCH')).toMatchObject({ cause: 'SIDE_MISMATCH' });
        // A refusal that states no condition still keeps its line.
        expect(refusal(undefined)).toMatchObject({ kind: 'outcome', cause: null });
        // A shape that could spell an amount is refused as the field, not the line.
        expect(refusal('49.6 over the leg')).toMatchObject({ kind: 'outcome', cause: null });
    });

    // `FUTURES_API_ERROR` is the desk's word for every refusal there is. These
    // are the shapes the exchange's own answer arrives in.
    it('names the code the exchange gave for a refusal', () => {
        const refusal = (details, result = 'command_rejected') => readDeskDiagnosticOutboundEvent({
            [result]: {
                request: 'trade.placeOrder',
                code: 'FUTURES_API_ERROR',
                message: 'Margin is insufficient. — insufficient margin for this order.',
                details: { marketType: 'futures', symbol: 'CYSUSDT', ...details },
                timestamp: AT,
            },
        });

        // Binance answered, and said which refusal it was.
        expect(refusal({ binanceCode: -2019 })).toMatchObject({ exchangeCode: '-2019' });
        // The Spot client nests its code; `spotBinanceCode` has already unnested
        // it by the time the envelope is built.
        expect(refusal({ marketType: 'spot', binanceCode: -2010 }))
            .toMatchObject({ market: 'spot', exchangeCode: '-2010' });
        // The request never reached an answer.
        expect(refusal({ binanceCode: 'ECONNRESET' }, 'command_unresolved'))
            .toMatchObject({ result: 'unresolved', exchangeCode: 'ECONNRESET' });
        expect(refusal({ binanceCode: 'ETIMEDOUT' })).toMatchObject({ exchangeCode: 'ETIMEDOUT' });
        // The desk refused it on its own account and asked the exchange nothing.
        expect(refusal({})).toMatchObject({ exchangeCode: null });
        // And the message the exchange wrote for a human stays out of it: it is
        // the one shape that can quote a quantity back.
        expect(JSON.stringify(refusal({ binanceCode: -2019 })))
            .not.toMatch(/Margin is insufficient|insufficient margin/);
    });

    it('drops a refusal code it cannot vouch for without dropping the refusal', () => {
        for (const binanceCode of [
            '20.5',
            'Order notional must be no smaller than 20',
            { code: -2019 },
            -12345678901,
            'lowercase',
        ]) {
            const event = readDeskDiagnosticOutboundEvent({
                command_rejected: {
                    request: 'trade.placeOrder',
                    code: 'FUTURES_API_ERROR',
                    message: 'refused',
                    details: { marketType: 'futures', symbol: 'CYSUSDT', binanceCode },
                    timestamp: AT,
                },
            });
            expect(event).toMatchObject({ kind: 'outcome', result: 'rejected', exchangeCode: null });
        }
    });

    it('leaves every market frame alone', () => {
        for (const frame of [
            null,
            'a string',
            { chart: [{ t: AT, o: '1', h: '2', l: '1', c: '2' }] },
            { depth: { bids: [['58400.10', '1.2']], asks: [] } },
            {
                type: 'futures.production.workstation.resource',
                resource: 'book',
                state: 'live',
                payload: { bids: [['58400.10', '1.2']] },
            },
        ]) {
            expect(readDeskDiagnosticOutboundEvent(frame)).toBeNull();
        }
    });
});

describe('the record on disk', () => {
    let disk;

    beforeEach(() => {
        disk = createMemoryDisk();
    });

    it('lands a timing and a fault as one readable line each', () => {
        const { record, clock } = createRecord(disk);
        record.record('timing', {
            phase: 'depth', durationMs: 184, outcome: 'ok', cache: null,
        });
        clock.now += 1_000;
        record.record('fault', { phase: 'stream-frame', code: 'STREAM_FRAME_REFUSED' });

        expect(disk.lines(TODAY)).toEqual([
            {
                at: '2026-08-11T14:20:31.482Z',
                kind: 'timing',
                phase: 'depth',
                durationMs: 184,
                outcome: 'ok',
                cache: null,
                // A phase that did not fail has no reason to state.
                code: null,
                symbol: null,
            },
            {
                at: '2026-08-11T14:20:32.482Z',
                kind: 'fault',
                phase: 'stream-frame',
                code: 'STREAM_FRAME_REFUSED',
                symbol: null,
            },
        ]);
    });

    it('keeps why a phase failed, and keeps the line when the reason is malformed', () => {
        const { record, clock } = createRecord(disk);
        record.record('timing', {
            phase: 'exchange-info', durationMs: 4, outcome: 'error', cache: 'miss', code: 'REQUEST_ABORTED',
        });
        clock.now += 1_000;
        record.record('timing', {
            phase: 'exchange-info', durationMs: 4, outcome: 'error', cache: 'miss', code: 'not a code',
        });

        expect(disk.lines(TODAY)).toEqual([
            {
                at: '2026-08-11T14:20:31.482Z',
                kind: 'timing',
                phase: 'exchange-info',
                durationMs: 4,
                outcome: 'error',
                cache: 'miss',
                code: 'REQUEST_ABORTED',
                symbol: null,
            },
            {
                at: '2026-08-11T14:20:32.482Z',
                kind: 'timing',
                phase: 'exchange-info',
                durationMs: 4,
                outcome: 'error',
                cache: 'miss',
                // A reason this file will not repeat costs the reason. Losing
                // the line instead would lose the fact that it failed at all.
                code: null,
                symbol: null,
            },
        ]);
    });

    it('keeps the expected abort and the successful shared retry beside it', () => {
        const { record, clock } = createRecord(disk);
        record.record('timing', {
            phase: 'exchange-info',
            durationMs: 4,
            outcome: 'aborted',
            cache: 'miss',
            code: 'REQUEST_ABORTED',
        });
        clock.now += 700;
        record.record('timing', {
            phase: 'exchange-info',
            durationMs: 704,
            outcome: 'ok',
            cache: 'shared',
            code: null,
        });
        clock.now += 1_000;
        record.record('timing', {
            phase: 'exchange-info',
            durationMs: 0,
            outcome: 'ok',
            cache: 'stale',
            code: null,
        });

        expect(disk.lines(TODAY)).toEqual([
            {
                at: '2026-08-11T14:20:31.482Z',
                kind: 'timing',
                phase: 'exchange-info',
                durationMs: 4,
                outcome: 'aborted',
                cache: 'miss',
                code: 'REQUEST_ABORTED',
                symbol: null,
            },
            {
                at: '2026-08-11T14:20:32.182Z',
                kind: 'timing',
                phase: 'exchange-info',
                durationMs: 704,
                outcome: 'ok',
                cache: 'shared',
                code: null,
                symbol: null,
            },
            {
                at: '2026-08-11T14:20:33.182Z',
                kind: 'timing',
                phase: 'exchange-info',
                durationMs: 0,
                outcome: 'ok',
                cache: 'stale',
                code: null,
                symbol: null,
            },
        ]);
    });

    it('adds to the record a previous run left behind', () => {
        disk.seed(TODAY, {
            text: '{"at":"2026-08-11T09:00:00.000Z","kind":"session","event":"started","version":null}\n',
        });
        const { record } = createRecord(disk);
        record.record('session', { event: 'started', version: '0.5.1' });

        expect(disk.lines(TODAY).map(line => line.at)).toEqual([
            '2026-08-11T09:00:00.000Z',
            '2026-08-11T14:20:31.482Z',
        ]);
    });

    it('opens the next day in its own file', () => {
        const { record, clock } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });
        clock.now = Date.parse('2026-08-12T00:00:04.000Z');
        record.record('fault', { phase: 'bootstrap', code: 'B' });

        expect(disk.lines(TODAY).map(line => line.code)).toEqual(['A']);
        expect(disk.lines('desk-2026-08-12-000.jsonl').map(line => line.code)).toEqual(['B']);
    });

    it('refuses an unrecognized event without writing anything', () => {
        const { record } = createRecord(disk);
        expect(record.record('console', { line: 'Rejected malformed renderer WebSocket JSON' }))
            .toBe(false);
        expect(disk.contents(TODAY)).toBeNull();
    });
});

describe('the bounds', () => {
    it('drops the days past the day bound', () => {
        const disk = createMemoryDisk();
        disk.seed('desk-2026-07-20-000.jsonl', { declared: 4_096 });
        disk.seed('desk-2026-07-29-000.jsonl', { declared: 4_096 });
        disk.seed('desk-2026-08-10-000.jsonl', { declared: 4_096 });
        const { record } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });

        expect([...disk.files.keys()].sort()).toEqual([
            // 2026-07-29 is the fourteenth day counting back from 2026-08-11.
            'desk-2026-07-29-000.jsonl',
            'desk-2026-08-10-000.jsonl',
            TODAY,
        ]);
    });

    it('drops the oldest segments until the record is under its byte bound', () => {
        const disk = createMemoryDisk();
        const segment = 3 * 1024 * 1024;
        // Twelve days inside the day bound, so only the byte bound can bind.
        for (const day of ['07-30', '07-31', ...Array.from(
            { length: 10 },
            (_, index) => `08-${String(index + 1).padStart(2, '0')}`,
        )]) {
            disk.seed(`desk-2026-${day}-000.jsonl`, { declared: segment });
        }
        const { record } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });

        const kept = [...disk.files.keys()].filter(name => name !== TODAY).sort();
        const held = kept.length * segment;
        expect(held).toBeLessThanOrEqual(DESK_DIAGNOSTIC_RECORD.MAX_TOTAL_BYTES);
        expect(held + segment).toBeGreaterThan(DESK_DIAGNOSTIC_RECORD.MAX_TOTAL_BYTES);
        expect(kept[0]).toBe('desk-2026-08-01-000.jsonl');
        expect(disk.contents(TODAY)).not.toBeNull();
    });

    it('rolls to the next segment rather than letting one file grow past its bound', () => {
        const disk = createMemoryDisk();
        disk.seed(TODAY, { declared: DESK_DIAGNOSTIC_RECORD.MAX_SEGMENT_BYTES - 64 });
        const { record } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });
        record.record('fault', { phase: 'bootstrap', code: 'B' });

        expect(disk.lines('desk-2026-08-11-001.jsonl').map(line => line.code)).toEqual(['B']);
    });

    it('starts a new segment when the one on disk is already full', () => {
        const disk = createMemoryDisk();
        disk.seed(TODAY, { declared: DESK_DIAGNOSTIC_RECORD.MAX_SEGMENT_BYTES });
        const { record } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });

        expect(disk.lines(TODAY)).toEqual([]);
        expect(disk.lines('desk-2026-08-11-001.jsonl').map(line => line.code)).toEqual(['A']);
    });

    it('stays usable when a rotation fails, and says so once', () => {
        const disk = createMemoryDisk({ failOn: new Set(['rotate']) });
        disk.seed('desk-2026-07-01-000.jsonl', { declared: 4_096 });
        const { record, warn } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });
        record.record('fault', { phase: 'bootstrap', code: 'B' });

        expect(disk.lines(TODAY).map(line => line.code)).toEqual(['A', 'B']);
        expect(disk.files.has('desk-2026-07-01-000.jsonl')).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/could not be rotated/);
    });
});

describe('what the record costs the desk', () => {
    it('answers rather than raising when the record cannot be opened', () => {
        const disk = createMemoryDisk({ failOn: new Set(['open']) });
        const { record, warn } = createRecord(disk);

        expect(() => record.record('fault', { phase: 'bootstrap', code: 'A' })).not.toThrow();
        expect(record.record('fault', { phase: 'bootstrap', code: 'B' })).toBe(false);
        expect(disk.files.size).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('answers rather than raising when the write itself fails', () => {
        const disk = createMemoryDisk({ failOn: new Set(['write']) });
        const { record, warn } = createRecord(disk);

        expect(record.record('fault', { phase: 'bootstrap', code: 'A' })).toBe(false);
        expect(record.record('fault', { phase: 'bootstrap', code: 'B' })).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('absorbs a stream that fails after the line was handed over', () => {
        const disk = createMemoryDisk();
        const { record, warn } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });

        expect(() => disk.streams[0].fail(Object.assign(new Error('disk'), { code: 'EIO' })))
            .not.toThrow();
        expect(record.record('fault', { phase: 'bootstrap', code: 'B' })).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not reopen a failed record on every line, and recovers after the cooldown', () => {
        const disk = createMemoryDisk({ failOn: new Set(['create']) });
        const { record, clock } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });
        disk.streams.length = 0;

        clock.now += DESK_DIAGNOSTIC_RECORD.REOPEN_COOLDOWN_MS - 1;
        expect(record.record('fault', { phase: 'bootstrap', code: 'B' })).toBe(false);
        expect(disk.streams).toHaveLength(0);

        disk.mkdirSync = () => {};
        Object.assign(disk, {
            createWriteStream: createMemoryDisk().createWriteStream,
        });
        clock.now += 1;
        expect(record.record('fault', { phase: 'bootstrap', code: 'C' })).toBe(true);
    });

    // Past the stream's own buffer, the alternative to dropping a line is
    // holding it in the main process's memory — which is the desk's memory.
    it('stops handing lines over when the disk stops keeping up, and resumes on drain', () => {
        const disk = createMemoryDisk();
        const { record, warn } = createRecord(disk);
        record.record('fault', { phase: 'bootstrap', code: 'A' });
        disk.streams[0].stalled = true;
        expect(record.record('fault', { phase: 'bootstrap', code: 'B' })).toBe(true);
        expect(record.record('fault', { phase: 'bootstrap', code: 'C' })).toBe(false);
        expect(record.record('fault', { phase: 'bootstrap', code: 'D' })).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/not keeping up/);

        disk.streams[0].drain();
        expect(record.record('fault', { phase: 'bootstrap', code: 'E' })).toBe(true);
        expect(disk.lines(TODAY).map(entry => entry.code)).toEqual(['A', 'B', 'E']);
    });

    it('behaves exactly as no record when no directory is configured', () => {
        expect(createDeskDiagnosticRecord()).toBe(DESK_DIAGNOSTICS_UNRECORDED);
        expect(createDeskDiagnosticRecord({ directory: '' })).toBe(DESK_DIAGNOSTICS_UNRECORDED);
        expect(DESK_DIAGNOSTICS_UNRECORDED.record('fault', { phase: 'a', code: 'B' })).toBe(false);
        expect(DESK_DIAGNOSTICS_UNRECORDED.observeOutbound({ command_rejected: {} })).toBe(false);
    });
});

// Binance lists USDⓈ-M perpetuals whose tickers are CJK words. On 2026-08-28
// the operator traded 龙虾USDT while its session resynchronized every fifteen
// seconds — and the record shows none of it, because the symbol rule read
// ASCII and a malformed field refuses the whole line. The record reads the
// same identity alphabet the workstation protocol does, or a storm on such a
// listing is invisible exactly where the operator would look for it.
describe('unicode listing symbols', () => {
    it('keeps a status line for a CJK listing instead of dropping it', () => {
        expect(describeDeskDiagnosticEvent('status', {
            symbol: '龙虾USDT',
            state: 'resynchronizing',
            code: 'CROSSED_ORDER_BOOK',
        })).toEqual({
            kind: 'status',
            symbol: '龙虾USDT',
            state: 'resynchronizing',
            code: 'CROSSED_ORDER_BOOK',
        });
    });

    it('keeps a delivery-dated symbol and still refuses shapes that could carry an amount', () => {
        expect(describeDeskDiagnosticEvent('status', {
            symbol: 'BTCUSDT_260929',
            state: 'live',
            code: null,
        }).symbol).toBe('BTCUSDT_260929');
        expect(describeDeskDiagnosticEvent('status', {
            symbol: '0.0431',
            state: 'live',
            code: null,
        })).toBeNull();
        expect(describeDeskDiagnosticEvent('status', {
            symbol: 'btcusdt',
            state: 'live',
            code: null,
        })).toBeNull();
    });
});

// The faults and phase timings of 2026-08-28 named no contract: fifteen-second
// resynchronization cycles read as "the desk's", when the whole storm belonged
// to one held session. A fault or a timing raised inside a session carries the
// session's contract; one raised outside any session still keeps its line.
describe('session-scoped faults and timings', () => {
    it('carries the symbol a fault names', () => {
        expect(describeDeskDiagnosticEvent('fault', {
            phase: 'book-recovery',
            code: 'DEPTH_BAND_WALKED',
            symbol: '龙虾USDT',
        })).toEqual({
            kind: 'fault',
            phase: 'book-recovery',
            code: 'DEPTH_BAND_WALKED',
            symbol: '龙虾USDT',
        });
    });

    it('keeps a fault that names no session', () => {
        expect(describeDeskDiagnosticEvent('fault', {
            phase: 'release',
            code: 'INVALID_CLOCK',
        })).toEqual({
            kind: 'fault',
            phase: 'release',
            code: 'INVALID_CLOCK',
            symbol: null,
        });
    });

    it('carries the symbol a phase timing belongs to when the caller names one', () => {
        expect(describeDeskDiagnosticEvent('timing', {
            phase: 'aggregate-ready',
            durationMs: 1650,
            outcome: 'ok',
            cache: null,
            code: null,
            symbol: '龙虾USDT',
        }).symbol).toBe('龙虾USDT');
    });

    // A background contract that stops on its own account, and the free
    // minute that loads it again (2026-09-03): two lines the record keeps
    // under phases of their own, so a day can be asked how many contracts
    // parked and how long each took to come back.
    it('keeps a parked contract and a lazy wake as lines', () => {
        expect(describeDeskDiagnosticEvent('fault', {
            phase: 'park',
            code: 'SOCKET_CLOSED',
            symbol: 'SKRUSDT',
        })).toEqual({
            kind: 'fault',
            phase: 'park',
            code: 'SOCKET_CLOSED',
            symbol: 'SKRUSDT',
        });
        expect(describeDeskDiagnosticEvent('timing', {
            phase: 'lazy-bootstrap',
            durationMs: 1_240,
            outcome: 'ok',
            cache: null,
            code: null,
            symbol: 'SKRUSDT',
        })).toEqual({
            kind: 'timing',
            phase: 'lazy-bootstrap',
            durationMs: 1_240,
            outcome: 'ok',
            cache: null,
            code: null,
            symbol: 'SKRUSDT',
        });
    });
});

// What the renderer says the screen switched to, and when the local link came
// and went. The workstation's own frames say what was delivered; only the
// renderer can say what is being looked at — a remount that reopened the
// previous contract is indistinguishable from an operator's choice without the
// cause beside it. Link lines are the one record of renderer sockets at all:
// on 2026-08-28 the workspace remounted twice in a minute and nothing wrote
// why, and a doubled frame reporter ran for two hours with nothing counting
// the sockets it implied.
describe('display and link lines', () => {
    it('keeps what the renderer says the screen switched to', () => {
        expect(describeDeskDiagnosticEvent('display', {
            event: 'symbol-shown',
            symbol: '龙虾USDT',
            from: 'VELVETUSDT',
            cause: 'restored',
        })).toEqual({
            kind: 'display',
            event: 'symbol-shown',
            symbol: '龙虾USDT',
            from: 'VELVETUSDT',
            cause: 'restored',
            interval: null,
            fromInterval: null,
        });
        expect(describeDeskDiagnosticEvent('display', {
            event: 'workspace-mounted',
            symbol: 'VELVETUSDT',
            from: null,
            cause: null,
        })).toEqual({
            kind: 'display',
            event: 'workspace-mounted',
            symbol: 'VELVETUSDT',
            from: null,
            cause: null,
            interval: null,
            fromInterval: null,
        });
    });

    // A switch of the chart interval used to be readable only from the timing
    // phases behind it — forty-five of them on 2026-09-02.
    it('keeps which interval the screen switched to', () => {
        expect(describeDeskDiagnosticEvent('display', {
            event: 'interval-shown',
            symbol: 'AKEUSDT',
            interval: '5m',
            fromInterval: '1m',
            cause: 'operator',
        })).toEqual({
            kind: 'display',
            event: 'interval-shown',
            symbol: 'AKEUSDT',
            from: null,
            cause: 'operator',
            interval: '5m',
            fromInterval: '1m',
        });
        expect(describeDeskDiagnosticEvent('display', {
            event: 'interval-shown',
            symbol: 'AKEUSDT',
            interval: 'five minutes',
            cause: 'restored',
        })).toBeNull();
    });

    it('refuses an event or a cause outside the stated vocabulary', () => {
        expect(describeDeskDiagnosticEvent('display', {
            event: 'window-painted',
            symbol: 'VELVETUSDT',
            from: null,
            cause: null,
        })).toBeNull();
        expect(describeDeskDiagnosticEvent('display', {
            event: 'symbol-shown',
            symbol: 'VELVETUSDT',
            from: null,
            cause: 'hmr',
        })).toBeNull();
    });

    it('counts renderer links as they come and go', () => {
        expect(describeDeskDiagnosticEvent('link', {
            event: 'renderer-connected',
            connections: 1,
        })).toEqual({ kind: 'link', event: 'renderer-connected', connections: 1 });
        expect(describeDeskDiagnosticEvent('link', {
            event: 'renderer-disconnected',
            connections: 0,
        })).toEqual({ kind: 'link', event: 'renderer-disconnected', connections: 0 });
        expect(describeDeskDiagnosticEvent('link', {
            event: 'renderer-connected',
            connections: -1,
        })).toBeNull();
    });
});

// What a fault leaves behind, beside the fault's own line: a close's code and
// lag, a crossing's identities and count. Identities and counts, never a price.
describe('the evidence beside a fault', () => {
    it('keeps a stream close under its declared fields', () => {
        expect(describeDeskDiagnosticEvent('evidence', {
            phase: 'stream-close',
            code: 'SOCKET_CLOSED',
            symbol: 'AKEUSDT',
            closeCode: 1006,
            closedBy: 'transport',
            lastUpstreamMs: 3_878,
        })).toEqual({
            kind: 'evidence',
            phase: 'stream-close',
            code: 'SOCKET_CLOSED',
            symbol: 'AKEUSDT',
            closeCode: 1006,
            closedBy: 'transport',
            lastUpstreamMs: 3_878,
            lastUpdateId: null,
            firstUpdateId: null,
            finalUpdateId: null,
            previousFinalUpdateId: null,
            crossedLevels: null,
        });
    });

    it('keeps a crossed book under its declared fields and refuses a price', () => {
        expect(describeDeskDiagnosticEvent('evidence', {
            phase: 'book-recovery',
            code: 'CROSSED_ORDER_BOOK',
            symbol: 'AKEUSDT',
            lastUpdateId: '8812345678901',
            firstUpdateId: '8812345678899',
            finalUpdateId: '8812345678901',
            previousFinalUpdateId: '8812345678898',
            crossedLevels: 3,
            bestBid: '0.1234',
        })).toEqual({
            kind: 'evidence',
            phase: 'book-recovery',
            code: 'CROSSED_ORDER_BOOK',
            symbol: 'AKEUSDT',
            closeCode: null,
            closedBy: null,
            lastUpstreamMs: null,
            lastUpdateId: '8812345678901',
            firstUpdateId: '8812345678899',
            finalUpdateId: '8812345678901',
            previousFinalUpdateId: '8812345678898',
            crossedLevels: 3,
        });
        // A closer this desk does not have costs the line.
        expect(describeDeskDiagnosticEvent('evidence', {
            phase: 'stream-close',
            code: 'SOCKET_CLOSED',
            closedBy: 'the proxy',
        })).toBeNull();
    });
});

// The read that confirms a fill burst against the exchange, scored against the
// stream it is confirming. Written on 2026-09-03, when 88 such reads in a day
// could not be asked whether one had found anything.
describe('the history line keeps the score of a reconfirmation read', () => {
    const line = (overrides = {}) => describeDeskDiagnosticEvent('history', {
        reason: 'fill',
        contracts: 1,
        reads: 1,
        returned: 3,
        restated: 1,
        held: 2,
        unreported: 0,
        differing: 0,
        vouched: 1,
        outcome: 'complete',
        code: null,
        ...overrides,
    });

    it('keeps the counts and the reason, and nothing that names a fill', () => {
        expect(line({ price: '100.5', tradeId: '4101', symbol: 'BTCUSDT' })).toEqual({
            kind: 'history',
            reason: 'fill',
            contracts: 1,
            reads: 1,
            returned: 3,
            restated: 1,
            held: 2,
            unreported: 0,
            differing: 0,
            vouched: 1,
            outcome: 'complete',
            code: null,
        });
    });

    it('accepts every reason a read can state, and refuses one it cannot', () => {
        for (const reason of [
            'fill', 'open', 'refresh', 'full', 'stream', 'bootstrap', 'continuation', 'unstated',
        ]) {
            expect(line({ reason })).toMatchObject({ kind: 'history', reason });
        }
        expect(line({ reason: 'because' })).toBeNull();
        expect(line({ reason: undefined })).toBeNull();
    });

    it('refuses a malformed count rather than writing half a score', () => {
        expect(line({ unreported: -1 })).toBeNull();
        expect(line({ vouched: 'yes' })).toBeNull();
        expect(line({ held: undefined })).toBeNull();
    });

    it('tolerates a code it will not repeat, and keeps the outcome', () => {
        expect(line({ outcome: 'failed', code: '-1003' })).toMatchObject({
            outcome: 'failed',
            code: null,
        });
        expect(line({ outcome: 'failed', code: 'ECONNRESET' })).toMatchObject({
            outcome: 'failed',
            code: 'ECONNRESET',
        });
        expect(line({ outcome: 'abandoned', code: 'ACTIVATION_RETIRED' }).outcome)
            .toBe('abandoned');
    });
});
