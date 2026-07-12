export const FUTURES_TESTNET_DECIMAL_LIMITS = Object.freeze({
    MAX_DIGITS: 40,
    MAX_SCALE: 18,
    MAX_BYTES: 42,
});

export const FUTURES_TESTNET_DECIMAL_ERROR_CODES = Object.freeze({
    INVALID_VALUE: 'FUTURES_TESTNET_DECIMAL_INVALID_VALUE',
    LIMIT_EXCEEDED: 'FUTURES_TESTNET_DECIMAL_LIMIT_EXCEEDED',
    INVALID_OPERATION: 'FUTURES_TESTNET_DECIMAL_INVALID_OPERATION',
});

export class FuturesTestnetDecimalError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesTestnetDecimalError';
        this.code = code;
    }
}

const INTERNAL_MAX_SCALE = FUTURES_TESTNET_DECIMAL_LIMITS.MAX_SCALE * 2;
const INTERNAL_MAX_COEFFICIENT_DIGITS = FUTURES_TESTNET_DECIMAL_LIMITS.MAX_DIGITS * 3;
const BASIS_POINT_DENOMINATOR = 10000n;
const MAX_SAFE_INTEGER = 9007199254740991;
const decimalValues = new WeakSet();

const decimalError = (code, message) => new FuturesTestnetDecimalError(code, message);

const isAsciiDigit = (character) => character >= '0' && character <= '9';

const absoluteCoefficient = (coefficient) => (
    coefficient < 0n ? -coefficient : coefficient
);

const coefficientDigitCount = (coefficient) => (
    absoluteCoefficient(coefficient).toString().length
);

const isSafeIntegerValue = (value) => (
    typeof value === 'number'
    && value >= -MAX_SAFE_INTEGER
    && value <= MAX_SAFE_INTEGER
    && value % 1 === 0
);

const formatCoefficient = (coefficient, scale) => {
    const negative = coefficient < 0n;
    const digits = absoluteCoefficient(coefficient).toString();
    let unsigned;

    if (scale === 0) {
        unsigned = digits;
    } else if (digits.length <= scale) {
        unsigned = `0.${'0'.repeat(scale - digits.length)}${digits}`;
    } else {
        const splitAt = digits.length - scale;
        unsigned = `${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
    }

    return negative ? `-${unsigned}` : unsigned;
};

const createDecimal = (coefficient, scale, original = null) => {
    if (typeof coefficient !== 'bigint'
        || !isSafeIntegerValue(scale)
        || scale < 0
        || scale > INTERNAL_MAX_SCALE
        || coefficientDigitCount(coefficient) > INTERNAL_MAX_COEFFICIENT_DIGITS) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Exact decimal operation exceeds its bounded representation',
        );
    }

    const value = Object.freeze({
        coefficient,
        scale,
        original: original ?? formatCoefficient(coefficient, scale),
    });
    decimalValues.add(value);
    return value;
};

const requireDecimal = (value) => {
    if ((typeof value !== 'object' && typeof value !== 'function')
        || value === null
        || !decimalValues.has(value)) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Exact decimal operations require parsed decimal values',
        );
    }
    return value;
};

const powerOfTen = (exponent) => {
    if (!isSafeIntegerValue(exponent) || exponent < 0 || exponent > INTERNAL_MAX_SCALE) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Exact decimal scale alignment exceeds its bounded range',
        );
    }
    return 10n ** BigInt(exponent);
};

const alignPair = (leftValue, rightValue) => {
    const left = requireDecimal(leftValue);
    const right = requireDecimal(rightValue);
    const scale = left.scale >= right.scale ? left.scale : right.scale;
    return {
        left: left.coefficient * powerOfTen(scale - left.scale),
        right: right.coefficient * powerOfTen(scale - right.scale),
        scale,
    };
};

const parseDecimal = (value, { signed, allowZero }) => {
    if (typeof value !== 'string' || value.length === 0) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact decimal must be a non-empty ASCII string',
        );
    }
    if (value.length > FUTURES_TESTNET_DECIMAL_LIMITS.MAX_BYTES) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
            'Exact decimal exceeds the byte limit',
        );
    }

    let cursor = 0;
    let negative = false;
    if (value[cursor] === '-') {
        if (!signed) {
            throw decimalError(
                FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
                'Exact decimal sign is not allowed',
            );
        }
        negative = true;
        cursor += 1;
    } else if (value[cursor] === '+') {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact decimal plus signs are not allowed',
        );
    }

    const integerStart = cursor;
    while (cursor < value.length && isAsciiDigit(value[cursor])) cursor += 1;
    const integerPart = value.slice(integerStart, cursor);
    if (integerPart.length === 0
        || (integerPart.length > 1 && integerPart[0] === '0')) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact decimal integer digits are not canonical',
        );
    }

    let fractionalPart = '';
    if (value[cursor] === '.') {
        cursor += 1;
        const fractionStart = cursor;
        while (cursor < value.length && isAsciiDigit(value[cursor])) cursor += 1;
        fractionalPart = value.slice(fractionStart, cursor);
        if (fractionalPart.length === 0) {
            throw decimalError(
                FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
                'Exact decimal point must be followed by digits',
            );
        }
    }

    if (cursor !== value.length) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact decimal contains unsupported characters',
        );
    }

    const digitCount = integerPart.length + fractionalPart.length;
    if (digitCount > FUTURES_TESTNET_DECIMAL_LIMITS.MAX_DIGITS
        || fractionalPart.length > FUTURES_TESTNET_DECIMAL_LIMITS.MAX_SCALE) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
            'Exact decimal exceeds its digit or scale limit',
        );
    }

    let coefficient = BigInt(`${integerPart}${fractionalPart}`);
    if (negative) coefficient = -coefficient;
    if (negative && coefficient === 0n) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact decimal negative zero is not canonical',
        );
    }
    if (!allowZero && coefficient === 0n) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact decimal must be greater than zero',
        );
    }

    return createDecimal(coefficient, fractionalPart.length, value);
};

export const parsePositiveExactDecimal = (value) => parseDecimal(value, {
    signed: false,
    allowZero: false,
});

export const parseNonNegativeExactDecimal = (value) => parseDecimal(value, {
    signed: false,
    allowZero: true,
});

export const parseSignedExactDecimal = (value, { allowZero = true } = {}) => (
    parseDecimal(value, { signed: true, allowZero })
);

export const parseCanonicalUnsignedInteger = (value, { maxDigits = 40 } = {}) => {
    if (typeof value !== 'string'
        || !isSafeIntegerValue(maxDigits)
        || maxDigits < 1
        || maxDigits > FUTURES_TESTNET_DECIMAL_LIMITS.MAX_DIGITS
        || value.length === 0
        || value.length > maxDigits
        || (value.length > 1 && value[0] === '0')
        || [...value].some((character) => !isAsciiDigit(character))) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Exact integer text is not canonical or exceeds its limit',
        );
    }
    return BigInt(value);
};

export const compareExactDecimals = (left, right) => {
    const aligned = alignPair(left, right);
    if (aligned.left < aligned.right) return -1;
    if (aligned.left > aligned.right) return 1;
    return 0;
};

export const addExactDecimals = (left, right) => {
    const aligned = alignPair(left, right);
    return createDecimal(aligned.left + aligned.right, aligned.scale);
};

export const subtractExactDecimals = (left, right) => {
    const aligned = alignPair(left, right);
    return createDecimal(aligned.left - aligned.right, aligned.scale);
};

export const multiplyExactDecimals = (leftValue, rightValue) => {
    const left = requireDecimal(leftValue);
    const right = requireDecimal(rightValue);
    return createDecimal(
        left.coefficient * right.coefficient,
        left.scale + right.scale,
    );
};

export const absoluteExactDecimal = (value) => {
    const decimal = requireDecimal(value);
    if (decimal.coefficient >= 0n) return decimal;
    return createDecimal(-decimal.coefficient, decimal.scale, decimal.original.slice(1));
};

export const maxExactDecimal = (left, right) => (
    compareExactDecimals(left, right) >= 0 ? requireDecimal(left) : requireDecimal(right)
);

export const decimalModulo = (value, increment, offset = null) => {
    const decimal = requireDecimal(value);
    const step = requireDecimal(increment);
    const origin = offset === null ? createDecimal(0n, 0, '0') : requireDecimal(offset);
    if (step.coefficient <= 0n) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Exact decimal increment must be greater than zero',
        );
    }

    const valueAndOrigin = alignPair(decimal, origin);
    const difference = createDecimal(
        valueAndOrigin.left - valueAndOrigin.right,
        valueAndOrigin.scale,
    );
    const differenceAndStep = alignPair(difference, step);
    return differenceAndStep.left % differenceAndStep.right;
};

export const isExactIncrement = (value, increment, offset = null) => (
    decimalModulo(value, increment, offset) === 0n
);

export const compareBasisPointRatio = (numeratorValue, denominatorValue, basisPoints) => {
    const numerator = requireDecimal(numeratorValue);
    const denominator = requireDecimal(denominatorValue);
    const bps = parseCanonicalUnsignedInteger(basisPoints, { maxDigits: 5 });
    if (numerator.coefficient < 0n || denominator.coefficient <= 0n) {
        throw decimalError(
            FUTURES_TESTNET_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Basis-point comparison requires a non-negative numerator and positive denominator',
        );
    }

    const left = createDecimal(
        numerator.coefficient * BASIS_POINT_DENOMINATOR,
        numerator.scale,
    );
    const right = createDecimal(
        denominator.coefficient * bps,
        denominator.scale,
    );
    return compareExactDecimals(left, right);
};

export const isZeroExactDecimal = (value) => requireDecimal(value).coefficient === 0n;

export const isPositiveExactDecimal = (value) => requireDecimal(value).coefficient > 0n;

export const formatExactDecimal = (value) => requireDecimal(value).original;
