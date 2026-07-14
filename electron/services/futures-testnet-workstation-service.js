import {
    FUTURES_TESTNET_WORKSTATION_ACTIONS,
    createFuturesTestnetWorkstationEvent,
    readFuturesTestnetWorkstationRequest,
} from '../../src/utils/futuresTestnetWorkstationProtocol.js';
import {
    FUTURES_WORKSTATION_EVENT_MAX_BYTES,
    FUTURES_WORKSTATION_RESOURCES,
    FUTURES_WORKSTATION_STATES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    appendFuturesWorkstationTrade,
    createFuturesWorkstationCatalogFrames,
    createFuturesWorkstationHeader,
    normalizeFuturesWorkstationDepthSnapshot,
    normalizeFuturesWorkstationExchangeInfo,
    normalizeFuturesWorkstationKlines,
    normalizeFuturesWorkstationPremiumIndex,
    normalizeFuturesWorkstationStreamFrame,
    normalizeFuturesWorkstationTicker,
    toRendererCandleRows,
    toRendererTradeRows,
    updateFuturesWorkstationCandles,
    updateFuturesWorkstationHeader,
} from './futures-workstation-market-contract.js';
import {
    FuturesWorkstationOrderBook,
} from './futures-workstation-order-book.js';

export const FUTURES_TESTNET_WORKSTATION_ALLOWLIST = Object.freeze([
    'BTCUSDT',
    'ETHUSDT',
    'SOLUSDT',
]);

export const FUTURES_TESTNET_WORKSTATION_FRESHNESS = Object.freeze({
    HEADER_MS: 5_000,
    CANDLES_MS: 5_000,
    DEPTH_MS: 3_000,
    TRADES_MS: 5_000,
    CHECK_MS: 1_000,
    RECONNECT_BASE_MS: 500,
    RECONNECT_MAX_MS: 30_000,
    RECONNECT_ATTEMPTS: 8,
    PENDING_EVENTS: 128,
});

export class FuturesTestnetWorkstationServiceError extends Error {
    constructor(code) {
        super('Futures Testnet workstation service failed');
        this.name = 'FuturesTestnetWorkstationServiceError';
        this.code = code;
    }
}

const systemClock = Object.freeze({
    now: () => Date.now(),
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: handle => clearInterval(handle),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: handle => clearTimeout(handle),
});

const safeCode = error => (
    typeof error?.code === 'string' && /^[A-Z0-9_-]{1,96}$/.test(error.code)
        ? error.code.replace(/-/g, '_')
        : 'WORKSTATION_RESOURCE_REJECTED'
);

export class FuturesTestnetWorkstationService {
    constructor({ transport, clock = systemClock, onInternalError = () => {} } = {}) {
        if (!transport
            || typeof transport.loadExchangeInfo !== 'function'
            || typeof transport.bootstrap !== 'function'
            || typeof transport.connect !== 'function'
            || typeof transport.close !== 'function'
            || typeof clock.now !== 'function'
            || typeof clock.setInterval !== 'function'
            || typeof clock.clearInterval !== 'function'
            || typeof clock.setTimeout !== 'function'
            || typeof clock.clearTimeout !== 'function'
            || typeof onInternalError !== 'function') {
            throw new FuturesTestnetWorkstationServiceError('INVALID_SERVICE_COMPOSITION');
        }
        this.transport = transport;
        this.clock = clock;
        this.onInternalError = onInternalError;
        this.generation = 0;
        this.current = null;
        this.stopped = false;
    }

    async handleRequest(raw, { emit } = {}) {
        if (this.stopped) throw new FuturesTestnetWorkstationServiceError('SERVICE_STOPPED');
        if (typeof emit !== 'function') {
            throw new FuturesTestnetWorkstationServiceError('INVALID_EMITTER');
        }
        const request = readFuturesTestnetWorkstationRequest(raw);
        if (request.action === FUTURES_TESTNET_WORKSTATION_ACTIONS.UNSUBSCRIBE) {
            if (this.current?.requestId === request.requestId) this.stopCurrent();
            return;
        }
        await this.startGeneration(request, emit, 0);
    }

    isCurrent(session) {
        return !this.stopped
            && this.current === session
            && !session.abortController.signal.aborted;
    }

    observedNow(session) {
        const now = this.clock.now();
        if (!Number.isSafeInteger(now) || now < 0) {
            throw new FuturesTestnetWorkstationServiceError('INVALID_CLOCK');
        }
        if (now < session.lastClock) {
            if (session.clockRegressed) return session.lastClock;
            session.clockRegressed = true;
            throw new FuturesTestnetWorkstationServiceError('CLOCK_REGRESSION');
        }
        session.lastClock = now;
        return now;
    }

    emitResource(session, resource, state, payload) {
        if (!this.isCurrent(session)) return false;
        session.revision += 1;
        const event = createFuturesTestnetWorkstationEvent({
            requestId: session.requestId,
            symbol: session.symbol,
            generation: session.generation,
            revision: session.revision,
            resource,
            state,
            observedAt: this.observedNow(session),
            payload,
        });
        if (Buffer.byteLength(JSON.stringify(event), 'utf8') > FUTURES_WORKSTATION_EVENT_MAX_BYTES) {
            throw new FuturesTestnetWorkstationServiceError('OUTBOUND_FRAME_TOO_LARGE');
        }
        session.emit(event);
        return true;
    }

    emitStatus(session, state, connected, reasonCode = null) {
        return this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.STATUS,
            state,
            Object.freeze({ connected, reasonCode }),
        );
    }

    async startGeneration(request, emit, reconnectAttempt) {
        this.stopCurrent();
        this.generation += 1;
        const session = {
            request,
            requestId: request.requestId,
            symbol: request.symbol,
            interval: request.interval,
            pair: request.symbol,
            generation: this.generation,
            revision: 0,
            reconnectAttempt,
            emit,
            abortController: new AbortController(),
            stream: null,
            reconnectTimer: null,
            freshnessTimer: null,
            orderBook: new FuturesWorkstationOrderBook(),
            bootstrapped: false,
            pendingEvents: [],
            contracts: Object.freeze([]),
            contract: null,
            header: null,
            candles: Object.freeze([]),
            markCandles: Object.freeze([]),
            indexCandles: Object.freeze([]),
            trades: Object.freeze([]),
            lastHeaderAt: 0,
            lastCandlesAt: 0,
            lastDepthAt: 0,
            lastTradesAt: 0,
            staleResources: new Set(),
            lastClock: 0,
            clockRegressed: false,
        };
        this.current = session;
        this.emitStatus(session, FUTURES_WORKSTATION_STATES.LOADING, false, null);

        try {
            const exchangeInfo = await this.transport.loadExchangeInfo({
                signal: session.abortController.signal,
            });
            if (!this.isCurrent(session)) return;
            session.contracts = normalizeFuturesWorkstationExchangeInfo(
                exchangeInfo,
                new Set(FUTURES_TESTNET_WORKSTATION_ALLOWLIST),
            );
            for (const frame of createFuturesWorkstationCatalogFrames(session.contracts)) {
                this.emitResource(
                    session,
                    FUTURES_WORKSTATION_RESOURCES.CATALOG,
                    FUTURES_WORKSTATION_STATES.LIVE,
                    frame,
                );
            }
            session.contract = session.contracts.find(contract => contract.symbol === session.symbol);
            if (!session.contract) {
                this.emitStatus(
                    session,
                    FUTURES_WORKSTATION_STATES.UNAVAILABLE,
                    false,
                    'SYMBOL_UNAVAILABLE',
                );
                return;
            }
            session.pair = session.contract.pair;
            session.orderBook.beginBootstrap();
            session.stream = this.transport.connect({
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
                signal: session.abortController.signal,
                onMessage: raw => this.handleStreamFrame(session, raw),
                onDisconnect: reason => this.handleDisconnect(session, reason),
            });
            if (session.reconnectTimer !== null) return;
            const bootstrap = await this.transport.bootstrap({
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
                signal: session.abortController.signal,
            });
            if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
            const depthSnapshot = normalizeFuturesWorkstationDepthSnapshot(
                bootstrap.depthSnapshot,
                session.symbol,
            );
            const bookResult = session.orderBook.bootstrap(depthSnapshot);
            if (!bookResult.live) {
                this.scheduleResync(session, 'DEPTH_BOOTSTRAP_GAP');
                return;
            }
            session.candles = normalizeFuturesWorkstationKlines(bootstrap.contractKlines);
            session.markCandles = normalizeFuturesWorkstationKlines(bootstrap.markKlines);
            session.indexCandles = normalizeFuturesWorkstationKlines(bootstrap.indexKlines);
            const premium = normalizeFuturesWorkstationPremiumIndex(
                bootstrap.premiumIndex,
                session.symbol,
            );
            const ticker = normalizeFuturesWorkstationTicker(bootstrap.ticker, session.symbol);
            session.header = createFuturesWorkstationHeader({
                premium,
                ticker,
                contractStatus: session.contract.status,
            });
            session.bootstrapped = true;
            const now = this.observedNow(session);
            session.lastHeaderAt = now;
            session.lastCandlesAt = now;
            session.lastDepthAt = now;
            session.lastTradesAt = now;
            this.emitResource(
                session,
                FUTURES_WORKSTATION_RESOURCES.HEADER,
                FUTURES_WORKSTATION_STATES.LIVE,
                session.header,
            );
            this.emitCandleSeries(session, 'contract', session.candles);
            this.emitCandleSeries(session, 'mark', session.markCandles);
            this.emitCandleSeries(session, 'index', session.indexCandles);
            this.emitResource(
                session,
                FUTURES_WORKSTATION_RESOURCES.DEPTH,
                FUTURES_WORKSTATION_STATES.LIVE,
                session.orderBook.toRendererView(),
            );
            this.emitTrades(session);
            for (const event of session.pendingEvents) this.applyStreamEvent(session, event);
            session.pendingEvents = [];
            if (!this.isCurrent(session)) return;
            this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, null);
            this.startFreshnessMonitor(session);
        } catch (error) {
            if (!this.isCurrent(session) || error?.name === 'AbortError') return;
            this.onInternalError({ phase: 'bootstrap', code: safeCode(error) });
            this.emitStatus(
                session,
                FUTURES_WORKSTATION_STATES.UNAVAILABLE,
                false,
                safeCode(error),
            );
        }
    }

    emitCandleSeries(session, series, rows, state = FUTURES_WORKSTATION_STATES.LIVE) {
        this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.CANDLES,
            state,
            Object.freeze({
                series,
                interval: session.interval,
                rows: toRendererCandleRows(rows),
            }),
        );
    }

    emitTrades(session, state = FUTURES_WORKSTATION_STATES.LIVE) {
        this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.TRADES,
            state,
            Object.freeze({ rows: toRendererTradeRows(session.trades) }),
        );
    }

    handleStreamFrame(session, raw) {
        if (!this.isCurrent(session)) return;
        try {
            const event = normalizeFuturesWorkstationStreamFrame(raw, {
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
            });
            if (event.kind === 'depth') {
                const result = session.orderBook.push({
                    firstUpdateId: event.firstUpdateId,
                    finalUpdateId: event.finalUpdateId,
                    previousFinalUpdateId: event.previousFinalUpdateId,
                    bids: event.bids,
                    asks: event.asks,
                    eventTime: event.eventTime,
                }, event.frameBytes);
                if (result.resync) this.scheduleResync(session, 'DEPTH_SEQUENCE_GAP');
                else if (result.applied && session.bootstrapped) {
                    session.lastDepthAt = this.observedNow(session);
                    session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.DEPTH);
                    this.emitResource(
                        session,
                        FUTURES_WORKSTATION_RESOURCES.DEPTH,
                        FUTURES_WORKSTATION_STATES.LIVE,
                        session.orderBook.toRendererView(),
                    );
                }
                return;
            }
            if (!session.bootstrapped) {
                if (session.pendingEvents.length >= FUTURES_TESTNET_WORKSTATION_FRESHNESS.PENDING_EVENTS) {
                    this.scheduleResync(session, 'STREAM_QUEUE_OVERFLOW');
                    return;
                }
                session.pendingEvents.push(event);
                return;
            }
            this.applyStreamEvent(session, event);
        } catch (error) {
            if (!this.isCurrent(session)) return;
            this.onInternalError({ phase: 'stream', code: safeCode(error) });
            this.scheduleResync(session, 'MALFORMED_STREAM_FRAME');
        }
    }

    applyStreamEvent(session, event) {
        if (!this.isCurrent(session)) return;
        const now = this.observedNow(session);
        if (event.kind === 'trade') {
            session.trades = appendFuturesWorkstationTrade(session.trades, event.row);
            session.lastTradesAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.TRADES);
            this.emitTrades(session);
        } else if (event.kind === 'kline') {
            session.candles = updateFuturesWorkstationCandles(session.candles, event.row);
            session.lastCandlesAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.CANDLES);
            this.emitCandleSeries(session, 'contract', session.candles);
        } else if (event.kind === 'mark' || event.kind === 'ticker') {
            session.header = updateFuturesWorkstationHeader(session.header, event);
            session.lastHeaderAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.HEADER);
            this.emitResource(
                session,
                FUTURES_WORKSTATION_RESOURCES.HEADER,
                FUTURES_WORKSTATION_STATES.LIVE,
                session.header,
            );
        }
    }

    markResourceStale(session, resource, payload) {
        if (session.staleResources.has(resource)) return;
        session.staleResources.add(resource);
        if (resource === FUTURES_WORKSTATION_RESOURCES.CANDLES) {
            this.emitCandleSeries(session, 'contract', session.candles, FUTURES_WORKSTATION_STATES.STALE);
        } else if (resource === FUTURES_WORKSTATION_RESOURCES.TRADES) {
            this.emitTrades(session, FUTURES_WORKSTATION_STATES.STALE);
        } else {
            this.emitResource(session, resource, FUTURES_WORKSTATION_STATES.STALE, payload);
        }
    }

    startFreshnessMonitor(session) {
        session.freshnessTimer = this.clock.setInterval(() => {
            if (!this.isCurrent(session)) return;
            try {
                const now = this.observedNow(session);
                if (now - session.lastHeaderAt > FUTURES_TESTNET_WORKSTATION_FRESHNESS.HEADER_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.HEADER, session.header);
                }
                if (now - session.lastCandlesAt > FUTURES_TESTNET_WORKSTATION_FRESHNESS.CANDLES_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.CANDLES, null);
                }
                if (now - session.lastDepthAt > FUTURES_TESTNET_WORKSTATION_FRESHNESS.DEPTH_MS) {
                    this.markResourceStale(
                        session,
                        FUTURES_WORKSTATION_RESOURCES.DEPTH,
                        session.orderBook.toRendererView(),
                    );
                }
                if (now - session.lastTradesAt > FUTURES_TESTNET_WORKSTATION_FRESHNESS.TRADES_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.TRADES, null);
                }
            } catch (error) {
                this.onInternalError({ phase: 'freshness', code: safeCode(error) });
                this.scheduleResync(session, safeCode(error));
            }
        }, FUTURES_TESTNET_WORKSTATION_FRESHNESS.CHECK_MS);
        session.freshnessTimer?.unref?.();
    }

    handleDisconnect(session, reason) {
        if (!this.isCurrent(session)) return;
        this.emitStatus(
            session,
            FUTURES_WORKSTATION_STATES.DISCONNECTED,
            false,
            typeof reason === 'string' && /^[A-Z0-9_]{1,96}$/.test(reason)
                ? reason
                : 'SOCKET_DISCONNECTED',
        );
        this.scheduleResync(session, 'SOCKET_DISCONNECTED');
    }

    scheduleResync(session, reasonCode) {
        if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
        if (session.reconnectAttempt >= FUTURES_TESTNET_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS) {
            this.emitStatus(
                session,
                FUTURES_WORKSTATION_STATES.UNAVAILABLE,
                false,
                'RECONNECT_EXHAUSTED',
            );
            return;
        }
        this.emitStatus(
            session,
            FUTURES_WORKSTATION_STATES.RESYNCHRONIZING,
            false,
            reasonCode,
        );
        session.stream?.close?.();
        session.stream = null;
        session.orderBook.stop();
        if (session.freshnessTimer !== null) {
            this.clock.clearInterval(session.freshnessTimer);
            session.freshnessTimer = null;
        }
        const delay = Math.min(
            FUTURES_TESTNET_WORKSTATION_FRESHNESS.RECONNECT_MAX_MS,
            FUTURES_TESTNET_WORKSTATION_FRESHNESS.RECONNECT_BASE_MS
                * (2 ** session.reconnectAttempt),
        );
        const request = session.request;
        const emit = session.emit;
        const attempt = session.reconnectAttempt + 1;
        session.reconnectTimer = this.clock.setTimeout(() => {
            session.reconnectTimer = null;
            if (this.isCurrent(session)) void this.startGeneration(request, emit, attempt);
        }, delay);
        session.reconnectTimer?.unref?.();
    }

    stopCurrent() {
        const session = this.current;
        this.current = null;
        if (!session) return;
        session.abortController.abort();
        session.stream?.close?.();
        session.orderBook.stop();
        if (session.freshnessTimer !== null) this.clock.clearInterval(session.freshnessTimer);
        if (session.reconnectTimer !== null) this.clock.clearTimeout(session.reconnectTimer);
        session.pendingEvents = [];
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.stopCurrent();
        this.transport.close();
    }
}
