const SENSITIVE_KEY = /(authorization|api[-_]?key|api[-_]?secret|signature|signed(?:url|body)?|headers?|config|request|response|cause|stack)/i;
const SIGNATURE_PATTERN = /((?:signature|x-mbx-apikey)=)[^&\s]+/gi;
const MAX_TEXT = 4096;
const MAX_KEYS = 64;
const MAX_DEPTH = 5;

const bounded = value => value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)}[truncated]`;

export const createFuturesTestnetExecutionSanitizer = (secretValues = []) => {
    const needles = [...new Set(
        secretValues
            .filter(value => typeof value === 'string' && value.length > 0)
            .flatMap(value => [value, encodeURIComponent(value)]),
    )].sort((left, right) => right.length - left.length);

    const sanitizeText = (value) => {
        let result = bounded(String(value));
        for (const needle of needles) result = result.split(needle).join('[redacted]');
        return result.replace(SIGNATURE_PATTERN, '$1[redacted]');
    };

    const sanitize = (value, depth = 0, seen = new WeakSet()) => {
        if (typeof value === 'string') return sanitizeText(value);
        if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Error) {
            return Object.freeze({
                name: sanitizeText(value.name || 'Error'),
                code: typeof value.code === 'string' || typeof value.code === 'number'
                    ? sanitizeText(value.code)
                    : null,
                message: sanitizeText(value.message || 'Execution error'),
            });
        }
        if (depth >= MAX_DEPTH || typeof value !== 'object') return '[redacted]';
        if (seen.has(value)) return '[circular]';
        seen.add(value);
        if (Array.isArray(value)) {
            return value.slice(0, MAX_KEYS).map(entry => sanitize(entry, depth + 1, seen));
        }
        const entries = Object.entries(value).slice(0, MAX_KEYS).map(([key, entry]) => [
            sanitizeText(key),
            SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(entry, depth + 1, seen),
        ]);
        return Object.fromEntries(entries);
    };

    return Object.freeze({ sanitize, sanitizeText });
};
export const installFuturesTestnetExecutionLogSanitizer = ({
    consoleObject = console,
    secretValues = [],
} = {}) => {
    const sanitizer = createFuturesTestnetExecutionSanitizer(secretValues);
    const originals = new Map();
    for (const method of ['debug', 'info', 'warn', 'error', 'log']) {
        if (typeof consoleObject[method] !== 'function') continue;
        const original = consoleObject[method].bind(consoleObject);
        originals.set(method, consoleObject[method]);
        consoleObject[method] = (...args) => original(...args.map(value => sanitizer.sanitize(value)));
    }
    return Object.freeze({
        ...sanitizer,
        restore: () => {
            for (const [method, original] of originals) consoleObject[method] = original;
        },
    });
};
