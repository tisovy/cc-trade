import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    createCommandRejection,
    validateTypedTradingCommand,
    validateLegacyCancelCommand,
    validateLegacyOrderCommand,
} from './trading-command-validation.js';
import {
    TRADE_COMMAND_VERSION,
    TRADING_COMMAND_ACTIONS,
} from '../../src/utils/tradingCommands.js';

describe('backend trading command validation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates structured backend rejection messages', () => {
        expect(createCommandRejection('buyOrder', 'INVALID_ORDER_PRICE', 'bad price', { field: 'price' })).toEqual({
            command_rejected: {
                request: 'buyOrder',
                code: 'INVALID_ORDER_PRICE',
                message: 'bad price',
                details: { field: 'price' },
                timestamp: Date.parse('2026-07-08T12:00:00.000Z'),
            },
        });
    });

    it('accepts valid legacy order aliases without changing resolved spot fields', () => {
        expect(validateLegacyOrderCommand({
            qty: '0.2500',
            p: '61000.50',
        }, {
            requestType: 'buyOrder',
            selectedSymbol: 'BTCUSDT',
        })).toEqual({
            ok: true,
            command: {
                symbol: 'BTCUSDT',
                side: 'BUY',
                quantityValue: '0.2500',
                priceValue: '61000.50',
                numericQuantity: 0.25,
                numericPrice: 61000.5,
            },
        });

        expect(validateLegacyOrderCommand({
            symbol: 'ETHUSDT',
            quantity: '1',
            price: '3000',
        }, {
            requestType: 'sellOrder',
        }).command.side).toBe('SELL');
    });

    it('rejects malformed legacy order payloads before REST submission', () => {
        expect(validateLegacyOrderCommand(null, { requestType: 'buyOrder' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'INVALID_ORDER_PAYLOAD',
                    details: { field: 'data' },
                },
            },
        });

        expect(validateLegacyOrderCommand({
            symbol: 'BTCUSDT',
            side: 'hold',
            quantity: '1',
            price: '100',
        }, {
            requestType: 'buyOrder',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'INVALID_ORDER_SIDE',
                    details: { field: 'side', value: 'hold' },
                },
            },
        });

        expect(validateLegacyOrderCommand({
            symbol: 'BTCUSDT',
            quantity: '0',
            price: '100',
        }, {
            requestType: 'buyOrder',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'INVALID_ORDER_QUANTITY',
                    details: { field: 'quantity', value: '0' },
                },
            },
        });
    });

    it('accepts valid legacy cancel aliases', () => {
        expect(validateLegacyCancelCommand({
            id: '123456',
            symbol: 'BTCUSDT',
        })).toEqual({
            ok: true,
            command: {
                symbol: 'BTCUSDT',
                orderId: '123456',
                origClientOrderId: null,
                newClientOrderId: null,
            },
        });

        expect(validateLegacyCancelCommand({
            clientOrderId: 'client-123',
        }, {
            selectedSymbol: 'ETHUSDT',
        })).toEqual({
            ok: true,
            command: {
                symbol: 'ETHUSDT',
                orderId: null,
                origClientOrderId: 'client-123',
                newClientOrderId: null,
            },
        });
    });

    it('rejects malformed legacy cancel payloads before REST submission', () => {
        expect(validateLegacyCancelCommand([], { selectedSymbol: 'BTCUSDT' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'INVALID_CANCEL_PAYLOAD',
                },
            },
        });

        expect(validateLegacyCancelCommand({
            symbol: 'BTCUSDT',
            orderId: 'abc',
            clientOrderId: 'client-123',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'INVALID_CANCEL_ORDER_ID',
                    details: { field: 'orderId', value: 'abc' },
                },
            },
        });

        expect(validateLegacyCancelCommand({
            symbol: 'BTCUSDT',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'INVALID_CANCEL_TARGET',
                },
            },
        });
    });

    it('rejects futures identity on every legacy execution family', () => {
        expect(validateLegacyOrderCommand({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            quantity: '1',
            price: '50000',
        }, { requestType: 'buyOrder' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'UNSUPPORTED_MARKET_TYPE',
                    details: { field: 'marketType', value: 'futures' },
                },
            },
        });

        expect(validateLegacyOrderCommand({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            quantity: '1',
            price: '50000',
        }, { requestType: 'sellOrder' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'sellOrder',
                    code: 'UNSUPPORTED_MARKET_TYPE',
                },
            },
        });

        expect(validateLegacyCancelCommand({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            orderId: 12345,
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'UNSUPPORTED_MARKET_TYPE',
                },
            },
        });

        expect(validateLegacyOrderCommand({
            marketType: 'spot',
            symbol: 'BTCUSDT',
            quantity: '1',
            price: '50000',
        }, {
            requestType: 'buyOrder',
            declaredMarketType: 'futures',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'UNSUPPORTED_MARKET_TYPE',
                    details: { field: 'envelope.marketType', value: 'futures' },
                },
            },
        });

        expect(validateLegacyCancelCommand({
            marketType: 'spot',
            symbol: 'BTCUSDT',
            orderId: 12345,
        }, { declaredMarketType: 'futures' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'UNSUPPORTED_MARKET_TYPE',
                },
            },
        });
    });

    it('accepts typed spot place-order commands and resolves the legacy handler target', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'client-123',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000.00',
            quantity: '0.010000',
        })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                version: TRADE_COMMAND_VERSION,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'client-123',
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                priceValue: '50000.00',
                quantityValue: '0.010000',
                numericPrice: 50000,
                numericQuantity: 0.01,
                requestType: 'buyOrder',
                orderPayload: {
                    symbol: 'BTCUSDT',
                    side: 'BUY',
                    price: '50000.00',
                    quantity: '0.010000',
                },
            },
        });
    });

    it('accepts typed spot cancel commands without treating clientOrderId as the cancel target', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'command-client-id',
            symbol: 'ETHUSDT',
            origClientOrderId: 'target-client-id',
            newClientOrderId: 'cancel-client-id',
        })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
                version: TRADE_COMMAND_VERSION,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'command-client-id',
                symbol: 'ETHUSDT',
                orderId: null,
                origClientOrderId: 'target-client-id',
                newClientOrderId: 'cancel-client-id',
                cancelPayload: {
                    symbol: 'ETHUSDT',
                    orderId: null,
                    origClientOrderId: 'target-client-id',
                    newClientOrderId: 'cancel-client-id',
                },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'command-client-id',
            symbol: 'ETHUSDT',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
                    code: 'INVALID_TYPED_CANCEL_TARGET',
                },
            },
        });
    });

    it('rejects typed commands that would change current spot execution guarantees', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'margin',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    code: 'UNSUPPORTED_MARKET_TYPE',
                },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'MARKET',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    code: 'UNSUPPORTED_TYPED_ORDER_TYPE',
                },
            },
        });
    });

    it('accepts spot-parity futures typed commands', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        })).toMatchObject({
            ok: true,
            command: {
                marketType: 'futures',
                futuresOrderPayload: {
                    symbol: 'BTCUSDT',
                    side: 'BUY',
                    orderType: 'LIMIT',
                    numericQuantity: 0.01,
                    numericPrice: 50000,
                    reduceOnly: false,
                },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            symbol: 'BTCUSDT',
            side: 'SELL',
            orderType: 'MARKET',
            quantity: '0.01',
            positionSide: 'LONG',
            reduceOnly: true,
        })).toMatchObject({
            ok: true,
            command: {
                marketType: 'futures',
                futuresOrderPayload: {
                    orderType: 'MARKET',
                    positionSide: 'LONG',
                    reduceOnly: true,
                },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.CANCEL_ALL,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            symbol: 'BTCUSDT',
        })).toMatchObject({
            ok: true,
            command: { marketType: 'futures', symbol: 'BTCUSDT' },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            paused: true,
        })).toMatchObject({
            ok: true,
            command: { marketType: 'futures', paused: true },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            paused: 'yes',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: { code: 'INVALID_TYPED_PAUSE_FLAG' },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            paused: true,
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: { code: 'TYPED_COMMAND_NOT_ENABLED' },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            quantity: '0.01',
            positionSide: 'SIDEWAYS',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: { code: 'INVALID_TYPED_ORDER_POSITION_SIDE' },
            },
        });
    });

    it('defines disabled typed command families with explicit backend rejection', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            symbol: 'BTCUSDT',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
                    code: 'TYPED_COMMAND_NOT_ENABLED',
                },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.CANCEL_ALL,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            symbol: 'BTCUSDT',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: TRADING_COMMAND_ACTIONS.CANCEL_ALL,
                    code: 'TYPED_COMMAND_NOT_ENABLED',
                },
            },
        });
    });

    it('accepts account refresh as a typed command family', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'refresh-1',
            symbol: 'BTCUSDT',
        })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
                version: TRADE_COMMAND_VERSION,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'refresh-1',
                symbol: 'BTCUSDT',
            },
        });
    });
});
