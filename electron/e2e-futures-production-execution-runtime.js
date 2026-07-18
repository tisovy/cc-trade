import {
    FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
} from './services/futures-production-execution-config.js';
import {
    FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS,
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
    FUTURES_PRODUCTION_EXECUTION_STATES,
    createFuturesProductionExecutionStatus,
    parseFuturesProductionExecutionCommand,
} from './services/futures-production-execution-protocol.js';

const ACCOUNT_FINGERPRINT = 'e'.repeat(64);
const BOOTSTRAP_FINGERPRINT = '0'.repeat(64);
const ALLOWED_SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
const EXTERNAL_CLIENT_ORDER_ID = 'external-desktop-order-1';
const CONFIRMED_CODE = 'FUTURES_PRODUCTION_E2E_CONFIRMED';
const ORDER_RULES = Object.freeze({
    BTCUSDT: Object.freeze({ stepSize: 0.001, minimumNotionalUsdt: 5 }),
    ETHUSDT: Object.freeze({ stepSize: 0.001, minimumNotionalUsdt: 5 }),
    SOLUSDT: Object.freeze({ stepSize: 0.1, minimumNotionalUsdt: 5 }),
});

const PREPARE_KINDS = Object.freeze({
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH
    ),
});

const FINAL_KINDS = Object.freeze({
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH
    ),
});

const ATTEMPT_STATES = Object.freeze({
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN
    ),
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_MARGIN_ADJUSTED
    ),
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED
    ),
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED
    ),
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CLOSED
    ),
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_ENGAGED
    ),
    [FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH]: (
        FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_DISENGAGED
    ),
});

const copy = value => JSON.parse(JSON.stringify(value));

const orderDraft = command => ({
    symbol: command.symbol,
    side: command.side,
    positionSide: command.positionSide,
    positionEffect: command.positionEffect,
    quantity: command.quantity,
    price: command.price,
});

const isStepAligned = (quantity, stepSize) => {
    const units = quantity / stepSize;
    return Number.isFinite(units) && Math.abs(units - Math.round(units)) < 1e-9;
};

const initialPortfolio = (observedAt) => ({
    state: 'live',
    observedAt,
    availableBalanceUsdt: '250.00',
    syncState: 'live',
    syncCode: CONFIRMED_CODE,
    positions: [{
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        quantity: '0.010',
        entryPrice: '60000.00',
        markPrice: '61000.00',
        notionalUsdt: '610.00',
        unrealizedPnlUsdt: '10.00',
        isolatedMarginUsdt: '305.00',
        liquidationPrice: '31000.00',
        leverage: 2,
        marginType: 'ISOLATED',
    }],
    openOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '81000001',
        clientOrderId: EXTERNAL_CLIENT_ORDER_ID,
        side: 'BUY',
        positionSide: 'LONG',
        positionEffect: 'ENTRY',
        price: '58445.00',
        originalQuantity: '0.004',
        executedQuantity: '0',
        status: 'NEW',
        type: 'LIMIT',
        timeInForce: 'GTC',
        isAppOwned: false,
        updateTime: observedAt,
        syncState: 'synced',
    }],
});

export const createE2eFuturesProductionExecutionRuntime = ({
    clock = () => Date.now(),
} = {}) => {
    const sessions = new Map();
    let revision = 1n;
    let requestSequence = 1n;
    let exchangeOrderSequence = 81_000_001n;
    let activeIntent = null;
    let intentExpiryTimer = null;
    let currentAttempt = null;
    let killSwitchEngaged = false;
    let portfolio = initialPortfolio(clock());
    let shutDown = false;

    const advanceRevision = () => {
        revision += 1n;
        return revision.toString();
    };

    const capabilities = (connectionId) => {
        const finalKind = activeIntent?.connectionId === connectionId
            ? activeIntent.kind
            : null;
        const canPrepare = activeIntent === null;
        return {
            placeOrder: (canPrepare && !killSwitchEngaged)
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
            adjustMargin: (canPrepare && portfolio.positions.length > 0)
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT,
            amendOrder: (canPrepare && portfolio.openOrders.length > 0)
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT,
            cancelAllOpenOrders: canPrepare
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
            closePositions: canPrepare
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
            engageKillSwitch: (canPrepare && !killSwitchEngaged)
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
            disengageKillSwitch: (canPrepare && killSwitchEngaged)
                || finalKind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
            code: activeIntent !== null && finalKind === null
                ? 'FUTURES_PRODUCTION_OPERATION_BUSY'
                : 'FUTURES_PRODUCTION_GATES_SATISFIED',
        };
    };

    const statusFor = connectionId => createFuturesProductionExecutionStatus({
        revision: revision.toString(),
        liveAuthorized: true,
        configured: true,
        account: {
            alias: 'e2e-mocked-account',
            fingerprint: ACCOUNT_FINGERPRINT,
        },
        caps: {
            allowedSymbols: [...ALLOWED_SYMBOLS],
            symbolConfigurations: ALLOWED_SYMBOLS.map(symbol => ({
                symbol,
                marginType: 'ISOLATED',
                leverage: 2,
                isAutoAddMargin: false,
            })),
            maxLeverage: 2,
            maxOrderNotionalUsdt: '10',
            maxDailyNotionalUsdt: '50',
            minAvailableBalanceUsdt: '10',
            minLiquidationDistanceBps: '1000',
            dailyUsedNotionalUsdt: '0',
            utcDay: '2026-07-18',
        },
        killSwitch: {
            engaged: killSwitchEngaged,
            policy: FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
        },
        capabilities: capabilities(connectionId),
        intent: activeIntent?.connectionId === connectionId
            ? activeIntent.intent
            : null,
        attempt: currentAttempt,
        reconciliation: {
            required: false,
            state: 'confirmed',
            nextAttemptAt: null,
        },
        recovery: {
            required: false,
            state: 'healthy',
            code: CONFIRMED_CODE,
        },
        portfolio: copy(portfolio),
    });

    const emitStatus = (connectionId) => {
        const session = sessions.get(connectionId);
        if (!session?.subscribed) return;
        session.emit(statusFor(connectionId));
    };

    const broadcastStatus = () => {
        for (const connectionId of sessions.keys()) emitStatus(connectionId);
    };

    const reject = (connectionId) => {
        advanceRevision();
        emitStatus(connectionId);
        return false;
    };

    const clearIntentExpiryTimer = () => {
        if (intentExpiryTimer === null) return;
        clearTimeout(intentExpiryTimer);
        intentExpiryTimer = null;
    };

    const expireActiveIntent = () => {
        if (!activeIntent || activeIntent.intent.expiresAt > clock()) return false;
        clearIntentExpiryTimer();
        activeIntent = null;
        advanceRevision();
        broadcastStatus();
        return true;
    };

    const scheduleIntentExpiry = () => {
        clearIntentExpiryTimer();
        if (!activeIntent) return;
        const delay = Math.max(0, activeIntent.intent.expiresAt - clock());
        intentExpiryTimer = setTimeout(() => {
            intentExpiryTimer = null;
            expireActiveIntent();
        }, delay);
        intentExpiryTimer.unref?.();
    };

    const canPrepareIntent = (command, kind) => {
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER) {
            if (killSwitchEngaged && command.positionEffect === 'ENTRY') return false;
            const rule = ORDER_RULES[command.symbol];
            const quantity = Number(command.quantity);
            const price = Number(command.price);
            const notional = quantity * price;
            if (!rule
                || !isStepAligned(quantity, rule.stepSize)
                || notional < rule.minimumNotionalUsdt
                || notional > 10) return false;
            if (command.positionEffect === 'EXIT') {
                const position = portfolio.positions.find(candidate => (
                    candidate.symbol === command.symbol
                    && candidate.positionSide === command.positionSide
                ));
                if (!position || quantity > Number(position.quantity)) return false;
            }
            return true;
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT) {
            return portfolio.openOrders.some(order => (
                order.symbol === command.symbol
                && order.positionSide === command.positionSide
                && order.clientOrderId === command.clientOrderId
            ));
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT) {
            const position = portfolio.positions.find(candidate => (
                candidate.symbol === command.symbol
                && candidate.positionSide === command.positionSide
            ));
            if (!position || (killSwitchEngaged && command.marginAction === 'REDUCE')) return false;
            return command.marginAction !== 'REDUCE'
                || Number(command.amount) <= Number(position.isolatedMarginUsdt);
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH) {
            return !killSwitchEngaged;
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH) {
            return killSwitchEngaged;
        }
        return true;
    };

    const createIntent = (command, connectionId, kind) => {
        const requestId = requestSequence.toString(16).padStart(32, '0');
        requestSequence += 1n;
        const nextRevision = advanceRevision();
        activeIntent = {
            connectionId,
            kind,
            command,
            draft: kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER
                ? orderDraft(command)
                : { ...command },
            intent: {
                requestId,
                kind,
                revision: nextRevision,
                expiresAt: clock() + 30_000,
            },
        };
        currentAttempt = null;
        scheduleIntentExpiry();
        broadcastStatus();
        return true;
    };

    const placePreparedOrder = (prepared, observedAt) => {
        exchangeOrderSequence += 1n;
        const draft = prepared.draft;
        portfolio.openOrders.push({
            symbol: draft.symbol,
            orderKind: 'REGULAR',
            orderId: exchangeOrderSequence.toString(),
            clientOrderId: `cc7-${prepared.intent.requestId}`,
            side: draft.side,
            positionSide: draft.positionSide,
            positionEffect: draft.positionEffect,
            price: draft.price,
            originalQuantity: draft.quantity,
            executedQuantity: '0',
            status: 'NEW',
            type: 'LIMIT',
            timeInForce: 'GTC',
            isAppOwned: true,
            updateTime: observedAt,
            syncState: 'synced',
        });
    };

    const applyPreparedIntent = (prepared, action, observedAt) => {
        if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER) {
            placePreparedOrder(prepared, observedAt);
        } else if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER) {
            const { symbol, clientOrderId, price } = prepared.draft;
            if (!portfolio.openOrders.some(order => (
                order.symbol === symbol && order.clientOrderId === clientOrderId
            ))) return false;
            portfolio.openOrders = portfolio.openOrders.map(order => (
                order.symbol === symbol && order.clientOrderId === clientOrderId
                    ? { ...order, price, updateTime: observedAt, syncState: 'synced' }
                    : order
            ));
        } else if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS) {
            portfolio.openOrders = [];
        } else if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS) {
            portfolio.positions = [];
        } else if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN) {
            const { symbol, positionSide, marginAction, amount } = prepared.draft;
            if (!portfolio.positions.some(position => (
                position.symbol === symbol && position.positionSide === positionSide
            ))) return false;
            portfolio.positions = portfolio.positions.map(position => {
                if (position.symbol !== symbol || position.positionSide !== positionSide) {
                    return position;
                }
                const direction = marginAction === 'ADD' ? 1 : -1;
                const adjusted = Math.max(
                    0,
                    Number(position.isolatedMarginUsdt) + direction * Number(amount),
                );
                return { ...position, isolatedMarginUsdt: adjusted.toFixed(2) };
            });
        } else if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH) {
            killSwitchEngaged = true;
        } else if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH) {
            killSwitchEngaged = false;
        }
        portfolio = {
            ...portfolio,
            observedAt,
            syncState: 'live',
            syncCode: CONFIRMED_CODE,
        };
        return true;
    };

    const finalizeIntent = (command, connectionId, kind) => {
        const prepared = activeIntent;
        if (!prepared
            || prepared.connectionId !== connectionId
            || prepared.kind !== kind
            || prepared.intent.requestId !== command.requestId
            || prepared.intent.revision !== command.revision
            || prepared.intent.expiresAt <= clock()) {
            expireActiveIntent();
            return reject(connectionId);
        }
        const observedAt = clock();
        if (!applyPreparedIntent(prepared, command.action, observedAt)) {
            clearIntentExpiryTimer();
            activeIntent = null;
            return reject(connectionId);
        }
        clearIntentExpiryTimer();
        activeIntent = null;
        const nextRevision = advanceRevision();
        currentAttempt = {
            requestId: command.requestId,
            kind,
            revision: nextRevision,
            acknowledgement: FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.ACCEPTED,
            state: ATTEMPT_STATES[kind],
            code: CONFIRMED_CODE,
            observedAt,
            items: [],
        };
        broadcastStatus();
        return true;
    };

    const handleRequest = async (raw, context = {}) => {
        if (shutDown
            || typeof context.connectionId !== 'string'
            || typeof context.emit !== 'function') return false;
        expireActiveIntent();
        let command;
        try {
            command = parseFuturesProductionExecutionCommand(raw, {
                allowedSymbols: [...ALLOWED_SYMBOLS],
            });
        } catch {
            return reject(context.connectionId);
        }

        if (command.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS) {
            if (command.accountFingerprint !== BOOTSTRAP_FINGERPRINT) return false;
            sessions.set(context.connectionId, {
                subscribed: true,
                emit: context.emit,
            });
            emitStatus(context.connectionId);
            return true;
        }
        if (command.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS) {
            sessions.delete(context.connectionId);
            return true;
        }
        if (!sessions.get(context.connectionId)?.subscribed
            || command.accountFingerprint !== ACCOUNT_FINGERPRINT) {
            return reject(context.connectionId);
        }
        const finalKind = FINAL_KINDS[command.action];
        if (!finalKind && command.revision !== revision.toString()) return reject(context.connectionId);
        if (command.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO) {
            portfolio = { ...portfolio, observedAt: clock() };
            advanceRevision();
            broadcastStatus();
            return true;
        }
        const prepareKind = PREPARE_KINDS[command.action];
        if (prepareKind) {
            if (activeIntent !== null || !canPrepareIntent(command, prepareKind)) {
                return reject(context.connectionId);
            }
            return createIntent(command, context.connectionId, prepareKind);
        }
        if (finalKind) return finalizeIntent(command, context.connectionId, finalKind);
        return reject(context.connectionId);
    };

    const disconnect = (connectionId) => {
        const removed = sessions.delete(connectionId);
        if (activeIntent?.connectionId === connectionId) {
            clearIntentExpiryTimer();
            activeIntent = null;
        }
        return removed;
    };

    const shutdown = async () => {
        shutDown = true;
        clearIntentExpiryTimer();
        sessions.clear();
        activeIntent = null;
    };

    const service = Object.freeze({ handleRequest, disconnect, shutdown });
    return Object.freeze({
        mode: 'e2e-in-memory-only',
        coordinator: null,
        service,
        inspect: () => copy({
            revision: revision.toString(),
            portfolio,
            activeIntent,
            currentAttempt,
            shutDown,
        }),
    });
};

export const E2E_FUTURES_EXTERNAL_CLIENT_ORDER_ID = EXTERNAL_CLIENT_ORDER_ID;
export const E2E_FUTURES_ACCOUNT_FINGERPRINT = ACCOUNT_FINGERPRINT;
