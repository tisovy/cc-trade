// The desk states its faults and its timings and then throws them away: started
// from a launcher the lines go nowhere, started from a terminal they live until
// it is closed. This is the file they land in — the same structured events, one
// per line, kept long enough to answer "what happened yesterday" and bounded
// tightly enough that a trading desk never loses its disk to its own log.
//
// Two rules hold the whole design up. Only the desk's own structured events are
// written, through the exact field list each kind declares below — so nothing
// arrives in whatever shape it happened to have. And nothing here may raise:
// a record that cannot be opened, written or rotated loses the line and leaves
// the desk exactly as it would be with no record at all.
import fs from 'node:fs';
import path from 'node:path';
import { TRADING_COMMAND_ACTIONS } from '../../src/utils/tradingCommands.js';
import { FUTURES_ACCOUNT_READ_REASONS } from './futures-account-state.js';
import {
    FUTURES_MARGIN_ESTIMATE_MAX_BPS,
    FUTURES_MARGIN_ESTIMATE_VALUES,
} from './futures-account-margin.js';

export const DESK_DIAGNOSTIC_RECORD = Object.freeze({
    // Measured on 2026-08-11 against the live exchange, one contract, 63s: the
    // bootstrap costs 10 lines (~1 KB) and a healthy desk then writes *nothing*
    // in steady running; a contract switch costs another 10. A desk that cannot
    // reach the exchange retries in a loop at ~39 lines/min (~2.1 KB/min,
    // ~3 MB/day) — the realistic ceiling, which the day bound below governs.
    // The pathological one is a contract whose every depth frame is refused: at
    // the measured 10 diffs/s that is ~600 lines/min, ~79 MB/day, and only the
    // byte bound can stop it in time.
    MAX_DAYS: 14,
    MAX_TOTAL_BYTES: 32 * 1024 * 1024,
    // One file the operator can actually open, and the granularity at which the
    // record forgets: the byte bound drops whole segments, oldest first.
    MAX_SEGMENT_BYTES: 4 * 1024 * 1024,
    // No event this record accepts comes near this. A line that does is a line
    // whose shape is wrong, and it is dropped rather than written.
    MAX_LINE_BYTES: 2048,
    // How much may be written between two sweeps. Rotating on the day boundary
    // alone would let the pathological case above sit hours past the byte bound.
    PRUNE_INTERVAL_BYTES: 1024 * 1024,
    // A record that failed is retried, but not per line: the disk that refused
    // one write refuses the next thousand just as fast.
    REOPEN_COOLDOWN_MS: 60_000,
    FILE_PREFIX: 'desk-',
    FILE_SUFFIX: '.jsonl',
    DAY_MS: 86_400_000,
});

const SEGMENT_NAME = /^desk-(\d{4}-\d{2}-\d{2})-(\d{3})\.jsonl$/;

// The desk's own vocabulary. Every pattern is an identifier the desk already
// emits — none of them can spell a decimal amount, which is what keeps a price
// or a size from arriving under a field name that was meant for a code.
const PHASE = /^[a-z][a-z0-9-]{0,32}(?::\d{1,12})?$/;
const CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
const STATE = /^[a-z][a-z-]{0,31}$/;
// The workstation protocol's identity alphabet, not ASCII: Binance lists
// perpetuals whose tickers are CJK words, and under the ASCII rule every line
// about one — the statuses naming a resynchronization storm included — lost
// itself to the malformed-field rule while the operator traded the contract
// (龙虾USDT, 2026-08-28). Letters without lowercase and numbers still cannot
// spell a decimal amount: `.` and `-` stay outside the class. The dated
// alternative is the delivery-contract form.
const SYMBOL_CHARACTERS = '[\\p{Lu}\\p{Lt}\\p{Lo}\\p{N}]';
const SYMBOL = new RegExp(
    `^(?:${SYMBOL_CHARACTERS}{1,24}|${SYMBOL_CHARACTERS}{1,17}_[0-9]{6})$`,
    'u',
);
const ACTION = /^[a-z][A-Za-z0-9._-]{0,63}$/;
const MARKET = /^[a-z][a-z-]{0,15}$/;
const SIDE = /^(?:BUY|SELL)$/;
const ORDER_TYPE = /^[A-Z][A-Z_]{0,31}$/;
// What the exchange says an order is now — `NEW`, `PARTIALLY_FILLED`, `FILLED`.
// The same shape as the type above, and for the same reason: an uppercase word
// cannot spell a decimal, so a size can never arrive under this name.
const ORDER_STATE = /^[A-Z][A-Z_]{0,31}$/;
// Binance permits `.`, `:` and `/` in a client order id; this desk mints only
// `<market>-<base36 time>-<base36 suffix>`, and the exchange's own identities
// are digits. Kept to that, because a rule this narrow cannot spell an amount —
// an identity from somewhere else loses its line rather than widening it.
const IDENTITY = /^[A-Za-z0-9_-]{1,64}$/;
const OUTCOME = /^[a-z][a-z-]{0,31}$/;
// Which of two states an incomplete settled pass was in. `debt-only` answered
// every request and waits for the exchange to write a charge it announced;
// `short` genuinely missed its target or was refused. Null on a pass that was
// not partial at all.
const PARTIAL_KIND = /^(?:debt-only|short)$/;
// How an exchange-info read used the shared cache: a fresh value, a new fetch,
// an in-flight fetch another caller started, or a bounded-stale value served
// while it is revalidated. Only reads that have a cache carry it; the rest
// state nothing.
const CACHE = /^(?:hit|miss|shared|stale)$/;
// `withheld` is the renderer's: a command that never left it, with the
// condition that stopped it, so an exit that was never sent is a line and not
// a blank.
const RESULT = /^(?:rejected|unresolved|resolved|withheld)$/;
// The exchange's own name for a refusal. Binance answers with a small signed
// integer (-2019, "insufficient margin"); a request that never reached an answer
// carries the transport's uppercase name instead (ECONNRESET, ETIMEDOUT).
// Neither shape has a decimal point in it, which is the whole reason this field
// may sit beside a rule that keeps amounts out — the exchange's *message* may
// not, and does not.
const EXCHANGE_CODE_NUMBER = /^-?\d{1,6}$/;
const EXCHANGE_CODE_NAME = /^[A-Z][A-Z0-9_]{0,39}$/;
const EVENT = /^(?:started|stopped)$/;
// What the renderer reports the screen doing, and why it switched. A closed
// vocabulary on both: the renderer is the desk's own, but these are still
// fields a caller chooses the value of.
const DISPLAY_EVENT = /^(?:symbol-shown|interval-shown|workspace-mounted|workspace-unmounted)$/;
const INTERVAL = /^[0-9]{1,3}[mhdwM]$/;
const DISPLAY_CAUSE = /^(?:operator|restored)$/;
// A renderer socket arriving or leaving. The count beside it is the sockets
// open after the event — two where one is expected is a second window or a
// leaked subscriber, and this line is the only record either has.
const LINK_EVENT = /^(?:renderer-connected|renderer-disconnected)$/;
// Why the desk read the signed account. A closed vocabulary rather than free
// text: a reason the record does not know is a read site that never stated one,
// and losing that line is how it says so.
const READ_REASON = new RegExp(`^(?:${FUTURES_ACCOUNT_READ_REASONS.join('|')})$`);
// Why the desk read what an open position has already settled. Its own closed
// vocabulary rather than the account read's above: these are the events that
// move settled money, and three of them — a fill that realized something, a
// funding charge, the stream coming up — are not reasons to read the signed
// account at all. Sharing one list would have dropped every line whose reason
// was `fill` or `funding`, which is most of them.
const SETTLED_REASON = /^(?:bootstrap|stream|fill|funding|settlement|refresh|confirm|credit-confirm|insurance|insurance-confirm|verification|extension|tick)$/;
// Which way round the exchange hands back a page of the income record. The whole
// backward walk rests on it being oldest-first — a full page is then the *oldest*
// thousand rows of the range asked for — and the endpoint's documentation does
// not state it either way. Assumed once already, and an assumption that decides
// which rows the desk holds is not something to assume twice. Measured on the
// wire, per pass, from the rows themselves.
const SETTLED_ORDER = /^(?:ascending|descending|flat|none)$/;
// The desk's own name for a stream of market data — `depth`, `candles`,
// `trades`, `ticker`. Same shape as the workstation protocol's resource names.
const RESOURCE = /^[a-z][a-zA-Z0-9]{0,31}$/;
// Whether the request this budget held back was the operator's business or the
// desk's own housekeeping. Two words, because the question the line answers is
// only ever which of the two was waiting.
const DEFERRED_STANDING = /^(?:command|urgent|ordinary)$/;
const CLOSED_BY = /^(?:exchange|desk|transport)$/;
// The route a physical attempt went on, in the desk's own words — never a
// path. Two thousand weight-5 lines on 2026-09-02 could be attributed only by
// their cadence.
const REQUEST_ROUTE = /^[a-z][a-z-]{0,31}$/;
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,31}$/;
const ESTIMATE_VALUE = new RegExp(`^(?:${FUTURES_MARGIN_ESTIMATE_VALUES.join('|')})$`);

const text = pattern => value => (
    typeof value === 'string' && pattern.test(value) ? value : undefined
);
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const httpStatus = value => (
    Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : undefined
);
const basisPoints = value => (
    Number.isSafeInteger(value)
        && value >= 0
        && value <= FUTURES_MARGIN_ESTIMATE_MAX_BPS
        ? value
        : undefined
);
// An order identity arrives as a number from the exchange and as a string from
// the desk's own client ids. Both name the same thing.
const identity = (value) => {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    return text(IDENTITY)(value);
};
const exchangeCode = (value) => {
    const named = text(EXCHANGE_CODE_NAME)(value);
    if (named !== undefined) return named;
    const numbered = Number.isSafeInteger(value) ? String(value) : value;
    return typeof numbered === 'string' && EXCHANGE_CODE_NUMBER.test(numbered)
        ? numbered
        : undefined;
};
const optional = read => value => (
    value === null || value === undefined ? null : read(value)
);
// The one field whose refusal costs the field and not the line. A command the
// exchange refused is worth recording even when the exchange named the refusal
// in a shape this record will not repeat — the alternative is losing the fact
// that it happened at all.
const tolerated = read => value => (
    value === null || value === undefined ? null : read(value) ?? null
);

// Each kind states exactly the fields it may carry. Nothing else is copied, so
// a credential, a signature or a money value offered alongside cannot reach the
// file; a field that is present but malformed refuses the whole event, so a
// line is never half a fact.
const RECORDED_FIELDS = Object.freeze({
    session: Object.freeze([
        ['event', text(EVENT)],
        ['version', optional(text(VERSION))],
    ]),
    // `code` is why the phase ended badly, and null on a phase that did not.
    // Without it a failure line states that something took four milliseconds and
    // refuses to say what refused: the desk failed one `exchange-info` read on
    // nearly every start for six days and the record could not be asked which of
    // three fast rejections it was. `tolerated` rather than `optional` for the
    // same reason the exchange's own refusal code is — a reason in a shape this
    // file will not repeat costs the reason, never the fact that it happened.
    // `symbol` on both: a fault or a timing raised inside a workstation session
    // belongs to that session's contract, and without it a held session's storm
    // reads as the desk's own — 2026-08-28, fifteen-second resynchronization
    // cycles that named no one. Optional, because the phases outside any
    // session are real too.
    timing: Object.freeze([
        ['phase', text(PHASE)],
        ['durationMs', count],
        ['outcome', text(OUTCOME)],
        ['cache', optional(text(CACHE))],
        ['code', tolerated(text(CODE))],
        ['symbol', optional(text(SYMBOL))],
    ]),
    fault: Object.freeze([
        ['phase', text(PHASE)],
        ['code', text(CODE)],
        ['symbol', optional(text(SYMBOL))],
    ]),
    // What a fault left behind to be read by, beside the fault's own line. A
    // stream close: who closed it, the socket's close code, and how late the
    // last frame before it was — on 2026-09-02 three closes each followed four
    // to eight seconds of lag and nothing said so. A crossed book: the
    // identities of the diff that crossed it and how many levels stand across
    // the market. Identities and counts, never a price.
    evidence: Object.freeze([
        ['phase', text(PHASE)],
        ['code', text(CODE)],
        ['symbol', optional(text(SYMBOL))],
        ['closeCode', optional(count)],
        ['closedBy', optional(text(CLOSED_BY))],
        ['lastUpstreamMs', optional(count)],
        ['lastUpdateId', optional(identity)],
        ['firstUpdateId', optional(identity)],
        ['finalUpdateId', optional(identity)],
        ['previousFinalUpdateId', optional(identity)],
        ['crossedLevels', optional(count)],
    ]),
    // What the renderer says the screen switched to. The frame lines say what
    // was delivered; only the renderer can say what is being looked at — a
    // remount that reopens the previous contract is indistinguishable from the
    // operator's own choice without the cause beside it.
    display: Object.freeze([
        ['event', text(DISPLAY_EVENT)],
        ['symbol', optional(text(SYMBOL))],
        ['from', optional(text(SYMBOL))],
        ['cause', optional(text(DISPLAY_CAUSE))],
        // Which chart interval the screen switched to and from. A switch used
        // to be readable only from the timing phases behind it (2026-09-02).
        ['interval', optional(text(INTERVAL))],
        ['fromInterval', optional(text(INTERVAL))],
    ]),
    // A renderer socket arriving or leaving, with the sockets open after it.
    // The local link was the one lifecycle the record never wrote, and a
    // workspace that remounts on a link flap looks like a haunting without it.
    link: Object.freeze([
        ['event', text(LINK_EVENT)],
        ['connections', count],
    ]),
    status: Object.freeze([
        ['symbol', text(SYMBOL)],
        ['state', text(STATE)],
        ['code', optional(text(CODE))],
    ]),
    // Market data the desk did not send because a newer frame for the same thing
    // was already waiting on a socket the renderer had not drained. Written when
    // the backlog clears, one line per resource, never one per frame — the case
    // worth recording is a socket blocked for a minute at ten books a second, and
    // that is exactly the case where the record must not become the problem.
    backlog: Object.freeze([
        ['resource', optional(text(RESOURCE))],
        ['symbol', optional(text(SYMBOL))],
        ['superseded', count],
        ['dropped', count],
        // How far behind it got, in frames and in bytes — the worst reached
        // during the backlog, because the line is written once it has ended and
        // by then what is waiting is nothing. Sixty-four frames is a different
        // backlog when they are status lines than when they are books, and the
        // frame count alone cannot tell the operator which they had. Counts, not
        // amounts: a byte total is a length, and no length is a price.
        ['frames', count],
        ['bytes', count],
    ]),
    // Where one frame spent its time on the way from the exchange to the screen.
    //
    // Delays, not clock readings. Five marks are taken — the exchange's own event
    // time, the main process receiving the frame, queueing it for the renderer,
    // the renderer receiving it, and the desk committing it to screen — and what
    // is written is the gap between each pair. Two reasons, and the second is the
    // load-bearing one: a reader wanting to know which step was slow would have to
    // subtract the readings anyway, and a delay is a *count* of milliseconds,
    // which is the same rule that keeps every other amount out of this file. A
    // clock reading is a number that could be anything; `count` cannot spell a
    // decimal, so no price or size can arrive under one of these names.
    //
    // `upstreamMs` alone is nullable, and null means "not knowable" rather than
    // zero. A frame whose payload states no event time has no upstream leg to
    // measure; so does a frame whose stated event time is *ahead* of when this
    // process received it, which is a disagreement between two clocks and not a
    // leg that took no time. Reporting either as 0 would claim the exchange
    // reached the desk instantly.
    //
    // `totalMs` is carried rather than left to be summed, for the same reason:
    // with `upstreamMs` absent a reader summing the parts would get the desk's own
    // share and call it the whole journey.
    frame: Object.freeze([
        ['phase', text(PHASE)],
        ['code', text(CODE)],
        ['resource', optional(text(RESOURCE))],
        ['symbol', optional(text(SYMBOL))],
        ['upstreamMs', optional(count)],
        ['queuedMs', count],
        ['deliveredMs', count],
        ['committedMs', count],
        ['totalMs', count],
        // Which order the frame was about, and what the exchange said about it.
        // Null on a market frame, which is about a contract and not an order.
        //
        // The identity is the one the `command` and `answer` lines already
        // carry, so a fill can be read against the order that was placed
        // without joining two vocabularies by hand. The state is what makes a
        // partial fill legible: it is the one thing the record may say about a
        // fill, because the filled *quantity* is an amount and stays out.
        ['identity', optional(identity)],
        ['status', optional(text(ORDER_STATE))],
    ]),
    // What the desk was told to do — contract, side, type, identity — and never
    // what it was worth. A trade journal is a different decision.
    command: Object.freeze([
        ['action', text(ACTION)],
        ['market', text(MARKET)],
        ['symbol', optional(text(SYMBOL))],
        ['side', optional(text(SIDE))],
        ['orderType', optional(text(ORDER_TYPE))],
        ['identity', optional(identity)],
    ]),
    // How long the desk was busy with the command above, from the validated
    // command to the end of handling it. The `command` line says what was asked
    // and when; without its answer the record cannot be asked the one question
    // an operator asks of a slow desk — how long an order actually took, and
    // whether the wait was the exchange's or the desk's own.
    //
    // What "handling it" contains differs by command, so durations compare only
    // within one action. For the Futures configuration commands — the leverage
    // multiple, the margin mode — it is the exchange round trip and the
    // contract's configuration re-read; the account pass those commands trigger
    // runs detached and prices consequences, not the answer. A Spot order's
    // answer still contains its account re-read — two `answer` lines from two
    // markets are not the same measurement.
    answer: Object.freeze([
        ['action', text(ACTION)],
        ['market', text(MARKET)],
        ['durationMs', count],
        ['outcome', text(OUTCOME)],
        ['symbol', optional(text(SYMBOL))],
        ['identity', optional(identity)],
    ]),
    // One line per pass over the signed account resources, stating why it went
    // out and what it cost. The desk's rule has always been that an account read
    // needs a stated reason; this is where the reason is kept, and it is the only
    // way to tell a desk that reads when it must from one that reads on every
    // frame that arrives. One line per pass, never per request — a full pass is
    // four requests and would say the same thing four times.
    read: Object.freeze([
        ['reason', text(READ_REASON)],
        ['resources', count],
        ['weight', count],
        // Periodic beats held, while the stream carried, since the last pass
        // that ran — stated on the pass so the deference is a line, not an
        // absence. Optional: the fee-valuation read has no beat to answer for.
        ['heldBeats', optional(count)],
    ]),
    // One line each time the desk's own read budget, and not the exchange, made
    // a request wait — what was waiting, how long, and how full the minute was
    // when it was turned away.
    //
    // Written because on 2026-08-22 the operator's leverage change took 26 368ms
    // and this file had nothing at all to say about it: a `command` line, then
    // twenty-six seconds of book faults belonging to something else, then the
    // `answer`. The wait is the desk's own doing, so it is the desk that has to
    // admit to it — otherwise the only reading left is that the exchange was
    // slow, which it was not.
    //
    // `spent` and `ceiling` are the weights this budget counts, not the
    // exchange's own meter, which the desk does not read.
    deferred: Object.freeze([
        ['standing', text(DEFERRED_STANDING)],
        ['waitedMs', count],
        ['weight', count],
        ['spent', count],
        ['ceiling', count],
    ]),
    // One line per logical Futures REST operation. The adapter may have made
    // more than one physical request for it — a connection fallback, clock
    // synchronization, or retry — and these counts are the only material from
    // that transport allowed into the record. There is deliberately no field
    // capable of carrying a URL, query, body, header, signature, exchange
    // message, credential or amount.
    request: Object.freeze([
        ['standing', text(DEFERRED_STANDING)],
        ['route', tolerated(text(REQUEST_ROUTE))],
        ['attempts', count],
        ['chargedWeight', count],
        ['observedWeight', optional(count)],
        ['backpressureMs', count],
        ['connectionRetries', count],
        ['networkRetries', count],
        ['timestampRetries', count],
        ['rateLimitResponses', count],
        ['outcome', text(OUTCOME)],
        ['status', optional(httpStatus)],
        ['code', tolerated(exchangeCode)],
    ]),
    // One line per pass over the income record — what the open positions have
    // already been charged or paid. Counts only, never the money itself: how
    // many pages were walked, how many rows the exchange answered with, how many
    // of those are a position's own money, how many contracts they name, and how
    // many renderers were listening when the answer went out.
    //
    // Written because on 2026-08-20 the operator's column was empty and nothing
    // in this file could say whether the read had fired, whether the exchange
    // had answered it, or whether what came back ever left the process. A figure
    // that disagrees with the exchange is a bug with a trail; an absent one had
    // none, and the whole path had to be read by hand to find that out.
    settled: Object.freeze([
        ['reason', text(SETTLED_REASON)],
        // What the exchange's own ordering was this pass, measured rather than
        // assumed. `none` means no page carried two rows to compare.
        ['order', text(SETTLED_ORDER)],
        ['pages', count],
        // What the pass actually asked the exchange for. A page is one read per
        // kind of flow now that the desk asks for the kinds it cannot derive
        // instead of for all of them, so `pages` alone stopped being the cost:
        // weight is `reads` times the endpoint's 30. Recorded because the whole
        // point of narrowing the read is a number, and a change that cannot be
        // read off the operator's own journal is a claim rather than a result.
        ['reads', count],
        // `reads` counts logical page operations. These two state what those
        // operations really cost after transport/time recovery.
        ['attempts', count],
        ['chargedWeight', count],
        // How many kinds of flow this pass asked for. `pages * types` is
        // `reads` while every kind answers; where it is not, a kind filled its
        // page and the walk went round again for it alone.
        ['types', count],
        ['lanes', count],
        // How much of this pass came off disk rather than the wire, and what the
        // exchange said about it when it was checked. A kept reading is only
        // safe while somebody can see whether it has ever been wrong.
        ['restored', count],
        // Whether the held rows were checked against the exchange this pass or
        // merely extended. `missing: 0` means nothing without it.
        ['verified', count],
        ['missing', count],
        ['differing', count],
        ['rows', count],
        ['kept', count],
        ['contracts', count],
        // How many of the held rows are funding charges. Split out from `rows`
        // because on 2026-08-20 the column beside an open position printed its
        // commission exactly and its funding not at all — and a single total of
        // rows held cannot tell "the read never got them" from "they were
        // dropped on the way to the screen".
        ['fundingRows', count],
        // Only presence counts for underivable credits. Raw identities and
        // amounts are intentionally not accepted anywhere in this kind.
        ['rebateRows', count],
        ['rebateSymbolRows', count],
        ['rebateTradeRows', count],
        // Zero recipients is the failure that reads exactly like a read which
        // never happened: the answer was correct and went nowhere.
        ['recipients', count],
        // How much of the window the held rows actually reach, as a span rather
        // than a clock reading — the same rule that keeps every other amount out
        // of this file, and the number that would have named the defect on the
        // first line: a reading covering one day of a seven-day window.
        ['coveredMs', count],
        ['coverageGainedMs', count],
        // `complete` reaches the window's start, `partial` stopped at the request
        // budget or the row ceiling, `failed` was refused, `abandoned` was
        // overtaken by a newer activation before it could answer.
        ['outcome', text(OUTCOME)],
        // `outcome: partial` was one word for two different states, and on
        // 2026-08-24 the desk announced a failure for the harmless one after
        // every close. `partialKind` says which: `debt-only` answered every
        // request and is waiting for the exchange to write a charge it
        // announced, `short` missed its target. `awaitingLanes` counts the
        // lanes owing a confirmation — with `reason` it says whether a debt is
        // standing and whether the same one is standing pass after pass, which
        // is the ledger's chronic-partial question. A count, like everything
        // else here: the lane names would be a list, and no list may enter this
        // file.
        ['partialKind', optional(text(PARTIAL_KIND))],
        ['awaitingLanes', optional(count)],
        ['code', tolerated(text(CODE))],
    ]),
    // The calculator's amounts never arrive here. One event is the aggregate
    // distance for one value in one pass, plus the count that could not be
    // computed; nullable fields mean there was no comparable row, not zero.
    estimate: Object.freeze([
        ['value', text(ESTIMATE_VALUE)],
        ['compared', count],
        ['unavailable', count],
        ['deviationBps', optional(basisPoints)],
        ['symbol', optional(text(SYMBOL))],
    ]),
    outcome: Object.freeze([
        ['action', text(ACTION)],
        ['result', text(RESULT)],
        ['code', text(CODE)],
        ['market', optional(text(MARKET))],
        ['symbol', optional(text(SYMBOL))],
        ['identity', optional(identity)],
        // Which condition of a desk refusal failed, when the code alone cannot
        // say. `FUTURES_REDUCTION_NOT_CONFIRMED` stood for five causes on
        // 2026-08-24 and the refusal of a live close had to be diagnosed from
        // the lines around it. Same shape as a code; `tolerated` for the same
        // reason the exchange's own code is — a cause this record will not
        // repeat costs the cause, never the refusal.
        ['cause', tolerated(text(CODE))],
        // `FUTURES_API_ERROR` above is the desk's word for every refusal there
        // is. This is the exchange's own, and it is the difference between an
        // evening of refusals being one cause or five.
        ['exchangeCode', tolerated(exchangeCode)],
        // For a quantity refusal: the size asked for over the leg held, in
        // basis points. A count; neither amount is written.
        ['requestedToLegBps', optional(count)],
    ]),
});

export const DESK_DIAGNOSTIC_RECORD_KINDS = Object.freeze(Object.keys(RECORDED_FIELDS));

// Most record kinds are a projection of an envelope that exists for other
// reasons: the caller hands over the whole thing and the field list above takes
// the handful of properties that may be kept. An extra property there is normal
// and is simply not copied.
//
// These two are built for this file and nothing else. Nobody constructs an
// `estimate` or a `frame` except to record it, so an unexpected field is not a
// bigger envelope being narrowed — it is a caller handing the privacy boundary
// something it never declared. Lose the whole line rather than silently stripping
// a price or a size out of it, which is the failure that would never be noticed.
const SEALED_KINDS = Object.freeze(new Set(['estimate', 'frame']));

/**
 * The whole of what may be written, and the only way in.
 *
 * Answers a frozen event, or `null` when the kind is not one this record keeps
 * or a field it declares is missing or malformed.
 */
export const describeDeskDiagnosticEvent = (kind, value) => {
    const fields = typeof kind === 'string' && Object.hasOwn(RECORDED_FIELDS, kind)
        ? RECORDED_FIELDS[kind]
        : null;
    if (fields === null
        || value === null
        || typeof value !== 'object'
        || Array.isArray(value)) return null;
    if (SEALED_KINDS.has(kind)) {
        const accepted = new Set(fields.map(([name]) => name));
        if (Object.keys(value).some(name => !accepted.has(name))) return null;
    }
    const event = { kind };
    for (const [name, read] of fields) {
        const carried = read(value[name]);
        if (carried === undefined) return null;
        event[name] = carried;
    }
    return Object.freeze(event);
};

const OUTCOME_ENVELOPES = Object.freeze([
    Object.freeze(['command_rejected', 'rejected']),
    Object.freeze(['command_unresolved', 'unresolved']),
    Object.freeze(['command_resolved', 'resolved']),
]);

/**
 * Recognizes the two facts the desk states to the renderer and nowhere else:
 * the workspace's own status line — which is where a resynchronization names
 * its cause — and the end of a trading command.
 *
 * This runs on every outbound frame, so it reads a handful of properties and
 * answers `null` for everything else.
 */
export const readDeskDiagnosticOutboundEvent = (payload) => {
    if (payload === null || typeof payload !== 'object') return null;
    if (payload.resource === 'status') {
        return describeDeskDiagnosticEvent('status', {
            symbol: payload.symbol,
            state: payload.state,
            code: payload.payload?.reasonCode ?? null,
        });
    }
    for (const [key, result] of OUTCOME_ENVELOPES) {
        const envelope = payload[key];
        if (envelope === null || typeof envelope !== 'object') continue;
        const details = envelope.details;
        return describeDeskDiagnosticEvent('outcome', {
            action: envelope.request,
            result,
            code: envelope.code,
            market: details?.marketType ?? null,
            symbol: details?.symbol ?? null,
            identity: details?.orderId ?? details?.origClientOrderId ?? details?.clientOrderId ?? null,
            // Present when the desk's own refusal names which condition failed;
            // absent on every other outcome.
            cause: details?.cause ?? null,
            // Present on every envelope the exchange itself refused; absent on
            // the desk's own refusals, which never asked it anything.
            exchangeCode: details?.binanceCode ?? null,
            requestedToLegBps: Number.isSafeInteger(details?.requestedToLegBps)
                ? details.requestedToLegBps
                : null,
        });
    }
    return null;
};

// Reads the desk asks for on its own beat, not things it did. While an order
// rests, the account is re-read every thirty seconds and the contract's
// configuration on every switch; recorded, those alone would be two thousand
// lines a day saying only that the desk was running. Their timings and their
// failures are already kept. The set names the reads, not the writes, so a
// command added later is recorded until someone decides otherwise.
const UNRECORDED_COMMAND_ACTIONS = Object.freeze(new Set([
    TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
    TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
    TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG,
]));

/**
 * The command as it was issued, before anything was sent.
 *
 * The outcome envelopes above say how a command ended but not what it was; only
 * the validated command carries the side and the type.
 */
export const readDeskDiagnosticCommandEvent = command => (
    UNRECORDED_COMMAND_ACTIONS.has(command?.action)
        ? null
        : describeDeskDiagnosticEvent('command', {
            action: command?.action,
            market: command?.marketType,
            symbol: command?.symbol ?? null,
            side: command?.side ?? null,
            orderType: command?.orderType ?? null,
            // The order's identity, not the command's: a cancellation names the
            // order it is cancelling, and a placement's own client id *is* that
            // order's. This is what ties a command to the outcome answering it.
            identity: command?.origClientOrderId
                ?? command?.orderId
                ?? command?.clientOrderId
                ?? null,
        })
);

// What the desk uses when no record is configured — the tests' baseline, and
// the answer to "does anything change when the record is not there".
export const DESK_DIAGNOSTICS_UNRECORDED = Object.freeze({
    directory: null,
    record: () => false,
    observeOutbound: () => false,
    observeCommand: () => false,
    close: () => {},
});

const utcDay = timestamp => new Date(timestamp).toISOString().slice(0, 10);

const segmentName = (day, index) => (
    `${DESK_DIAGNOSTIC_RECORD.FILE_PREFIX}${day}-${String(index).padStart(3, '0')}`
    + DESK_DIAGNOSTIC_RECORD.FILE_SUFFIX
);

/**
 * Opens the record under `directory`, one file per day, appended to, and keeps
 * it inside both bounds.
 *
 * `fileSystem` and `now` are injected the way the desk's other on-disk setting
 * injects them, so every degradation below is provable without a disk that has
 * to be made to fail.
 */
export const createDeskDiagnosticRecord = ({
    directory,
    fileSystem = fs,
    now = () => Date.now(),
    logger = console,
} = {}) => {
    if (typeof directory !== 'string' || directory === '') return DESK_DIAGNOSTICS_UNRECORDED;

    let stream = null;
    let openDay = null;
    let openSegment = 0;
    let segmentBytes = 0;
    let bytesSincePrune = 0;
    let stalledAt = null;
    let statedFailure = false;
    let backedUp = false;

    // A record that is failing says so once. Saying it per line would cost the
    // desk more than the missing record does, and the console is where the desk
    // already speaks.
    const stateFailure = (what, error) => {
        if (statedFailure) return;
        statedFailure = true;
        try {
            logger?.warn?.(
                `[desk-record] ${what} (${error?.code || error?.message || 'unknown'});`
                + ' the record is degraded',
            );
        } catch {
            // Even saying so must not raise.
        }
    };

    const sizeOf = (name) => {
        try {
            return fileSystem.statSync(path.join(directory, name)).size ?? 0;
        } catch {
            return 0;
        }
    };

    const listSegments = () => {
        const segments = [];
        for (const name of fileSystem.readdirSync(directory)) {
            const match = SEGMENT_NAME.exec(name);
            if (match === null) continue;
            segments.push(Object.freeze({ name, day: match[1], index: Number(match[2]) }));
        }
        // The name sorts chronologically by construction: day first, then a
        // zero-padded segment.
        return segments.sort((left, right) => (left.name < right.name ? -1 : 1));
    };

    // Whatever the day bound leaves, the byte bound finishes. A failure here
    // leaves the record usable — but not silently over its bound.
    const prune = () => {
        bytesSincePrune = 0;
        try {
            const current = openDay === null ? null : segmentName(openDay, openSegment);
            const oldestKeptDay = utcDay(
                now() - ((DESK_DIAGNOSTIC_RECORD.MAX_DAYS - 1) * DESK_DIAGNOSTIC_RECORD.DAY_MS),
            );
            const survivors = [];
            for (const entry of listSegments()) {
                if (entry.name === current) continue;
                if (entry.day < oldestKeptDay) {
                    fileSystem.unlinkSync(path.join(directory, entry.name));
                    continue;
                }
                survivors.push(Object.freeze({ name: entry.name, bytes: sizeOf(entry.name) }));
            }
            let total = survivors.reduce((sum, entry) => sum + entry.bytes, segmentBytes);
            for (const entry of survivors) {
                if (total <= DESK_DIAGNOSTIC_RECORD.MAX_TOTAL_BYTES) break;
                fileSystem.unlinkSync(path.join(directory, entry.name));
                total -= entry.bytes;
            }
        } catch (error) {
            stateFailure('the record could not be rotated', error);
        }
    };

    // `forcedIndex` is the segment a full one rolls into. Re-reading the size of
    // the file just declared full would work only as long as the disk answers
    // faster than the desk writes, which is not a thing to depend on.
    const open = (day, forcedIndex = null) => {
        fileSystem.mkdirSync(directory, { recursive: true });
        const sameDay = forcedIndex === null
            ? listSegments().filter(entry => entry.day === day)
            : [];
        let index = forcedIndex ?? (sameDay.length === 0 ? 0 : sameDay[sameDay.length - 1].index);
        let bytes = sameDay.length === 0 ? 0 : sizeOf(segmentName(day, index));
        if (bytes >= DESK_DIAGNOSTIC_RECORD.MAX_SEGMENT_BYTES) {
            index += 1;
            bytes = 0;
        }
        const opened = fileSystem.createWriteStream(
            path.join(directory, segmentName(day, index)),
            { flags: 'a' },
        );
        // A stream reports its failures asynchronously; unhandled, that error
        // reaches the process rather than the line that caused it.
        opened.on('error', (error) => {
            stream = null;
            stalledAt = now();
            stateFailure('a write failed', error);
        });
        // A disk that stops accepting writes must cost the desk a line, not
        // memory: past the stream's own buffer the record stops handing lines
        // over until the disk has caught up.
        opened.on('drain', () => {
            backedUp = false;
        });
        backedUp = false;
        stream = opened;
        openDay = day;
        openSegment = index;
        segmentBytes = bytes;
        statedFailure = false;
    };

    const ensureStream = (day) => {
        const full = segmentBytes >= DESK_DIAGNOSTIC_RECORD.MAX_SEGMENT_BYTES;
        if (stream !== null && openDay === day && !full) return true;
        if (stream === null
            && stalledAt !== null
            && now() - stalledAt < DESK_DIAGNOSTIC_RECORD.REOPEN_COOLDOWN_MS) return false;
        const rolling = stream !== null && openDay === day && full;
        if (stream !== null) {
            try {
                stream.end();
            } catch {
                // A segment that will not close is still a segment we are done with.
            }
            stream = null;
        }
        try {
            open(day, rolling ? openSegment + 1 : null);
        } catch (error) {
            stalledAt = now();
            stateFailure('the record could not be opened', error);
            return false;
        }
        stalledAt = null;
        prune();
        return true;
    };

    const writeEvent = (event) => {
        if (event === null) return false;
        try {
            const at = now();
            if (!ensureStream(utcDay(at))) return false;
            if (backedUp) return false;
            const line = `${JSON.stringify({ at: new Date(at).toISOString(), ...event })}\n`;
            const bytes = Buffer.byteLength(line, 'utf8');
            if (bytes > DESK_DIAGNOSTIC_RECORD.MAX_LINE_BYTES) return false;
            if (stream.write(line) === false) {
                backedUp = true;
                stateFailure('the disk is not keeping up', null);
            }
            segmentBytes += bytes;
            bytesSincePrune += bytes;
            if (bytesSincePrune >= DESK_DIAGNOSTIC_RECORD.PRUNE_INTERVAL_BYTES) prune();
            return true;
        } catch (error) {
            stream = null;
            stalledAt = now();
            stateFailure('a line could not be written', error);
            return false;
        }
    };

    return Object.freeze({
        directory,
        record: (kind, value) => writeEvent(describeDeskDiagnosticEvent(kind, value)),
        observeOutbound: (payload) => {
            try {
                return writeEvent(readDeskDiagnosticOutboundEvent(payload));
            } catch {
                return false;
            }
        },
        observeCommand: (command) => {
            try {
                return writeEvent(readDeskDiagnosticCommandEvent(command));
            } catch {
                return false;
            }
        },
        close: () => {
            try {
                stream?.end();
            } catch {
                // Closing a record that is already broken changes nothing.
            }
            stream = null;
        },
    });
};
