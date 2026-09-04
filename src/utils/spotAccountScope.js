const PRIVATE_TYPES = new Set(['balances', 'orders', 'history', 'execution_update', 'balance_update']);
const STORAGE_KINDS = new Set(['orders_history', 'pnl_snapshots']);

// Pseudonymous configured-key identity, not an exchange UID or authorization.
export const readSpotAccountFingerprint = value =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;

export const isSpotAccountPayload = payload => {
    if (!payload || typeof payload !== 'object' || payload.marketType === 'futures') return false;
    return PRIVATE_TYPES.has(payload.type)
        || [...PRIVATE_TYPES].some(type => Object.hasOwn(payload, type));
};

export const spotAccountStorageKey = (kind, fingerprint) =>
    STORAGE_KINDS.has(kind) && readSpotAccountFingerprint(fingerprint)
        ? `cc-trade:spot:v1:${fingerprint}:${kind}` : null;

export const readSpotAccountStorage = (kind, fingerprint, fallback = null) => {
    const key = spotAccountStorageKey(kind, fingerprint);
    if (!key) return fallback;
    try {
        const stored = JSON.parse(localStorage.getItem(key));
        return stored?.version === 1 && stored.marketType === 'spot'
            && stored.accountFingerprint === fingerprint && stored.kind === kind
            ? stored.data ?? fallback : fallback;
    } catch {
        return fallback;
    }
};

export const writeSpotAccountStorage = (kind, fingerprint, data) => {
    const key = spotAccountStorageKey(kind, fingerprint);
    if (!key) return false;
    try {
        localStorage.setItem(key, JSON.stringify({
            version: 1, marketType: 'spot', accountFingerprint: fingerprint, kind, data,
        }));
        return true;
    } catch {
        return false;
    }
};
