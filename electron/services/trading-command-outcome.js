// Binance is explicit that some failures do not tell you whether the order
// executed: an HTTP 503 "Unknown error" *may* have succeeded, and the order
// status must be confirmed before retrying. The desk used to convert every
// failure — timeout, socket error, 5xx, and a plain business rejection — into
// one rejection, so the operator saw "not placed" for an order that could be
// live, and a retry created a second real one.
//
// This module is the single place that decides which failures are honest
// refusals and which are silence.

export const TRADING_OUTCOME = Object.freeze({
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    UNRESOLVED: 'unresolved',
});

// The request left this machine and may have been executed before the failure.
const INDETERMINATE_TRANSPORT_CODES = Object.freeze(new Set([
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNRESET',
    'ECONNABORTED',
    'EPIPE',
    'ERR_SOCKET_CONNECTION_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
]));

// The connection was never established, so nothing could have been executed.
// Treating these as unknown would send the operator hunting for an order that
// provably does not exist.
const DETERMINATE_TRANSPORT_CODES = Object.freeze(new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]));

const readStatus = (error) => {
    const candidates = [error?.status, error?.statusCode, error?.response?.status];
    for (const candidate of candidates) {
        const status = Number(candidate);
        if (Number.isFinite(status) && status > 0) return status;
    }
    return null;
};

/**
 * True when a failed mutating request may nevertheless have executed.
 *
 * Only mutating commands consult this. A read that times out is simply a failed
 * read: nothing was changed, so there is nothing to reconcile.
 */
export const isIndeterminateTradingFailure = (error) => {
    if (error?.indeterminate === true) return true;
    const status = readStatus(error);
    if (status !== null) return status >= 500;
    const code = typeof error?.code === 'string' ? error.code : null;
    if (code === null) return false;
    if (DETERMINATE_TRANSPORT_CODES.has(code)) return false;
    return INDETERMINATE_TRANSPORT_CODES.has(code);
};

export const UNRESOLVED_COMMAND_MESSAGE = 'Binance did not confirm this order either way.'
    + ' It may be live. The desk is checking it against the exchange —'
    + ' do not resubmit until the check answers.';

export const UNCONFIRMED_COMMAND_MESSAGE = 'Binance could not confirm whether this order exists.'
    + ' Check the order on Binance before acting on it. No retry is offered,'
    + ' because resubmitting could create a second order.';

/**
 * The renderer-facing shape of an outcome that is neither accepted nor refused.
 *
 * It is deliberately not a `command_rejected`: a rejection invites a retry, and
 * retrying an order that may already be live is the exact failure this exists to
 * prevent.
 */
export const createCommandUnresolved = (request, code, message, details = {}) => ({
    command_unresolved: {
        request,
        code,
        message,
        details,
        timestamp: Date.now(),
    },
});
