import fs from 'node:fs/promises';
import fsConstants from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const JOURNAL_FILE = 'journal.bin';
const ANCHOR_FILE = 'anchor.json';
const LOCK_FILE = 'journal.lock';
const RECORD_VERSION = 1;
const MAX_RECORD_BYTES = 16_384;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 50_000;
const ZERO_HASH = '0'.repeat(64);
const TERMINAL_STATES = new Set([
    'locally_rejected',
    'exchange_rejected',
    'confirmed_filled',
    'confirmed_canceled',
]);

export class FuturesTestnetExecutionLedgerError extends Error {
    constructor(code) {
        super('Futures testnet execution ledger is unavailable');
        this.name = 'FuturesTestnetExecutionLedgerError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesTestnetExecutionLedgerError(code);
};

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
);

const canonicalize = (value) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_RECORD');
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isPlainObject(value)) fail('INVALID_RECORD');
    return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
};

const canonicalJson = (value) => JSON.stringify(canonicalize(value));

const hmacHex = (key, ...chunks) => {
    const hmac = createHmac('sha256', key);
    chunks.forEach((chunk) => hmac.update(chunk));
    return hmac.digest('hex');
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
    if (!isPlainObject(value)
        || value.version !== RECORD_VERSION
        || !/^(0|[1-9][0-9]*)$/.test(value.sequence)
        || !/^[0-9a-f]{64}$/.test(value.recordHash ?? '')
        || !/^[0-9a-f]{64}$/.test(value.mac ?? '')) {
        fail('CORRUPT_ANCHOR');
    }
    const body = canonicalJson({
        version: value.version,
        sequence: value.sequence,
        recordHash: value.recordHash,
    });
    if (hmacHex(key, 'anchor\0', body) !== value.mac) fail('CORRUPT_ANCHOR');
    return value;
};

const encodeFrame = (key, sequence, previousHash, record) => {
    const payload = Buffer.from(canonicalJson({
        version: RECORD_VERSION,
        sequence,
        previousHash,
        record,
    }), 'utf8');
    if (payload.byteLength > MAX_RECORD_BYTES) fail('RECORD_TOO_LARGE');
    const hash = hmacHex(key, 'record\0', previousHash, '\0', sequence, '\0', payload);
    const frame = Buffer.allocUnsafe(4 + payload.byteLength + 32);
    frame.writeUInt32BE(payload.byteLength, 0);
    payload.copy(frame, 4);
    Buffer.from(hash, 'hex').copy(frame, 4 + payload.byteLength);
    return { frame, hash };
};

const parseJournal = (key, bytes, anchor) => {
    const records = [];
    let offset = 0;
    let previousHash = ZERO_HASH;
    let expectedSequence = 1n;
    let anchoredEnd = anchor.sequence === '0' ? 0 : null;
    while (offset < bytes.byteLength) {
        const remaining = bytes.byteLength - offset;
        if (remaining < 4) break;
        const length = bytes.readUInt32BE(offset);
        if (length === 0 || length > MAX_RECORD_BYTES) fail('CORRUPT_JOURNAL');
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
        if (!isPlainObject(parsed)
            || parsed.version !== RECORD_VERSION
            || parsed.sequence !== sequence
            || parsed.previousHash !== previousHash
            || !isPlainObject(parsed.record)) {
            fail('CORRUPT_JOURNAL');
        }
        const expectedHash = hmacHex(key, 'record\0', previousHash, '\0', sequence, '\0', payload);
        if (expectedHash !== storedHash) fail('CORRUPT_JOURNAL');
        records.push(Object.freeze({
            sequence,
            hash: storedHash,
            record: Object.freeze(parsed.record),
        }));
        offset += frameLength;
        previousHash = storedHash;
        expectedSequence += 1n;
        if (sequence === anchor.sequence && storedHash === anchor.recordHash) anchoredEnd = offset;
        if (anchoredEnd !== null && offset > anchoredEnd) fail('UNANCHORED_COMPLETE_RECORD');
    }

    if (anchor.sequence === '0') {
        if (anchor.recordHash !== ZERO_HASH || records.length > 0) fail('ANCHOR_ROLLBACK');
    } else if (anchoredEnd === null) {
        fail('ANCHOR_ROLLBACK');
    }
    if (offset < bytes.byteLength && anchoredEnd !== offset) fail('CORRUPT_JOURNAL');
    return { records, truncateTo: offset, previousHash };
};

const ensurePrivateDirectory = async (directory, fsImpl) => {
    await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsImpl.chmod(directory, 0o700);
    const stat = await fsImpl.lstat(directory);
    if (!stat.isDirectory()
        || (stat.mode & 0o777) !== 0o700
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        fail('UNSAFE_DIRECTORY');
    }
};

const verifyRegularPrivateFile = async (filePath, fsImpl) => {
    const stat = await fsImpl.lstat(filePath);
    if (!stat.isFile()
        || stat.nlink !== 1
        || (stat.mode & 0o777) !== 0o600
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        fail('UNSAFE_FILE');
    }
    return stat;
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
        const stat = await verifyRegularPrivateFile(quarantinePath, fsImpl);
        const contents = await fsImpl.readFile(quarantinePath, 'utf8');
        matches = stat.dev === identity.device
            && stat.ino === identity.inode
            && contents === identity.contents;
    } catch {
        matches = false;
    }
    if (matches) await fsImpl.unlink(quarantinePath).catch(() => {});
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
            const nonce = randomBytes(16).toString('hex');
            const contents = `${process.pid} ${nonce}\n`;
            await handle.writeFile(contents, 'utf8');
            await handle.sync();
            await handle.close();
            await fsImpl.chmod(lockPath, 0o600);
            const stat = await verifyRegularPrivateFile(lockPath, fsImpl);
            return Object.freeze({
                contents,
                device: stat.dev,
                inode: stat.ino,
            });
        } catch (error) {
            if (error?.code !== 'EEXIST') fail('LEASE_UNAVAILABLE');
            let stalePid = null;
            let staleIdentity = null;
            try {
                const before = await verifyRegularPrivateFile(lockPath, fsImpl);
                const contents = await fsImpl.readFile(lockPath, 'utf8');
                const after = await verifyRegularPrivateFile(lockPath, fsImpl);
                if (before.dev !== after.dev || before.ino !== after.ino) fail('LEASE_UNAVAILABLE');
                stalePid = Number(contents.trim().split(' ')[0]);
                staleIdentity = {
                    contents,
                    device: before.dev,
                    inode: before.ino,
                };
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
    let stat;
    let contents;
    try {
        stat = await verifyRegularPrivateFile(lockPath, fsImpl);
        contents = await fsImpl.readFile(lockPath, 'utf8');
    } catch {
        fail('LEASE_LOST');
    }
    if (stat.dev !== identity.device
        || stat.ino !== identity.inode
        || contents !== identity.contents) {
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

const fsyncDirectory = async (directory, fsImpl) => {
    const handle = await fsImpl.open(directory, fsConstants.constants.O_RDONLY);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

export const createFuturesTestnetExecutionCommandDigest = (command) => {
    if (!isPlainObject(command)) fail('INVALID_COMMAND');
    const fields = [
        'action', 'version', 'requestId', 'marketType', 'environment', 'symbol', 'side',
        'orderType', 'quantity', 'price', 'timeInForce', 'positionSide', 'marginType',
        'leverage', 'reduceOnly', 'workingType', 'priceProtect', 'clientOrderId',
    ];
    const hash = createHash('sha256');
    hash.update('cc-trade/futures-testnet-command/v1');
    for (const field of fields) {
        if (!Object.hasOwn(command, field)) fail('INVALID_COMMAND');
        const bytes = Buffer.from(canonicalJson(command[field]), 'utf8');
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(bytes.byteLength, 0);
        hash.update(length);
        hash.update(bytes);
    }
    return hash.digest('hex');
};

export const createFuturesTestnetExecutionLedger = ({
    directory,
    integrityKey,
    fsImpl = fs,
} = {}) => {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('INVALID_DIRECTORY');
    const key = Buffer.isBuffer(integrityKey) ? Buffer.from(integrityKey) : Buffer.from(integrityKey ?? '');
    if (key.byteLength < 32) fail('INVALID_INTEGRITY_KEY');

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
        const tempPath = path.join(directory, `.anchor-${process.pid}-${sequence}.tmp`);
        const handle = await fsImpl.open(
            tempPath,
            fsConstants.constants.O_CREAT | fsConstants.constants.O_EXCL | fsConstants.constants.O_WRONLY,
            0o600,
        );
        try {
            await handle.writeFile(encodeAnchor(key, String(sequence), previousHash), 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fsImpl.chmod(tempPath, 0o600);
        await fsImpl.rename(tempPath, anchorPath);
        await fsyncDirectory(directory, fsImpl);
    };

    const open = async () => {
        if (opened) return;
        await ensurePrivateDirectory(directory, fsImpl);
        leaseIdentity = await acquireLease(lockPath, fsImpl);
        try {
            let anchor;
            try {
                anchor = decodeAnchor(key, await fsImpl.readFile(anchorPath, 'utf8'));
                await verifyRegularPrivateFile(anchorPath, fsImpl);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
                anchor = { sequence: '0', recordHash: ZERO_HASH };
            }
            const flags = fsConstants.constants.O_CREAT
                | fsConstants.constants.O_RDWR
                | fsConstants.constants.O_APPEND
                | (fsConstants.constants.O_NOFOLLOW || 0);
            journalHandle = await fsImpl.open(journalPath, flags, 0o600);
            await fsImpl.chmod(journalPath, 0o600);
            await verifyRegularPrivateFile(journalPath, fsImpl);
            const journalStat = await journalHandle.stat();
            if (journalStat.size > MAX_JOURNAL_BYTES) fail('JOURNAL_CAPACITY_EXCEEDED');
            const bytes = await journalHandle.readFile();
            if (anchor.sequence === '0' && bytes.byteLength === 0) await writeAnchor();
            const parsed = parseJournal(key, bytes, anchor);
            if (parsed.truncateTo < bytes.byteLength) {
                await journalHandle.truncate(parsed.truncateTo);
                await journalHandle.sync();
            }
            records = parsed.records;
            if (records.length > MAX_RECORDS) fail('JOURNAL_CAPACITY_EXCEEDED');
            previousHash = parsed.previousHash;
            sequence = BigInt(anchor.sequence);
            journalBytes = parsed.truncateTo;
            opened = true;
        } catch (error) {
            const safeError = error instanceof FuturesTestnetExecutionLedgerError
                ? error
                : new FuturesTestnetExecutionLedgerError('UNSAFE_FILE');
            await journalHandle?.close().catch(() => {});
            journalHandle = null;
            await relocateAndRemoveLease(lockPath, leaseIdentity, fsImpl, 'open-failed');
            leaseIdentity = null;
            throw safeError;
        }
    };

    const appendNow = async (record) => {
        if (!opened || !journalHandle || poisoned) {
            fail(poisoned ? 'LEDGER_FAILED_CLOSED' : 'LEDGER_NOT_OPEN');
        }
        const nextSequence = sequence + 1n;
        const normalizedRecord = canonicalize(record);
        const { frame, hash } = encodeFrame(key, String(nextSequence), previousHash, normalizedRecord);
        if (records.length >= MAX_RECORDS
            || journalBytes + frame.byteLength > MAX_JOURNAL_BYTES) {
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
            if (error instanceof FuturesTestnetExecutionLedgerError) throw error;
            fail('PERSISTENCE_FAILED');
        }
        const entry = Object.freeze({
            sequence: String(sequence),
            hash,
            record: Object.freeze(normalizedRecord),
        });
        records = [...records, entry];
        journalBytes += frame.byteLength;
        return entry;
    };

    const append = (record) => {
        const operation = appendTail.then(() => appendNow(record));
        appendTail = operation.catch(() => {});
        return operation;
    };

    const getRecords = () => records.map((entry) => entry.record);
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
    const getLatestByRequest = () => {
        const byRequest = new Map();
        for (const entry of records) {
            if (entry.record.requestId) byRequest.set(entry.record.requestId, entry.record);
        }
        return [...byRequest.values()];
    };
    const getLatestAttempt = () => records.at(-1)?.record ?? null;
    const getActiveAttempt = () => {
        const active = getLatestByRequest().filter(record => !TERMINAL_STATES.has(record.state));
        if (active.length > 1) fail('MULTIPLE_ACTIVE_ATTEMPTS');
        return active[0] ?? null;
    };
    const getDispatchTimes = () => records
        .filter((entry) => entry.record.event === 'dispatch_intent')
        .map((entry) => entry.record.observedAt);
    const getOrderRateState = () => {
        let pauseUntil = 0;
        for (const entry of records) {
            const value = entry.record.pauseUntil;
            if (Number.isSafeInteger(value) && value >= 0) pauseUntil = Math.max(pauseUntil, value);
        }
        return Object.freeze({
            dispatchTimes: Object.freeze(getDispatchTimes()),
            pauseUntil,
        });
    };

    const close = async () => {
        await appendTail;
        if (journalHandle) {
            await journalHandle.sync().catch(() => {});
            await journalHandle.close().catch(() => {});
            journalHandle = null;
        }
        opened = false;
        await relocateAndRemoveLease(lockPath, leaseIdentity, fsImpl, 'closed');
        leaseIdentity = null;
    };

    return Object.freeze({
        open,
        append,
        close,
        getRecords,
        findRequest,
        findClientOrder,
        getLatestAttempt,
        getActiveAttempt,
        getDispatchTimes,
        getOrderRateState,
        getRevision: () => String(sequence),
        getPaths: () => Object.freeze({ journalPath, anchorPath, lockPath }),
    });
};
