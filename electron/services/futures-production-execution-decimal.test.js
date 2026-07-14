import { describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_DECIMAL_ERROR_CODES,
    FuturesProductionDecimalError,
    addExactDecimals,
    compareBasisPointRatio,
    compareExactDecimals,
    formatExactDecimal,
    isExactIncrement,
    multiplyExactDecimals,
    parseCanonicalUnsignedInteger,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
} from './futures-production-execution-decimal.js';

const expectDecimalError = (operation, code) => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(FuturesProductionDecimalError);
        expect(error.code).toBe(code);
        return;
    }
    throw new Error('Expected production exact-decimal validation to fail');
};

describe('production futures exact decimals', () => {
    it('preserves exact transport text with bounded BigInt coefficients', () => {
        const value = parsePositiveExactDecimal('10000.000000000000000001');
        expect(value).toEqual({
            coefficient: 10000000000000000000001n,
            scale: 18,
            original: '10000.000000000000000001',
        });
        expect(formatExactDecimal(value)).toBe('10000.000000000000000001');
        expect(Object.isFrozen(value)).toBe(true);
    });

    it.each([
        '', ' ', '+1', '-1', '00', '01', '.1', '1.', '1e1', '1_000', 'NaN',
        'Infinity', '0', '0.000000000000000000', '１',
    ])('rejects non-canonical positive input %j', (value) => {
        expectDecimalError(
            () => parsePositiveExactDecimal(value),
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
    });

    it('does not coerce hostile inputs', () => {
        let coercions = 0;
        const value = {
            toString() {
                coercions += 1;
                return '1';
            },
            valueOf() {
                coercions += 1;
                return 1;
            },
        };
        expectDecimalError(
            () => parsePositiveExactDecimal(value),
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
        expect(coercions).toBe(0);
    });

    it('accepts exact digit and scale boundaries and rejects one unit over', () => {
        expect(parsePositiveExactDecimal('9'.repeat(40)).coefficient)
            .toBe(BigInt('9'.repeat(40)));
        expect(parsePositiveExactDecimal(`0.${'0'.repeat(17)}1`).scale).toBe(18);
        expectDecimalError(
            () => parsePositiveExactDecimal('9'.repeat(41)),
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
        );
        expectDecimalError(
            () => parsePositiveExactDecimal(`0.${'0'.repeat(18)}1`),
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
        );
    });

    it('handles non-negative and signed positions without signed zero', () => {
        expect(parseNonNegativeExactDecimal('0.000').coefficient).toBe(0n);
        expect(parseSignedExactDecimal('-12.3400')).toMatchObject({
            coefficient: -123400n,
            scale: 4,
        });
        expectDecimalError(
            () => parseSignedExactDecimal('-0.0'),
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
    });

    it('aligns cap values and computes conservative notionals exactly', () => {
        const configuredCap = parsePositiveExactDecimal('10000');
        const exactBoundary = multiplyExactDecimals(
            parsePositiveExactDecimal('0.125'),
            parsePositiveExactDecimal('80000'),
        );
        const oneUnitOver = addExactDecimals(
            exactBoundary,
            parsePositiveExactDecimal('0.000000000000000001'),
        );
        expect(compareExactDecimals(exactBoundary, configuredCap)).toBe(0);
        expect(compareExactDecimals(oneUnitOver, configuredCap)).toBe(1);
    });

    it('validates exact steps and basis-point equality by integer arithmetic', () => {
        expect(isExactIncrement(
            parsePositiveExactDecimal('60000.15'),
            parsePositiveExactDecimal('0.05'),
            parseNonNegativeExactDecimal('0'),
        )).toBe(true);
        expect(compareBasisPointRatio(
            parseNonNegativeExactDecimal('10'),
            parsePositiveExactDecimal('100'),
            '1000',
        )).toBe(0);
    });

    it('keeps exchange int64 values lossless and rejects forged operands', () => {
        expect(parseCanonicalUnsignedInteger('9223372036854775807'))
            .toBe(9223372036854775807n);
        expectDecimalError(
            () => compareExactDecimals(
                parsePositiveExactDecimal('1'),
                { coefficient: 1n, scale: 0, original: '1' },
            ),
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_OPERATION,
        );
    });
});
