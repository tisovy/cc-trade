import { createHash } from 'node:crypto';

export const FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS = Object.freeze({
    BODY_BYTES: 65_536,
    HEADER_COUNT: 64,
    HEADER_VALUE_BYTES: 4_096,
    HEADER_AGGREGATE_BYTES: 32_768,
    MESSAGE_BYTES: 512,
    DIAGNOSTIC_BYTES: 4_096,
    JSON_DEPTH: 8,
    JSON_NODES: 1_024,
});

export const FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS = Object.freeze({
    ...FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS,
    BODY_BYTES: 2_097_152,
    JSON_NODES: 131_072,
});

export class FuturesTestnetExecutionJsonError extends Error {
    constructor(code) {
        super('Futures testnet execution response was rejected');
        this.name = 'FuturesTestnetExecutionJsonError';
        this.code = code;
    }
}

export class FuturesTestnetExecutionIntegerToken {
    constructor(token) {
        this.token = token;
        Object.freeze(this);
    }
}

const fail = (code) => {
    throw new FuturesTestnetExecutionJsonError(code);
};

const resolveResponseLimits = (limits) => {
    if (limits === undefined || limits === FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS) {
        return FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS;
    }
    if (limits === FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS) {
        return FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS;
    }
    fail('INVALID_RESPONSE_LIMIT_PROFILE');
};

const hasOnlyUnicodeScalars = (value) => {
    for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
            index += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            return false;
        }
    }
    return true;
};

export const parseFuturesTestnetExecutionJson = (text, limits) => {
    const responseLimits = resolveResponseLimits(limits);
    if (typeof text !== 'string'
        || Buffer.byteLength(text, 'utf8') > responseLimits.BODY_BYTES
        || !hasOnlyUnicodeScalars(text)) {
        fail('INVALID_RESPONSE_ENCODING');
    }

    let cursor = 0;
    let nodes = 0;
    const countNode = () => {
        nodes += 1;
        if (nodes > responseLimits.JSON_NODES) {
            fail('RESPONSE_JSON_RESOURCE_LIMIT');
        }
    };
    const skipWhitespace = () => {
        while ([' ', '\n', '\r', '\t'].includes(text[cursor])) cursor += 1;
    };
    const parseString = () => {
        if (text[cursor] !== '"') fail('INVALID_RESPONSE_JSON');
        const start = cursor;
        cursor += 1;
        let closed = false;
        while (cursor < text.length) {
            const character = text[cursor];
            const unit = text.charCodeAt(cursor);
            if (character === '"') {
                cursor += 1;
                closed = true;
                break;
            }
            if (unit < 0x20) fail('INVALID_RESPONSE_JSON');
            if (character === '\\') {
                cursor += 1;
                const escape = text[cursor];
                if (escape === 'u') {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor + 1, cursor + 5))) {
                        fail('INVALID_RESPONSE_JSON');
                    }
                    cursor += 5;
                    continue;
                }
                if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
                    fail('INVALID_RESPONSE_JSON');
                }
                cursor += 1;
                continue;
            }
            cursor += 1;
        }
        if (!closed) fail('INVALID_RESPONSE_JSON');
        let value;
        try {
            value = JSON.parse(text.slice(start, cursor));
        } catch {
            fail('INVALID_RESPONSE_JSON');
        }
        if (!hasOnlyUnicodeScalars(value)
            || Buffer.byteLength(value, 'utf8') > FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.DIAGNOSTIC_BYTES) {
            fail('RESPONSE_JSON_RESOURCE_LIMIT');
        }
        return value;
    };
    const parseInteger = () => {
        const start = cursor;
        if (text[cursor] === '-') cursor += 1;
        if (text[cursor] === '0') {
            cursor += 1;
            if (/^[0-9]$/.test(text[cursor] ?? '')) fail('INVALID_RESPONSE_JSON');
        } else {
            if (!/^[1-9]$/.test(text[cursor] ?? '')) fail('INVALID_RESPONSE_JSON');
            while (/^[0-9]$/.test(text[cursor] ?? '')) cursor += 1;
        }
        if (['.', 'e', 'E'].includes(text[cursor])) fail('INVALID_RESPONSE_JSON');
        return new FuturesTestnetExecutionIntegerToken(text.slice(start, cursor));
    };
    const parseValue = (depth) => {
        if (depth > FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.JSON_DEPTH) {
            fail('RESPONSE_JSON_RESOURCE_LIMIT');
        }
        countNode();
        skipWhitespace();
        if (text[cursor] === '"') return parseString();
        if (text[cursor] === '{') return parseObject(depth + 1);
        if (text[cursor] === '[') return parseArray(depth + 1);
        if (text.slice(cursor, cursor + 4) === 'true') {
            cursor += 4;
            return true;
        }
        if (text.slice(cursor, cursor + 5) === 'false') {
            cursor += 5;
            return false;
        }
        if (text.slice(cursor, cursor + 4) === 'null') {
            cursor += 4;
            return null;
        }
        return parseInteger();
    };
    const parseObject = (depth) => {
        cursor += 1;
        skipWhitespace();
        const result = Object.create(null);
        const keys = new Set();
        if (text[cursor] === '}') {
            cursor += 1;
            return result;
        }
        while (cursor < text.length) {
            const key = parseString();
            if (keys.has(key)) fail('DUPLICATE_RESPONSE_KEY');
            keys.add(key);
            skipWhitespace();
            if (text[cursor] !== ':') fail('INVALID_RESPONSE_JSON');
            cursor += 1;
            result[key] = parseValue(depth);
            skipWhitespace();
            if (text[cursor] === '}') {
                cursor += 1;
                return result;
            }
            if (text[cursor] !== ',') fail('INVALID_RESPONSE_JSON');
            cursor += 1;
            skipWhitespace();
        }
        fail('INVALID_RESPONSE_JSON');
    };
    const parseArray = (depth) => {
        cursor += 1;
        skipWhitespace();
        const result = [];
        if (text[cursor] === ']') {
            cursor += 1;
            return result;
        }
        while (cursor < text.length) {
            result.push(parseValue(depth));
            skipWhitespace();
            if (text[cursor] === ']') {
                cursor += 1;
                return result;
            }
            if (text[cursor] !== ',') fail('INVALID_RESPONSE_JSON');
            cursor += 1;
            skipWhitespace();
        }
        fail('INVALID_RESPONSE_JSON');
    };

    skipWhitespace();
    const result = parseValue(0);
    skipWhitespace();
    if (cursor !== text.length) fail('INVALID_RESPONSE_JSON');
    return result;
};

export const readFuturesTestnetExecutionResponseBody = async (response, limits) => {
    const responseLimits = resolveResponseLimits(limits);
    const chunks = [];
    let total = 0;
    if (response?.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
            total += bytes.byteLength;
            if (total > responseLimits.BODY_BYTES) {
                await reader.cancel().catch(() => {});
                fail('RESPONSE_BODY_TOO_LARGE');
            }
            chunks.push(bytes);
        }
    } else {
        const text = await response.text();
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > responseLimits.BODY_BYTES) {
            fail('RESPONSE_BODY_TOO_LARGE');
        }
        chunks.push(bytes);
        total = bytes.byteLength;
    }

    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(combined);
    } catch {
        fail('INVALID_RESPONSE_ENCODING');
    }
    return Object.freeze({
        text,
        digest: createHash('sha256').update(combined).digest('hex'),
    });
};

export const validateFuturesTestnetExecutionResponseHeaders = (headers) => {
    const entries = headers && typeof headers.entries === 'function'
        ? [...headers.entries()]
        : Object.entries(headers || {});
    if (entries.length > FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.HEADER_COUNT) {
        fail('RESPONSE_HEADERS_TOO_LARGE');
    }
    let aggregate = 0;
    const selected = Object.create(null);
    for (const [rawName, rawValue] of entries) {
        const name = String(rawName).toLowerCase();
        const value = String(rawValue);
        const valueBytes = Buffer.byteLength(value, 'utf8');
        aggregate += Buffer.byteLength(name, 'utf8') + valueBytes;
        if (valueBytes > FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.HEADER_VALUE_BYTES
            || aggregate > FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.HEADER_AGGREGATE_BYTES) {
            fail('RESPONSE_HEADERS_TOO_LARGE');
        }
        if ([
            'retry-after',
            'x-mbx-order-count-10s',
            'x-mbx-order-count-1m',
            'x-mbx-used-weight-1m',
        ].includes(name)) selected[name] = value;
    }
    return Object.freeze(selected);
};

export const readIntegerToken = (value, { minimum = null, maximum = null } = {}) => {
    if (!(value instanceof FuturesTestnetExecutionIntegerToken)) fail('INVALID_INTEGER_TOKEN');
    let parsed;
    try {
        parsed = BigInt(value.token);
    } catch {
        fail('INVALID_INTEGER_TOKEN');
    }
    if ((minimum !== null && parsed < minimum) || (maximum !== null && parsed > maximum)) {
        fail('INVALID_INTEGER_TOKEN');
    }
    return { parsed, token: value.token };
};
