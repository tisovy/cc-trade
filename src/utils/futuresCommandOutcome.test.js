import { describe, expect, it } from 'vitest'
import {
  FUTURES_COMMAND_OUTCOME,
  readFuturesCommandAnswer,
} from './futuresCommandOutcome.js'

const cancelWatcher = Object.freeze({
  kind: 'cancel',
  request: 'trade.cancelOrder',
  symbol: 'BTCUSDT',
  orderId: '11',
  clientOrderId: 'order-abc',
})

const placeWatcher = Object.freeze({
  kind: 'place',
  request: 'trade.placeOrder',
  symbol: 'BTCUSDT',
  orderId: null,
  clientOrderId: 'f-mint-1',
})

describe('readFuturesCommandAnswer', () => {
  it.each(['UNKNOWN', '', undefined, 'PENDING_CANCEL'])('does not invent a cancel refusal for status %s', status => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'execution', report: { symbol: 'BTCUSDT', orderId: '11', status },
    })).toBeNull()
  })

  it('ignores another action on the same order', () => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'rejected', envelope: {
        request: 'trade.replaceOrder', details: { symbol: 'BTCUSDT', orderId: '11' },
      },
    })).toBeNull()
  })

  it('does not call an unknown placement refused or use execution type as order status', () => {
    for (const report of [{ status: 'UNKNOWN' }, { x: 'NEW' }, {}]) {
      expect(readFuturesCommandAnswer(placeWatcher, {
        kind: 'execution', report: { symbol: 'BTCUSDT', clientOrderId: 'f-mint-1', ...report },
      })).toBeNull()
    }
  })
  it('confirms a cancellation only when the exchange reports the order cancelled', () => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'execution',
      report: { symbol: 'BTCUSDT', orderId: '11', status: 'CANCELED' },
    })).toMatchObject({ outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED })
  })

  // A report that still describes the order as working is not an answer: the
  // reconciliation that finds the order alive lands here, and a drag started on
  // it would show a lifted order that is still resting on the book.
  it('waits while the order is still reported as working', () => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'execution',
      report: { symbol: 'BTCUSDT', orderId: '11', status: 'NEW' },
    })).toBeNull()
  })

  // The market took it. The order is gone, but nothing is owed for it: no
  // replacement may be placed against a fill.
  it('refuses a cancellation whose order filled instead', () => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'execution',
      report: { symbol: 'BTCUSDT', orderId: '11', status: 'FILLED' },
    })).toMatchObject({
      outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
      code: 'ORDER_NOT_CANCELLED',
    })
  })

  it('ignores traffic about another order', () => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'execution',
      report: { symbol: 'ETHUSDT', orderId: '99', status: 'CANCELED' },
    })).toBeNull()
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'rejected',
      envelope: {
        request: 'trade.cancelOrder',
        code: 'FUTURES_API_ERROR',
        details: { symbol: 'BTCUSDT', orderId: '77' },
      },
    })).toBeNull()
  })

  it('reads a refusal that names the order as this command being refused', () => {
    expect(readFuturesCommandAnswer(cancelWatcher, {
      kind: 'rejected',
      envelope: {
        request: 'trade.cancelOrder',
        code: 'FUTURES_API_ERROR',
        message: 'Unknown order sent.',
        details: { symbol: 'BTCUSDT', orderId: '11' },
      },
    })).toMatchObject({
      outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
      message: 'Unknown order sent.',
    })
  })

  // A refusal composed before the order was identified names only the action;
  // there is nothing more specific to compare it against.
  it('reads an unidentified refusal of the same action as this command', () => {
    expect(readFuturesCommandAnswer(placeWatcher, {
      kind: 'rejected',
      envelope: {
        request: 'trade.placeOrder',
        code: 'FUTURES_ORDER_CAP_EXCEEDED',
        details: { marketType: 'futures', capUsdt: '200' },
      },
    })).toMatchObject({ outcome: FUTURES_COMMAND_OUTCOME.REFUSED })
    expect(readFuturesCommandAnswer(placeWatcher, {
      kind: 'rejected',
      envelope: { request: 'trade.cancelOrder', details: {} },
    })).toBeNull()
  })

  it('confirms a placement the exchange reports as working', () => {
    expect(readFuturesCommandAnswer(placeWatcher, {
      kind: 'execution',
      report: { symbol: 'BTCUSDT', clientOrderId: 'f-mint-1', status: 'NEW' },
    })).toMatchObject({ outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED })
  })

  it('reads both an unresolved warning and its withdrawal as unknown', () => {
    for (const kind of ['unresolved', 'resolved']) {
      expect(readFuturesCommandAnswer(placeWatcher, {
        kind,
        envelope: {
          request: 'trade.placeOrder',
          code: 'FUTURES_OUTCOME_PENDING',
          details: { symbol: 'BTCUSDT', clientOrderId: 'f-mint-1' },
        },
      })).toMatchObject({ outcome: FUTURES_COMMAND_OUTCOME.UNKNOWN })
    }
  })
})
