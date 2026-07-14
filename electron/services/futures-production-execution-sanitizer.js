const SENSITIVE_KEY = /(?:^|[-_.])(authorization|cookie|api[-_]?key|api[-_]?secret|secret|signature|signed(?:url|body)?|headers?|config|request|response|cause|stack|proxy|dispatcher|agent|credential|recovery[-_]?authorization)(?:$|[-_.])/i;
const SIGNED_VALUE_PATTERN = /((?:signature|x-mbx-apikey|authorization)\s*(?:=|:)\s*)[^&\s,;]+/gi;
const URL_QUERY_PATTERN = /(https:\/\/[^\s?]+)\?[^\s]+/gi;
const MAX_TEXT_BYTES = 4_096;
const MAX_KEYS = 64;
const MAX_DEPTH = 5;
const MAX_SECRET_VALUES = 32;
const MAX_SECRET_BYTES = 1_024;

const utf8Length = value => Buffer.byteLength(value, 'utf8');

const truncateUtf8 = (value) => {
    if (utf8Length(value) <= MAX_TEXT_BYTES) return value;
    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (utf8Length(value.slice(0, middle)) <= MAX_TEXT_BYTES - 12) low = middle;
        else high = middle - 1;
    }
    return `${value.slice(0, low)}[truncated]`;
};

const deriveNeedles = (values) => {
    const needles = new Set();
    for (const value of values) {
        if (typeof value !== 'string' || value.length === 0) continue;
        if (utf8Length(value) > MAX_SECRET_BYTES) continue;
        needles.add(value);
        needles.add(encodeURIComponent(value));
        needles.add(Buffer.from(value, 'utf8').toString('base64'));
        needles.add(Buffer.from(value, 'utf8').toString('hex'));
        if (needles.size >= MAX_SECRET_VALUES * 4) break;
    }
    return [...needles]
        .filter(value => value.length > 0)
        .sort((left, right) => right.length - left.length);
};

export const createFuturesProductionExecutionSanitizer = (initialSecretValues = []) => {
    let secretValues = [];
    let needles = [];

    const addSecretValues = (values) => {
        if (!Array.isArray(values)) return false;
        secretValues = [...new Set([...secretValues, ...values]
            .filter(value => typeof value === 'string' && value.length > 0))]
            .slice(-MAX_SECRET_VALUES);
        needles = deriveNeedles(secretValues);
        return true;
    };
    addSecretValues(initialSecretValues);

    const sanitizeText = (value) => {
        let result;
        try {
            result = String(value);
        } catch {
            return '[redacted]';
        }
        for (const needle of needles) result = result.split(needle).join('[redacted]');
        result = result
            .replace(SIGNED_VALUE_PATTERN, '$1[redacted]')
            .replace(URL_QUERY_PATTERN, '$1?[redacted]');
        return truncateUtf8(result);
    };

    const sanitize = (value, depth = 0, seen = new WeakSet()) => {
        if (typeof value === 'string') return sanitizeText(value);
        if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'symbol' || typeof value === 'function' || value === undefined) {
            return '[redacted]';
        }
        if (value instanceof Error) {
            const code = typeof value.code === 'string' || typeof value.code === 'number'
                ? sanitizeText(value.code)
                : null;
            return Object.freeze({
                name: sanitizeText(value.name || 'Error'),
                code,
                message: sanitizeText(value.message || 'Production execution error'),
            });
        }
        if (depth >= MAX_DEPTH || typeof value !== 'object') return '[redacted]';
        if (seen.has(value)) return '[circular]';
        seen.add(value);
        if (Array.isArray(value)) {
            return value.slice(0, MAX_KEYS).map(entry => sanitize(entry, depth + 1, seen));
        }

        const output = {};
        for (const key of Reflect.ownKeys(value).slice(0, MAX_KEYS)) {
            if (typeof key !== 'string') continue;
            const safeKey = sanitizeText(key);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || SENSITIVE_KEY.test(key)) {
                output[safeKey] = '[redacted]';
                continue;
            }
            output[safeKey] = sanitize(descriptor.value, depth + 1, seen);
        }
        return output;
    };

    return Object.freeze({ addSecretValues, sanitize, sanitizeText });
};

export const installFuturesProductionExecutionLogSanitizer = ({
    consoleObject = console,
    secretValues = [],
} = {}) => {
    const sanitizer = createFuturesProductionExecutionSanitizer(secretValues);
    const originals = new Map();
    let restored = false;
    for (const method of ['debug', 'info', 'warn', 'error', 'log']) {
        if (typeof consoleObject?.[method] !== 'function') continue;
        const original = consoleObject[method];
        const forward = original.bind(consoleObject);
        originals.set(method, original);
        consoleObject[method] = (...args) => forward(...args.map(value => sanitizer.sanitize(value)));
    }
    return Object.freeze({
        ...sanitizer,
        restore: () => {
            if (restored) return false;
            restored = true;
            for (const [method, original] of originals) consoleObject[method] = original;
            return true;
        },
    });
};

export const isFuturesProductionExecutionSensitiveKey = value => (
    typeof value === 'string' && SENSITIVE_KEY.test(value)
);
