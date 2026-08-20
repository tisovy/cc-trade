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

    // Binance caps a client order id at 36 characters. Catching it here keeps a
    // malformed id a named local rejection instead of an order the operator
    // watches the exchange refuse.
    it('refuses a client order id the exchange would reject', () => {
        const result = validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            clientOrderId: 'futures-BEATUSDT-SELL-mrc0zuo0-4fzyo8',
            symbol: 'BEATUSDT',
            side: 'SELL',
            price: '3.4',
            quantity: '100',
        }, { selectedSymbol: 'BEATUSDT' });

        expect(result.ok).toBe(false);
        expect(result.rejection.command_rejected.code).toBe('INVALID_CLIENT_ORDER_ID');
        expect(result.rejection.command_rejected.details).toMatchObject({
            field: 'clientOrderId',
            length: 37,
        });
    });

    it('refuses a client order id built from characters the exchange forbids', () => {
        const result = validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            clientOrderId: 'has spaces & symbols',
            symbol: 'BEATUSDT',
            side: 'SELL',
            price: '3.4',
            quantity: '100',
        }, { selectedSymbol: 'BEATUSDT' });

        expect(result.ok).toBe(false);
        expect(result.rejection.command_rejected.code).toBe('INVALID_CLIENT_ORDER_ID');
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
                // A legacy payload carries no command identity of its own.
                newClientOrderId: null,
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
                    // The identity the intent was minted with reaches the
                    // exchange on Spot too, so a resubmission is deduplicable.
                    newClientOrderId: 'client-123',
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

    it('accepts futures order amendments and rejects untargeted ones', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderId: 11,
            price: '58500.0',
            quantity: '0.004',
        })).toMatchObject({
            ok: true,
            command: {
                futuresModifyPayload: {
                    symbol: 'BTCUSDT',
                    side: 'BUY',
                    orderId: 11,
                    numericPrice: 58500,
                    numericQuantity: 0.004,
                },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            symbol: 'BTCUSDT',
            side: 'BUY',
            price: '58500.0',
            quantity: '0.004',
        })).toMatchObject({
            ok: false,
            rejection: { command_rejected: { code: 'INVALID_TYPED_MODIFY_TARGET' } },
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

    it('accepts futures history and refuses it for spot or without a contract', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'history-1',
            symbol: 'BTCUSDT',
        })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
                version: TRADE_COMMAND_VERSION,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'history-1',
                symbol: 'BTCUSDT',
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'history-2',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: { code: 'INVALID_TYPED_HISTORY_SYMBOL' },
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'history-3',
            symbol: 'BTCUSDT',
        })).toMatchObject({ ok: false });
    });

    it('bounds and normalizes futures history coverage without rounding identities', () => {
        const coverage = Object.fromEntries([
            ['btcusdt', {
                readAt: 1_784_000_000_000,
                orderCursor: '9223372036854775807',
                tradeCursor: 17,
            }],
            ['bad symbol', { readAt: 1, orderCursor: '1', tradeCursor: '2' }],
            ...Array.from({ length: 30 }, (_, index) => [
                `SYM${index}USDT`,
                { readAt: index + 1, orderCursor: String(index + 1), tradeCursor: null },
            ]),
        ]);
        const result = validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'history-coverage',
            symbol: 'BTCUSDT',
            coverage,
            full: true,
        });

        expect(result.ok).toBe(true);
        expect(Object.keys(result.command.coverage)).toHaveLength(24);
        expect(result.command.coverage.BTCUSDT).toEqual({
            readAt: 1_784_000_000_000,
            orderCursor: '9223372036854775807',
            // A numeric identity is rejected rather than rounded in transit.
            tradeCursor: null,
        });
        expect(result.command.coverage).not.toHaveProperty('bad symbol');
        expect(result.command.full).toBe(true);
    });

    // Reading a contract's configuration touches nothing, so it may fall back to
    // the contract on screen — unlike setting leverage, which may not.
    it('accepts a contract configuration read and refuses it for spot', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'config-1',
        }, { selectedSymbol: 'btcusdt' })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG,
                version: TRADE_COMMAND_VERSION,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'config-1',
                symbol: 'BTCUSDT',
            },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'config-2',
        })).toMatchObject({
            ok: false,
            rejection: { command_rejected: { code: 'INVALID_TYPED_SYMBOL_CONFIG_SYMBOL' } },
        });

        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG,
            version: TRADE_COMMAND_VERSION,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'config-3',
            symbol: 'BTCUSDT',
        })).toMatchObject({ ok: false });
    });

    // Leverage names one contract and one whole number: applied to the wrong
    // contract it reprices every position on it, and the exchange takes integers
    // only, so a fraction is refused here rather than by a signed request.
    it('accepts a leverage change and names every field it refuses', () => {
        const validCommand = {
            action: TRADING_COMMAND_ACTIONS.SET_LEVERAGE,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'leverage-1',
            symbol: 'btcusdt',
            leverage: 20,
        };
        expect(validateTypedTradingCommand(validCommand, { selectedSymbol: 'ETHUSDT' })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.SET_LEVERAGE,
                version: TRADE_COMMAND_VERSION,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'leverage-1',
                symbol: 'BTCUSDT',
                leveragePayload: { symbol: 'BTCUSDT', leverage: 20 },
            },
        });

        expect(validateTypedTradingCommand(
            { ...validCommand, symbol: undefined },
            { selectedSymbol: 'ETHUSDT' },
        )).toMatchObject({
            ok: false,
            rejection: { command_rejected: { code: 'INVALID_TYPED_LEVERAGE_SYMBOL' } },
        });

        for (const leverage of [0, -5, 2.5, 126, 'twenty', undefined]) {
            expect(validateTypedTradingCommand({ ...validCommand, leverage })).toMatchObject({
                ok: false,
                rejection: { command_rejected: { code: 'INVALID_TYPED_LEVERAGE_VALUE' } },
            });
        }

        expect(validateTypedTradingCommand({ ...validCommand, marketType: 'spot' }))
            .toMatchObject({ ok: false });
    });

    // The margin mode decides whether a losing position is capped at its own
    // margin or stands behind the whole wallet, so it names its contract on the
    // same terms as the leverage — and only the exchange's own two words.
    it('accepts a margin-mode change and names every field it refuses', () => {
        const validCommand = {
            action: TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'margin-type-1',
            symbol: 'epicusdt',
            marginType: 'isolated',
        };
        expect(validateTypedTradingCommand(validCommand, { selectedSymbol: 'ETHUSDT' })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE,
                version: TRADE_COMMAND_VERSION,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'margin-type-1',
                symbol: 'EPICUSDT',
                marginTypePayload: { symbol: 'EPICUSDT', marginType: 'ISOLATED' },
            },
        });

        expect(validateTypedTradingCommand(
            { ...validCommand, symbol: undefined },
            { selectedSymbol: 'ETHUSDT' },
        )).toMatchObject({
            ok: false,
            rejection: { command_rejected: { code: 'INVALID_TYPED_MARGIN_TYPE_SYMBOL' } },
        });

        for (const marginType of ['CROSS_MARGIN', 'cross-ish', '', undefined, 5]) {
            expect(validateTypedTradingCommand({ ...validCommand, marginType })).toMatchObject({
                ok: false,
                rejection: { command_rejected: { code: 'INVALID_TYPED_MARGIN_TYPE_VALUE' } },
            });
        }

        expect(validateTypedTradingCommand({ ...validCommand, marketType: 'spot' }))
            .toMatchObject({ ok: false });
    });

    // Margin transfers move real money and name one position. The symbol has no
    // fallback to the selected contract precisely because the fallback would
    // land the transfer on a position the operator never clicked.
    it('accepts a futures margin adjustment and names every field it refuses', () => {
        const validCommand = {
            action: TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'margin-1',
            symbol: 'btcusdt',
            positionSide: 'LONG',
            direction: 'add',
            amount: '250.5',
        };
        expect(validateTypedTradingCommand(validCommand, { selectedSymbol: 'ETHUSDT' })).toEqual({
            ok: true,
            command: {
                action: TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
                version: TRADE_COMMAND_VERSION,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'margin-1',
                symbol: 'BTCUSDT',
                marginPayload: {
                    symbol: 'BTCUSDT',
                    positionSide: 'LONG',
                    direction: 'ADD',
                    amount: '250.5',
                },
            },
        });

        // No symbol means no position, even with a contract on screen.
        expect(validateTypedTradingCommand(
            { ...validCommand, symbol: undefined },
            { selectedSymbol: 'ETHUSDT' },
        )).toMatchObject({
            ok: false,
            rejection: { command_rejected: { code: 'INVALID_TYPED_MARGIN_SYMBOL' } },
        });

        expect(validateTypedTradingCommand({ ...validCommand, positionSide: 'BOTHS' }))
            .toMatchObject({
                ok: false,
                rejection: { command_rejected: { code: 'INVALID_TYPED_MARGIN_POSITION_SIDE' } },
            });

        for (const direction of [undefined, '', 'SET', 'ADD_ALL']) {
            expect(validateTypedTradingCommand({ ...validCommand, direction }))
                .toMatchObject({
                    ok: false,
                    rejection: { command_rejected: { code: 'INVALID_TYPED_MARGIN_DIRECTION' } },
                });
        }

        for (const amount of [undefined, '', '0', '-5', 'abc', Number.NaN]) {
            expect(validateTypedTradingCommand({ ...validCommand, amount }))
                .toMatchObject({
                    ok: false,
                    rejection: { command_rejected: { code: 'INVALID_TYPED_MARGIN_AMOUNT' } },
                });
        }

        // Spot has no position margin to move.
        expect(validateTypedTradingCommand({ ...validCommand, marketType: 'spot' }))
            .toMatchObject({
                ok: false,
                rejection: { command_rejected: { code: 'TYPED_COMMAND_NOT_ENABLED' } },
            });
    });

    it('defaults a margin adjustment to the one-way leg the account read reports', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'margin-2',
            symbol: 'BTCUSDT',
            direction: 'REMOVE',
            amount: 40,
        })).toMatchObject({
            ok: true,
            command: {
                marginPayload: {
                    positionSide: 'BOTH',
                    direction: 'REMOVE',
                    amount: '40',
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
                // Unmarked means a person asked. The desk reads everything it
                // can find out for one of those, and only the orders and
                // positions a timer polls for when the timer says so.
                periodic: false,
            },
        });
    });

    // The distinction the backend cannot make for itself. Both asks arrive as
    // the same command, and on 2026-08-20 treating them alike cost the desk
    // both ways: the operator's press deferred at a figure that would not move,
    // then six requests every thirty seconds once it was not.
    it('carries whether a timer asked for the account or a person did', () => {
        expect(validateTypedTradingCommand({
            action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
            version: TRADE_COMMAND_VERSION,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'refresh-tick',
            symbol: 'BTCUSDT',
            periodic: true,
        }).command.periodic).toBe(true);
        // Never inferred from anything else, and never true by accident.
        for (const claimed of ['true', 1, {}, null]) {
            expect(validateTypedTradingCommand({
                action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
                version: TRADE_COMMAND_VERSION,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'refresh-odd',
                symbol: 'BTCUSDT',
                periodic: claimed,
            }).command.periodic).toBe(false);
        }
    });
});
