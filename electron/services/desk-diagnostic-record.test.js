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
        })).toEqual({ kind: 'fault', phase: 'book-recovery', code: 'DEPTH_SEQUENCE_GAP' });
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
            exchangeCode: null,
        });
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
            },
            {
                at: '2026-08-11T14:20:32.482Z',
                kind: 'fault',
                phase: 'stream-frame',
                code: 'STREAM_FRAME_REFUSED',
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
