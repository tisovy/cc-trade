// The cluster fold must be indistinguishable from folding the reports one at
// a time — the drain feeds it a burst, and a burst that folded differently
// from a quiet afternoon would make the commit window change what the desk
// remembers. Asserted structurally: object identities may differ where the
// sequential fold rebuilt an entry it did not change.

import { describe, expect, it } from 'vitest'
import {
  applyFuturesHistoryReading,
  beginFuturesHistoryRead,
  createHeldFuturesHistory,
  foldExecutionIntoFuturesHistory,
  foldExecutionsIntoFuturesHistory,
} from './futuresHeldHistory.js'

const READ_AT = 1_784_000_000_000

const heldReading = (trades = [], orders = []) => applyFuturesHistoryReading(
  beginFuturesHistoryRead(createHeldFuturesHistory(), { symbol: 'AUSDT' }),
  {
    symbol: 'AUSDT',
    symbols: ['AUSDT', 'BUSDT'],
    orders,
    trades,
    discovered: 2,
    error: null,
  },
  READ_AT,
)

const fill = (orderId, tradeId, time, {
  symbol = 'AUSDT',
  quantity = '1',
  status = 'PARTIALLY_FILLED',
  executed = '1',
} = {}) => ({
  symbol,
  orderId,
  status,
  side: 'BUY',
  price: '2',
  origQty: '9',
  executedQty: executed,
  tradeId,
  lastFilledQty: quantity,
  lastFilledPrice: '2',
  realizedPnl: '0.1',
  time,
})

const sequential = (history, reports) => reports.reduce(
  (folded, report) => foldExecutionIntoFuturesHistory(folded, report),
  history,
)

describe('foldExecutionsIntoFuturesHistory', () => {
  it('matches the sequential fold for a mixed cluster', () => {
    const history = heldReading(
      [{ symbol: 'AUSDT', id: 1, orderId: 10, realizedPnl: '1', time: 1_000 }],
      [{ symbol: 'AUSDT', orderId: 10, status: 'FILLED', time: 1_000 }],
    )
    const reports = [
      fill(11, 21, 5_000),
      fill(11, 22, 5_100, { executed: '2' }),
      fill(12, 23, 5_050, { symbol: 'BUSDT' }),
      // A terminal report of the same order: both the order log and the
      // trade log take it.
      fill(11, 24, 5_200, { status: 'FILLED', executed: '9' }),
      // A cancellation carries no fill and touches only the order log.
      {
        symbol: 'AUSDT', orderId: 13, status: 'CANCELED', side: 'SELL',
        price: '3', origQty: '4', executedQty: '0', time: 5_300,
      },
    ]
    expect(foldExecutionsIntoFuturesHistory(history, reports))
      .toEqual(sequential(history, reports))
  })

  it('matches the sequential fold when reports share one moment', () => {
    const history = heldReading()
    // Equal times force the tie order through the same stable sort the
    // one-at-a-time fold produced with its prepends.
    const reports = [
      fill(31, 41, 7_000),
      fill(32, 42, 7_000),
      fill(33, 43, 7_000),
      fill(31, 44, 7_000, { executed: '2' }),
    ]
    expect(foldExecutionsIntoFuturesHistory(history, reports))
      .toEqual(sequential(history, reports))
  })

  it('matches the sequential fold across the per-contract retention bound', () => {
    const seed = Array.from({ length: 7_995 }, (_, index) => ({
      symbol: 'AUSDT',
      id: index + 100,
      orderId: index + 100,
      realizedPnl: '0',
      time: 10_000 + index,
    }))
    const history = heldReading(seed)
    const reports = Array.from({ length: 12 }, (_, index) => (
      fill(9_000 + index, 20_000 + index, 100_000 + index)
    ))
    const batch = foldExecutionsIntoFuturesHistory(history, reports)
    expect(batch).toEqual(sequential(history, reports))
    // The bound actually bit, so the equality covered the truncation path.
    expect(batch.trades.length).toBeLessThan(seed.length + reports.length)
  })

  it('advances the trade generation once per fill, as the sequential fold does', () => {
    const history = heldReading()
    const reports = [fill(51, 61, 8_000), fill(51, 62, 8_100), fill(52, 63, 8_200)]
    expect(foldExecutionsIntoFuturesHistory(history, reports).tradeGeneration)
      .toBe(sequential(history, reports).tradeGeneration)
  })

  it('folds nothing into a review nobody has read, exactly as one report does', () => {
    const unread = createHeldFuturesHistory()
    expect(foldExecutionsIntoFuturesHistory(unread, [fill(71, 81, 9_000)])).toBe(unread)
  })
})
