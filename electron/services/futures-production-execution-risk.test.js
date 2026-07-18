import { describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS,
    FUTURES_PRODUCTION_EXECUTION_RISK_CODES,
    FUTURES_PRODUCTION_EXECUTION_RISK_REASONS,
    evaluateFuturesProductionExecutionRisk,
} from './futures-production-execution-risk.js';

const fingerprint = 'a'.repeat(64);
const credentialBinding = 'b'.repeat(64);

const createInput = () => ({
    policy: {
        allowedSymbols: ['BTCUSDT'],
        maxLeverage: 2,
        maxOrderNotionalUsdt: '10',
        maxDailyNotionalUsdt: '50',
        minAvailableBalanceUsdt: '100',
        minLiquidationDistanceBps: '1000',
        killSwitchPolicy: 'v1-persistent-block-new-exposure',
    },
    identity: {
        environment: 'production',
        accountAlias: 'reviewed-main',
        apiKeyFingerprint: fingerprint,
        credentialBinding,
        generation: 'generation-1',
    },
    snapshot: {
        environment: 'production',
        accountAlias: 'reviewed-main',
        apiKeyFingerprint: fingerprint,
        credentialBinding,
        generation: 'generation-1',
        complete: true,
        fresh: true,
        clockRegressed: false,
        accountConfig: {
            canTrade: true,
            dualSidePosition: true,
            multiAssetsMargin: false,
        },
        symbolConfig: {
            symbol: 'BTCUSDT',
            marginType: 'ISOLATED',
            isAutoAddMargin: false,
            leverage: 2,
            maxNotionalValue: '1000000',
        },
        markPrice: {
            symbol: 'BTCUSDT',
            markPrice: '10.00',
        },
        position: {
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            positionAmt: '0',
            liquidationPrice: '0',
            marginAsset: 'USDT',
        },
        balance: {
            asset: 'USDT',
            availableBalance: '1000',
            marginAvailable: true,
        },
        exchangeInfo: {
            symbol: 'BTCUSDT',
            status: 'TRADING',
            contractType: 'PERPETUAL',
            quoteAsset: 'USDT',
            marginAsset: 'USDT',
            supportedOrderTypes: ['LIMIT', 'MARKET'],
            supportedTimeInForce: ['GTC'],
            priceFilter: {
                minPrice: '1',
                maxPrice: '1000000',
                tickSize: '0.01',
            },
            percentPriceFilter: {
                multiplierUp: '1.2',
                multiplierDown: '0.8',
            },
            lotSizeFilter: {
                minQty: '0.001',
                maxQty: '100',
                stepSize: '0.001',
            },
            minNotionalUsdt: '5',
            maxOpenOrders: 10,
        },
        regularOpenOrderCount: 0,
        algoOpenOrderCount: 0,
    },
    draft: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        positionSide: 'LONG',
        positionEffect: 'ENTRY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: '1',
        price: '10.00',
    },
    killSwitchEngaged: false,
    dailyNotionalUsed: '0',
});

describe('production Futures exact risk evaluator', () => {
    it.each([
        ['LONG entry', 'LONG', 'ENTRY', 'BUY', '0', '0', FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.OPENING],
        ['LONG exit', 'LONG', 'EXIT', 'SELL', '1', '5', FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING],
        ['SHORT entry', 'SHORT', 'ENTRY', 'SELL', '0', '0', FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.OPENING],
        ['SHORT exit', 'SHORT', 'EXIT', 'BUY', '-1', '15', FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING],
    ])('classifies the exact Hedge Mode matrix: %s', (
        _label,
        positionSide,
        positionEffect,
        side,
        positionAmt,
        liquidationPrice,
        classification,
    ) => {
        const input = createInput();
        input.snapshot.position.positionSide = positionSide;
        input.snapshot.position.positionAmt = positionAmt;
        input.snapshot.position.liquidationPrice = liquidationPrice;
        input.draft.positionSide = positionSide;
        input.draft.positionEffect = positionEffect;
        input.draft.side = side;
        expect(evaluateFuturesProductionExecutionRisk(input)).toMatchObject({
            ok: true,
            classification,
        });
    });

    it('accepts an exact-cap opening order and returns only backend classification facts', () => {
        const result = evaluateFuturesProductionExecutionRisk(createInput());
        expect(result).toEqual({
            ok: true,
            classification: FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.OPENING,
            notionalUsdt: '10.00',
            conservativePrice: '10.00',
            dailyNotionalBeforeUsdt: '0',
            dailyNotionalAfterUsdt: '10.00',
            observedLeverage: 2,
        });
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('keeps a verified reducing exit available at exhausted caps and distressed balance', () => {
        const reducing = createInput();
        reducing.policy.maxOrderNotionalUsdt = '1';
        reducing.snapshot.symbolConfig.maxNotionalValue = '1';
        reducing.snapshot.balance.availableBalance = '0';
        reducing.snapshot.position.positionAmt = '2';
        reducing.snapshot.position.liquidationPrice = '9.99';
        reducing.draft = {
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            type: 'MARKET',
            timeInForce: null,
            quantity: '1',
            price: null,
        };
        reducing.dailyNotionalUsed = '50';

        expect(evaluateFuturesProductionExecutionRisk(reducing)).toMatchObject({
            ok: true,
            classification: FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING,
            notionalUsdt: '10.00',
            dailyNotionalBeforeUsdt: '50',
            dailyNotionalAfterUsdt: '50',
        });
    });

    it('allows only a reducing exit from a legacy cross high-leverage leg', () => {
        const reducing = createInput();
        reducing.snapshot.symbolConfig.marginType = 'CROSSED';
        reducing.snapshot.symbolConfig.isAutoAddMargin = true;
        reducing.snapshot.symbolConfig.leverage = 20;
        reducing.snapshot.position.positionAmt = '2';
        reducing.draft = {
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '1',
            price: '10.00',
        };
        expect(evaluateFuturesProductionExecutionRisk(reducing)).toMatchObject({
            ok: true,
            classification: FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING,
            observedLeverage: 20,
        });

        const increasing = createInput();
        increasing.snapshot.symbolConfig.marginType = 'CROSSED';
        increasing.snapshot.symbolConfig.isAutoAddMargin = true;
        increasing.snapshot.symbolConfig.leverage = 20;
        increasing.snapshot.position.positionAmt = '2';
        expect(evaluateFuturesProductionExecutionRisk(increasing)).toMatchObject({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.SYMBOL_REJECTED,
        });
    });

    it('uses max(limit, mark) and rejects one exact unit over the order cap', () => {
        const equality = createInput();
        equality.draft.price = '9.99';
        expect(evaluateFuturesProductionExecutionRisk(equality)).toMatchObject({
            ok: true,
            notionalUsdt: '10.00',
            conservativePrice: '10.00',
        });

        const over = createInput();
        over.draft.price = '10.01';
        expect(evaluateFuturesProductionExecutionRisk(over)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_NOTIONAL_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.MAXIMUM_ORDER_NOTIONAL,
        });
    });

    it('passes exact daily equality and rejects one exact unit over without mutation', () => {
        const equality = createInput();
        equality.dailyNotionalUsed = '40';
        const before = structuredClone(equality);
        expect(evaluateFuturesProductionExecutionRisk(equality)).toMatchObject({
            ok: true,
            dailyNotionalAfterUsdt: '50.00',
        });
        expect(equality).toEqual(before);

        const over = createInput();
        over.dailyNotionalUsed = '40.01';
        expect(evaluateFuturesProductionExecutionRisk(over)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.DAILY_NOTIONAL_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.MAXIMUM_DAILY_NOTIONAL,
        });
    });

    it('keeps the exact post-margin balance reserve and rejects one smallest unit below', () => {
        const equality = createInput();
        equality.snapshot.balance.availableBalance = '105.00000000';
        expect(evaluateFuturesProductionExecutionRisk(equality)).toMatchObject({ ok: true });

        const above = createInput();
        above.snapshot.balance.availableBalance = '105.00000001';
        expect(evaluateFuturesProductionExecutionRisk(above)).toMatchObject({ ok: true });

        const below = createInput();
        below.snapshot.balance.availableBalance = '104.99999999';
        expect(evaluateFuturesProductionExecutionRisk(below)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.BALANCE_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.AVAILABLE_BALANCE,
        });
    });

    it('classifies increasing and rejects a side/effect mismatch before exposure evaluation', () => {
        const increasing = createInput();
        increasing.snapshot.position.positionAmt = '2';
        increasing.snapshot.position.liquidationPrice = '5';
        expect(evaluateFuturesProductionExecutionRisk(increasing)).toMatchObject({
            ok: true,
            classification: FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.INCREASING,
        });

        const ambiguous = createInput();
        ambiguous.snapshot.position.positionAmt = '2';
        ambiguous.snapshot.position.liquidationPrice = '5';
        ambiguous.draft.side = 'SELL';
        expect(evaluateFuturesProductionExecutionRisk(ambiguous)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.ORDER_SCHEMA,
        });
    });

    it('blocks exposure while the kill switch is engaged but permits exact reductions', () => {
        const blocked = createInput();
        blocked.killSwitchEngaged = true;
        expect(evaluateFuturesProductionExecutionRisk(blocked)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.KILL_SWITCH_BLOCKED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.KILL_SWITCH,
        });

        const reducing = createInput();
        reducing.killSwitchEngaged = true;
        reducing.snapshot.position.positionAmt = '2';
        reducing.snapshot.position.liquidationPrice = '5';
        reducing.draft = {
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            type: 'MARKET',
            timeInForce: null,
            quantity: '1',
            price: null,
        };
        expect(evaluateFuturesProductionExecutionRisk(reducing)).toMatchObject({
            ok: true,
            classification: FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING,
            notionalUsdt: '10.00',
        });
    });

    it.each([
        ['zero LONG leg', 'LONG', '0', 'SELL', '1'],
        ['over LONG exit', 'LONG', '2', 'SELL', '2.001'],
        ['wrong-sign SHORT leg', 'SHORT', '2', 'BUY', '1'],
    ])('rejects ambiguous Hedge Mode exit classification: %s', (
        _label,
        positionSide,
        amount,
        side,
        quantity,
    ) => {
        const input = createInput();
        input.snapshot.position.positionAmt = amount;
        input.snapshot.position.positionSide = positionSide;
        input.snapshot.position.liquidationPrice = amount === '0' ? '0' : '5';
        input.draft.side = side;
        input.draft.positionSide = positionSide;
        input.draft.positionEffect = 'EXIT';
        input.draft.quantity = quantity;
        expect(evaluateFuturesProductionExecutionRisk(input)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.CLASSIFICATION_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.EXPOSURE_AMBIGUOUS,
        });
    });

    it('requires exactly isolated 2x even when the exchange permits another leverage', () => {
        const input = createInput();
        input.snapshot.symbolConfig.leverage = 1;
        expect(evaluateFuturesProductionExecutionRisk(input)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.LEVERAGE_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.LEVERAGE_STATE,
        });
    });

    it('uses exact price, percent-price, lot-size, and minimum-notional filters', () => {
        const badTick = createInput();
        badTick.draft.price = '10.001';
        expect(evaluateFuturesProductionExecutionRisk(badTick)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.PRICE_FILTER,
        });

        const badStep = createInput();
        badStep.draft.quantity = '1.0005';
        expect(evaluateFuturesProductionExecutionRisk(badStep)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.QUANTITY_FILTER,
        });

        const tooSmall = createInput();
        tooSmall.draft.quantity = '0.001';
        expect(evaluateFuturesProductionExecutionRisk(tooSmall)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_NOTIONAL_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.MINIMUM_NOTIONAL,
        });

        const outsidePercent = createInput();
        outsidePercent.draft.price = '12.01';
        outsidePercent.draft.quantity = '0.5';
        expect(evaluateFuturesProductionExecutionRisk(outsidePercent)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.PRICE_FILTER,
        });
    });

    it('passes exact liquidation-distance equality and rejects one unit inside', () => {
        const equality = createInput();
        equality.snapshot.position.positionAmt = '1';
        equality.snapshot.position.liquidationPrice = '9';
        expect(evaluateFuturesProductionExecutionRisk(equality)).toMatchObject({ ok: true });

        const inside = createInput();
        inside.snapshot.position.positionAmt = '1';
        inside.snapshot.position.liquidationPrice = '9.00000001';
        expect(evaluateFuturesProductionExecutionRisk(inside)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.LIQUIDATION_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
        });
    });

    it.each([
        ['missing long liquidation', '1', '0'],
        ['wrong-side long liquidation', '1', '11'],
        ['wrong-side short liquidation', '-1', '9'],
    ])('rejects unsafe %s state', (_label, positionAmt, liquidationPrice) => {
        const input = createInput();
        input.snapshot.position.positionAmt = positionAmt;
        input.snapshot.position.liquidationPrice = liquidationPrice;
        if (positionAmt.startsWith('-')) {
            input.snapshot.position.positionSide = 'SHORT';
            input.draft.positionSide = 'SHORT';
            input.draft.side = 'SELL';
        }
        expect(evaluateFuturesProductionExecutionRisk(input)).toEqual({
            ok: false,
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.LIQUIDATION_REJECTED,
            reason: FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
        });
    });

    it.each([
        ['canTrade', input => { input.snapshot.accountConfig.canTrade = false; }],
        ['one-way mode', input => { input.snapshot.accountConfig.dualSidePosition = false; }],
        ['multi asset', input => { input.snapshot.accountConfig.multiAssetsMargin = true; }],
        ['cross margin', input => { input.snapshot.symbolConfig.marginType = 'CROSSED'; }],
        ['auto add', input => { input.snapshot.symbolConfig.isAutoAddMargin = true; }],
        ['identity', input => { input.snapshot.credentialBinding = 'c'.repeat(64); }],
        ['stale', input => { input.snapshot.fresh = false; }],
        ['clock regression', input => { input.snapshot.clockRegressed = true; }],
    ])('fails closed on invalid %s state', (_label, mutate) => {
        const input = createInput();
        mutate(input);
        expect(evaluateFuturesProductionExecutionRisk(input).ok).toBe(false);
    });

    it('rejects invalid hard policy, accessor fields, extra fields, and numeric decimals', () => {
        const overHardLimit = createInput();
        overHardLimit.policy.maxOrderNotionalUsdt = '10.000000000000000001';
        expect(evaluateFuturesProductionExecutionRisk(overHardLimit)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.POLICY_REJECTED,
        });

        const accessor = createInput();
        Object.defineProperty(accessor.policy, 'maxLeverage', {
            enumerable: true,
            get: () => 2,
        });
        expect(evaluateFuturesProductionExecutionRisk(accessor)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.POLICY_REJECTED,
        });

        const expanded = { ...createInput(), retry: 1 };
        expect(evaluateFuturesProductionExecutionRisk(expanded)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.INVALID_INPUT,
        });

        const numeric = createInput();
        numeric.dailyNotionalUsed = 0;
        expect(evaluateFuturesProductionExecutionRisk(numeric)).toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
        });
    });

    it('is deterministic across concurrent callers and never shares mutable state', async () => {
        const inputs = Array.from({ length: 32 }, () => createInput());
        const results = await Promise.all(inputs.map(async input => (
            evaluateFuturesProductionExecutionRisk(input)
        )));
        expect(new Set(results.map(result => JSON.stringify(result))).size).toBe(1);
        expect(results.every(result => result.ok)).toBe(true);
    });
});
