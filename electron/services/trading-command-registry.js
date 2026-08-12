// Two commands, one order.
//
// The renderer's socket handler is `async`, and `ws` does not wait for it: two
// frames that arrive back to back both enter the trading path and run against
// the exchange at the same time. Nothing local stopped that. Two consequences,
// both of which cost real money:
//
// - A command delivered twice was submitted twice. The renderer resends a
//   command it believes never left (`retryUnsentCommand`), carrying the same
//   identity on purpose — and a reconnected renderer resends it on a socket
//   that never saw the first answer. Binance refuses a duplicate
//   `newClientOrderId` on placement, so that one case is caught downstream; a
//   cancellation and an amendment carry no such protection and would simply run
//   twice.
// - An amendment and a cancellation of one order raced. Accepted in that order,
//   they could reach Binance in the other, so an order the operator cancelled
//   came back amended.
//
// This module is the one place both are decided. It records what each mutating
// command did, answers a second copy from that record, and holds one lane per
// contract so commands on the same book run in the order they were accepted.
//
// It never decides *whether* a command may run: validation, the order cap and
// the pause gate all already answered that before anything reaches here.

import { AsyncLocalStorage } from 'node:async_hooks';
import { TRADING_COMMAND_ACTIONS } from '../../src/utils/tradingCommands.js';

// What a command changes at the exchange. Reads are absent on purpose: an
// account refresh or a history page may be asked for as often as the desk
// likes, and the history fan-out depends on staying concurrent. `SET_TRADING_PAUSED`
// is absent too — it sends nothing and only sets a local flag.
export const MUTATING_TRADING_ACTIONS = Object.freeze(new Set([
    TRADING_COMMAND_ACTIONS.PLACE_ORDER,
    TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
    TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
    TRADING_COMMAND_ACTIONS.CANCEL_ALL,
    TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
    TRADING_COMMAND_ACTIONS.SET_LEVERAGE,
    TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE,
]));

export const isMutatingTradingCommand = command => (
    typeof command?.action === 'string' && MUTATING_TRADING_ACTIONS.has(command.action)
);

// Keys are built by joining fields the exchange chose the alphabets of, so the
// separator is the one character none of them can contain. A printable one
// would leave two different commands able to spell one key between them.
const SEPARATOR = '\u0000';

// The envelopes that say how a command ended, and nothing else. A recorded
// outcome is replayed verbatim to whoever sends the second copy, so this list is
// deliberately narrow: an account snapshot or a chart page replayed minutes
// later would be a lie about the present, where a rejection or an execution
// report is a statement about a command that stays true.
export const TRADING_COMMAND_OUTCOME_KEYS = Object.freeze([
    'command_rejected',
    'command_unresolved',
    'command_resolved',
    'execution_update',
    'futures_execution_update',
]);

export const isTradingCommandOutcomeEnvelope = payload => (
    payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && TRADING_COMMAND_OUTCOME_KEYS.some(key => payload[key] !== undefined)
);

// A command carries its identity from the moment the operator's intent is
// formed, and keeps it through every rebuild and resend of that intent. That is
// what makes a second copy recognizable at all — so a command that arrives
// without one cannot be deduplicated, and is only serialized.
export const readTradingCommandIdentity = (command) => {
    if (!isMutatingTradingCommand(command)) return null;
    const clientOrderId = command.clientOrderId;
    if (typeof clientOrderId !== 'string' || clientOrderId.length === 0) return null;
    return [
        command.marketType ?? '',
        command.accountId ?? '',
        command.action,
        clientOrderId,
    ].join(SEPARATOR);
};

// One lane per contract per account per market. An amendment and a cancellation
// of one order share a symbol, so a symbol lane is what orders them; two
// contracts have nothing to say to each other and stay concurrent, which is the
// whole reason the lane is not simply global.
//
// A mutating command with no symbol would be unordered against everything, so it
// takes the market's shared lane rather than none at all.
export const readTradingCommandLane = command => [
    command?.marketType ?? '',
    command?.accountId ?? '',
    typeof command?.symbol === 'string' && command.symbol.length > 0
        ? command.symbol
        : '*',
].join(SEPARATOR);

// Long enough to cover a renderer that drops its socket, reconnects and resends
// what it believes never left; short enough that the record is about the recent
// past and not about the session.
export const TRADING_COMMAND_RECORD_MAX_AGE_MS = 300_000;
export const TRADING_COMMAND_RECORD_MAX_ENTRIES = 256;
// A mutating command states its end at most three times — an unresolved
// warning, its withdrawal, and the report. The cap is what stops a handler
// nobody foresaw from making the record grow with its output.
export const TRADING_COMMAND_MAX_RECORDED_OUTCOMES = 8;

const IGNORE = () => {};
const RESOLVED = Promise.resolve();

/**
 * The registry the main process runs every mutating trading command through.
 *
 * `submit` is the only entry point. `recordOutcome` is called by the connection's
 * emit for every outbound payload; it is a no-op outside a running command.
 */
export const createTradingCommandRegistry = ({
    now = () => Date.now(),
    maxAgeMs = TRADING_COMMAND_RECORD_MAX_AGE_MS,
    maxEntries = TRADING_COMMAND_RECORD_MAX_ENTRIES,
    maxOutcomes = TRADING_COMMAND_MAX_RECORDED_OUTCOMES,
} = {}) => {
    // Insertion-ordered, which is what makes eviction by age a walk from the
    // front rather than a sort.
    const records = new Map();
    const lanes = new Map();
    // The recording travels with the command's own async execution, so an
    // outcome emitted after three awaits and a reconciliation is still
    // attributed to the command that caused it — and a command running
    // concurrently on another contract records its own.
    const recording = new AsyncLocalStorage();

    const evict = () => {
        const deadline = now() - maxAgeMs;
        for (const [key, record] of records) {
            if (record.settled && record.completedAt <= deadline) records.delete(key);
        }
        // Trimmed to below the ceiling rather than to it, because the command
        // being submitted is about to take a place of its own.
        if (records.size < maxEntries) return;
        for (const [key, record] of records) {
            if (records.size < maxEntries) return;
            // An in-flight command has no outcome yet and is what a second copy
            // is about to wait on; only a finished one may be forgotten.
            if (record.settled) records.delete(key);
        }
    };

    const runInLane = (key, task) => {
        const previous = lanes.get(key) ?? RESOLVED;
        const settled = previous.then(task);
        const tail = settled.then(IGNORE, IGNORE);
        lanes.set(key, tail);
        void tail.then(() => {
            if (lanes.get(key) === tail) lanes.delete(key);
        });
        return settled;
    };

    return {
        /**
         * Records an outbound payload against the command being executed.
         *
         * Outside a command — a stream update, a market frame — there is no
         * store and nothing happens.
         */
        recordOutcome: (payload) => {
            const record = recording.getStore();
            if (!record || record.settled) return false;
            if (!isTradingCommandOutcomeEnvelope(payload)) return false;
            if (record.outcomes.length >= maxOutcomes) return false;
            record.outcomes.push(payload);
            return true;
        },

        /**
         * Runs a mutating command once, in the order it was accepted.
         *
         * A command whose identity is already known is not run: the caller is
         * answered with what that command produced — after waiting for it, if it
         * has not finished. `emit` is the caller's own, because the second copy
         * may arrive on a socket that never saw the first answer.
         *
         * Returns true when the command was executed, false when it was answered
         * from the record.
         */
        submit: async (command, { execute, emit }) => {
            evict();
            const identity = readTradingCommandIdentity(command);
            const known = identity === null ? undefined : records.get(identity);
            if (known !== undefined) {
                if (!known.settled) await known.completion;
                for (const outcome of known.outcomes) emit(outcome);
                return false;
            }

            let settle;
            const record = {
                outcomes: [],
                settled: false,
                completedAt: 0,
                completion: new Promise((resolve) => { settle = resolve; }),
            };
            // A command with no identity is still ordered, but nothing can
            // recognize a second copy of it, so nothing is recorded for one.
            if (identity !== null) records.set(identity, record);

            try {
                return await runInLane(
                    readTradingCommandLane(command),
                    () => recording.run(record, execute).then(() => true),
                );
            } finally {
                // Sealed before the waiters are woken: a handler that left work
                // running behind it may still emit, and what it emits belongs to
                // no command any more.
                record.settled = true;
                record.completedAt = now();
                settle();
            }
        },

        // What the record holds, for the test that proves it stays bounded.
        size: () => records.size,
        laneCount: () => lanes.size,
    };
};
