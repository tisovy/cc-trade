export const FUTURES_PRODUCTION_DECIMAL_LIMITS = Object.freeze({
    MAX_DIGITS: 40,
    MAX_SCALE: 18,
    MAX_BYTES: 42,
});

export const FUTURES_PRODUCTION_DECIMAL_ERROR_CODES = Object.freeze({
    INVALID_VALUE: 'FUTURES_PRODUCTION_DECIMAL_INVALID_VALUE',
    LIMIT_EXCEEDED: 'FUTURES_PRODUCTION_DECIMAL_LIMIT_EXCEEDED',
    INVALID_OPERATION: 'FUTURES_PRODUCTION_DECIMAL_INVALID_OPERATION',
});

export class FuturesProductionDecimalError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesProductionDecimalError';
        this.code = code;
    }
}

const INTERNAL_MAX_SCALE = FUTURES_PRODUCTION_DECIMAL_LIMITS.MAX_SCALE * 2;
const INTERNAL_MAX_COEFFICIENT_DIGITS = FUTURES_PRODUCTION_DECIMAL_LIMITS.MAX_DIGITS * 3;
const BASIS_POINT_DENOMINATOR = 10000n;
const MAX_SAFE_INTEGER = 9007199254740991;
const decimalValues = new WeakSet();

const fail = (code, message) => {
    throw new FuturesProductionDecimalError(code, message);
};

const isSafeInteger = (value) => (
    typeof value === 'number'
    && value >= -MAX_SAFE_INTEGER
    && value <= MAX_SAFE_INTEGER
    && value % 1 === 0
    && !Object.is(value, -0)
);

const absoluteCoefficient = (coefficient) => (
    coefficient < 0n ? -coefficient : coefficient
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
        || !isSafeInteger(scale)
        || scale < 0
        || scale > INTERNAL_MAX_SCALE
        || absoluteCoefficient(coefficient).toString().length
            > INTERNAL_MAX_COEFFICIENT_DIGITS) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Production exact decimal operation exceeds its bounded representation',
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
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Production exact decimal operations require parsed values',
        );
    }
    return value;
};

const powerOfTen = (exponent) => {
    if (!isSafeInteger(exponent) || exponent < 0 || exponent > INTERNAL_MAX_SCALE) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Production exact decimal scale alignment exceeds its bound',
        );
    }
    return 10n ** BigInt(exponent);
};

const alignPair = (leftValue, rightValue) => {
    const left = requireDecimal(leftValue);
    const right = requireDecimal(rightValue);
    const scale = Math.max(left.scale, right.scale);
    return {
        left: left.coefficient * powerOfTen(scale - left.scale),
        right: right.coefficient * powerOfTen(scale - right.scale),
        scale,
    };
};

const parseDecimal = (value, { signed, allowZero }) => {
    if (typeof value !== 'string' || value.length === 0) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact decimal must be a non-empty ASCII string',
        );
    }
    if (Buffer.byteLength(value, 'utf8') > FUTURES_PRODUCTION_DECIMAL_LIMITS.MAX_BYTES) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
            'Production exact decimal exceeds its byte bound',
        );
    }

    let cursor = 0;
    let negative = false;
    if (value[cursor] === '-') {
        if (!signed) {
            fail(
                FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
                'Production exact decimal sign is not allowed',
            );
        }
        negative = true;
        cursor += 1;
    } else if (value[cursor] === '+') {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact decimal plus sign is not canonical',
        );
    }

    const integerStart = cursor;
    while (value[cursor] >= '0' && value[cursor] <= '9') cursor += 1;
    const integerPart = value.slice(integerStart, cursor);
    if (integerPart.length === 0 || (integerPart.length > 1 && integerPart[0] === '0')) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact decimal integer digits are not canonical',
        );
    }

    let fractionalPart = '';
    if (value[cursor] === '.') {
        cursor += 1;
        const fractionStart = cursor;
        while (value[cursor] >= '0' && value[cursor] <= '9') cursor += 1;
        fractionalPart = value.slice(fractionStart, cursor);
        if (fractionalPart.length === 0) {
            fail(
                FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
                'Production exact decimal point requires fractional digits',
            );
        }
    }
    if (cursor !== value.length) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact decimal contains unsupported characters',
        );
    }

    const digitCount = integerPart.length + fractionalPart.length;
    if (digitCount > FUTURES_PRODUCTION_DECIMAL_LIMITS.MAX_DIGITS
        || fractionalPart.length > FUTURES_PRODUCTION_DECIMAL_LIMITS.MAX_SCALE) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.LIMIT_EXCEEDED,
            'Production exact decimal exceeds its digit or scale bound',
        );
    }

    let coefficient = BigInt(`${integerPart}${fractionalPart}`);
    if (negative) coefficient = -coefficient;
    if (negative && coefficient === 0n) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact decimal negative zero is not canonical',
        );
    }
    if (!allowZero && coefficient === 0n) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact decimal must be greater than zero',
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
        || !isSafeInteger(maxDigits)
        || maxDigits < 1
        || maxDigits > FUTURES_PRODUCTION_DECIMAL_LIMITS.MAX_DIGITS
        || value.length === 0
        || value.length > maxDigits
        || (value.length > 1 && value[0] === '0')
        || [...value].some((character) => character < '0' || character > '9')) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_VALUE,
            'Production exact integer is not canonical or exceeds its bound',
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
    return createDecimal(left.coefficient * right.coefficient, left.scale + right.scale);
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
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Production exact decimal increment must be positive',
        );
    }
    const alignedValue = alignPair(decimal, origin);
    const difference = createDecimal(
        alignedValue.left - alignedValue.right,
        alignedValue.scale,
    );
    const alignedStep = alignPair(difference, step);
    return alignedStep.left % alignedStep.right;
};

export const isExactIncrement = (value, increment, offset = null) => (
    decimalModulo(value, increment, offset) === 0n
);

export const compareBasisPointRatio = (numeratorValue, denominatorValue, basisPoints) => {
    const numerator = requireDecimal(numeratorValue);
    const denominator = requireDecimal(denominatorValue);
    const bps = parseCanonicalUnsignedInteger(basisPoints, { maxDigits: 5 });
    if (numerator.coefficient < 0n || denominator.coefficient <= 0n) {
        fail(
            FUTURES_PRODUCTION_DECIMAL_ERROR_CODES.INVALID_OPERATION,
            'Production basis-point comparison requires non-negative/positive operands',
        );
    }
    return compareExactDecimals(
        createDecimal(numerator.coefficient * BASIS_POINT_DENOMINATOR, numerator.scale),
        createDecimal(denominator.coefficient * bps, denominator.scale),
    );
};

export const isZeroExactDecimal = (value) => requireDecimal(value).coefficient === 0n;

export const isPositiveExactDecimal = (value) => requireDecimal(value).coefficient > 0n;

export const formatExactDecimal = (value) => requireDecimal(value).original;
