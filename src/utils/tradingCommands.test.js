import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    DEFAULT_ACCOUNT_ID,
    DEFAULT_SPOT_ORDER_TYPE,
    DEFAULT_SPOT_TIME_IN_FORCE,
    SPOT_MARKET_TYPE,
    TRADE_COMMAND_VERSION,
    TRADING_COMMAND_ACTIONS,
    createAccountRefreshCommand,
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
            clientOrderId: 'spot-BTCUSDT-BUY-mrc0zuo0-4fzyo8',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: DEFAULT_SPOT_ORDER_TYPE,
            timeInForce: DEFAULT_SPOT_TIME_IN_FORCE,
            price: '50000',
            quantity: '0.01',
        });
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

    it('rejects legacy adaptation for unsupported command families', () => {
        expect(() => toLegacyTradingRequest(createSpotCancelAllCommand({ symbol: 'BTCUSDT' })))
            .toThrow('trade.cancelAll cannot be adapted to the legacy protocol');
    });
});
