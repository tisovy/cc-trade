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
// order so commands about the same order run in the order they were accepted.
//
// It never decides *whether* a command may run: validation, the order cap and
// the pause gate all already answered that before anything reaches here.
//
// Two properties it depends on, stated so they are not quietly removed:
//
// - `recordOutcome` is reached from the connection's `emit` and nowhere else,
//   and every outcome envelope that goes through `emit` is emitted by a command
//   handler. The user-data stream broadcasts instead (`broadcastToRenderers`),
//   which is what keeps a fill for an unrelated order from being recorded as a
//   running command's answer. Routing stream traffic through `emit` would break
//   that, and this is the comment that says so.
// - A lane is held for as long as its command takes, and a mutating command is
//   bounded: every REST call times out at 10 s, and the worst path — an
//   indeterminate failure followed by three reconciliation lookups and their
//   backoff — is around 40 s. That is the ceiling on how long the next command
//   *about the same order* can wait, and it is the price of the ordering. It is
//   also exactly the window in which the desk has already told the operator it
//   does not know what happened. A command that speaks for a whole contract —
//   cancel-all, leverage, margin type — holds every order on it for that long,
//   which is the reason it is the narrower lane that is the default.

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

// The contract a command acts on, per account per market. Two contracts have
// nothing to say to each other and stay concurrent, which is why ordering is
// not simply global.
//
// Validation requires a symbol on every mutating command, so the fallback below
// is unreachable by anything that gets this far. It is there because the
// alternative to a shared lane is a command ordered against nothing at all.
export const readTradingCommandLane = command => [
    command?.marketType ?? '',
    command?.accountId ?? '',
    typeof command?.symbol === 'string' && command.symbol.length > 0
        ? command.symbol
        : '*',
].join(SEPARATOR);

// What speaks for a whole contract rather than for one order on it. Cancel-all
// is about every order there is; leverage, margin type and position margin are
// properties of the contract and change what any order on it means. Each runs
// alone: every order command already accepted on that contract finishes first,
// and every one accepted after it waits for it.
export const CONTRACT_WIDE_TRADING_ACTIONS = Object.freeze(new Set([
    TRADING_COMMAND_ACTIONS.CANCEL_ALL,
    TRADING_COMMAND_ACTIONS.SET_LEVERAGE,
    TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE,
    TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
]));

// The order a command names, or null when it speaks for the contract.
//
// Ordering exists for two commands about *one* order: an amendment and a
// cancellation accepted in that order could otherwise reach Binance in the
// other, and the order the operator cancelled comes back amended. Two commands
// about different orders have nothing to say to each other, even on one
// contract — and holding them apart was what made the operator's three resting
// orders movable only one at a time, each lift waiting a full round trip for a
// placement it had no relationship with.
//
// An order is named by the exchange's own id wherever the desk has one and by
// the client id the desk minted only until that id exists, at every call site
// that names one, so two commands about one order always spell it the same way.
// A placement names the order it creates: the id it mints is the only name that
// order has until Binance answers, and it is the name a cancellation arriving
// behind it would use. A command that carries both names is keyed by the
// exchange id, because that is the one every other command prefers.
export const readTradingCommandOrderLane = (command) => {
    if (!isMutatingTradingCommand(command)) return null;
    if (CONTRACT_WIDE_TRADING_ACTIONS.has(command.action)) return null;
    const named = command.action === TRADING_COMMAND_ACTIONS.PLACE_ORDER
        ? command.clientOrderId
        : command.orderId ?? command.origClientOrderId;
    // Named by nothing the desk can order it against. It takes the contract,
    // which is the only thing left that is narrower than everything.
    if (named === null || named === undefined || named === '') return null;
    return [readTradingCommandLane(command), String(named)].join(SEPARATOR);
};

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
    // One lane per order, and one gate per contract holding the commands that
    // speak for the whole of it.
    const lanes = new Map();
    const contracts = new Map();
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

    const contractGate = (key) => {
        const held = contracts.get(key);
        if (held !== undefined) return held;
        const gate = { barrier: RESOLVED, members: new Set() };
        contracts.set(key, gate);
        return gate;
    };

    // A contract is remembered only while something is ordered against it.
    const forgetContract = (key) => {
        const gate = contracts.get(key);
        if (gate !== undefined && gate.barrier === RESOLVED && gate.members.size === 0) {
            contracts.delete(key);
        }
    };

    // What a command must not overtake, and what must not overtake it.
    //
    // An order command waits for the last command about that same order, and for
    // the last contract-wide command — which speaks for its order too. A
    // contract-wide command waits for the last contract-wide command and for
    // every order command already accepted on that contract, and everything
    // accepted after it waits for it.
    const runInLane = (command, task) => {
        const contractKey = readTradingCommandLane(command);
        const orderKey = readTradingCommandOrderLane(command);
        const gate = contractGate(contractKey);
        const after = orderKey === null
            ? Promise.all([gate.barrier, ...gate.members])
            : Promise.all([lanes.get(orderKey) ?? RESOLVED, gate.barrier]);
        const settled = after.then(task);
        const tail = settled.then(IGNORE, IGNORE);

        if (orderKey === null) {
            gate.barrier = tail;
            // Every member it waited for is accounted for by the barrier now;
            // only what is accepted after it has anything left to wait on.
            gate.members.clear();
            void tail.then(() => {
                if (gate.barrier === tail) gate.barrier = RESOLVED;
                forgetContract(contractKey);
            });
            return settled;
        }

        lanes.set(orderKey, tail);
        gate.members.add(tail);
        void tail.then(() => {
            if (lanes.get(orderKey) === tail) lanes.delete(orderKey);
            gate.members.delete(tail);
            forgetContract(contractKey);
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
         * Whatever the command produced is what a second copy gets, including a
         * refusal the desk decided on its own — trading paused, or past the
         * order cap. That is deliberate: an identity is minted per operator
         * intent, so the same one arriving twice is one intent delivered twice,
         * never two. Pressing the button again is a new intent with a new
         * identity, and runs.
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
                    command,
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
        laneCount: () => lanes.size + contracts.size,
    };
};
