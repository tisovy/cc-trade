import fs from 'node:fs/promises';
import fsConstants from 'node:fs';
import path from 'node:path';
import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import {
    createFuturesProductionExecutionSanitizer,
} from './futures-production-execution-sanitizer.js';

const JOURNAL_FILE = 'journal.bin';
const ANCHOR_FILE = 'anchor.json';
const LOCK_FILE = 'journal.lock';
const RECORD_VERSION = 1;
const ZERO_HASH = '0'.repeat(64);
const MAX_SAFE_TIME = 8_640_000_000_000_000;

export const FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS = Object.freeze({
    maximumRecordBytes: 16_384,
    maximumJournalBytes: 64 * 1024 * 1024,
    maximumRecords: 100_000,
    maximumSafeDetailBytes: 512,
    maximumRequestWeight: 1_000,
});

export const FUTURES_PRODUCTION_EXECUTION_AUDIT_EVENT_TYPES = Object.freeze([
    'received_command',
    'gate_decision',
    'intent_issued',
    'intent_consumed',
    'intent_expired',
    'queued',
    'daily_notional_reserved',
    'dispatch_intent',
    'exchange_request',
    'exchange_response',
    'response_classified',
    'acknowledgement',
    'terminal_transition',
    'reconciliation_result',
    'monitor_result',
    'kill_switch_transition',
    'cancel_all_parent',
    'cancel_all_child',
    'close_positions_parent',
    'close_positions_child',
    'credential_mismatch',
    'restart_recovery',
    'operator_recovery',
    'rate_pause',
    'rate_counter',
    'storage_health',
]);

const AUDIT_CATEGORIES = new Set([
    'command', 'gate', 'intent', 'dispatch', 'exchange', 'reconciliation',
    'recovery', 'safety', 'storage', 'rate',
]);
const AUDIT_OUTCOMES = new Set([
    'received', 'allowed', 'blocked', 'pending', 'accepted', 'rejected', 'unknown',
    'partial', 'confirmed', 'engaged', 'disengaged', 'healthy', 'failed', 'expired',
]);
const AUDIT_FIELDS = Object.freeze([
    'version',
    'eventType',
    'category',
    'outcome',
    'observedAt',
    'requestId',
    'operationId',
    'parentOperationId',
    'intentId',
    'clientOrderId',
    'commandDigest',
    'action',
    'accountAlias',
    'accountFingerprint',
    'credentialBinding',
    'symbol',
    'side',
    'orderType',
    'timeInForce',
    'quantity',
    'price',
    'reduceOnly',
    'exchangeOrderId',
    'gate',
    'endpointId',
    'requestWeight',
    'utcDay',
    'exactNotional',
    'dispatchAt',
    'serverTime',
    'pauseUntil',
    'state',
    'code',
    'detailDigest',
    'safeDetail',
]);
const NULLABLE_FIELDS = AUDIT_FIELDS.filter(field => ![
    'version', 'eventType', 'category', 'outcome', 'observedAt',
].includes(field));
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTION_PATTERN = /^(?:futures\.production\.[A-Za-z][A-Za-z0-9]*|backend\.futuresProduction\.[A-Za-z][A-Za-z0-9]*)$/;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,32}$/;
const HEX_256_PATTERN = /^[0-9a-f]{64}$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RATE_COUNTER_ENDPOINT_IDS = new Set([
    'server-time',
    'exchange-info',
    'mark-price',
    'account-config',
    'symbol-config',
    'balance-v3',
    'position-risk',
    'open-orders',
    'open-algo-orders',
    'new-limit-gtc-order',
    'new-reduce-only-market-order',
    'query-order',
    'cancel-all-open-orders',
    'cancel-all-algo-open-orders',
]);
const SAFE_DETAIL_FORBIDDEN = /(?:authorization|api[-_ ]?key|api[-_ ]?secret|signature|x-mbx-apikey|https?:\/\/|[?&][A-Za-z0-9_.~-]+=)/i;
const TERMINAL_STATES = new Set([
    'locally_rejected',
    'exchange_rejected',
    'confirmed_filled',
    'confirmed_canceled',
    'confirmed_closed',
    'confirmed_empty',
    'kill_switch_engaged',
    'expired',
]);
const OPERATION_LIFECYCLE_EVENT_TYPES = new Set([
    'intent_issued',
    'intent_consumed',
    'intent_expired',
    'queued',
    'daily_notional_reserved',
    'dispatch_intent',
    'response_classified',
    'acknowledgement',
    'terminal_transition',
    'reconciliation_result',
    'monitor_result',
    'cancel_all_parent',
    'cancel_all_child',
    'close_positions_parent',
    'close_positions_child',
    'restart_recovery',
]);

export class FuturesProductionExecutionLedgerError extends Error {
    constructor(code) {
        super('Futures production execution ledger is unavailable');
        this.name = 'FuturesProductionExecutionLedgerError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesProductionExecutionLedgerError(code);
};

const mergeOperationLifecycleRecord = (previous, current) => {
    if (!previous) return current;
    const merged = { ...previous };
    for (const field of AUDIT_FIELDS) {
        if (!NULLABLE_FIELDS.includes(field) || current[field] !== null) {
            merged[field] = current[field];
        }
    }
    return Object.freeze(merged);
};

const isPlainObject = value => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
);

const hasOnlyDataProperties = (value) => (
    isPlainObject(value)
    && Reflect.ownKeys(value).every((key) => {
        if (typeof key !== 'string') return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && Object.hasOwn(descriptor, 'value');
    })
);

const canonicalize = (value) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_RECORD');
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!hasOnlyDataProperties(value)) fail('INVALID_RECORD');
    return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
};

const canonicalJson = value => JSON.stringify(canonicalize(value));

const hmacHex = (key, ...chunks) => {
    const hmac = createHmac('sha256', key);
    chunks.forEach(chunk => hmac.update(chunk));
    return hmac.digest('hex');
};

const equalHex = (left, right) => {
    if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

const requireNullableToken = (value, code = 'INVALID_AUDIT_RECORD') => {
    if (value !== null && (typeof value !== 'string' || !TOKEN_PATTERN.test(value))) fail(code);
    return value;
};

const requireNullableHex = (value) => {
    if (value !== null && (typeof value !== 'string' || !HEX_256_PATTERN.test(value))) {
        fail('INVALID_AUDIT_RECORD');
    }
    return value;
};

const requireNullableTime = (value) => {
    if (value !== null
        && (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_TIME)) {
        fail('INVALID_AUDIT_RECORD');
    }
    return value;
};

const parseExactDecimal = (value, { positive = false } = {}) => {
    if (typeof value !== 'string'
        || value.length > 80
        || !/^(?:0|[1-9][0-9]{0,59})(?:\.[0-9]{1,18})?$/.test(value)) {
        fail('INVALID_EXACT_DECIMAL');
    }
    const [integer, fraction = ''] = value.split('.');
    if (integer.length + fraction.length > 60) fail('INVALID_EXACT_DECIMAL');
    const units = BigInt(`${integer}${fraction}`);
    if (positive && units === 0n) fail('INVALID_EXACT_DECIMAL');
    return { units, scale: fraction.length };
};

const formatExactDecimal = ({ units, scale }) => {
    if (units === 0n) return '0';
    let digits = units.toString();
    if (scale > 0) digits = digits.padStart(scale + 1, '0');
    const integer = scale === 0 ? digits : digits.slice(0, -scale);
    const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
    return fraction.length > 0 ? `${integer}.${fraction}` : integer;
};

const alignDecimals = (left, right) => {
    const scale = Math.max(left.scale, right.scale);
    return {
        left: left.units * (10n ** BigInt(scale - left.scale)),
        right: right.units * (10n ** BigInt(scale - right.scale)),
        scale,
    };
};

export const normalizeFuturesProductionExactDecimal = (value) => (
    formatExactDecimal(parseExactDecimal(value))
);

export const addFuturesProductionExactDecimals = (leftValue, rightValue) => {
    const aligned = alignDecimals(parseExactDecimal(leftValue), parseExactDecimal(rightValue));
    return formatExactDecimal({ units: aligned.left + aligned.right, scale: aligned.scale });
};

export const compareFuturesProductionExactDecimals = (leftValue, rightValue) => {
    const aligned = alignDecimals(parseExactDecimal(leftValue), parseExactDecimal(rightValue));
    if (aligned.left < aligned.right) return -1;
    if (aligned.left > aligned.right) return 1;
    return 0;
};

export const subtractFuturesProductionExactDecimals = (leftValue, rightValue) => {
    const aligned = alignDecimals(parseExactDecimal(leftValue), parseExactDecimal(rightValue));
    if (aligned.left < aligned.right) fail('INVALID_EXACT_DECIMAL');
    return formatExactDecimal({ units: aligned.left - aligned.right, scale: aligned.scale });
};

export const canonicalFuturesProductionUtcDay = (serverTime) => {
    if (!Number.isSafeInteger(serverTime) || serverTime < 0 || serverTime > MAX_SAFE_TIME) {
        fail('INVALID_SERVER_TIME');
    }
    const date = new Date(serverTime);
    if (Number.isNaN(date.getTime())) fail('INVALID_SERVER_TIME');
    return date.toISOString().slice(0, 10);
};

const validateUtcDay = (value) => {
    const match = typeof value === 'string' ? DAY_PATTERN.exec(value) : null;
    if (!match) fail('INVALID_UTC_DAY');
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isSafeInteger(timestamp)
        || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        fail('INVALID_UTC_DAY');
    }
    return value;
};

const containsKnownSecret = (value, secretValues) => {
    if (typeof value !== 'string') return false;
    return secretValues.some((secret) => {
        if (typeof secret !== 'string' || secret.length === 0) return false;
        return value.includes(secret)
            || value.includes(encodeURIComponent(secret))
            || value.includes(Buffer.from(secret, 'utf8').toString('base64'));
    });
};

const validateSecretValues = (secretValues) => {
    if (!Array.isArray(secretValues)
        || secretValues.length > 32
        || secretValues.some(value => (
            typeof value !== 'string'
            || value.length === 0
            || Buffer.byteLength(value, 'utf8') > 1_024
        ))) {
        fail('INVALID_AUDIT_CONFIGURATION');
    }
    return secretValues;
};

export const createFuturesProductionExecutionAuditRecord = (
    input,
    { secretValues = [] } = {},
) => {
    if (!hasOnlyDataProperties(input)
        || Reflect.ownKeys(input).some(key => !AUDIT_FIELDS.includes(key))) {
        fail('INVALID_AUDIT_RECORD');
    }
    validateSecretValues(secretValues);
    const record = Object.fromEntries(AUDIT_FIELDS.map(field => [field, null]));
    record.version = RECORD_VERSION;
    for (const field of AUDIT_FIELDS) {
        if (Object.hasOwn(input, field)) record[field] = input[field];
    }
    if (record.version !== RECORD_VERSION
        || !FUTURES_PRODUCTION_EXECUTION_AUDIT_EVENT_TYPES.includes(record.eventType)
        || !AUDIT_CATEGORIES.has(record.category)
        || !AUDIT_OUTCOMES.has(record.outcome)
        || !Number.isSafeInteger(record.observedAt)
        || record.observedAt < 0
        || record.observedAt > MAX_SAFE_TIME) {
        fail('INVALID_AUDIT_RECORD');
    }
    for (const field of NULLABLE_FIELDS) {
        if (record[field] !== null && containsKnownSecret(record[field], secretValues)) {
            fail('AUDIT_SECRET_REJECTED');
        }
    }
    for (const field of [
        'requestId', 'operationId', 'parentOperationId', 'intentId', 'clientOrderId',
        'gate', 'endpointId', 'state', 'code',
    ]) requireNullableToken(record[field]);
    for (const field of [
        'commandDigest', 'accountFingerprint', 'credentialBinding', 'detailDigest',
    ]) requireNullableHex(record[field]);
    if (record.action !== null
        && (typeof record.action !== 'string'
            || record.action.length > 128
            || !ACTION_PATTERN.test(record.action))) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.accountAlias !== null
        && (typeof record.accountAlias !== 'string'
            || record.accountAlias.length === 0
            || record.accountAlias.length > 64
            || !/^[\x21-\x7e]+$/.test(record.accountAlias))) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.symbol !== null
        && (typeof record.symbol !== 'string' || !SYMBOL_PATTERN.test(record.symbol))) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.side !== null && !['BUY', 'SELL'].includes(record.side)) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.orderType !== null && !['LIMIT', 'MARKET'].includes(record.orderType)) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.timeInForce !== null && record.timeInForce !== 'GTC') {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.quantity !== null) parseExactDecimal(record.quantity, { positive: true });
    if (record.price !== null) parseExactDecimal(record.price);
    if (record.reduceOnly !== null && typeof record.reduceOnly !== 'boolean') {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.exchangeOrderId !== null
        && (typeof record.exchangeOrderId !== 'string'
            || !/^[1-9][0-9]{0,18}$/.test(record.exchangeOrderId)
            || BigInt(record.exchangeOrderId) > 9_223_372_036_854_775_807n)) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.requestWeight !== null
        && (!Number.isSafeInteger(record.requestWeight)
            || record.requestWeight <= 0
            || record.requestWeight
                > FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRequestWeight)) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.utcDay !== null) validateUtcDay(record.utcDay);
    if (record.exactNotional !== null) record.exactNotional = normalizeFuturesProductionExactDecimal(
        record.exactNotional,
    );
    for (const field of ['dispatchAt', 'serverTime', 'pauseUntil']) {
        requireNullableTime(record[field]);
    }
    if (record.safeDetail !== null) {
        if (typeof record.safeDetail !== 'string') fail('INVALID_AUDIT_RECORD');
        const sanitizer = createFuturesProductionExecutionSanitizer(secretValues);
        record.safeDetail = sanitizer.sanitizeText(record.safeDetail);
        if (Buffer.byteLength(record.safeDetail, 'utf8')
                > FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumSafeDetailBytes
            || SAFE_DETAIL_FORBIDDEN.test(record.safeDetail)) {
            fail('AUDIT_SECRET_REJECTED');
        }
    }
    if (record.eventType === 'daily_notional_reserved') {
        if (record.utcDay === null
            || record.exactNotional === null
            || record.serverTime === null
            || record.dispatchAt === null
            || (record.operationId === null
                && record.requestId === null
                && record.clientOrderId === null)
            || compareFuturesProductionExactDecimals(record.exactNotional, '0') <= 0
            || canonicalFuturesProductionUtcDay(record.serverTime) !== record.utcDay) {
            fail('INVALID_DAILY_RESERVATION');
        }
    }
    if (record.eventType === 'dispatch_intent'
        && (record.dispatchAt === null
            || (record.operationId === null
                && record.requestId === null
                && record.clientOrderId === null))) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.eventType === 'rate_pause' && record.pauseUntil === null) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.eventType === 'rate_counter') {
        if (record.category !== 'rate'
            || record.outcome !== 'accepted'
            || record.state !== 'reserved'
            || record.endpointId === null
            || !RATE_COUNTER_ENDPOINT_IDS.has(record.endpointId)
            || record.requestWeight === null) {
            fail('INVALID_AUDIT_RECORD');
        }
    } else if (record.requestWeight !== null) {
        fail('INVALID_AUDIT_RECORD');
    }
    if (record.eventType === 'kill_switch_transition'
        && !((record.state === 'engaged' && record.outcome === 'engaged')
            || (record.state === 'disengaged' && record.outcome === 'disengaged'))) {
        fail('INVALID_KILL_SWITCH_STATE');
    }
    return Object.freeze(record);
};

export const createFuturesProductionExecutionCommandDigest = (command) => {
    if (!hasOnlyDataProperties(command)) fail('INVALID_COMMAND');
    const serialized = canonicalJson(command);
    if (Buffer.byteLength(serialized, 'utf8') > 4_096) fail('INVALID_COMMAND');
    return createHash('sha256')
        .update('cc-trade/futures-production-command/v1\0')
        .update(serialized)
        .digest('hex');
};

const encodeAnchor = (key, sequence, recordHash) => {
    const body = { version: RECORD_VERSION, sequence, recordHash };
    const serialized = canonicalJson(body);
    return `${canonicalJson({ ...body, mac: hmacHex(key, 'anchor\0', serialized) })}\n`;
};

const decodeAnchor = (key, text) => {
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        fail('CORRUPT_ANCHOR');
    }
    if (!hasOnlyDataProperties(value)
        || Reflect.ownKeys(value).length !== 4
        || value.version !== RECORD_VERSION
        || !/^(?:0|[1-9][0-9]{0,5})$/.test(value.sequence)
        || BigInt(value.sequence) > BigInt(FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRecords)
        || !HEX_256_PATTERN.test(value.recordHash ?? '')
        || !HEX_256_PATTERN.test(value.mac ?? '')) {
        fail('CORRUPT_ANCHOR');
    }
    const body = canonicalJson({
        version: value.version,
        sequence: value.sequence,
        recordHash: value.recordHash,
    });
    if (!equalHex(hmacHex(key, 'anchor\0', body), value.mac)) fail('CORRUPT_ANCHOR');
    return value;
};

const encodeFrame = (key, sequence, previousHash, record) => {
    const payload = Buffer.from(canonicalJson({
        version: RECORD_VERSION,
        sequence,
        previousHash,
        record,
    }), 'utf8');
    if (payload.byteLength > FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRecordBytes) {
        fail('RECORD_TOO_LARGE');
    }
    const hash = hmacHex(key, 'record\0', previousHash, '\0', sequence, '\0', payload);
    const frame = Buffer.allocUnsafe(4 + payload.byteLength + 32);
    frame.writeUInt32BE(payload.byteLength, 0);
    payload.copy(frame, 4);
    Buffer.from(hash, 'hex').copy(frame, 4 + payload.byteLength);
    return { frame, hash };
};

const parseJournal = (key, bytes, anchor, secretValues) => {
    const records = [];
    let offset = 0;
    let previousHash = ZERO_HASH;
    let expectedSequence = 1n;
    let anchoredEnd = anchor.sequence === '0' ? 0 : null;
    while (offset < bytes.byteLength) {
        if (records.length >= FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRecords) {
            fail('JOURNAL_CAPACITY_EXCEEDED');
        }
        const remaining = bytes.byteLength - offset;
        if (remaining < 4) break;
        const length = bytes.readUInt32BE(offset);
        if (length === 0
            || length > FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRecordBytes) {
            fail('CORRUPT_JOURNAL');
        }
        const frameLength = 4 + length + 32;
        if (remaining < frameLength) break;
        const payload = bytes.subarray(offset + 4, offset + 4 + length);
        const storedHash = bytes.subarray(offset + 4 + length, offset + frameLength).toString('hex');
        let parsed;
        try {
            parsed = JSON.parse(payload.toString('utf8'));
        } catch {
            fail('CORRUPT_JOURNAL');
        }
        const sequence = String(expectedSequence);
        if (!hasOnlyDataProperties(parsed)
            || Reflect.ownKeys(parsed).length !== 4
            || parsed.version !== RECORD_VERSION
            || parsed.sequence !== sequence
            || parsed.previousHash !== previousHash
            || canonicalJson(parsed) !== payload.toString('utf8')) {
            fail('CORRUPT_JOURNAL');
        }
        let record;
        try {
            record = createFuturesProductionExecutionAuditRecord(parsed.record, { secretValues });
        } catch {
            fail('CORRUPT_JOURNAL');
        }
        const expectedHash = hmacHex(key, 'record\0', previousHash, '\0', sequence, '\0', payload);
        if (!equalHex(expectedHash, storedHash)) fail('CORRUPT_JOURNAL');
        records.push(Object.freeze({ sequence, hash: storedHash, record }));
        offset += frameLength;
        previousHash = storedHash;
        expectedSequence += 1n;
        if (sequence === anchor.sequence && storedHash === anchor.recordHash) anchoredEnd = offset;
        if (anchoredEnd !== null && offset > anchoredEnd) fail('UNANCHORED_COMPLETE_RECORD');
    }
    if (anchor.sequence === '0') {
        if (anchor.recordHash !== ZERO_HASH || records.length > 0) fail('ANCHOR_ROLLBACK');
    } else if (anchoredEnd === null || BigInt(anchor.sequence) !== BigInt(records.length)) {
        fail('ANCHOR_ROLLBACK');
    }
    if (offset < bytes.byteLength && anchoredEnd !== offset) fail('CORRUPT_JOURNAL');
    return { records, truncateTo: offset, previousHash };
};

const fsyncDirectory = async (directory, fsImpl) => {
    const flags = fsConstants.constants.O_RDONLY | (fsConstants.constants.O_DIRECTORY || 0);
    const handle = await fsImpl.open(directory, flags);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

const ensurePrivateDirectory = async (directory, fsImpl) => {
    let created = false;
    try {
        await fsImpl.lstat(directory);
    } catch (error) {
        if (error?.code !== 'ENOENT') fail('UNSAFE_DIRECTORY');
        await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
        created = true;
    }
    if (created) await fsImpl.chmod(directory, 0o700);
    const stat = await fsImpl.lstat(directory);
    if (!stat.isDirectory()
        || stat.isSymbolicLink()
        || (stat.mode & 0o777) !== 0o700
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        fail('UNSAFE_DIRECTORY');
    }
    if (created) await fsyncDirectory(path.dirname(directory), fsImpl);
};

const verifyPrivateStat = (stat) => {
    if (!stat.isFile()
        || stat.nlink !== 1
        || (stat.mode & 0o777) !== 0o600
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        fail('UNSAFE_FILE');
    }
};

const verifyPrivateHandlePath = async (filePath, handle, fsImpl) => {
    const handleStat = await handle.stat();
    const pathStat = await fsImpl.lstat(filePath);
    verifyPrivateStat(handleStat);
    verifyPrivateStat(pathStat);
    if (handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino) fail('UNSAFE_FILE');
    return pathStat;
};

const readPrivateFile = async (filePath, fsImpl, maximumBytes) => {
    const handle = await fsImpl.open(
        filePath,
        fsConstants.constants.O_RDONLY | (fsConstants.constants.O_NOFOLLOW || 0),
    );
    try {
        const stat = await verifyPrivateHandlePath(filePath, handle, fsImpl);
        if (stat.size > maximumBytes) fail('UNSAFE_FILE');
        return await handle.readFile();
    } finally {
        await handle.close();
    }
};

const isProcessAlive = (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code !== 'ESRCH';
    }
};

const relocateAndRemoveLease = async (lockPath, identity, fsImpl, label) => {
    if (!identity) return false;
    const quarantinePath = `${lockPath}.${label}-${process.pid}-${randomBytes(8).toString('hex')}`;
    try {
        await fsImpl.rename(lockPath, quarantinePath);
    } catch {
        return false;
    }
    let matches = false;
    try {
        const handle = await fsImpl.open(
            quarantinePath,
            fsConstants.constants.O_RDONLY | (fsConstants.constants.O_NOFOLLOW || 0),
        );
        try {
            const stat = await verifyPrivateHandlePath(quarantinePath, handle, fsImpl);
            const contents = await handle.readFile({ encoding: 'utf8' });
            matches = stat.dev === identity.device
                && stat.ino === identity.inode
                && contents === identity.contents;
        } finally {
            await handle.close();
        }
    } catch {
        matches = false;
    }
    if (matches) {
        await fsImpl.unlink(quarantinePath);
        await fsyncDirectory(path.dirname(lockPath), fsImpl);
    }
    return matches;
};

const acquireLease = async (lockPath, fsImpl) => {
    const flags = fsConstants.constants.O_CREAT
        | fsConstants.constants.O_EXCL
        | fsConstants.constants.O_WRONLY
        | (fsConstants.constants.O_NOFOLLOW || 0);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const handle = await fsImpl.open(lockPath, flags, 0o600);
            try {
                const nonce = randomBytes(16).toString('hex');
                const contents = `${process.pid} ${nonce}\n`;
                await handle.writeFile(contents, 'utf8');
                await handle.sync();
                const stat = await verifyPrivateHandlePath(lockPath, handle, fsImpl);
                await fsyncDirectory(path.dirname(lockPath), fsImpl);
                return Object.freeze({ contents, device: stat.dev, inode: stat.ino });
            } finally {
                await handle.close();
            }
        } catch (error) {
            if (error instanceof FuturesProductionExecutionLedgerError) throw error;
            if (error?.code !== 'EEXIST') fail('LEASE_UNAVAILABLE');
            let staleIdentity;
            let stalePid;
            try {
                const handle = await fsImpl.open(
                    lockPath,
                    fsConstants.constants.O_RDONLY | (fsConstants.constants.O_NOFOLLOW || 0),
                );
                try {
                    const stat = await verifyPrivateHandlePath(lockPath, handle, fsImpl);
                    const contents = await handle.readFile({ encoding: 'utf8' });
                    if (!/^\d+ [0-9a-f]{32}\n$/.test(contents)) fail('LEASE_UNAVAILABLE');
                    stalePid = Number(contents.slice(0, contents.indexOf(' ')));
                    staleIdentity = { contents, device: stat.dev, inode: stat.ino };
                } finally {
                    await handle.close();
                }
            } catch {
                fail('LEASE_UNAVAILABLE');
            }
            if (isProcessAlive(stalePid)) fail('LEASE_UNAVAILABLE');
            if (!await relocateAndRemoveLease(lockPath, staleIdentity, fsImpl, 'stale')) {
                fail('LEASE_UNAVAILABLE');
            }
        }
    }
    fail('LEASE_UNAVAILABLE');
};

const verifyLease = async (lockPath, identity, fsImpl) => {
    if (!identity) fail('LEASE_LOST');
    try {
        const handle = await fsImpl.open(
            lockPath,
            fsConstants.constants.O_RDONLY | (fsConstants.constants.O_NOFOLLOW || 0),
        );
        try {
            const stat = await verifyPrivateHandlePath(lockPath, handle, fsImpl);
            const contents = await handle.readFile({ encoding: 'utf8' });
            if (stat.dev !== identity.device
                || stat.ino !== identity.inode
                || contents !== identity.contents) {
                fail('LEASE_LOST');
            }
        } finally {
            await handle.close();
        }
    } catch (error) {
        if (error instanceof FuturesProductionExecutionLedgerError
            && error.code === 'LEASE_LOST') throw error;
        fail('LEASE_LOST');
    }
};

const writeAll = async (handle, bytes) => {
    let offset = 0;
    while (offset < bytes.byteLength) {
        const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
        if (!Number.isSafeInteger(result?.bytesWritten) || result.bytesWritten <= 0) {
            fail('JOURNAL_WRITE_FAILED');
        }
        offset += result.bytesWritten;
    }
};

const replayRecords = (entries, { serverTime = null, originWeightNow = null } = {}) => {
    const dailyReservations = new Map();
    const dispatchTimes = [];
    const originWeightReservations = [];
    let pauseUntil = 0;
    let lastOriginWeightObservedAt = null;
    let lastServerTime = null;
    let lastUtcDay = null;
    let killSwitch = 'engaged';
    const latestByOperation = new Map();
    const countedDispatches = new Set();
    let credentialBinding = null;

    for (const entry of entries) {
        const record = entry.record;
        if (record.eventType === 'kill_switch_transition') killSwitch = record.state;
        if (record.eventType === 'daily_notional_reserved') {
            if (lastServerTime !== null && record.serverTime < lastServerTime) fail('CLOCK_REGRESSED');
            if (lastUtcDay !== null && record.utcDay < lastUtcDay) fail('UTC_DAY_REGRESSED');
            lastServerTime = record.serverTime;
            lastUtcDay = record.utcDay;
            dailyReservations.set(
                record.utcDay,
                addFuturesProductionExactDecimals(
                    dailyReservations.get(record.utcDay) ?? '0',
                    record.exactNotional,
                ),
            );
            const dispatchKey = `${record.operationId ?? record.requestId ?? record.clientOrderId}\0${record.dispatchAt}`;
            if (!countedDispatches.has(dispatchKey)) {
                countedDispatches.add(dispatchKey);
                dispatchTimes.push(record.dispatchAt);
            }
        } else if (record.eventType === 'dispatch_intent') {
            const dispatchKey = `${record.operationId ?? record.requestId ?? record.clientOrderId}\0${record.dispatchAt}`;
            if (!countedDispatches.has(dispatchKey)) {
                countedDispatches.add(dispatchKey);
                dispatchTimes.push(record.dispatchAt);
            }
        }
        if (record.eventType === 'rate_pause') pauseUntil = Math.max(pauseUntil, record.pauseUntil);
        if (record.eventType === 'rate_counter') {
            if (lastOriginWeightObservedAt !== null
                && record.observedAt < lastOriginWeightObservedAt) {
                fail('CLOCK_REGRESSED');
            }
            lastOriginWeightObservedAt = record.observedAt;
            originWeightReservations.push(Object.freeze({
                observedAt: record.observedAt,
                requestWeight: record.requestWeight,
            }));
        }
        const operationKey = record.operationId ?? record.requestId;
        if (operationKey !== null && OPERATION_LIFECYCLE_EVENT_TYPES.has(record.eventType)) {
            latestByOperation.set(
                operationKey,
                mergeOperationLifecycleRecord(latestByOperation.get(operationKey), record),
            );
        }
        if (record.credentialBinding !== null) credentialBinding = record.credentialBinding;
    }

    if (serverTime !== null) {
        const currentDay = canonicalFuturesProductionUtcDay(serverTime);
        if (lastServerTime !== null && serverTime < lastServerTime) fail('CLOCK_REGRESSED');
        if (lastUtcDay !== null && currentDay < lastUtcDay) fail('UTC_DAY_REGRESSED');
    }
    if (originWeightNow !== null) {
        requireNullableTime(originWeightNow);
        if (lastOriginWeightObservedAt !== null
            && lastOriginWeightObservedAt > originWeightNow) {
            fail('CLOCK_IN_FUTURE');
        }
    }

    const activeOperations = [...latestByOperation.values()].filter(record => (
        !TERMINAL_STATES.has(record.state)
        && !['rejected', 'expired'].includes(record.outcome)
    ));
    const activeBindings = new Set(
        activeOperations.map(record => record.credentialBinding).filter(Boolean),
    );
    if (activeBindings.size > 1) fail('CREDENTIAL_BINDING_MISMATCH');
    if (activeBindings.size === 1) [credentialBinding] = activeBindings;

    return Object.freeze({
        healthy: true,
        killSwitch,
        killSwitchEngaged: killSwitch === 'engaged',
        dailyReservations: Object.freeze(Object.fromEntries(
            [...dailyReservations.entries()].sort(([left], [right]) => left.localeCompare(right)),
        )),
        lastUtcDay,
        lastServerTime,
        dispatchTimes: Object.freeze([...dispatchTimes]),
        originWeightReservations: Object.freeze([...originWeightReservations]),
        lastOriginWeightObservedAt,
        pauseUntil,
        credentialBinding,
        activeOperations: Object.freeze([...activeOperations]),
    });
};

export const replayFuturesProductionExecutionAudit = (records, options = {}) => {
    if (!Array.isArray(records)) fail('INVALID_RECORD');
    const entries = records.map((record, index) => ({
        sequence: String(index + 1),
        hash: ZERO_HASH,
        record: createFuturesProductionExecutionAuditRecord(record),
    }));
    return replayRecords(entries, {
        originWeightNow: Date.now(),
        ...options,
    });
};

export const createFuturesProductionExecutionLedger = ({
    directory,
    integrityKey,
    secretValues = [],
    fsImpl = fs,
    now = Date.now,
} = {}) => {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('INVALID_DIRECTORY');
    validateSecretValues(secretValues);
    if (typeof now !== 'function') fail('INVALID_CONFIGURATION');
    const key = Buffer.isBuffer(integrityKey)
        ? Buffer.from(integrityKey)
        : Buffer.from(integrityKey ?? '');
    if (key.byteLength !== 32) fail('INVALID_INTEGRITY_KEY');

    const journalPath = path.join(directory, JOURNAL_FILE);
    const anchorPath = path.join(directory, ANCHOR_FILE);
    const lockPath = path.join(directory, LOCK_FILE);
    let journalHandle = null;
    let records = [];
    let previousHash = ZERO_HASH;
    let sequence = 0n;
    let opened = false;
    let poisoned = false;
    let leaseIdentity = null;
    let appendTail = Promise.resolve();
    let journalBytes = 0;

    const writeAnchor = async () => {
        const tempPath = path.join(directory, `.anchor-${process.pid}-${sequence}-${randomBytes(4).toString('hex')}.tmp`);
        const handle = await fsImpl.open(
            tempPath,
            fsConstants.constants.O_CREAT
                | fsConstants.constants.O_EXCL
                | fsConstants.constants.O_WRONLY
                | (fsConstants.constants.O_NOFOLLOW || 0),
            0o600,
        );
        try {
            await handle.writeFile(encodeAnchor(key, String(sequence), previousHash), 'utf8');
            await handle.sync();
            await verifyPrivateHandlePath(tempPath, handle, fsImpl);
        } finally {
            await handle.close();
        }
        await fsImpl.rename(tempPath, anchorPath);
        const anchorHandle = await fsImpl.open(
            anchorPath,
            fsConstants.constants.O_RDONLY | (fsConstants.constants.O_NOFOLLOW || 0),
        );
        try {
            await verifyPrivateHandlePath(anchorPath, anchorHandle, fsImpl);
        } finally {
            await anchorHandle.close();
        }
        await fsyncDirectory(directory, fsImpl);
    };

    const appendNow = async (record) => {
        if (!opened || !journalHandle || poisoned) {
            fail(poisoned ? 'LEDGER_FAILED_CLOSED' : 'LEDGER_NOT_OPEN');
        }
        const nextSequence = sequence + 1n;
        const { frame, hash } = encodeFrame(key, String(nextSequence), previousHash, record);
        if (records.length >= FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumRecords
            || journalBytes + frame.byteLength
                > FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumJournalBytes) {
            poisoned = true;
            fail('JOURNAL_CAPACITY_EXCEEDED');
        }
        try {
            await verifyLease(lockPath, leaseIdentity, fsImpl);
            await writeAll(journalHandle, frame);
            await journalHandle.sync();
            sequence = nextSequence;
            previousHash = hash;
            await writeAnchor();
            await verifyLease(lockPath, leaseIdentity, fsImpl);
        } catch (error) {
            poisoned = true;
            if (error instanceof FuturesProductionExecutionLedgerError) throw error;
            fail('PERSISTENCE_FAILED');
        }
        const entry = Object.freeze({ sequence: String(sequence), hash, record });
        records = [...records, entry];
        journalBytes += frame.byteLength;
        return entry;
    };

    const initializeDefaultKillSwitch = async () => {
        if (records.length !== 0) return;
        const observedAt = now();
        const record = createFuturesProductionExecutionAuditRecord({
            eventType: 'kill_switch_transition',
            category: 'safety',
            outcome: 'engaged',
            observedAt,
            state: 'engaged',
            code: 'DEFAULT_ENGAGED',
            safeDetail: 'persistent-default-engaged',
        }, { secretValues });
        await appendNow(record);
    };

    const cleanupFailedOpen = async () => {
        await journalHandle?.close().catch(() => {});
        journalHandle = null;
        opened = false;
        await relocateAndRemoveLease(lockPath, leaseIdentity, fsImpl, 'open-failed').catch(() => {});
        leaseIdentity = null;
    };

    const open = async () => {
        if (opened) return;
        poisoned = false;
        await ensurePrivateDirectory(directory, fsImpl);
        leaseIdentity = await acquireLease(lockPath, fsImpl);
        try {
            let anchor = null;
            try {
                const anchorBytes = await readPrivateFile(anchorPath, fsImpl, 4_096);
                anchor = decodeAnchor(key, anchorBytes.toString('utf8'));
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }

            const flags = fsConstants.constants.O_CREAT
                | fsConstants.constants.O_RDWR
                | fsConstants.constants.O_APPEND
                | (fsConstants.constants.O_NOFOLLOW || 0);
            journalHandle = await fsImpl.open(journalPath, flags, 0o600);
            const journalStat = await verifyPrivateHandlePath(journalPath, journalHandle, fsImpl);
            if (journalStat.size > FUTURES_PRODUCTION_EXECUTION_AUDIT_LIMITS.maximumJournalBytes) {
                fail('JOURNAL_CAPACITY_EXCEEDED');
            }
            const bytes = await journalHandle.readFile();
            if (anchor === null) {
                if (bytes.byteLength !== 0) fail('MISSING_ANCHOR');
                anchor = { sequence: '0', recordHash: ZERO_HASH };
                await writeAnchor();
            }
            const parsed = parseJournal(key, bytes, anchor, secretValues);
            if (parsed.truncateTo < bytes.byteLength) {
                await journalHandle.truncate(parsed.truncateTo);
                await journalHandle.sync();
            }
            records = parsed.records;
            previousHash = parsed.previousHash;
            sequence = BigInt(anchor.sequence);
            journalBytes = parsed.truncateTo;
            opened = true;
            await initializeDefaultKillSwitch();
            replayRecords(records, { originWeightNow: now() });
            await verifyLease(lockPath, leaseIdentity, fsImpl);
        } catch (error) {
            const safeError = error instanceof FuturesProductionExecutionLedgerError
                ? error
                : new FuturesProductionExecutionLedgerError('UNSAFE_FILE');
            await cleanupFailedOpen();
            throw safeError;
        }
    };

    const append = (input) => {
        const operation = appendTail.then(async () => {
            const record = createFuturesProductionExecutionAuditRecord(input, { secretValues });
            return appendNow(record);
        });
        appendTail = operation.catch(() => {});
        return operation;
    };

    const reserveDailyNotional = ({
        utcDay,
        serverTime,
        exactNotional,
        maximumDailyNotional,
        ...auditFields
    } = {}) => {
        const operation = appendTail.then(async () => {
            validateUtcDay(utcDay);
            if (canonicalFuturesProductionUtcDay(serverTime) !== utcDay) fail('INVALID_UTC_DAY');
            const increment = normalizeFuturesProductionExactDecimal(exactNotional);
            parseExactDecimal(increment, { positive: true });
            const maximum = normalizeFuturesProductionExactDecimal(maximumDailyNotional);
            parseExactDecimal(maximum, { positive: true });
            const snapshot = replayRecords(records, { serverTime });
            const prior = snapshot.dailyReservations[utcDay] ?? '0';
            const next = addFuturesProductionExactDecimals(prior, increment);
            if (compareFuturesProductionExactDecimals(next, maximum) > 0) {
                fail('DAILY_NOTIONAL_EXCEEDED');
            }
            const dispatchAt = auditFields.dispatchAt ?? now();
            const record = createFuturesProductionExecutionAuditRecord({
                ...auditFields,
                eventType: 'daily_notional_reserved',
                category: 'rate',
                outcome: 'accepted',
                observedAt: auditFields.observedAt ?? dispatchAt,
                dispatchAt,
                serverTime,
                utcDay,
                exactNotional: increment,
            }, { secretValues });
            const entry = await appendNow(record);
            return Object.freeze({
                entry,
                utcDay,
                reserved: next,
                remaining: subtractFuturesProductionExactDecimals(maximum, next),
            });
        });
        appendTail = operation.catch(() => {});
        return operation;
    };

    const setKillSwitch = ({ engaged, ...auditFields } = {}) => {
        const operation = appendTail.then(async () => {
            if (typeof engaged !== 'boolean') fail('INVALID_KILL_SWITCH_STATE');
            const observedAt = auditFields.observedAt ?? now();
            const state = engaged ? 'engaged' : 'disengaged';
            const record = createFuturesProductionExecutionAuditRecord({
                ...auditFields,
                eventType: 'kill_switch_transition',
                category: 'safety',
                outcome: state,
                observedAt,
                state,
            }, { secretValues });
            return appendNow(record);
        });
        appendTail = operation.catch(() => {});
        return operation;
    };

    const persistRatePause = ({ pauseUntil, ...auditFields } = {}) => append({
        ...auditFields,
        eventType: 'rate_pause',
        category: 'rate',
        outcome: 'accepted',
        observedAt: auditFields.observedAt ?? now(),
        pauseUntil,
        state: pauseUntil > (auditFields.observedAt ?? now()) ? 'paused' : 'clear',
    });

    const persistOriginWeightReservation = ({ requestWeight, ...auditFields } = {}) => {
        const operation = appendTail.then(async () => {
            const observedAt = auditFields.observedAt ?? now();
            const current = now();
            requireNullableTime(current);
            if (observedAt > current) fail('CLOCK_IN_FUTURE');
            const snapshot = replayRecords(records, { originWeightNow: current });
            if (snapshot.lastOriginWeightObservedAt !== null
                && observedAt < snapshot.lastOriginWeightObservedAt) {
                fail('CLOCK_REGRESSED');
            }
            const record = createFuturesProductionExecutionAuditRecord({
                ...auditFields,
                eventType: 'rate_counter',
                category: 'rate',
                outcome: 'accepted',
                observedAt,
                requestWeight,
                state: 'reserved',
            }, { secretValues });
            const entry = await appendNow(record);
            return Object.freeze({ entry, observedAt, requestWeight: record.requestWeight });
        });
        appendTail = operation.catch(() => {});
        return operation;
    };

    const getRecords = () => records.map(entry => entry.record);
    const findRequest = (requestId) => {
        for (let index = records.length - 1; index >= 0; index -= 1) {
            if (records[index].record.requestId === requestId) return records[index].record;
        }
        return null;
    };
    const findClientOrder = (clientOrderId) => {
        for (let index = records.length - 1; index >= 0; index -= 1) {
            if (records[index].record.clientOrderId === clientOrderId) return records[index].record;
        }
        return null;
    };
    const getReplaySnapshot = options => replayRecords(records, {
        ...options,
        originWeightNow: now(),
    });
    const getActiveOperations = () => getReplaySnapshot().activeOperations;
    const getOrderRateState = () => {
        const snapshot = getReplaySnapshot();
        return Object.freeze({
            dispatchTimes: snapshot.dispatchTimes,
            originWeightReservations: snapshot.originWeightReservations,
            lastOriginWeightObservedAt: snapshot.lastOriginWeightObservedAt,
            pauseUntil: snapshot.pauseUntil,
            dailyReservations: snapshot.dailyReservations,
            lastUtcDay: snapshot.lastUtcDay,
            lastServerTime: snapshot.lastServerTime,
        });
    };
    const assertHealthy = async () => {
        if (!opened || poisoned) fail(poisoned ? 'LEDGER_FAILED_CLOSED' : 'LEDGER_NOT_OPEN');
        await verifyLease(lockPath, leaseIdentity, fsImpl);
        return getReplaySnapshot();
    };

    const close = async () => {
        await appendTail;
        if (journalHandle) {
            await journalHandle.sync().catch(() => {});
            await journalHandle.close().catch(() => {});
            journalHandle = null;
        }
        opened = false;
        await relocateAndRemoveLease(lockPath, leaseIdentity, fsImpl, 'closed').catch(() => {});
        leaseIdentity = null;
    };

    return Object.freeze({
        open,
        append,
        reserveDailyNotional,
        setKillSwitch,
        persistRatePause,
        persistOriginWeightReservation,
        close,
        assertHealthy,
        getRecords,
        getRevision: () => String(sequence),
        findRequest,
        findClientOrder,
        getActiveOperations,
        getReplaySnapshot,
        getOrderRateState,
        getPaths: () => Object.freeze({ journalPath, anchorPath, lockPath }),
        getHealth: () => Object.freeze({
            opened,
            poisoned,
            leaseHeld: leaseIdentity !== null,
            healthy: opened && !poisoned && leaseIdentity !== null,
        }),
    });
};
