const isCommandPayloadObject = (payload) => (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
);

const normalizeTextField = (value) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString();
    }
    return null;
};

const normalizeSide = (value) => {
    const side = normalizeTextField(value)?.toUpperCase();
    return side === 'BUY' || side === 'SELL' ? side : null;
};

const normalizePositiveNumber = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
};

const hasUsableValue = (value) => {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || value.trim() !== '';
};

const firstUsableValue = (...values) => values.find(hasUsableValue);

const normalizeOrderId = (value) => {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return /^[1-9]\d*$/.test(trimmed) ? trimmed : null;
    }
    return null;
};

export const createCommandRejection = (request, code, message, details = {}) => ({
    command_rejected: {
        request,
        code,
        message,
        details,
        timestamp: Date.now(),
    },
});

export const validateLegacyOrderCommand = (payload, { requestType = 'buyOrder', selectedSymbol } = {}) => {
    if (!isCommandPayloadObject(payload)) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_PAYLOAD',
                `${requestType} payload must be an object`,
                { field: 'data' },
            ),
        };
    }

    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_SYMBOL',
                `${requestType} requires a symbol`,
                { field: 'symbol' },
            ),
        };
    }

    const defaultSide = requestType === 'sellOrder' ? 'SELL' : 'BUY';
    const sideSource = hasUsableValue(payload.side) ? payload.side : defaultSide;
    const side = normalizeSide(sideSource);
    if (!side) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_SIDE',
                `${requestType} side must be BUY or SELL`,
                { field: 'side', value: payload.side },
            ),
        };
    }

    const quantityValue = payload.quantity ?? payload.qty;
    const numericQuantity = normalizePositiveNumber(quantityValue);
    if (numericQuantity === null) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_QUANTITY',
                `${requestType} quantity must be a positive finite number`,
                { field: payload.quantity === undefined ? 'qty' : 'quantity', value: quantityValue },
            ),
        };
    }

    const priceValue = payload.price ?? payload.p;
    const numericPrice = normalizePositiveNumber(priceValue);
    if (numericPrice === null) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_PRICE',
                `${requestType} price must be a positive finite number`,
                { field: payload.price === undefined ? 'p' : 'price', value: priceValue },
            ),
        };
    }

    return {
        ok: true,
        command: {
            symbol,
            side,
            quantityValue,
            priceValue,
            numericQuantity,
            numericPrice,
        },
    };
};

export const validateLegacyCancelCommand = (payload, { selectedSymbol } = {}) => {
    const requestType = 'cancelOrder';
    if (!isCommandPayloadObject(payload)) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_PAYLOAD',
                'cancelOrder payload must be an object',
                { field: 'data' },
            ),
        };
    }

    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_SYMBOL',
                'cancelOrder requires a symbol',
                { field: 'symbol' },
            ),
        };
    }

    const rawOrderId = firstUsableValue(payload.orderId, payload.id);
    const rawOrigClientOrderId = firstUsableValue(payload.origClientOrderId, payload.clientOrderId);
    const orderId = rawOrderId === undefined ? null : normalizeOrderId(rawOrderId);
    const origClientOrderId = rawOrigClientOrderId === undefined ? null : normalizeTextField(rawOrigClientOrderId);
    if (rawOrderId !== undefined && orderId === null) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_ORDER_ID',
                'cancelOrder orderId must be a positive integer',
                { field: payload.orderId === undefined ? 'id' : 'orderId', value: rawOrderId },
            ),
        };
    }
    if (!orderId && !origClientOrderId) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_TARGET',
                'cancelOrder requires orderId or origClientOrderId',
                { fields: ['orderId', 'id', 'origClientOrderId', 'clientOrderId'] },
            ),
        };
    }

    const newClientOrderId = hasUsableValue(payload.newClientOrderId)
        ? normalizeTextField(payload.newClientOrderId)
        : null;
    if (hasUsableValue(payload.newClientOrderId) && !newClientOrderId) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_NEW_CLIENT_ORDER_ID',
                'cancelOrder newClientOrderId must be a non-empty string',
                { field: 'newClientOrderId', value: payload.newClientOrderId },
            ),
        };
    }

    return {
        ok: true,
        command: {
            symbol,
            orderId,
            origClientOrderId,
            newClientOrderId,
        },
    };
};
