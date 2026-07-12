import { describe, expect, it } from 'vitest';
import {
    FUTURES_TESTNET_DECIMAL_ERROR_CODES,
    FuturesTestnetDecimalError,
    absoluteExactDecimal,
    addExactDecimals,
    compareBasisPointRatio,
    compareExactDecimals,
    decimalModulo,
    formatExactDecimal,
    isExactIncrement,
    multiplyExactDecimals,
    parseCanonicalUnsignedInteger,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
    subtractExactDecimals,
} from './futures-testnet-execution-decimal.js';

const expectDecimalError = (operation, code) => {
    try {
        operation();
        throw new Error('Expected exact-decimal validation to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(FuturesTestnetDecimalError);
        expect(error.code).toBe(code);
    }
};

describe('futures testnet exact decimal parsing', () => {
    it('preserves canonical transport strings and exposes bounded BigInt coefficients', () => {
        const decimal = parsePositiveExactDecimal('70000.000000000000000001');

        expect(decimal).toEqual({
            coefficient: 70000000000000000000001n,
            scale: 18,
            original: '70000.000000000000000001',
        });
        expect(Object.isFrozen(decimal)).toBe(true);
        expect(formatExactDecimal(decimal)).toBe('70000.000000000000000001');
    });

    it.each([
        '',
        ' ',
        '+1',
        '-1',
        '00',
        '01',
        '00.1',
        '.1',
        '1.',
        '1e1',
        '1E+1',
        '1_000',
        '1,000',
        'NaN',
        'Infinity',
        '0',
        '0.000000000000000000',
        '１',
    ])('rejects non-canonical positive decimal %j', (value) => {
        expectDecimalError(
            () => parsePositiveExactDecimal(value),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
    });

    it('rejects non-string values without invoking implicit coercion', () => {
        let coercions = 0;
        const value = {
            valueOf() {
                coercions += 1;
                return 1;
            },
            toString() {
                coercions += 1;
                return '1';
            },
        };

        expectDecimalError(
            () => parsePositiveExactDecimal(value),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
        expect(coercions).toBe(0);
    });

    it('accepts the exact 40-digit and 18-scale boundaries and rejects one unit beyond each', () => {
        const fortyDigits = '9'.repeat(40);
        const scaleEighteen = `0.${'0'.repeat(17)}1`;

        expect(parsePositiveExactDecimal(fortyDigits).coefficient).toBe(BigInt(fortyDigits));
        expect(parsePositiveExactDecimal(scaleEighteen).scale).toBe(18);

        expectDecimalError(
            () => parsePositiveExactDecimal('9'.repeat(41)),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
        );
        expectDecimalError(
            () => parsePositiveExactDecimal(`0.${'0'.repeat(18)}1`),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
        );
    });

    it('handles non-negative, signed, and absolute values without accepting signed zero', () => {
        expect(parseNonNegativeExactDecimal('0.000').coefficient).toBe(0n);
        const negative = parseSignedExactDecimal('-12.3400');
        expect(negative.coefficient).toBe(-123400n);
        expect(absoluteExactDecimal(negative)).toEqual({
            coefficient: 123400n,
            scale: 4,
            original: '12.3400',
        });

        for (const value of ['-0', '-0.0', '-0.000000000000000000']) {
            expectDecimalError(
                () => parseSignedExactDecimal(value),
                FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            );
        }
        expectDecimalError(
            () => parseSignedExactDecimal('0', { allowZero: false }),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
    });

    it('parses canonical bounded unsigned integer text without numeric coercion', () => {
        expect(parseCanonicalUnsignedInteger('0')).toBe(0n);
        expect(parseCanonicalUnsignedInteger('9007199254740993')).toBe(9007199254740993n);

        for (const value of ['', '00', '01', '-1', '+1', '1.0', '1e0', ' 1', '１']) {
            expectDecimalError(
                () => parseCanonicalUnsignedInteger(value),
                FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            );
        }
        expectDecimalError(
            () => parseCanonicalUnsignedInteger('123', { maxDigits: 2 }),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
        );
    });
});

describe('futures testnet exact decimal arithmetic', () => {
    it('aligns scales for comparison, addition, and subtraction exactly', () => {
        const one = parsePositiveExactDecimal('1');
        const oneScaled = parsePositiveExactDecimal('1.000000000000000000');
        const fractional = parsePositiveExactDecimal('0.000000000000000001');

        expect(compareExactDecimals(one, oneScaled)).toBe(0);
        expect(formatExactDecimal(addExactDecimals(one, fractional)))
            .toBe('1.000000000000000001');
        expect(formatExactDecimal(subtractExactDecimals(oneScaled, fractional)))
            .toBe('0.999999999999999999');
    });

    it('multiplies the maximum external digits and scales within a bounded derived value', () => {
        const left = parsePositiveExactDecimal(`${'9'.repeat(22)}.${'9'.repeat(18)}`);
        const right = parsePositiveExactDecimal(`${'8'.repeat(22)}.${'8'.repeat(18)}`);
        const product = multiplyExactDecimals(left, right);

        expect(product.scale).toBe(36);
        expect(product.coefficient.toString().length).toBe(80);
        expect(product.coefficient).toBe(left.coefficient * right.coefficient);
    });

    it('uses the minimum-relative modulo required for price ticks and quantity steps', () => {
        const minimum = parseNonNegativeExactDecimal('1.00');
        const increment = parsePositiveExactDecimal('0.05');

        expect(decimalModulo(
            parsePositiveExactDecimal('1.10'),
            increment,
            minimum,
        )).toBe(0n);
        expect(isExactIncrement(
            parsePositiveExactDecimal('1.15'),
            increment,
            minimum,
        )).toBe(true);
        expect(isExactIncrement(
            parsePositiveExactDecimal('1.151'),
            increment,
            minimum,
        )).toBe(false);
    });

    it('compares basis points by cross multiplication with equality passing exactly', () => {
        const denominator = parsePositiveExactDecimal('100.00000000');

        expect(compareBasisPointRatio(
            parseNonNegativeExactDecimal('10'),
            denominator,
            '1000',
        )).toBe(0);
        expect(compareBasisPointRatio(
            parseNonNegativeExactDecimal('9.99999999'),
            denominator,
            '1000',
        )).toBe(-1);
        expect(compareBasisPointRatio(
            parseNonNegativeExactDecimal('10.00000001'),
            denominator,
            '1000',
        )).toBe(1);
    });

    it('rejects forged operands, non-positive increments, and unbounded repeated products', () => {
        const one = parsePositiveExactDecimal('1');
        expectDecimalError(
            () => compareExactDecimals(one, { coefficient: 1n, scale: 0, original: '1' }),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
        );
        expectDecimalError(
            () => decimalModulo(one, parseNonNegativeExactDecimal('0')),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
        );

        const maximum = parsePositiveExactDecimal('9'.repeat(40));
        const product = multiplyExactDecimals(maximum, maximum);
        const boundedMaximum = multiplyExactDecimals(product, maximum);
        expectDecimalError(
            () => multiplyExactDecimals(boundedMaximum, maximum),
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
        );
    });

    it('is deterministic and does not mutate parsed operands', () => {
        const left = parsePositiveExactDecimal('123.4500');
        const right = parsePositiveExactDecimal('0.5500');
        const beforeLeft = { ...left };
        const beforeRight = { ...right };

        const first = addExactDecimals(left, right);
        const second = addExactDecimals(left, right);

        expect(first).toEqual(second);
        expect(left).toEqual(beforeLeft);
        expect(right).toEqual(beforeRight);
    });
});
