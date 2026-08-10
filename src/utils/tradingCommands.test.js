import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    CLIENT_ORDER_ID_MAX_LENGTH,
    CLIENT_ORDER_ID_PATTERN,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_SPOT_ORDER_TYPE,
    DEFAULT_SPOT_TIME_IN_FORCE,
    FUTURES_MARKET_TYPE,
    POSITION_MARGIN_DIRECTIONS,
    SPOT_MARKET_TYPE,
    TRADE_COMMAND_VERSION,
    TRADING_COMMAND_ACTIONS,
    createAccountRefreshCommand,
    createFuturesAdjustPositionMarginCommand,
    createSpotCancelAllCommand,
    createSpotCancelOrderCommand,
    createSpotPlaceOrderCommand,
    createSpotReplaceOrderCommand,
    isTypedTradingAction,
    toLegacyTradingRequest,
} from './tradingCommands.js';

describe('trading command contract', () => {
    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-08T12:00:00.000Z'));
        vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds versioned spot place-order commands with safe defaults', () => {
        expect(createSpotPlaceOrderCommand({
            symbol: 'BTCUSDT',
            side: 'BUY',
            price: 50000,
            quantity: '0.01',
        })).toEqual({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: SPOT_MARKET_TYPE,
            accountId: DEFAULT_ACCOUNT_ID,
            clientOrderId: 's-mrc0zuo0-4fzyo82m',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: DEFAULT_SPOT_ORDER_TYPE,
            timeInForce: DEFAULT_SPOT_TIME_IN_FORCE,
            price: '50000',
            quantity: '0.01',
        });
    });

    // Binance refuses an id over 36 characters. The previous form spelled out
    // the market, symbol and side and reached exactly 37 for a futures order on
    // an 8-character symbol, so every futures entry was rejected by the
    // exchange. The bound is asserted here rather than discovered live.
    it('mints client order ids the exchange accepts, for the longest symbols', () => {
        vi.restoreAllMocks();
        for (const symbol of ['BTCUSDT', 'BEATUSDT', '1000000MOGUSDT', 'X'.repeat(24)]) {
            for (const marketType of [SPOT_MARKET_TYPE, FUTURES_MARKET_TYPE]) {
                const { clientOrderId } = createSpotPlaceOrderCommand({
                    marketType,
                    symbol,
                    side: 'SELL',
                    price: 1,
                    quantity: '1',
                });
                expect(clientOrderId.length).toBeLessThanOrEqual(CLIENT_ORDER_ID_MAX_LENGTH);
                expect(clientOrderId).toMatch(CLIENT_ORDER_ID_PATTERN);
            }
        }
    });

    it('keeps an operator-supplied client order id instead of minting one', () => {
        expect(createSpotPlaceOrderCommand({
            symbol: 'BTCUSDT',
            side: 'BUY',
            price: 1,
            quantity: '1',
            clientOrderId: 'my-own-id',
        }).clientOrderId).toBe('my-own-id');
    });

    it('adapts spot place-order commands to unchanged legacy wire payloads', () => {
        const buyCommand = createSpotPlaceOrderCommand({
            clientOrderId: 'client-0',
            symbol: 'BTCUSDT',
            side: 'BUY',
            price: '12346',
            quantity: '99.9',
        });

        expect(toLegacyTradingRequest(buyCommand)).toEqual({
            request: 'buyOrder',
            data: {
                symbol: 'BTCUSDT',
                side: 'BUY',
                price: '12346',
                quantity: '99.9',
            },
        });

        const sellCommand = createSpotPlaceOrderCommand({
            clientOrderId: 'client-1',
            symbol: 'ETHUSDT',
            side: 'SELL',
            price: '3000.50',
            quantity: '1.25',
        });

        expect(toLegacyTradingRequest(sellCommand)).toEqual({
            request: 'sellOrder',
            data: {
                symbol: 'ETHUSDT',
                side: 'SELL',
                price: '3000.50',
                quantity: '1.25',
            },
        });
    });

    it('adapts spot cancel commands to legacy cancel aliases', () => {
        const byOrderId = createSpotCancelOrderCommand({
            symbol: 'BTCUSDT',
            orderId: 12345,
        });
        expect(toLegacyTradingRequest(byOrderId)).toEqual({
            request: 'cancelOrder',
            data: {
                symbol: 'BTCUSDT',
                orderId: 12345,
                id: 12345,
            },
        });

        const byClientOrderId = createSpotCancelOrderCommand({
            symbol: 'ETHUSDT',
            origClientOrderId: 'client-target',
            newClientOrderId: 'cancel-client',
        });
        expect(toLegacyTradingRequest(byClientOrderId)).toEqual({
            request: 'cancelOrder',
            data: {
                symbol: 'ETHUSDT',
                origClientOrderId: 'client-target',
                clientOrderId: 'client-target',
                newClientOrderId: 'cancel-client',
            },
        });
    });

    it('defines the required Phase 3 command families', () => {
        expect(createSpotReplaceOrderCommand({
            symbol: 'BTCUSDT',
            orderId: 12,
            side: 'BUY',
            price: '50001',
            quantity: '0.01',
        }).action).toBe(TRADING_COMMAND_ACTIONS.REPLACE_ORDER);
        expect(createSpotCancelAllCommand({ symbol: 'BTCUSDT' }).action).toBe(TRADING_COMMAND_ACTIONS.CANCEL_ALL);
        expect(createAccountRefreshCommand({ symbol: 'BTCUSDT' }).action).toBe(TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH);
        expect(isTypedTradingAction(TRADING_COMMAND_ACTIONS.PLACE_ORDER)).toBe(true);
        expect(isTypedTradingAction('order')).toBe(false);
    });

    it('builds a futures margin adjustment that names one position and no order', () => {
        const command = createFuturesAdjustPositionMarginCommand({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            direction: POSITION_MARGIN_DIRECTIONS.ADD,
            amount: 250,
        });
        expect(command).toMatchObject({
            action: TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
            version: TRADE_COMMAND_VERSION,
            marketType: FUTURES_MARKET_TYPE,
            accountId: DEFAULT_ACCOUNT_ID,
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            direction: 'ADD',
            amount: '250',
        });
        expect(command.clientOrderId).toMatch(CLIENT_ORDER_ID_PATTERN);
        // Nothing that would make this look like an order to the exchange.
        expect(command).not.toHaveProperty('side');
        expect(command).not.toHaveProperty('quantity');
        expect(command).not.toHaveProperty('price');
    });

    it('rejects legacy adaptation for unsupported command families', () => {
        expect(() => toLegacyTradingRequest(createSpotCancelAllCommand({ symbol: 'BTCUSDT' })))
            .toThrow('trade.cancelAll cannot be adapted to the legacy protocol');
    });
});
