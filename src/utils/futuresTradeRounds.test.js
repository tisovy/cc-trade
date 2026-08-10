import { describe, expect, it } from 'vitest'
import { buildFuturesTradeRounds } from './futuresTradeRounds.js'

const fill = (overrides = {}) => ({
  id: 1,
  orderId: 10,
  symbol: 'BICOUSDT',
  side: 'BUY',
  price: '2.554',
  quantity: '1000',
  commission: '0.0102',
  realizedPnl: '0',
  time: 1_784_000_000_000,
  ...overrides,
})

describe('buildFuturesTradeRounds', () => {
  // One market close arrives as five fills in the same second, each with a sixth
  // of the PnL. The position is one thing that happened.
  it('folds the fills of one round trip into the position they were', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '2.554', quantity: '3000', commission: '0.0306', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '2.632', quantity: '1000', commission: '0.0105', realizedPnl: '78', time: 5000 }),
      fill({ id: 3, side: 'SELL', price: '2.632', quantity: '2000', commission: '0.0210', realizedPnl: '156', time: 5000 }),
    ])
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG',
      openTime: 1000,
      closeTime: 5000,
      quantity: '3000',
      entryPrice: 2.554,
      exitPrice: 2.632,
      realizedPnl: 234,
      fills: 3,
      open: false,
      partial: false,
    })
    expect(rounds[0].fee).toBeCloseTo(0.0621, 8)
    // Realized PnL is reported before commission, so the net is stated apart.
    expect(rounds[0].netPnl).toBeCloseTo(233.9379, 8)
  })

  it('averages the entry and the exit across the fills of each side', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '2', quantity: '1000', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '3', quantity: '1000', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '4', quantity: '2000', realizedPnl: '3000', time: 3000 }),
    ])
    expect(round.entryPrice).toBeCloseTo(2.5, 8)
    expect(round.exitPrice).toBe(4)
    expect(round.quantity).toBe('2000')
  })

  // A position that is still open is not a result yet, and must not be reported
  // as one. The surface that reviews closed positions drops it on this flag.
  it('reports a position still open as open, and states its entry from its own fills', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '2.6', quantity: '1000', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '2.5', quantity: '400', realizedPnl: '40', time: 2000 }),
    ])
    expect(round).toMatchObject({
      positionSide: 'SHORT',
      quantity: '1000',
      exitPrice: 2.5,
      realizedPnl: 40,
      open: true,
    })
  })

  // Exchange decimals: 0.1 + 0.2 − 0.3 is 5.5e-17 in floating point, and a round
  // that never reaches flat swallows every position after it.
  it('closes a round on exact decimal arithmetic', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '100', quantity: '0.1', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '100', quantity: '0.2', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '110', quantity: '0.3', realizedPnl: '3', time: 3000 }),
      fill({ id: 4, side: 'BUY', price: '100', quantity: '0.5', time: 4000 }),
    ])
    expect(rounds).toHaveLength(2)
    // Newest first, like every other history table in the desk.
    expect(rounds[0]).toMatchObject({ open: true, quantity: '0.5' })
    expect(rounds[1]).toMatchObject({ open: false, quantity: '0.3', realizedPnl: 3 })
  })

  // The window of trades the exchange returns is bounded, so its first rows can be
  // the closing fills of a position opened before it. The entry is not lost: the
  // realized PnL states it exactly, so it is recovered rather than shown as a dash.
  it('recovers the entry price of a position opened before the window', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '2.632', quantity: '1000', realizedPnl: '78', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '2.640', quantity: '500', realizedPnl: '40', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '2.500', quantity: '800', realizedPnl: '0', time: 3000 }),
    ])
    expect(rounds).toHaveLength(2)
    const closed = rounds[1]
    expect(closed).toMatchObject({
      // A SELL that realizes PnL closed a long, whatever the side of the fill says.
      positionSide: 'LONG',
      quantity: '1500',
      realizedPnl: 118,
      partial: true,
      entryImplied: true,
      open: false,
    })
    // 1500 sold at an average of 2.634666… for 118 of profit was entered at
    // 2.556 — the exchange's own arithmetic, inverted.
    expect(closed.entryPrice).toBeCloseTo(2.556, 8)
    expect(closed.exitPrice).toBeCloseTo(2.6346666, 6)
    // The position opened afterwards is its own round, not part of that one.
    expect(rounds[0]).toMatchObject({ positionSide: 'LONG', quantity: '800', open: true })
  })

  // A desk that sizes every order in USDT cannot read a position it is handed in
  // contracts: 3 000 BICO and 3 000 BMT differ by two orders of magnitude.
  it('values each round in USDT at the price it was entered at', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '2.500', quantity: '4000', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '2.600', quantity: '4000', realizedPnl: '400', time: 2000 }),
    ])
    expect(round.notional).toBeCloseTo(10_000, 6)
    // The exit is the entry plus what the round realized, which is the column
    // beside it — so the two readings cannot contradict each other.
    expect(round.notional + round.realizedPnl).toBeCloseTo(4000 * 2.6, 6)
  })

  // The entry of a position opened before the window is recovered rather than
  // read, and what it was worth follows from the same arithmetic.
  it('values a round whose entry was recovered rather than read', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '2.632', quantity: '1000', realizedPnl: '78', time: 1000 }),
    ])
    expect(round.entryImplied).toBe(true)
    // 1 000 sold at 2.632 for 78 of profit was entered at 2.554: 2 554 USDT.
    expect(round.notional).toBeCloseTo(2554, 6)
  })

  // A market order larger than the position closes it and opens the opposite one.
  it('splits a fill that flips the position into two rounds', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '2', quantity: '100', commission: '0.01', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '3', quantity: '300', commission: '0.03', realizedPnl: '100', time: 2000 }),
    ])
    expect(rounds).toHaveLength(2)
    const closed = rounds[1]
    // All of the realized PnL was made on the way out of the long.
    expect(closed).toMatchObject({ positionSide: 'LONG', quantity: '100', realizedPnl: 100 })
    expect(closed.fee).toBeCloseTo(0.02, 8)
    const opened = rounds[0]
    expect(opened).toMatchObject({
      positionSide: 'SHORT',
      quantity: '200',
      entryPrice: 3,
      realizedPnl: 0,
      open: true,
    })
    expect(opened.fee).toBeCloseTo(0.02, 8)
  })

  it('ignores fills it cannot read rather than reporting a round built on them', () => {
    expect(buildFuturesTradeRounds([
      fill({ id: 1, quantity: '0' }),
      fill({ id: 2, quantity: 'abc' }),
      fill({ id: 3, price: '0' }),
    ])).toEqual([])
    expect(buildFuturesTradeRounds(null)).toEqual([])
    expect(buildFuturesTradeRounds()).toEqual([])
  })

  // The account trades several contracts, and one contract's exposure says nothing
  // about another's: folding them together would close rounds that never closed.
  it('folds each contract on its own exposure', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2', quantity: '100', time: 1000 }),
      fill({ id: 1, symbol: 'BTCUSDT', side: 'SELL', price: '60000', quantity: '0.5', time: 2000 }),
      fill({ id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '3', quantity: '100', realizedPnl: '100', time: 3000 }),
    ])
    expect(rounds).toHaveLength(2)
    // Newest first across contracts, and each round says which contract it is.
    expect(rounds[0]).toMatchObject({
      symbol: 'BICOUSDT', positionSide: 'LONG', quantity: '100', realizedPnl: 100, open: false,
    })
    expect(rounds[1]).toMatchObject({
      symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '0.5', open: true,
    })
    // Trade ids are numbered per contract, so the keys must still differ.
    expect(rounds[0].key).not.toBe(rounds[1].key)
  })

  it('orders the fills itself rather than trusting the order they arrive in', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 3, side: 'SELL', price: '3', quantity: '100', realizedPnl: '100', time: 3000 }),
      fill({ id: 1, side: 'BUY', price: '2', quantity: '100', time: 1000 }),
    ])
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({ entryPrice: 2, exitPrice: 3, open: false })
  })
})
