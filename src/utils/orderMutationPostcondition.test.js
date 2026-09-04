import { describe, expect, it } from 'vitest'
import { evaluateOrderMutationPostcondition as evaluate, readUnresolvedOrderPostcondition as read } from './orderMutationPostcondition.js'
import { answersUnresolvedCommand } from './unresolvedCommandIdentity.js'

const expected = { price: '40000', quantity: '0.004' }
const held = (request = 'trade.cancelOrder') => ({ request, details: { symbol: 'BTCUSDT', orderId: '11', clientOrderId: 'original', expected } })

describe('action-specific mutation evidence', () => {
  it.each(['NEW', 'PARTIALLY_FILLED', 'PENDING_NEW', 'PENDING_CANCEL', 'UNKNOWN', '', undefined])('does not prove cancellation from %s', status => {
    expect(evaluate({ action: 'trade.cancelOrder', report: { status } }).state).toBe('pending')
  })
  it.each(['CANCELED', 'CANCELLED'])('confirms cancellation from %s only', status => {
    expect(evaluate({ action: 'trade.cancelOrder', report: { status } })).toMatchObject({ state: 'confirmed', code: 'OUTCOME_CANCELED' })
  })
  it.each(['FILLED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'])('explains terminal %s without claiming cancellation', status => {
    expect(evaluate({ action: 'trade.cancelOrder', report: { status } })).toMatchObject({ state: 'terminal', status, code: 'ORDER_NOT_CANCELLED' })
  })
  it.each(['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED'])('recognized %s proves that placement existed', status => {
    expect(evaluate({ action: 'trade.placeOrder', report: { status } }).state).toBe('confirmed')
  })
  it('does not turn a rejected or missing-status placement into accepted', () => {
    expect(evaluate({ action: 'trade.placeOrder', report: { status: 'REJECTED' } }).state).toBe('terminal')
    expect(evaluate({ action: 'trade.placeOrder', report: {} }).state).toBe('pending')
  })
  it.each([
    { price: '39999', origQty: '0.004' }, { price: '40000', origQty: '0.003' },
    { price: '40000' }, { origQty: '0.004' }, { price: '4e4', origQty: '0.004' },
    { price: Infinity, origQty: '0.004' }, { price: '40000', origQty: 'NaN' },
  ])('does not confirm unmatched or missing amendment terms: %j', report => {
    expect(evaluate({ action: 'trade.replaceOrder', report: { status: 'NEW', ...report }, expected }).state).toBe('pending')
  })
  it('compares both terms exactly, allowing equivalent decimal formatting', () => {
    expect(evaluate({ action: 'trade.replaceOrder', report: { X: 'PARTIALLY_FILLED', p: '040000.000', q: '0.004000' }, expected }).state).toBe('confirmed')
    const large = { price: '9007199254740993.0001', quantity: '0.00000000000000000001' }
    expect(evaluate({ action: 'trade.replaceOrder', report: { status: 'NEW', price: '9007199254740993.0002', origQty: large.quantity }, expected: large }).state).toBe('pending')
    expect(evaluate({ action: 'trade.replaceOrder', report: { status: 'FILLED', price: large.price, origQty: large.quantity }, expected: large }).state).toBe('confirmed')
  })
  it('explains closed unmatched amendments and retains uncertainty without expected terms', () => {
    expect(evaluate({ action: 'trade.replaceOrder', report: { status: 'FILLED', price: '39999', origQty: '0.004' }, expected })).toMatchObject({ state: 'terminal', code: 'AMENDMENT_NOT_CONFIRMED' })
    expect(evaluate({ action: 'trade.replaceOrder', report: { status: 'NEW', price: '40000', origQty: '0.004' } }).state).toBe('pending')
  })
  it('requires matching identity and does not confuse two actions on one order', () => {
    expect(read(held(), { symbol: 'ETHUSDT', orderId: '11', status: 'CANCELED' })).toBeNull()
    expect(read(held(), { symbol: 'BTCUSDT', orderId: '12', status: 'CANCELED' })).toBeNull()
    expect(answersUnresolvedCommand(held(), { symbol: 'BTCUSDT', orderId: '11', request: 'trade.placeOrder' })).toBe(false)
    expect(read(held(), { symbol: 'BTCUSDT', orderId: '11', status: 'NEW' }).state).toBe('pending')
    expect(read(held(), { s: 'BTCUSDT', c: 'cancel-request', C: 'original', X: 'CANCELED' }).state).toBe('confirmed')
  })
})
