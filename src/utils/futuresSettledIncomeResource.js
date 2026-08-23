// Canonical, transport-neutral representation of the Futures income record.
//
// This module deliberately has no Node, Electron or React dependencies. The
// same identity and resource semantics can therefore be used at the HTTP
// boundary, in the durable store, across IPC and in the renderer without each
// layer inventing a subtly different key.

export const FUTURES_SETTLED_INCOME_RESOURCE_VERSION = 2;

// Shared by acquisition, persistence and renderer admission. The producer
// stops one lane at this many canonical rows; a receiver must refuse a larger
// array before canonicalizing or sorting it, otherwise the wire boundary has a
// larger (effectively unbounded) resource budget than the process that created
// the resource.
export const MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE = 24_000;

export const DEFAULT_FUTURES_SETTLED_INCOME_TYPES = Object.freeze([
    'FUNDING_FEE',
    'INSURANCE_CLEAR',
    'COMMISSION_REBATE',
    'REFERRAL_KICKBACK',
    'API_REBATE',
    'FEE_RETURN',
]);

const LANE_STATUSES = new Set(['idle', 'loading', 'ready', 'stale', 'error']);
const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const CANONICAL_INCOME_TYPE_TEXT = /^[A-Z0-9_]+$/;
const CANONICAL_SYMBOL_TEXT = /^[A-Z0-9_]+$/;
const CANONICAL_ASSET_TEXT = /^[A-Z0-9]+$/;
const SAFE_ERROR_CODE_TEXT = /^(?:-?\d{1,10}|[A-Z][A-Z0-9_]{0,63})$/;
const MAX_IDENTIFIER_TEXT_LENGTH = 64;
const MAX_INCOME_TYPE_TEXT_LENGTH = 64;
const MAX_SYMBOL_TEXT_LENGTH = 64;
const MAX_ASSET_TEXT_LENGTH = 32;
const MAX_DECIMAL_TEXT_LENGTH = 256;
const MAX_DECIMAL_DIGITS = 128;
const MAX_DECIMAL_SCALE = 64;
const MAX_ERROR_SOURCE_TEXT_LENGTH = 4_096;
const CREDENTIAL_MARKER_TEXT = /\b(?:proxy-authorization|authorization|x-mbx-api[-_]?key|api[-_ ]?key|signature|secret|bearer|basic)\b/i;
const CONTRACT_SCOPED_INCOME_TYPES = new Set([
    'FUNDING_FEE',
    'INSURANCE_CLEAR',
]);

const finiteTime = (value) => {
    if (Number.isSafeInteger(value)) return value >= 0 ? value : null;
    if (typeof value !== 'string' || !INTEGER_TEXT.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const finiteOptionalTime = value => (value === null || value === undefined
    ? null
    : finiteTime(value));

const text = value => (typeof value === 'string' ? value.trim() : '');

// IDs parsed as an unsafe JavaScript number are irrecoverably rounded. Refuse
// them here; the exchange adapter must preserve their JSON token as a string.
// Safe numeric IDs remain accepted for compatibility with existing callers.
export const exactFuturesIncomeIdentifier = (value) => {
    const candidate = typeof value === 'string'
        ? value
        : typeof value === 'bigint'
            ? value.toString()
            : Number.isSafeInteger(value) ? String(value) : null;
    return candidate !== null
        && candidate.length <= MAX_IDENTIFIER_TEXT_LENGTH
        && INTEGER_TEXT.test(candidate)
        ? candidate
        : null;
};

const identityPart = (value) => `${value.length}:${value}`;

const boundedUpperText = (value, maximumLength) => {
    const source = typeof value === 'string' ? value : '';
    if (source.length > maximumLength) return null;
    if (source.trim() === '') return '';
    return source === source.trim() ? source : null;
};

const boundedDecimalText = (value) => {
    // Exact exchange money is textual. Once a JSON number has crossed the
    // JavaScript parser its original decimal digits cannot be recovered, even
    // when the rounded value happens to look finite or safe.
    const source = typeof value === 'string' ? value : '';
    if (source.length > MAX_DECIMAL_TEXT_LENGTH) return null;
    const candidate = source.trim();
    if (!DECIMAL_TEXT.test(candidate)) return null;
    const unsigned = candidate.startsWith('-') || candidate.startsWith('+')
        ? candidate.slice(1)
        : candidate;
    const [integer = '', fraction = ''] = unsigned.split('.');
    if (integer.length + fraction.length > MAX_DECIMAL_DIGITS
        || fraction.length > MAX_DECIMAL_SCALE) return null;
    const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';
    const normalizedFraction = fraction.replace(/0+$/, '');
    const zero = normalizedInteger === '0' && normalizedFraction === '';
    const sign = candidate.startsWith('-') && !zero ? '-' : '';
    return normalizedFraction === ''
        ? `${sign}${normalizedInteger}`
        : `${sign}${normalizedInteger}.${normalizedFraction}`;
};

const identifierExceedsBound = value => (
    (typeof value === 'string' && value.length > MAX_IDENTIFIER_TEXT_LENGTH)
    || (typeof value === 'bigint' && value.toString().length > MAX_IDENTIFIER_TEXT_LENGTH)
);

const optionalIdentifierIsMalformed = (value, canonical) => (
    value !== null
    && value !== undefined
    && value !== ''
    && canonical === null
);

const canonicalParts = (row) => {
    const incomeType = boundedUpperText(row?.incomeType, MAX_INCOME_TYPE_TEXT_LENGTH);
    const symbol = boundedUpperText(row?.symbol, MAX_SYMBOL_TEXT_LENGTH);
    const asset = boundedUpperText(row?.asset, MAX_ASSET_TEXT_LENGTH);
    const income = boundedDecimalText(row?.income);
    const time = finiteTime(row?.time);
    const tranId = exactFuturesIncomeIdentifier(row?.tranId);
    const tradeId = exactFuturesIncomeIdentifier(row?.tradeId);
    if (identifierExceedsBound(row?.tranId)
        || identifierExceedsBound(row?.tradeId)
        || optionalIdentifierIsMalformed(row?.tranId, tranId)
        || optionalIdentifierIsMalformed(row?.tradeId, tradeId)
        || incomeType === null || incomeType.length === 0
        || !CANONICAL_INCOME_TYPE_TEXT.test(incomeType)
        || symbol === null
        || (CONTRACT_SCOPED_INCOME_TYPES.has(incomeType) && symbol.length === 0)
        || (symbol.length > 0 && !CANONICAL_SYMBOL_TEXT.test(symbol))
        || asset === null || asset.length === 0
        || !CANONICAL_ASSET_TEXT.test(asset)
        || income === null
        || time === null) return null;

    return {
        incomeType,
        symbol,
        asset,
        income,
        time,
        tranId,
        tradeId,
    };
};

const identityFromParts = (parts) => {
    if (parts.tranId !== null) {
        return `fsi:v2:tran:${identityPart(parts.incomeType)}:${identityPart(parts.tranId)}`;
    }
    const fields = [
        parts.incomeType,
        parts.symbol,
        String(parts.time),
        parts.income,
        parts.asset,
        parts.tradeId ?? '',
    ];
    return `fsi:v2:row:${fields.map(identityPart).join(':')}`;
};

export const canonicalFuturesIncomeRowIdentity = (row) => {
    const parts = canonicalParts(row);
    return parts === null ? null : identityFromParts(parts);
};

export const canonicalFuturesIncomeRow = (row) => {
    const parts = canonicalParts(row);
    if (parts === null) return null;
    return Object.freeze({
        identity: identityFromParts(parts),
        symbol: parts.symbol,
        incomeType: parts.incomeType,
        income: parts.income,
        asset: parts.asset,
        time: parts.time,
        tranId: parts.tranId,
        tradeId: parts.tradeId,
    });
};

const compareRows = (left, right) => (
    left.time - right.time
    || left.incomeType.localeCompare(right.incomeType)
    || left.identity.localeCompare(right.identity)
);

export const canonicalFuturesIncomeRows = (rows) => {
    const byIdentity = new Map();
    for (const raw of rows ?? []) {
        const row = canonicalFuturesIncomeRow(raw);
        if (row !== null) byIdentity.set(row.identity, row);
    }
    return [...byIdentity.values()].sort(compareRows);
};

export const canonicalFuturesIncomeRowMap = rows => new Map(
    canonicalFuturesIncomeRows(rows).map(row => [row.identity, row]),
);

export const sanitizeFuturesSettledIncomeError = (error) => {
    if (error === null || error === undefined) return null;
    const rawCode = typeof error?.code === 'string' || Number.isFinite(error?.code)
        ? String(error.code).trim()
        : '';
    const code = SAFE_ERROR_CODE_TEXT.test(rawCode) ? rawCode : 'READ_FAILED';
    const source = (typeof error?.message === 'string'
        ? error.message
        : (typeof error === 'string' ? error : 'Income history read failed'))
        .slice(0, MAX_ERROR_SOURCE_TEXT_LENGTH);
    // Do not persist URLs, query strings, headers or credentials accidentally
    // embedded in an HTTP client's message.
    const message = (CREDENTIAL_MARKER_TEXT.test(source)
        ? 'Income history read failed [credentials redacted]'
        : source.replace(/https?:\/\/\S+/gi, '[url]'))
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 240);
    const rawStatus = error?.status ?? error?.statusCode ?? error?.response?.status;
    const numericStatus = rawStatus === null || rawStatus === undefined || rawStatus === ''
        ? null
        : Number(rawStatus);
    const status = Number.isInteger(numericStatus)
        && numericStatus >= 100
        && numericStatus <= 599
        ? numericStatus
        : null;
    return Object.freeze({
        code,
        message,
        ...(status === null ? {} : { status }),
    });
};

const normalizeIncomeType = value => text(value).toUpperCase();

const cloneRowsForType = (rows, incomeType) => {
    const result = new Map();
    const source = rows instanceof Map ? rows.values() : (rows ?? []);
    for (const raw of source) {
        const row = canonicalFuturesIncomeRow(raw);
        if (row !== null && row.incomeType === incomeType) result.set(row.identity, row);
    }
    return result;
};

const normalizePending = (pending, incomeType) => {
    if (!pending) return null;
    const targetFrom = finiteTime(pending.targetFrom);
    const targetTo = finiteTime(pending.targetTo);
    const nextPage = Number.isSafeInteger(pending.nextPage) && pending.nextPage > 0
        ? pending.nextPage
        : null;
    if (targetFrom === null || targetTo === null || targetFrom > targetTo || nextPage === null) {
        return null;
    }
    return {
        targetFrom,
        targetTo,
        nextPage,
        rows: cloneRowsForType(pending.rows, incomeType),
    };
};

export const createFuturesSettledIncomeLane = (incomeType, values = {}) => {
    const type = normalizeIncomeType(incomeType);
    const coveredFrom = finiteOptionalTime(values.coveredFrom);
    const coveredTo = finiteOptionalTime(values.coveredTo);
    const validCoverage = coveredFrom !== null && coveredTo !== null && coveredFrom <= coveredTo;
    const rawAttemptedAt = finiteOptionalTime(values.attemptedAt);
    const successfulAt = finiteOptionalTime(values.successfulAt);
    // A last attempt cannot predate the success it claims to have observed.
    // Constructor callers receive a safely degraded state rather than an
    // impossible clock that can poison aggregate freshness ordering; durable
    // and IPC trust boundaries reject the raw contradiction atomically.
    const attemptedAt = rawAttemptedAt !== null
        && successfulAt !== null
        && rawAttemptedAt < successfulAt
        ? null
        : rawAttemptedAt;
    const targetTo = finiteOptionalTime(values.targetTo);
    const confirmationNotBefore = finiteOptionalTime(values.confirmationNotBefore);
    const pending = normalizePending(values.pending, type);
    const rows = cloneRowsForType(values.rows, type);
    const requestedStatus = LANE_STATUSES.has(values.status) ? values.status : 'idle';
    const readyStateIsValid = requestedStatus !== 'ready' || (
        pending === null
        && confirmationNotBefore === null
        && validCoverage
        && targetTo !== null
        && attemptedAt !== null
        && successfulAt !== null
        && attemptedAt >= successfulAt
    );
    const hasRetainedEvidence = successfulAt !== null
        || validCoverage
        || rows.size > 0;
    const status = confirmationNotBefore !== null
        ? 'stale'
        : readyStateIsValid
            ? requestedStatus
            : pending !== null
                ? 'loading'
                : hasRetainedEvidence ? 'stale' : 'idle';
    return {
        incomeType: type,
        rows,
        coveredFrom: validCoverage ? coveredFrom : null,
        coveredTo: validCoverage ? coveredTo : null,
        targetTo,
        nextPage: Number.isSafeInteger(values.nextPage) && values.nextPage > 0
            ? values.nextPage
            : 1,
        status,
        attemptedAt,
        successfulAt,
        confirmationNotBefore,
        complete: values.complete === true
            && status === 'ready'
            && pending === null
            && confirmationNotBefore === null,
        error: sanitizeFuturesSettledIncomeError(values.error),
        pending,
    };
};

export const cloneFuturesSettledIncomeLane = lane => createFuturesSettledIncomeLane(
    lane?.incomeType,
    lane,
);

const rowTuple = row => [
    row.identity,
    row.incomeType,
    row.symbol,
    row.income,
    row.asset,
    row.time,
    row.tranId,
    row.tradeId,
];

const serializableLane = lane => ({
    incomeType: lane.incomeType,
    // `lane` has just crossed createFuturesSettledIncomeLane, so its Maps already
    // contain canonical, identity-deduplicated rows. Sort those rows for stable
    // persistence without canonicalizing the complete lane a second time.
    rows: [...lane.rows.values()].sort(compareRows),
    coveredFrom: lane.coveredFrom,
    coveredTo: lane.coveredTo,
    targetTo: lane.targetTo,
    nextPage: lane.nextPage,
    status: lane.status,
    attemptedAt: lane.attemptedAt,
    successfulAt: lane.successfulAt,
    confirmationNotBefore: lane.confirmationNotBefore,
    complete: lane.complete,
    error: lane.error,
    pending: lane.pending === null ? null : {
        targetFrom: lane.pending.targetFrom,
        targetTo: lane.pending.targetTo,
        nextPage: lane.pending.nextPage,
        rows: [...lane.pending.rows.values()].sort(compareRows),
    },
});

const serializableLanesOf = resource => Object.values(resource?.lanes ?? {})
    .map(lane => createFuturesSettledIncomeLane(lane.incomeType, lane))
    .sort((left, right) => left.incomeType.localeCompare(right.incomeType))
    .map(serializableLane);

const laneTuple = (lane) => {
    const tuple = [
        lane.incomeType,
        lane.status,
        lane.coveredFrom,
        lane.coveredTo,
        lane.targetTo,
        lane.nextPage,
        lane.complete,
        lane.error?.code ?? null,
        lane.error?.status ?? null,
        lane.error?.message ?? null,
        lane.rows.map(rowTuple),
        lane.pending === null ? null : [
            lane.pending.targetFrom,
            lane.pending.targetTo,
            lane.pending.nextPage,
            lane.pending.rows.map(rowTuple),
        ],
    ];
    // Keep debt-free v2 snapshots digest-compatible with stores written before
    // confirmation debt became durable. A real deadline is still authenticated
    // as content and therefore advances the resource generation.
    if (lane.confirmationNotBefore !== null) tuple.push(lane.confirmationNotBefore);
    return tuple;
};

const fnv1a = (source, seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
};

const digestFromSerializableLanes = (resource, lanes) => {
    const source = JSON.stringify([
        FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
        resource?.status ?? 'idle',
        resource?.coveredFrom ?? null,
        resource?.coveredTo ?? null,
        resource?.targetTo ?? null,
        resource?.error?.code ?? null,
        resource?.error?.message ?? null,
        lanes.map(laneTuple),
    ]);
    return `${fnv1a(source, 0x811c9dc5)}${fnv1a(source, 0x9e3779b9)}`;
};

export const futuresSettledIncomeContentDigest = (resource) => {
    const lanes = serializableLanesOf(resource);
    return digestFromSerializableLanes(resource, lanes);
};

const aggregateStatus = (lanes) => {
    if (lanes.some(lane => lane.status === 'error')) {
        return lanes.some(lane => lane.successfulAt !== null || lane.rows.size > 0) ? 'stale' : 'error';
    }
    if (lanes.some(lane => lane.status === 'stale')) return 'stale';
    if (lanes.some(lane => lane.status === 'loading')) return 'loading';
    if (lanes.length > 0 && lanes.every(lane => lane.status === 'ready')) return 'ready';
    return 'idle';
};

const aggregateCoverage = (lanes) => {
    if (lanes.length === 0 || lanes.some(
        lane => lane.coveredFrom === null || lane.coveredTo === null,
    )) return { coveredFrom: null, coveredTo: null };
    const coveredFrom = Math.max(...lanes.map(lane => lane.coveredFrom));
    const coveredTo = Math.min(...lanes.map(lane => lane.coveredTo));
    return coveredFrom <= coveredTo
        ? { coveredFrom, coveredTo }
        : { coveredFrom: null, coveredTo: null };
};

const composeResource = ({ lanes: laneInput, generation = 0 }) => {
    const lanes = {};
    for (const lane of Object.values(laneInput ?? {})) {
        const normalized = createFuturesSettledIncomeLane(lane.incomeType, lane);
        if (normalized.incomeType.length > 0) lanes[normalized.incomeType] = normalized;
    }
    const ordered = Object.values(lanes).sort(
        (left, right) => left.incomeType.localeCompare(right.incomeType),
    );
    const rows = new Map();
    for (const lane of ordered) {
        for (const [identity, row] of lane.rows) rows.set(identity, row);
    }
    const coverage = aggregateCoverage(ordered);
    const attempted = ordered.map(lane => lane.attemptedAt).filter(value => value !== null);
    const successful = ordered.map(lane => lane.successfulAt).filter(value => value !== null);
    const targets = ordered.map(lane => lane.targetTo).filter(value => value !== null);
    const targetTo = targets.length > 0 ? Math.max(...targets) : null;
    const status = aggregateStatus(ordered);
    const completeByType = Object.fromEntries(ordered.map(lane => [
        lane.incomeType,
        lane.status === 'ready'
            && lane.complete
            && lane.coveredFrom !== null
            && lane.coveredTo !== null
            && lane.targetTo !== null
            && lane.coveredTo >= lane.targetTo,
    ]));
    const error = ordered.find(lane => lane.error !== null)?.error ?? null;
    const resource = {
        version: FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
        status,
        rows,
        lanes,
        coveredFrom: coverage.coveredFrom,
        coveredTo: coverage.coveredTo,
        targetTo,
        completeByType,
        complete: ordered.length > 0
            && targetTo !== null
            && Object.values(completeByType).every(Boolean)
            && ordered.every(lane => (
                lane.coveredTo !== null && lane.coveredTo >= targetTo
            )),
        attemptedAt: attempted.length > 0 ? Math.max(...attempted) : null,
        successfulAt: successful.length === ordered.length && successful.length > 0
            ? Math.min(...successful)
            : null,
        error,
        generation,
        digest: null,
        // Compatibility aliases for the current connection while it migrates.
        from: coverage.coveredFrom,
        to: coverage.coveredTo,
        slice: null,
        gap: null,
    };
    resource.digest = futuresSettledIncomeContentDigest(resource);
    return resource;
};

export const createFuturesSettledIncomeResource = ({
    incomeTypes = DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
    lanes = null,
    generation = 0,
} = {}) => {
    const laneInput = lanes ?? Object.fromEntries(
        incomeTypes.map(incomeType => [
            normalizeIncomeType(incomeType),
            createFuturesSettledIncomeLane(incomeType),
        ]),
    );
    return composeResource({ lanes: laneInput, generation });
};

export const finalizeFuturesSettledIncomeResource = ({ lanes, previous = null }) => {
    const priorGeneration = Number.isSafeInteger(previous?.generation) && previous.generation >= 0
        ? previous.generation
        : 0;
    const candidate = composeResource({ lanes, generation: priorGeneration });
    const priorDigest = typeof previous?.digest === 'string'
        ? previous.digest
        : (previous === null ? null : futuresSettledIncomeContentDigest(previous));
    if (priorDigest !== null && priorDigest !== candidate.digest) {
        candidate.generation = priorGeneration + 1;
    }
    return candidate;
};

export const serializeFuturesSettledIncomeResource = (resource) => {
    const serializedLanes = serializableLanesOf(resource);
    return {
        version: FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
        generation: Number.isSafeInteger(resource?.generation) ? resource.generation : 0,
        // Compute the digest from the exact canonical snapshot being written.
        // Store validation can compare this once against `resource.digest`
        // instead of canonicalizing and hashing the full resource twice.
        digest: digestFromSerializableLanes(resource, serializedLanes),
        lanes: serializedLanes,
    };
};

const persistedCanonicalRows = (rows, incomeType) => {
    if (!Array.isArray(rows)
        || rows.length > MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE) return null;
    const identities = new Set();
    const canonical = [];
    for (const raw of rows) {
        const row = canonicalFuturesIncomeRow(raw);
        if (row === null
            || row.incomeType !== incomeType
            || raw?.identity !== row.identity
            || raw?.symbol !== row.symbol
            || raw?.incomeType !== row.incomeType
            || raw?.income !== row.income
            || raw?.asset !== row.asset
            || raw?.time !== row.time
            || raw?.tranId !== row.tranId
            || raw?.tradeId !== row.tradeId
            || identities.has(row.identity)) return null;
        identities.add(row.identity);
        canonical.push(row);
    }
    return canonical;
};

export const restoreFuturesSettledIncomeResource = (payload, {
    incomeTypes = DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
    windowFrom = null,
    now = null,
} = {}) => {
    if (payload?.version !== FUTURES_SETTLED_INCOME_RESOURCE_VERSION) return null;
    if (!Array.isArray(payload.lanes)) return null;
    if (typeof payload.digest !== 'string') return null;
    const required = new Set(incomeTypes.map(normalizeIncomeType));
    const lanes = {};
    for (const rawLane of payload.lanes) {
        const type = normalizeIncomeType(rawLane?.incomeType);
        if (!required.has(type) || lanes[type] !== undefined) return null;
        if (!LANE_STATUSES.has(rawLane?.status)) return null;
        const rawTargetTo = finiteOptionalTime(rawLane?.targetTo);
        const rawAttemptedAt = finiteOptionalTime(rawLane?.attemptedAt);
        const rawSuccessfulAt = finiteOptionalTime(rawLane?.successfulAt);
        const rawConfirmationNotBefore = finiteOptionalTime(
            rawLane?.confirmationNotBefore,
        );
        if ((rawLane?.targetTo !== null && rawLane?.targetTo !== undefined
                && rawTargetTo === null)
            || (rawLane?.attemptedAt !== null && rawLane?.attemptedAt !== undefined
                && rawAttemptedAt === null)
            || (rawLane?.successfulAt !== null && rawLane?.successfulAt !== undefined
                && rawSuccessfulAt === null)
            || (rawLane?.confirmationNotBefore !== null
                && rawLane?.confirmationNotBefore !== undefined
                && rawConfirmationNotBefore === null)
            || (rawAttemptedAt !== null && rawSuccessfulAt !== null
                && rawAttemptedAt < rawSuccessfulAt)) return null;
        const rawHasCoveredFrom = rawLane?.coveredFrom !== null
            && rawLane?.coveredFrom !== undefined;
        const rawHasCoveredTo = rawLane?.coveredTo !== null
            && rawLane?.coveredTo !== undefined;
        if (rawHasCoveredFrom !== rawHasCoveredTo) return null;
        if (rawHasCoveredFrom) {
            const rawCoveredFrom = finiteTime(rawLane.coveredFrom);
            const rawCoveredTo = finiteTime(rawLane.coveredTo);
            if (rawCoveredFrom === null
                || rawCoveredTo === null
                || rawCoveredFrom > rawCoveredTo) return null;
        }
        const rows = persistedCanonicalRows(rawLane?.rows, type);
        if (rows === null) return null;
        let pending = null;
        if (rawLane?.pending !== null) {
            if (rawLane?.pending === undefined || typeof rawLane.pending !== 'object') return null;
            const pendingRows = persistedCanonicalRows(rawLane.pending.rows, type);
            if (pendingRows === null) return null;
            pending = { ...rawLane.pending, rows: pendingRows };
        }
        if ((rawLane.status === 'ready' && (
            rawAttemptedAt === null
            || rawSuccessfulAt === null
            || rawLane?.pending !== null
            || rawConfirmationNotBefore !== null
        )) || (rawLane?.complete === true && (
            rawLane.status !== 'ready'
            || rawLane?.pending !== null
            || rawConfirmationNotBefore !== null
        )) || (rawConfirmationNotBefore !== null
            && rawLane.status !== 'stale')) return null;
        const lane = createFuturesSettledIncomeLane(type, {
            ...rawLane,
            rows,
            pending,
        });
        if (rawLane?.pending !== null && lane.pending === null) return null;
        if ((lane.status === 'ready' || lane.complete)
            && (lane.coveredFrom === null || lane.coveredTo === null)) return null;
        if (lane.pending !== null) {
            if ([...lane.pending.rows.values()].some(row => (
                row.time < lane.pending.targetFrom || row.time > lane.pending.targetTo
            ))) return null;
        }
        lanes[type] = lane;
    }
    if ([...required].some(type => lanes[type] === undefined)) return null;
    const generation = Number.isSafeInteger(payload.generation) && payload.generation >= 0
        ? payload.generation
        : 0;
    const persisted = composeResource({ lanes, generation });
    if (payload.digest !== persisted.digest) return null;

    // Wall time can step backwards between the stream invalidation write and a
    // restart. Authenticate the exact persisted content first: otherwise
    // clipping a corrupted snapshot could accidentally make its old digest look
    // valid. Only a debt target whose displacement fits inside its own persisted
    // confirmation interval may cross the new clock. The target/deadline are an
    // obligation, not coverage; all future evidence around them still degrades.
    let clockDegraded = false;
    if (now !== null) {
        for (const lane of Object.values(lanes)) {
            const futureRows = [...lane.rows.values()].some(row => row.time > now);
            const futurePending = lane.pending !== null && (
                lane.pending.targetFrom > now
                || lane.pending.targetTo > now
                || [...lane.pending.rows.values()].some(row => row.time > now)
            );
            const hasFutureEvidence = (lane.coveredFrom !== null && lane.coveredFrom > now)
                || (lane.coveredTo !== null && lane.coveredTo > now)
                || (lane.targetTo !== null && lane.targetTo > now)
                || (lane.attemptedAt !== null && lane.attemptedAt > now)
                || (lane.successfulAt !== null && lane.successfulAt > now)
                || futureRows
                || futurePending;
            if (!hasFutureEvidence) continue;

            const confirmationInterval = lane.confirmationNotBefore !== null
                && lane.targetTo !== null
                ? lane.confirmationNotBefore - lane.targetTo
                : null;
            const boundedDebtRollback = lane.targetTo !== null
                && lane.targetTo > now
                && Number.isSafeInteger(confirmationInterval)
                && confirmationInterval >= 0
                && lane.targetTo - now <= confirmationInterval;
            if (!boundedDebtRollback) return null;

            if (futureRows) {
                lane.rows = new Map([...lane.rows].filter(([, row]) => row.time <= now));
                clockDegraded = true;
            }
            if (lane.coveredTo !== null && lane.coveredTo > now) {
                if (lane.coveredFrom !== null && lane.coveredFrom <= now) {
                    lane.coveredTo = now;
                } else {
                    lane.coveredFrom = null;
                    lane.coveredTo = null;
                }
                lane.complete = false;
                clockDegraded = true;
            }
            if (futurePending) {
                // A page checkpoint is one transaction over its frozen target.
                // Truncating it would create a prefix the exchange never proved,
                // so discard it and let the next pass restart from confirmed data.
                lane.pending = null;
                lane.nextPage = 1;
                lane.complete = false;
                clockDegraded = true;
            }
            if (lane.attemptedAt !== null && lane.attemptedAt > now) {
                lane.attemptedAt = null;
                clockDegraded = true;
            }
            if (lane.successfulAt !== null && lane.successfulAt > now) {
                lane.successfulAt = null;
                lane.complete = false;
                clockDegraded = true;
            }
        }
    }

    // Sliding the caller's retention window is a new truthful resource state,
    // not a corrupt persisted digest. Verify first, then trim and advance the
    // generation if the visible content or coverage changed.
    if (windowFrom === null) {
        return clockDegraded
            ? finalizeFuturesSettledIncomeResource({ lanes, previous: persisted })
            : persisted;
    }
    for (const lane of Object.values(lanes)) {
        if (lane.coveredTo !== null && lane.coveredTo < windowFrom) return null;
        lane.rows = new Map([...lane.rows].filter(([, row]) => (
            row.time >= windowFrom && (now === null || row.time <= now)
        )));
        if (lane.coveredFrom !== null) lane.coveredFrom = Math.max(lane.coveredFrom, windowFrom);
        if (lane.coveredFrom !== null && lane.coveredFrom > lane.coveredTo) {
            lane.coveredFrom = null;
            lane.coveredTo = null;
            lane.complete = false;
        }
        if (lane.pending !== null && lane.pending.targetFrom < windowFrom) {
            lane.pending = null;
            lane.nextPage = 1;
            lane.status = lane.successfulAt === null ? 'idle' : 'stale';
        }
    }
    return finalizeFuturesSettledIncomeResource({ lanes, previous: persisted });
};
