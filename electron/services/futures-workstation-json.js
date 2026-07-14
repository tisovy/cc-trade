export const FUTURES_WORKSTATION_JSON_LIMITS = Object.freeze({
    WS_FRAME_BYTES: 64 * 1024,
    HEADER_COUNT: 64,
    HEADER_VALUE_BYTES: 4 * 1024,
    HEADER_AGGREGATE_BYTES: 16 * 1024,
    STRING_BYTES: 16 * 1024,
    JSON_DEPTH: 12,
    JSON_NODES: 16_384,
});

export const FUTURES_WORKSTATION_BODY_LIMITS = Object.freeze({
    EXCHANGE_INFO: 2 * 1024 * 1024,
    DEPTH: 512 * 1024,
    KLINES: 1024 * 1024,
    HEADER: 64 * 1024,
});

export class FuturesWorkstationJsonError extends Error {
    constructor(code) {
        super('Futures workstation JSON value was rejected');
        this.name = 'FuturesWorkstationJsonError';
        this.code = code;
    }
}

export class FuturesWorkstationIntegerToken {
    constructor(token) {
        this.token = token;
        Object.freeze(this);
    }
}

const fail = (code) => {
    throw new FuturesWorkstationJsonError(code);
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

export const parseFuturesWorkstationJson = (
    text,
    {
        maxBytes,
        maxDepth = FUTURES_WORKSTATION_JSON_LIMITS.JSON_DEPTH,
        maxNodes = FUTURES_WORKSTATION_JSON_LIMITS.JSON_NODES,
        maxStringBytes = FUTURES_WORKSTATION_JSON_LIMITS.STRING_BYTES,
    },
) => {
    if (typeof text !== 'string'
        || Buffer.byteLength(text, 'utf8') > maxBytes
        || !hasOnlyUnicodeScalars(text)) {
        fail('INVALID_JSON_ENCODING');
    }

    let cursor = 0;
    let nodes = 0;
    const countNode = () => {
        nodes += 1;
        if (nodes > maxNodes) fail('JSON_RESOURCE_LIMIT');
    };
    const skipWhitespace = () => {
        while ([' ', '\n', '\r', '\t'].includes(text[cursor])) cursor += 1;
    };
    const parseString = () => {
        if (text[cursor] !== '"') fail('INVALID_JSON');
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
            if (unit < 0x20) fail('INVALID_JSON');
            if (character === '\\') {
                cursor += 1;
                const escape = text[cursor];
                if (escape === 'u') {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor + 1, cursor + 5))) {
                        fail('INVALID_JSON');
                    }
                    cursor += 5;
                    continue;
                }
                if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
                    fail('INVALID_JSON');
                }
                cursor += 1;
                continue;
            }
            cursor += 1;
        }
        if (!closed) fail('INVALID_JSON');
        let value;
        try {
            value = JSON.parse(text.slice(start, cursor));
        } catch {
            fail('INVALID_JSON');
        }
        if (!hasOnlyUnicodeScalars(value)
            || Buffer.byteLength(value, 'utf8') > maxStringBytes) {
            fail('JSON_RESOURCE_LIMIT');
        }
        return value;
    };
    const parseInteger = () => {
        const start = cursor;
        if (text[cursor] === '-') cursor += 1;
        if (text[cursor] === '0') {
            cursor += 1;
            if (/^[0-9]$/.test(text[cursor] ?? '')) fail('INVALID_JSON');
        } else {
            if (!/^[1-9]$/.test(text[cursor] ?? '')) fail('INVALID_JSON');
            while (/^[0-9]$/.test(text[cursor] ?? '')) cursor += 1;
        }
        if (['.', 'e', 'E'].includes(text[cursor])) fail('INVALID_JSON_NUMBER');
        return new FuturesWorkstationIntegerToken(text.slice(start, cursor));
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
            if (keys.has(key)) fail('DUPLICATE_JSON_KEY');
            keys.add(key);
            skipWhitespace();
            if (text[cursor] !== ':') fail('INVALID_JSON');
            cursor += 1;
            result[key] = parseValue(depth);
            skipWhitespace();
            if (text[cursor] === '}') {
                cursor += 1;
                return result;
            }
            if (text[cursor] !== ',') fail('INVALID_JSON');
            cursor += 1;
            skipWhitespace();
        }
        fail('INVALID_JSON');
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
            if (text[cursor] !== ',') fail('INVALID_JSON');
            cursor += 1;
            skipWhitespace();
        }
        fail('INVALID_JSON');
    };
    const parseValue = (depth) => {
        if (depth > maxDepth) fail('JSON_RESOURCE_LIMIT');
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

    skipWhitespace();
    const result = parseValue(0);
    skipWhitespace();
    if (cursor !== text.length) fail('INVALID_JSON');
    return result;
};

export const readFuturesWorkstationResponseBody = async (response, maxBytes, signal) => {
    const chunks = [];
    let total = 0;
    if (response?.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const cancel = () => {
            try {
                void Promise.resolve(reader.cancel()).catch(() => {});
            } catch {
                // The operation deadline remains authoritative.
            }
        };
        signal?.addEventListener?.('abort', cancel, { once: true });
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
                total += bytes.byteLength;
                if (total > maxBytes) {
                    cancel();
                    fail('RESPONSE_BODY_TOO_LARGE');
                }
                chunks.push(bytes);
            }
        } finally {
            signal?.removeEventListener?.('abort', cancel);
        }
    } else if (typeof response?.text === 'function') {
        const text = await response.text();
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > maxBytes) fail('RESPONSE_BODY_TOO_LARGE');
        chunks.push(bytes);
        total = bytes.byteLength;
    } else {
        fail('INVALID_RESPONSE_BODY');
    }

    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(combined);
    } catch {
        fail('INVALID_JSON_ENCODING');
    }
};

export const validateFuturesWorkstationResponseHeaders = (headers) => {
    if (!headers || typeof headers.entries !== 'function') fail('INVALID_RESPONSE_HEADERS');
    let count = 0;
    let aggregate = 0;
    for (const [rawName, rawValue] of headers.entries()) {
        count += 1;
        const name = String(rawName);
        const value = String(rawValue);
        const valueBytes = Buffer.byteLength(value, 'utf8');
        aggregate += Buffer.byteLength(name, 'utf8') + valueBytes;
        if (count > FUTURES_WORKSTATION_JSON_LIMITS.HEADER_COUNT
            || valueBytes > FUTURES_WORKSTATION_JSON_LIMITS.HEADER_VALUE_BYTES
            || aggregate > FUTURES_WORKSTATION_JSON_LIMITS.HEADER_AGGREGATE_BYTES) {
            fail('RESPONSE_HEADERS_TOO_LARGE');
        }
    }
};

export const readFuturesWorkstationIdentity = (value) => {
    if (!(value instanceof FuturesWorkstationIntegerToken)
        || !/^(?:0|[1-9][0-9]*)$/.test(value.token)) {
        fail('INVALID_INTEGER_IDENTITY');
    }
    return value.token;
};

export const readFuturesWorkstationTimestamp = (value) => {
    const token = readFuturesWorkstationIdentity(value);
    const number = Number(token);
    if (!Number.isSafeInteger(number) || number < 0) fail('INVALID_TIMESTAMP');
    return number;
};

export const readFuturesWorkstationCount = (value, maximum = 1_000_000_000) => {
    const number = readFuturesWorkstationTimestamp(value);
    if (number > maximum) fail('INVALID_COUNT');
    return number;
};
