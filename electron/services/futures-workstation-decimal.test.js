import { describe, expect, it } from 'vitest';
import {
    FuturesWorkstationDecimalError,
    addFuturesWorkstationDecimals,
    compareFuturesWorkstationDecimals,
    isFuturesWorkstationDecimal,
    normalizeFuturesWorkstationDecimal,
    subtractFuturesWorkstationDecimals,
    toFuturesWorkstationPercent,
} from './futures-workstation-decimal.js';

describe('Futures workstation exact decimal arithmetic', () => {
    it.each([
        ['1.2300', '1.23'],
        ['0.00000000', '0'],
        ['-0.2500', '-0.25'],
        ['900719925474099312345.0001', '900719925474099312345.0001'],
    ])('normalizes %s without binary floating point', (input, expected) => {
        expect(normalizeFuturesWorkstationDecimal(input)).toBe(expected);
    });

    it('adds and subtracts values beyond Number precision exactly', () => {
        expect(addFuturesWorkstationDecimals('900719925474099312345.1', '0.2'))
            .toBe('900719925474099312345.3');
        expect(subtractFuturesWorkstationDecimals('900719925474099312345.3', '0.2'))
            .toBe('900719925474099312345.1');
    });

    it('compares different scales exactly', () => {
        expect(compareFuturesWorkstationDecimals('1.0000000000000001', '1')).toBe(1);
        expect(compareFuturesWorkstationDecimals('0.9999999999999999', '1')).toBe(-1);
        expect(compareFuturesWorkstationDecimals('1.0', '1.000')).toBe(0);
    });

    it.each([
        ['-0.0001', '-0.01'],
        ['0.00012500', '0.0125'],
        ['0', '0'],
        ['0.1', '10'],
        ['900719925474099312345.0001', '90071992547409931234500.01'],
    ])('converts funding fraction %s to exact percent %s', (input, expected) => {
        expect(toFuturesWorkstationPercent(input)).toBe(expected);
    });

    it.each(['01', '.1', '1.', '1e3', 'NaN', '', ' 1', '+1'])(
        'rejects noncanonical decimal %s',
        (value) => expect(() => normalizeFuturesWorkstationDecimal(value))
            .toThrow(FuturesWorkstationDecimalError),
    );

    // For a caller that has to decide rather than fail: on the delivery path an
    // unreadable range means "no reading stated", not "stop sending the book".
    it('answers whether a value is a decimal without raising on one that is not', () => {
        for (const value of ['0', '-1.5', '900719925474099312345.0001']) {
            expect(isFuturesWorkstationDecimal(value)).toBe(true);
        }
        for (const value of ['01', '1e3', '', ' 1', '9'.repeat(65), null, undefined, 5, {}]) {
            expect(isFuturesWorkstationDecimal(value)).toBe(false);
        }
    });
});
