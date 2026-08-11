const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export class FuturesWorkstationDecimalError extends Error {
    constructor(code = 'INVALID_FUTURES_WORKSTATION_DECIMAL') {
        super('Futures workstation decimal value was rejected');
        this.name = 'FuturesWorkstationDecimalError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesWorkstationDecimalError(code);
};

export const parseFuturesWorkstationDecimal = (value) => {
    if (typeof value !== 'string' || value.length > 64 || !DECIMAL_PATTERN.test(value)) {
        fail('INVALID_FUTURES_WORKSTATION_DECIMAL');
    }
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = unsigned.split('.');
    const coefficient = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
    return Object.freeze({ coefficient, scale: fraction.length });
};

const scaleCoefficient = (decimal, scale) => (
    decimal.coefficient * (10n ** BigInt(scale - decimal.scale))
);

const formatCoefficient = (coefficient, scale) => {
    if (coefficient === 0n) return '0';
    const negative = coefficient < 0n;
    const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
    if (scale === 0) return `${negative ? '-' : ''}${digits}`;
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
};

export const normalizeFuturesWorkstationDecimal = (value) => {
    const decimal = parseFuturesWorkstationDecimal(value);
    return formatCoefficient(decimal.coefficient, decimal.scale);
};

export const compareFuturesWorkstationDecimals = (left, right) => {
    const a = parseFuturesWorkstationDecimal(left);
    const b = parseFuturesWorkstationDecimal(right);
    const scale = Math.max(a.scale, b.scale);
    const scaledA = scaleCoefficient(a, scale);
    const scaledB = scaleCoefficient(b, scale);
    return scaledA < scaledB ? -1 : scaledA > scaledB ? 1 : 0;
};

export const addFuturesWorkstationDecimals = (left, right) => {
    const a = parseFuturesWorkstationDecimal(left);
    const b = parseFuturesWorkstationDecimal(right);
    const scale = Math.max(a.scale, b.scale);
    return formatCoefficient(
        scaleCoefficient(a, scale) + scaleCoefficient(b, scale),
        scale,
    );
};

export const subtractFuturesWorkstationDecimals = (left, right) => {
    const a = parseFuturesWorkstationDecimal(left);
    const b = parseFuturesWorkstationDecimal(right);
    const scale = Math.max(a.scale, b.scale);
    return formatCoefficient(
        scaleCoefficient(a, scale) - scaleCoefficient(b, scale),
        scale,
    );
};

export const toFuturesWorkstationPercent = (value) => {
    const decimal = parseFuturesWorkstationDecimal(value);
    if (decimal.scale >= 2) {
        return formatCoefficient(decimal.coefficient, decimal.scale - 2);
    }
    return formatCoefficient(
        decimal.coefficient * (10n ** BigInt(2 - decimal.scale)),
        0,
    );
};

// Whether a value can be read as a decimal at all, for a caller that has to
// decide rather than fail. The predicates below answer a question *about* a
// decimal and raise on anything that is not one, which is right where the value
// arrived through a validator — and wrong on the delivery path, where an
// unreadable value means "no reading stated", not "stop sending the book".
export const isFuturesWorkstationDecimal = value => (
    typeof value === 'string' && value.length <= 64 && DECIMAL_PATTERN.test(value)
);

export const isPositiveFuturesWorkstationDecimal = value => (
    parseFuturesWorkstationDecimal(value).coefficient > 0n
);

export const isNonNegativeFuturesWorkstationDecimal = value => (
    parseFuturesWorkstationDecimal(value).coefficient >= 0n
);
