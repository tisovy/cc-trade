import { createHash } from 'node:crypto';
import { isSpotAccountPayload, readSpotAccountFingerprint } from '../../src/utils/spotAccountScope.js';

export const createSpotAccountFingerprint = apiKey =>
    typeof apiKey === 'string' && apiKey.trim()
        ? createHash('sha256').update('cc-trade:spot-account:v1\0').update(apiKey).digest('hex')
        : null;

export const stampSpotAccountPayload = (payload, fingerprint) =>
    isSpotAccountPayload(payload)
        // Append after the legacy payload key; parseData reads that key first.
        ? { ...payload, spot_account_fingerprint: readSpotAccountFingerprint(fingerprint) }
        : payload;
