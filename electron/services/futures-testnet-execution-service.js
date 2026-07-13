import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
    compareExactDecimals,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
} from './futures-testnet-execution-decimal.js';
import {
    FUTURES_TESTNET_EXECUTION_ACK_ACTION,
    FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS,
    FUTURES_TESTNET_EXECUTION_ACTION,
    FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
    FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES,
    FUTURES_TESTNET_EXECUTION_STATES,
    createFuturesTestnetExecutionAcknowledgement,
    createFuturesTestnetExecutionProtocolRejection,
    parseFuturesTestnetExecutionCommand,
} from './futures-testnet-execution-protocol.js';
import {
    FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS,
    createFuturesTestnetExecutionStatus,
    parseFuturesTestnetExecutionSessionRequest,
} from './futures-testnet-execution-session-protocol.js';
import {
    FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS,
    FuturesTestnetExecutionFacadeError,
} from './futures-testnet-execution-facade.js';
import {
    createFuturesTestnetExecutionCommandDigest,
} from './futures-testnet-execution-ledger.js';
import { evaluateFuturesTestnetExecutionRisk } from './futures-testnet-execution-risk.js';

const INTENT_TTL_MS = 30_000;
const FAST_RECONCILIATION_DELAYS = Object.freeze([0, 1_000, 2_000, 5_000, 10_000, 30_000]);
const SLOW_RECONCILIATION_DELAY_MS = 5 * 60_000;
const OPEN_MONITOR_DELAY_MS = 60_000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60_000;
const MAX_RECOVERY_AGE_MS = 90 * 24 * 60 * 60_000;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const TERMINAL_STATES = new Set([
    FUTURES_TESTNET_EXECUTION_STATES.LOCALLY_REJECTED,
    FUTURES_TESTNET_EXECUTION_STATES.EXCHANGE_REJECTED,
    FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_FILLED,
    FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_CANCELED,
]);

const CONFIG_CODE_MAP = Object.freeze({
    FUTURES_EXECUTION_DISABLED: FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED,
    FUTURES_EXECUTION_ENVIRONMENT_REJECTED:
        FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENVIRONMENT_REJECTED,
    FUTURES_EXECUTION_CREDENTIALS_REJECTED:
        FUTURES_TESTNET_EXECUTION_SAFE_CODES.CREDENTIALS_REJECTED,
});

export class FuturesTestnetExecutionServiceError extends Error {
    constructor(code) {
        super('Futures testnet execution service is unavailable');
        this.name = 'FuturesTestnetExecutionServiceError';
        this.code = code;
    }
}

const requireSafeNow = (now) => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new FuturesTestnetExecutionServiceError('INVALID_CLOCK');
    }
    return value;
};

const nextRevision = (current) => String(BigInt(current) + 1n);

const createOrderSummary = (order) => Object.freeze({
    orderId: order.orderId,
    status: order.status,
    originalQuantity: order.originalQuantity,
    executedQuantity: order.executedQuantity,
    averagePrice: order.averagePrice,
    updateTime: order.updateTime,
});

const orderSummariesEqual = (left, right) => (
    left !== null
    && right !== null
    && [
        'orderId',
        'status',
        'originalQuantity',
        'executedQuantity',
        'averagePrice',
        'updateTime',
    ].every(field => left[field] === right[field])
);

const makeAcknowledgement = ({ revision, observedAt, command, acknowledgement, state, code, order }) => (
    createFuturesTestnetExecutionAcknowledgement({
        channelId: FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
        action: FUTURES_TESTNET_EXECUTION_ACK_ACTION,
        version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
        revision,
        requestId: command.requestId,
        marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
        environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
        symbol: command.symbol,
        clientOrderId: command.clientOrderId,
        acknowledgement,
        state,
        code,
        observedAt,
        order,
    })
);

const rejectionCodeForConfig = (config) => (
    CONFIG_CODE_MAP[config?.code] ?? FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED
);

const exactDecimalEquals = (left, right) => {
    try {
        return compareExactDecimals(
            parsePositiveExactDecimal(left),
            parsePositiveExactDecimal(right),
        ) === 0;
    } catch {
        return false;
    }
};

const requireExchangeOrderId = (value) => {
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) {
        throw new FuturesTestnetExecutionServiceError('INVALID_EXCHANGE_ORDER_ID');
    }
    let parsed;
    try {
        parsed = BigInt(value);
    } catch {
        throw new FuturesTestnetExecutionServiceError('INVALID_EXCHANGE_ORDER_ID');
    }
    if (parsed > MAX_SIGNED_INT64) {
        throw new FuturesTestnetExecutionServiceError('INVALID_EXCHANGE_ORDER_ID');
    }
    return value;
};

const validateReconciledOrder = (command, order, expectedExchangeOrderId = null) => {
    if (!order
        || order.symbol !== command.symbol
        || order.clientOrderId !== command.clientOrderId
        || (expectedExchangeOrderId !== null && order.orderId !== expectedExchangeOrderId)
        || order.side !== command.side
        || order.positionSide !== 'BOTH'
        || order.type !== 'LIMIT'
        || order.origType !== 'LIMIT'
        || order.timeInForce !== 'GTC'
        || order.reduceOnly !== true
        || order.closePosition !== false
        || order.priceProtect !== false
        || order.workingType !== 'CONTRACT_PRICE'
        || !exactDecimalEquals(order.originalQuantity, command.quantity)
        || !exactDecimalEquals(order.price, command.price)) {
        throw new FuturesTestnetExecutionServiceError('RECONCILIATION_IDENTITY_MISMATCH');
    }
    return order;
};

const stateForOrder = (status) => {
    if (status === 'NEW' || status === 'PARTIALLY_FILLED') {
        return FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN;
    }
    if (status === 'FILLED') return FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_FILLED;
    if (['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(status)) {
        return FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_CANCELED;
    }
    if (status === 'REJECTED') return FUTURES_TESTNET_EXECUTION_STATES.EXCHANGE_REJECTED;
    throw new FuturesTestnetExecutionServiceError('UNKNOWN_ORDER_STATUS');
};

const acknowledgementForState = (state) => {
    if (state === FUTURES_TESTNET_EXECUTION_STATES.EXCHANGE_REJECTED) {
        return {
            acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.REJECTED,
            code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
            order: null,
        };
    }
    return {
        acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.ACCEPTED,
        code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED,
    };
};

export const createFuturesTestnetExecutionService = ({
    config,
    credentialBinding,
    ledger,
    reader,
    facade,
    coordinator,
    evaluateRisk = evaluateFuturesTestnetExecutionRisk,
    randomBytes = nodeRandomBytes,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onInternalError = () => {},
} = {}) => {
    if (!config || !ledger || typeof ledger.append !== 'function'
        || typeof randomBytes !== 'function' || typeof now !== 'function') {
        throw new FuturesTestnetExecutionServiceError('INVALID_COMPOSITION');
    }

    const sessions = new Map();
    const timers = new Set();
    let revision = '0';
    let started = false;
    let shuttingDown = false;
    let mutex = false;
    let currentAttempt = null;
    let failedClosed = false;
    let transitionTail = Promise.resolve();
    let reconciliationPromise = null;
    let activePlacementCompletion = null;

    const schedule = (callback, delay) => {
        if (shuttingDown) return null;
        const timer = setTimeoutFn(() => {
            timers.delete(timer);
            void callback();
        }, delay);
        timers.add(timer);
        return timer;
    };

    const currentCapability = (session) => {
        if (failedClosed) {
            return {
                enabled: false,
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE,
            };
        }
        if (!config.enabled) {
            return { enabled: false, code: rejectionCodeForConfig(config) };
        }
        if (!started
            || shuttingDown
            || !session
            || session.readBound !== true
            || session.environment !== 'testnet') {
            return { enabled: false, code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED };
        }
        if (currentAttempt && currentAttempt.credentialBinding !== credentialBinding) {
            return {
                enabled: false,
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE,
            };
        }
        if (currentAttempt && !TERMINAL_STATES.has(currentAttempt.state)) {
            return { enabled: false, code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY };
        }
        return { enabled: true, code: 'FUTURES_EXECUTION_ENABLED' };
    };

    const getAttemptAcknowledgement = () => currentAttempt?.attempt ?? null;

    const emitStatus = (session, { advance = false } = {}) => {
        if (!session?.subscribed || typeof session.emit !== 'function') return null;
        if (advance) revision = nextRevision(revision);
        const status = createFuturesTestnetExecutionStatus({
            revision,
            symbol: session.symbol,
            capability: currentCapability(session),
            intent: session.intent && session.intent.expiresAt > requireSafeNow(now)
                ? session.intent
                : null,
            attempt: currentAttempt?.command?.symbol === session.symbol
                ? getAttemptAcknowledgement()
                : null,
        });
        session.emit(status);
        return status;
    };

    const broadcastStatus = () => {
        for (const session of sessions.values()) emitStatus(session);
    };

    const persistTransitionNow = async ({
        command,
        event,
        state,
        acknowledgement,
        code,
        order = null,
        binding = credentialBinding,
        extra = {},
    }) => {
        const {
            exchangeOrderId: suppliedExchangeOrderId,
            ...durableExtra
        } = extra;
        const inheritedExchangeOrderId = currentAttempt?.requestId === command.requestId
            ? currentAttempt.exchangeOrderId
            : undefined;
        const exchangeOrderId = suppliedExchangeOrderId === undefined
            ? inheritedExchangeOrderId
            : requireExchangeOrderId(suppliedExchangeOrderId);
        if (exchangeOrderId !== undefined) requireExchangeOrderId(exchangeOrderId);
        const observedAt = requireSafeNow(now);
        const transitionRevision = nextRevision(revision);
        const attempt = makeAcknowledgement({
            revision: transitionRevision,
            observedAt,
            command,
            acknowledgement,
            state,
            code,
            order,
        });
        const entry = await ledger.append({
            version: 1,
            event,
            state,
            revision: transitionRevision,
            observedAt,
            requestId: command.requestId,
            clientOrderId: command.clientOrderId,
            commandDigest: createFuturesTestnetExecutionCommandDigest(command),
            credentialBinding: binding,
            dispatchObservedAt: extra.dispatchObservedAt
                ?? currentAttempt?.dispatchObservedAt
                ?? (event === 'dispatch_intent' ? observedAt : null),
            command,
            attempt,
            ...(exchangeOrderId === undefined ? {} : { exchangeOrderId }),
            ...durableExtra,
        });
        revision = transitionRevision;
        currentAttempt = entry.record;
        broadcastStatus();
        return entry.record;
    };

    const persistTransition = (options) => {
        const operation = transitionTail.then(() => persistTransitionNow(options));
        transitionTail = operation.catch((error) => {
            failedClosed = true;
            revision = nextRevision(revision);
            broadcastStatus();
            onInternalError({
                phase: 'persistence',
                code: error?.code ?? 'failed_closed',
            });
        });
        return operation;
    };

    const persistLocalRejection = (command, code, event = 'locally_rejected') => (
        persistTransition({
            command,
            event,
            state: FUTURES_TESTNET_EXECUTION_STATES.LOCALLY_REJECTED,
            acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.REJECTED,
            code,
        })
    );

    const handleRatePause = (error) => {
        if (!(error instanceof FuturesTestnetExecutionFacadeError)
            || (error.kind !== FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED
                && ![418, 429].includes(error.status))
            || typeof coordinator?.setOrderPauseUntil !== 'function') return null;
        const observedAt = requireSafeNow(now);
        const retryAfter = error.headers?.['retry-after'];
        let pauseMs = error.status === 418 ? THREE_DAYS_MS : 120_000;
        if (/^(0|[1-9][0-9]*)$/.test(retryAfter ?? '')) {
            const seconds = Number(retryAfter);
            if (Number.isSafeInteger(seconds)) pauseMs = Math.max(pauseMs, Math.min(THREE_DAYS_MS, seconds * 1000));
        }
        const pauseUntil = observedAt + pauseMs;
        coordinator.setOrderPauseUntil(pauseUntil);
        return pauseUntil;
    };

    const transitionFromOrder = async (attempt, rawOrder) => {
        const expectedExchangeOrderId = attempt.exchangeOrderId === undefined
            ? null
            : requireExchangeOrderId(attempt.exchangeOrderId);
        const order = validateReconciledOrder(
            attempt.command,
            rawOrder,
            expectedExchangeOrderId,
        );
        const state = stateForOrder(order.status);
        const mapping = acknowledgementForState(state);
        const orderSummary = mapping.order === null ? null : createOrderSummary(order);
        if (state === FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN
            && attempt.state === FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN
            && orderSummariesEqual(attempt.attempt?.order ?? null, orderSummary)) {
            schedule(
                () => reconcile(attempt, { slow: false, index: 0, monitoring: true }),
                OPEN_MONITOR_DELAY_MS,
            );
            return attempt;
        }
        const next = await persistTransition({
            command: attempt.command,
            event: 'reconciled',
            state,
            acknowledgement: mapping.acknowledgement,
            code: mapping.code,
            order: orderSummary,
            binding: attempt.credentialBinding,
        });
        if (state === FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN) {
            schedule(() => reconcile(next, { slow: false, index: 0, monitoring: true }), OPEN_MONITOR_DELAY_MS);
        }
        return next;
    };

    const reconcileOnce = async (attempt, { slow = false, index = 0, monitoring = false } = {}) => {
        if (shuttingDown || !attempt?.command || TERMINAL_STATES.has(attempt.state)) return attempt;
        if (attempt.credentialBinding !== credentialBinding || !facade) {
            if (attempt.state !== FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE) {
                return persistTransition({
                    command: attempt.command,
                    event: 'recovery_unavailable',
                    state: FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE,
                    acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE,
                    order: attempt.attempt?.order ?? null,
                    binding: attempt.credentialBinding,
                });
            }
            return attempt;
        }
        const recoveryStartedAt = attempt.dispatchObservedAt ?? attempt.observedAt;
        const recoveryNow = requireSafeNow(now);
        if (!Number.isSafeInteger(recoveryStartedAt)
            || recoveryStartedAt < 0
            || recoveryNow < recoveryStartedAt
            || recoveryNow - recoveryStartedAt > MAX_RECOVERY_AGE_MS) {
            if (attempt.state === FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE) {
                return attempt;
            }
            return persistTransition({
                command: attempt.command,
                event: 'recovery_horizon_exceeded',
                state: FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE,
                acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE,
                order: attempt.attempt?.order ?? null,
                binding: attempt.credentialBinding,
            });
        }
        try {
            const query = () => facade.queryOrderByOriginalClientOrderId({
                symbol: attempt.command.symbol,
                originalClientOrderId: attempt.command.clientOrderId,
            });
            const order = typeof coordinator?.executeRecoveryQuery === 'function'
                ? await coordinator.executeRecoveryQuery(query)
                : await query();
            return await transitionFromOrder(attempt, order);
        } catch (error) {
            const pauseUntil = handleRatePause(error);
            onInternalError({ phase: 'reconcile', code: error?.kind ?? error?.code ?? 'unknown' });
            let recoveryAttempt = attempt;
            if (pauseUntil !== null) {
                recoveryAttempt = await persistTransition({
                    command: attempt.command,
                    event: 'recovery_rate_pause',
                    state: attempt.state,
                    acknowledgement: attempt.attempt?.acknowledgement
                        ?? FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                    code: attempt.attempt?.code
                        ?? FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                    order: attempt.attempt?.order ?? null,
                    binding: attempt.credentialBinding,
                    extra: { pauseUntil },
                });
            }
            const admission = coordinator?.getOrderAdmissionSnapshot?.();
            const pausedAt = requireSafeNow(now);
            if (Number.isSafeInteger(admission?.pauseUntil)
                && admission.pauseUntil > pausedAt) {
                schedule(
                    () => reconcile(currentAttempt, { slow, index, monitoring }),
                    admission.pauseUntil - pausedAt,
                );
                return recoveryAttempt;
            }
            if (monitoring) {
                schedule(() => reconcile(currentAttempt, { monitoring: true }), OPEN_MONITOR_DELAY_MS);
                return recoveryAttempt;
            }
            if (!slow && index + 1 < FAST_RECONCILIATION_DELAYS.length) {
                schedule(
                    () => reconcile(currentAttempt, { index: index + 1 }),
                    FAST_RECONCILIATION_DELAYS[index + 1]
                        - FAST_RECONCILIATION_DELAYS[index],
                );
                return recoveryAttempt;
            }
            const unavailable = recoveryAttempt.state
                === FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE
                ? recoveryAttempt
                : await persistTransition({
                    command: recoveryAttempt.command,
                    event: 'reconciliation_unavailable',
                    state: FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE,
                    acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE,
                    order: recoveryAttempt.attempt?.order ?? null,
                    binding: recoveryAttempt.credentialBinding,
                });
            schedule(() => reconcile(currentAttempt, { slow: true }), SLOW_RECONCILIATION_DELAY_MS);
            return unavailable;
        }
    };

    const reconcile = (attempt, options = {}) => {
        if (reconciliationPromise) return reconciliationPromise;
        reconciliationPromise = reconcileOnce(attempt, options).finally(() => {
            reconciliationPromise = null;
        });
        return reconciliationPromise;
    };

    const start = async () => {
        if (started) return;
        await ledger.open();
        try {
            revision = ledger.getRecords().reduce((current, record) => (
                typeof record.revision === 'string' && BigInt(record.revision) > BigInt(current)
                    ? record.revision
                    : current
            ), ledger.getRevision());
            coordinator?.restoreOrderState?.(ledger.getOrderRateState?.() ?? {
                dispatchTimes: [],
                pauseUntil: 0,
            });
            currentAttempt = ledger.getActiveAttempt?.() ?? ledger.getLatestAttempt();
            started = true;
            if (currentAttempt?.state === FUTURES_TESTNET_EXECUTION_STATES.QUEUED) {
                await persistLocalRejection(
                    currentAttempt.command,
                    FUTURES_TESTNET_EXECUTION_SAFE_CODES.INTERRUPTED_BEFORE_DISPATCH,
                    'restart_before_dispatch',
                );
            } else if (currentAttempt && !TERMINAL_STATES.has(currentAttempt.state)) {
                if (currentAttempt.state === FUTURES_TESTNET_EXECUTION_STATES.DISPATCHED) {
                    await persistTransition({
                        command: currentAttempt.command,
                        event: 'restart_unknown',
                        state: FUTURES_TESTNET_EXECUTION_STATES.RESULT_UNKNOWN,
                        acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                        code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                        binding: currentAttempt.credentialBinding,
                    });
                }
                await reconcile(currentAttempt);
            }
        } catch (error) {
            failedClosed = true;
            started = false;
            await ledger.close().catch(() => {});
            throw error;
        }
    };

    const bindReadSession = ({ connectionId, symbol, environment = 'testnet' } = {}) => {
        const symbolAllowed = config.policy?.allowedSymbols
            ? config.policy.allowedSymbols.includes(symbol)
            : typeof symbol === 'string' && /^[A-Z0-9]{2,20}$/.test(symbol);
        if (typeof connectionId !== 'string' || !connectionId
            || !symbolAllowed
            || environment !== 'testnet') return false;
        const existing = sessions.get(connectionId);
        existing?.intentAbortController?.abort();
        existing?.preflightAbortController?.abort();
        const generation = String(BigInt(existing?.generation ?? '0') + 1n);
        const session = {
            connectionId,
            sessionIdentity: `${connectionId}:${generation}`,
            generation,
            symbol,
            environment,
            subscribed: existing?.subscribed ?? false,
            emit: existing?.emit ?? null,
            intent: null,
            readBound: true,
            intentPreparation: false,
            intentAbortController: null,
            preflightAbortController: null,
        };
        sessions.set(connectionId, session);
        emitStatus(session, { advance: true });
        return true;
    };

    const unbindReadSession = (connectionId) => {
        const session = sessions.get(connectionId);
        if (!session) return false;
        session.intentAbortController?.abort();
        session.preflightAbortController?.abort();
        session.intent = null;
        session.readBound = false;
        emitStatus(session, { advance: true });
        return true;
    };

    const disconnect = (connectionId) => {
        const session = sessions.get(connectionId);
        if (!session) return false;
        session.intentAbortController?.abort();
        session.preflightAbortController?.abort();
        session.intent = null;
        session.subscribed = false;
        session.emit = null;
        sessions.delete(connectionId);
        return true;
    };

    const handleSessionRequest = async (raw, { connectionId, emit } = {}) => {
        let request;
        try {
            request = parseFuturesTestnetExecutionSessionRequest(raw);
        } catch {
            return false;
        }
        let session = sessions.get(connectionId);
        if (!session && request.action !== FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.UNSUBSCRIBE_STATUS) {
            session = {
                connectionId,
                sessionIdentity: `${connectionId}:0`,
                generation: '0',
                symbol: request.symbol,
                environment: 'testnet',
                subscribed: false,
                emit: null,
                intent: null,
                readBound: false,
                intentPreparation: false,
                intentAbortController: null,
                preflightAbortController: null,
            };
            sessions.set(connectionId, session);
        }
        if (!session || session.symbol !== request.symbol) return false;
        if (request.action === FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.UNSUBSCRIBE_STATUS) {
            session.subscribed = false;
            session.emit = null;
            session.intent = null;
            session.intentAbortController?.abort();
            session.preflightAbortController?.abort();
            return true;
        }
        session.subscribed = true;
        session.emit = emit;
        if (request.action === FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.SUBSCRIBE_STATUS
            && request.revision !== '0') {
            emitStatus(session, { advance: true });
            return false;
        }
        if (request.action === FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.PREPARE_INTENT) {
            if (request.revision !== revision) {
                emitStatus(session, { advance: true });
                return false;
            }
            if (session.intent && session.intent.expiresAt <= requireSafeNow(now)) {
                session.intent = null;
            }
            const capability = currentCapability(session);
            if (capability.enabled && !session.intent) {
                if (session.intentPreparation) return false;
                session.intentPreparation = true;
                const intentAbortController = new AbortController();
                session.intentAbortController = intentAbortController;
                let intentFacts;
                try {
                    if (!reader) throw new FuturesTestnetExecutionServiceError('RISK_READER_UNAVAILABLE');
                    const preflight = await reader.readPreflight({
                        symbol: session.symbol,
                        credentialIdentity: credentialBinding,
                        connectionIdentity: session.connectionId,
                        sessionIdentity: session.sessionIdentity,
                        generation: session.generation,
                        signal: intentAbortController.signal,
                    });
                    const account = preflight.observations?.accountConfig?.data;
                    const symbolConfig = preflight.observations?.symbolConfig?.data;
                    const positions = preflight.observations?.positions?.data?.positions;
                    const position = Array.isArray(positions) && positions.length === 1
                        ? positions[0]
                        : null;
                    const positionAmount = parseSignedExactDecimal(position?.positionAmt, {
                        allowZero: false,
                    });
                    if (account?.canTrade !== true
                        || account.dualSidePosition !== false
                        || account.multiAssetsMargin !== false
                        || symbolConfig?.symbol !== session.symbol
                        || symbolConfig.marginType !== 'ISOLATED'
                        || symbolConfig.isAutoAddMargin !== false
                        || !Number.isSafeInteger(symbolConfig.leverage)
                        || symbolConfig.leverage < 1
                        || symbolConfig.leverage > config.policy.maxLeverage
                        || position?.symbol !== session.symbol
                        || position.positionSide !== 'BOTH'
                        || position.marginAsset !== 'USDT') {
                        throw new FuturesTestnetExecutionServiceError('INTENT_RISK_REJECTED');
                    }
                    intentFacts = {
                        side: positionAmount.coefficient > 0n ? 'SELL' : 'BUY',
                        leverage: symbolConfig.leverage,
                    };
                } catch (error) {
                    const stillOwned = sessions.get(connectionId) === session;
                    if (stillOwned) {
                        session.intentPreparation = false;
                        session.intentAbortController = null;
                    }
                    onInternalError({
                        phase: 'intent',
                        code: error?.code ?? 'risk_unavailable',
                    });
                    if (stillOwned) emitStatus(session, { advance: true });
                    return false;
                }
                session.intentPreparation = false;
                session.intentAbortController = null;
                if (sessions.get(connectionId) !== session
                    || session.readBound !== true
                    || session.subscribed !== true
                    || session.intent !== null
                    || request.revision !== revision
                    || currentCapability(session).enabled !== true) {
                    if (sessions.get(connectionId) === session && session.subscribed) {
                        emitStatus(session, { advance: true });
                    }
                    return false;
                }
                const bytes = randomBytes(16);
                if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== 16) {
                    throw new FuturesTestnetExecutionServiceError('INVALID_RANDOM_SOURCE');
                }
                const requestId = Buffer.from(bytes).toString('hex');
                session.intent = Object.freeze({
                    requestId,
                    clientOrderId: `cc6-${requestId}`,
                    symbol: session.symbol,
                    side: intentFacts.side,
                    leverage: intentFacts.leverage,
                    expiresAt: requireSafeNow(now) + INTENT_TTL_MS,
                });
            }
            emitStatus(session, { advance: true });
            return true;
        }
        emitStatus(session);
        return true;
    };

    const emitProtocolRejection = (emit) => {
        revision = nextRevision(revision);
        emit(createFuturesTestnetExecutionStatus({
            revision,
            symbol: config.policy?.allowedSymbols?.[0] ?? 'BTCUSDT',
            capability: { enabled: false, code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED },
            attempt: createFuturesTestnetExecutionProtocolRejection({
                revision,
                observedAt: requireSafeNow(now),
            }),
        }));
    };

    const emitTransientRejection = (command, code, emit) => {
        revision = nextRevision(revision);
        const attempt = makeAcknowledgement({
            revision,
            observedAt: requireSafeNow(now),
            command,
            acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.REJECTED,
            state: FUTURES_TESTNET_EXECUTION_STATES.LOCALLY_REJECTED,
            code,
            order: null,
        });
        if (typeof emit === 'function') {
            emit(createFuturesTestnetExecutionStatus({
                revision,
                symbol: command.symbol,
                capability: { enabled: false, code },
                attempt,
            }));
        }
        return attempt;
    };

    const emitStoredAttempt = (stored, emit, session) => {
        if (typeof emit !== 'function' || !stored?.attempt) return;
        revision = nextRevision(revision);
        emit(createFuturesTestnetExecutionStatus({
            revision,
            symbol: stored.command.symbol,
            capability: currentCapability(session),
            attempt: { ...stored.attempt, revision },
        }));
    };

    const handlePlaceOrder = async (raw, { connectionId, emit } = {}) => {
        let command;
        try {
            command = parseFuturesTestnetExecutionCommand(raw, {
                allowedSymbols: config.policy?.allowedSymbols ?? ['BTCUSDT'],
            });
        } catch {
            if (typeof emit === 'function') emitProtocolRejection(emit);
            return false;
        }
        if (mutex) {
            emitTransientRejection(
                command,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY,
                emit,
            );
            return false;
        }
        mutex = true;
        let completePlacement;
        activePlacementCompletion = new Promise((resolve) => {
            completePlacement = resolve;
        });
        let session = null;
        let abortController = null;
        try {
        const digest = createFuturesTestnetExecutionCommandDigest(command);
        const prior = ledger.findRequest(command.requestId);
        if (prior) {
            if (prior.commandDigest === digest) {
                emitStoredAttempt(prior, emit, sessions.get(connectionId));
                return true;
            }
            emitTransientRejection(
                command,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.DUPLICATE_REJECTED,
                emit,
            );
            return false;
        }
        const clientCollision = ledger.findClientOrder(command.clientOrderId);
        if (clientCollision) {
            emitTransientRejection(
                command,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.DUPLICATE_REJECTED,
                emit,
            );
            return false;
        }
        if (currentAttempt && !TERMINAL_STATES.has(currentAttempt.state)) {
            emitTransientRejection(
                command,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY,
                emit,
            );
            return false;
        }
        session = sessions.get(connectionId);
        const intent = session?.intent;
        const ownsIntent = Boolean(
            session
            && session.readBound === true
            && session.symbol === command.symbol
            && intent
            && intent.requestId === command.requestId
            && intent.clientOrderId === command.clientOrderId
            && intent.side === command.side
            && intent.leverage === command.leverage,
        );
        if (!ownsIntent) {
            emitTransientRejection(
                command,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED,
                emit,
            );
            return false;
        }
        session.intent = null;
        if (intent.expiresAt <= requireSafeNow(now)) {
            emitTransientRejection(
                command,
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED,
                emit,
            );
            return false;
        }
        const capability = currentCapability(session);
        if (!capability.enabled) {
            if (currentAttempt && !TERMINAL_STATES.has(currentAttempt.state)) {
                emitTransientRejection(command, capability.code, emit);
            } else {
                await persistLocalRejection(command, capability.code);
            }
            return false;
        }
        abortController = new AbortController();
        session.preflightAbortController = abortController;
            await persistTransition({
                command,
                event: 'queued',
                state: FUTURES_TESTNET_EXECUTION_STATES.QUEUED,
                acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.PENDING,
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING,
            });
            if (!reader || !facade) {
                await persistLocalRejection(command, FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED);
                return false;
            }
            const preflight = await reader.readPreflight({
                symbol: command.symbol,
                credentialIdentity: credentialBinding,
                connectionIdentity: session.connectionId,
                sessionIdentity: session.sessionIdentity,
                generation: session.generation,
                signal: abortController.signal,
            });
            if (sessions.get(connectionId) === session
                && session.preflightAbortController === abortController) {
                session.preflightAbortController = null;
            }
            const risk = evaluateRisk({
                command,
                policy: config.policy,
                ownership: preflight.riskOwnership,
                observations: preflight.observations,
            });
            if (!risk.ok) {
                await persistLocalRejection(command, risk.code);
                return false;
            }
            const currentSession = sessions.get(connectionId);
            if (!currentSession || currentSession.generation !== session.generation) {
                await persistLocalRejection(
                    command,
                    FUTURES_TESTNET_EXECUTION_SAFE_CODES.INTERRUPTED_BEFORE_DISPATCH,
                );
                return false;
            }
            const orderAdmission = coordinator?.reserveOrderDispatch?.() ?? null;
            await persistTransition({
                command,
                event: 'dispatch_intent',
                state: FUTURES_TESTNET_EXECUTION_STATES.DISPATCHED,
                acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.PENDING,
                code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING,
                extra: { orderAdmission },
            });
            if (typeof reader.getValidationToDispatchAgeMs === 'function') {
                const finalRisk = evaluateRisk({
                    command,
                    policy: config.policy,
                    ownership: {
                        ...preflight.riskOwnership,
                        validationToDispatchAgeMs: reader.getValidationToDispatchAgeMs(preflight),
                    },
                    observations: preflight.observations,
                });
                if (!finalRisk.ok) {
                    await persistLocalRejection(command, finalRisk.code, 'dispatch_stale');
                    return false;
                }
            }
            try {
                const placementAcknowledgement = await facade.placeReduceOnlyLimitGtcOrder({
                    symbol: command.symbol,
                    side: command.side,
                    quantity: command.quantity,
                    price: command.price,
                    clientOrderId: command.clientOrderId,
                });
                const exchangeOrderId = requireExchangeOrderId(
                    placementAcknowledgement?.orderId,
                );
                await persistTransition({
                    command,
                    event: 'post_ack',
                    state: FUTURES_TESTNET_EXECUTION_STATES.RECONCILING,
                    acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.PENDING,
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING,
                    extra: { exchangeOrderId },
                });
                await reconcile(currentAttempt);
                return true;
            } catch (error) {
                const pauseUntil = handleRatePause(error);
                if (error instanceof FuturesTestnetExecutionFacadeError
                    && [
                        FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED,
                        FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED,
                    ].includes(error.kind)) {
                    const code = error.kind === FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED
                        ? FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED
                        : FUTURES_TESTNET_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED;
                    await persistTransition({
                        command,
                        event: 'post_rejected',
                        state: FUTURES_TESTNET_EXECUTION_STATES.EXCHANGE_REJECTED,
                        acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.REJECTED,
                        code,
                        extra: { pauseUntil },
                    });
                    return false;
                }
                await persistTransition({
                    command,
                    event: 'post_unknown',
                    state: FUTURES_TESTNET_EXECUTION_STATES.RESULT_UNKNOWN,
                    acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                    extra: { pauseUntil },
                });
                await reconcile(currentAttempt);
                return true;
            }
        } catch (error) {
            onInternalError({ phase: 'place', code: error?.code ?? error?.kind ?? 'unknown' });
            if (currentAttempt?.state === FUTURES_TESTNET_EXECUTION_STATES.DISPATCHED) {
                try {
                    await persistTransition({
                        command,
                        event: 'post_unknown',
                        state: FUTURES_TESTNET_EXECUTION_STATES.RESULT_UNKNOWN,
                        acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN,
                        code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                    });
                } catch {
                    // The last durable pending state remains authoritative and globally blocking.
                }
            } else if (currentAttempt?.state === FUTURES_TESTNET_EXECUTION_STATES.QUEUED) {
                try {
                    const code = [
                        'FUTURES_EXECUTION_ORDER_COUNT_LIMITED',
                        'FUTURES_EXECUTION_RATE_PAUSED',
                    ].includes(error?.code)
                        ? FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED
                        : FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED;
                    await persistLocalRejection(
                        command,
                        code,
                    );
                } catch {
                    // No dispatch intent exists; persistence failure leaves execution disabled.
                }
            }
            return false;
        } finally {
            abortController?.abort();
            if (abortController
                && sessions.get(connectionId) === session
                && session.preflightAbortController === abortController) {
                session.preflightAbortController = null;
            }
            mutex = false;
            completePlacement();
            activePlacementCompletion = null;
        }
    };

    const recoverTestnetAttempt = async () => {
        if (!currentAttempt || TERMINAL_STATES.has(currentAttempt.state)) return currentAttempt;
        return reconcile(currentAttempt, { slow: true });
    };

    const shutdown = async () => {
        shuttingDown = true;
        for (const timer of timers) clearTimeoutFn(timer);
        timers.clear();
        for (const session of sessions.values()) {
            session.intentAbortController?.abort();
            session.preflightAbortController?.abort();
            session.intent = null;
            session.subscribed = false;
            session.emit = null;
        }
        sessions.clear();
        await activePlacementCompletion;
        await reconciliationPromise;
        await transitionTail;
        await ledger.close();
        started = false;
    };

    return Object.freeze({
        start,
        shutdown,
        bindReadSession,
        unbindReadSession,
        disconnect,
        handleSessionRequest,
        handlePlaceOrder,
        recoverTestnetAttempt,
        getCurrentAttempt: () => currentAttempt,
        getRevision: () => revision,
        isStarted: () => started,
    });
};

let processGlobalService = null;

export const getProcessGlobalFuturesTestnetExecutionService = (create) => {
    if (processGlobalService === null) {
        if (typeof create !== 'function') {
            throw new FuturesTestnetExecutionServiceError('PROCESS_GLOBAL_FACTORY_REQUIRED');
        }
        processGlobalService = create();
    }
    return processGlobalService;
};
