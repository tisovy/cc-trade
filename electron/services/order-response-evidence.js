import { evaluateOrderMutationPostcondition } from '../../src/utils/orderMutationPostcondition.js';
import { matchesOrderReportIdentity, readExchangeOrderId } from '../../src/utils/orderReportIdentity.js';

// A 2xx response is not permission to invent its order or state. This error
// enters the existing read-only reconciliation owner and never carries a body.
export class OrderResponseEvidenceError extends Error {
    constructor() {
        super('Binance returned insufficient order evidence; execution is unconfirmed.');
        this.name = 'OrderResponseEvidenceError';
        this.code = 'ORDER_RESPONSE_UNCONFIRMED';
        this.indeterminate = true;
        this.outcomeCertainty = 'unknown';
    }
}

export const requireOrderResponseEvidence = (report, command, action = null) => {
    // This boundary reads REST order objects, never a nested stream envelope.
    if (!report || typeof report !== 'object' || Array.isArray(report)
        || typeof report.symbol !== 'string' || readExchangeOrderId(report.orderId) === null
        || report.e === 'ORDER_TRADE_UPDATE') throw new OrderResponseEvidenceError();
    const clientOrderId = action === 'trade.placeOrder'
        ? command.newClientOrderId : command.origClientOrderId;
    const identityMatches = action === 'trade.placeOrder' && clientOrderId == null
        ? (report?.symbol ?? report?.s) === command.symbol
            && readExchangeOrderId(report?.orderId ?? report?.i) !== null
        : matchesOrderReportIdentity(report, {
            symbol: command.symbol, orderId: action === 'trade.placeOrder' ? null : command.orderId, clientOrderId,
        });
    if (!identityMatches || (action !== null && evaluateOrderMutationPostcondition({
        action, report,
        expected: { price: command.numericPrice ?? command.price, quantity: command.numericQuantity ?? command.quantity },
    }).state !== 'confirmed')) throw new OrderResponseEvidenceError();
    return report;
};
