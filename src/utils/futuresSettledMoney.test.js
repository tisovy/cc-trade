import { describe, expect, it } from 'vitest'
import {
  foldFuturesSettledMoney,
  readFuturesOpenPositionStarts,
  readFuturesSettledIncome,
  readFuturesSettledIncomeFrame,
} from './futuresSettledMoney.js'
import buildFuturesTradeRounds from './futuresTradeRounds.js'

const row = (overrides = {}) => ({
  symbol: 'BEATUSDT',
  incomeType: 'REALIZED_PNL',
  income: '10',
  asset: 'USDT',
  time: 2_000,
  tranId: '1',
  tradeId: null,
  ...overrides,
})

describe('readFuturesSettledIncome', () => {
  // A transfer into the futures wallet is the operator moving their own money.
  // Counted as a position's settled income it would read as a winning trade.
  it('keeps only the flows a position can be charged or credited with', () => {
    const kept = readFuturesSettledIncome([
      row({ incomeType: 'REALIZED_PNL' }),
      row({ incomeType: 'TRANSFER', tranId: '2' }),
      row({ incomeType: 'WELCOME_BONUS', tranId: '3' }),
      row({ incomeType: 'FUNDING_FEE', tranId: '4' }),
    ])
    expect(kept.map(entry => entry.component)).toEqual(['realizedPnl', 'funding'])
  })

  // Binance states that `tranId` is unique only within one `incomeType`. Keyed
  // on the id alone, a commission charged beside a realizing fill collapses onto
  // that fill and the fee is never counted.
  it('does not collapse two income types that share a transaction id', () => {
    const kept = readFuturesSettledIncome([
      row({ incomeType: 'REALIZED_PNL', income: '120', tranId: '77' }),
      row({ incomeType: 'COMMISSION', income: '-4', tranId: '77' }),
    ])
    expect(kept).toHaveLength(2)
    expect(kept.map(entry => entry.amount)).toEqual([120, -4])
  })

  // A page boundary inside one millisecond hands the same row back twice, and a
  // funding charge counted twice is money.
  it('drops a row repeated across pages', () => {
    const kept = readFuturesSettledIncome([
      row({ incomeType: 'FUNDING_FEE', income: '-7', tranId: '9' }),
      row({ incomeType: 'FUNDING_FEE', income: '-7', tranId: '9' }),
    ])
    expect(kept).toHaveLength(1)
  })

  it('refuses a row with no contract or no readable amount', () => {
    expect(readFuturesSettledIncome([
      row({ symbol: null, tranId: '5' }),
      row({ income: 'not a number', tranId: '6' }),
    ])).toEqual([])
  })
})

describe('foldFuturesSettledMoney', () => {
  // The exchange signs an income row its own way: positive is an inflow, so
  // commission and funding arrive negative and the total is their sum. Subtracting
  // them would hand the fee back to the operator as profit.
  it('sums the exchange’s signed amounts rather than subtracting them', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ incomeType: 'REALIZED_PNL', income: '120.5', tranId: '1' }),
      row({ incomeType: 'COMMISSION', income: '-4.2', tranId: '1' }),
      row({ incomeType: 'FUNDING_FEE', income: '-7.1', tranId: '2', time: 2_500 }),
    ], { starts: { BEATUSDT: 1_000 } }))
    expect(reading.realizedPnl).toBeCloseTo(120.5, 6)
    expect(reading.commission).toBeCloseTo(-4.2, 6)
    expect(reading.funding).toBeCloseTo(-7.1, 6)
    expect(reading.total).toBeCloseTo(109.2, 6)
  })

  // An account on a rebate that counted only what it was charged would overstate
  // what the position cost it to trade.
  it('nets a commission rebate against the commission', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ incomeType: 'COMMISSION', income: '-4.2', tranId: '1' }),
      row({ incomeType: 'COMMISSION_REBATE', income: '0.4', tranId: '2' }),
    ], { starts: { BEATUSDT: 1_000 } }))
    expect(reading.commission).toBeCloseTo(-3.8, 6)
  })

  // The row states the position's settled money, not the account's history on
  // that contract. A contract traded, closed and re-entered would otherwise
  // carry the old trade's profit into the new position.
  it('counts only what settled after the position opened', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ income: '999', time: 500, tranId: '1' }),
      row({ income: '10', time: 2_000, tranId: '2' }),
    ], { starts: { BEATUSDT: 1_000 } }))
    expect(reading.realizedPnl).toBeCloseTo(10, 6)
    expect(reading.complete).toBe(true)
    expect(reading.from).toBe(1_000)
  })

  // A total silently missing eight hours of funding is worse than one that names
  // its own edge.
  it('says so when it does not know when the position opened', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ income: '10', tranId: '1' }),
    ], { starts: {} }))
    expect(reading.complete).toBe(false)
    expect(reading.from).toBeNull()
  })

  // Binance charges commission in BNB whenever the account holds it. A BNB
  // amount added into a USDT total is not a quantity of anything.
  it('keeps a commission charged in another asset out of the settlement total', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ incomeType: 'REALIZED_PNL', income: '10', tranId: '1' }),
      row({ incomeType: 'COMMISSION', income: '-0.003', asset: 'BNB', tranId: '2' }),
    ], { starts: { BEATUSDT: 1_000 } }))
    expect(reading.total).toBeCloseTo(10, 6)
    expect(reading.commission).toBeNull()
    expect(reading.otherAssets).toHaveLength(1)
    expect(reading.otherAssets[0]).toMatchObject({ asset: 'BNB' })
    expect(reading.otherAssets[0].commission).toBeCloseTo(-0.003, 6)
  })

  // Nothing settled is an answer. It is a different answer from not read, and a
  // component the account has none of must not read as a zero — `0.00` beside
  // insurance clearance reads as a liquidation that cost nothing.
  it('reports a position that has settled nothing without inventing zeros', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([], {
      starts: { BEATUSDT: 1_000 },
    }))
    expect(reading.total).toBeNull()
    expect(reading.realizedPnl).toBeNull()
    expect(reading.insuranceClear).toBeNull()
    expect(reading.complete).toBe(true)
  })

  it('states insurance clearance only where the position incurred some', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ incomeType: 'INSURANCE_CLEAR', income: '-12', tranId: '1' }),
    ], { starts: { BEATUSDT: 1_000 } }))
    expect(reading.insuranceClear).toBeCloseTo(-12, 6)
    expect(reading.funding).toBeNull()
  })
})

describe('readFuturesOpenPositionStarts', () => {
  // The two flags answer different questions and only one is about time.
  // `entryImplied` says the entry *price* was recovered from what the round
  // realized; `partial` says the round began by reducing a position opened
  // before this window of fills. Reading provenance as coverage takes the
  // moment the window happened to start for the moment the position opened, and
  // then reports a partial settled total as a complete one.
  it('refuses a start from a round that began before the window', () => {
    expect(readFuturesOpenPositionStarts([
      {
        symbol: 'BEATUSDT', open: true, openTime: 5_000,
        partial: true, entryImplied: false,
      },
    ], ['BEATUSDT'])).toEqual({})
  })

  it('takes a start from a round the walk saw open', () => {
    expect(readFuturesOpenPositionStarts([
      {
        symbol: 'BEATUSDT', open: true, openTime: 5_000,
        partial: false, entryImplied: false,
      },
    ], ['BEATUSDT'])).toEqual({ BEATUSDT: 5_000 })
  })

  // A recovered entry price is not by itself a reason to distrust the time: the
  // question is whether the round began by closing something older.
  it('does not refuse a start merely because the entry price was recovered', () => {
    expect(readFuturesOpenPositionStarts([
      {
        symbol: 'BEATUSDT', open: true, openTime: 5_000,
        partial: false, entryImplied: true,
      },
    ], ['BEATUSDT'])).toEqual({ BEATUSDT: 5_000 })
  })

  it('ignores closed rounds and contracts with no open position', () => {
    expect(readFuturesOpenPositionStarts([
      { symbol: 'BEATUSDT', open: false, openTime: 1_000, partial: false },
      { symbol: 'BMTUSDT', open: true, openTime: 2_000, partial: false },
    ], ['BEATUSDT'])).toEqual({})
  })

  // A hedged account carries two open rounds on one contract; the exposure the
  // row shows began at the earlier of them.
  it('takes the earliest open round on a contract', () => {
    expect(readFuturesOpenPositionStarts([
      { symbol: 'BEATUSDT', open: true, openTime: 9_000, partial: false },
      { symbol: 'BEATUSDT', open: true, openTime: 3_000, partial: false },
    ], ['BEATUSDT'])).toEqual({ BEATUSDT: 3_000 })
  })
})

// Driven through the real fold rather than hand-made rounds: the flags are the
// fold's to set, and a test that invents them proves only that this file agrees
// with itself.
describe('readFuturesOpenPositionStarts, against the fold', () => {
  const fill = (overrides = {}) => ({
    symbol: 'BEATUSDT', side: 'BUY', positionSide: 'BOTH',
    price: '100', quantity: '1', realizedPnl: '0', commission: '0',
    time: 1_000, id: 1, ...overrides,
  })

  // The case the wrong flag let through. A long opened before this window is
  // sold partly at exactly its average entry — zero realized PnL — and the
  // operator then adds to it, leaving it open. The fold reads the whole of that
  // as one round on the original, pre-window position, so it is `partial`; but
  // its entry price is honestly averaged from the fills that are here, so
  // `entryImplied` is *false*. A filter reading provenance as coverage accepts
  // it, takes `openTime` — the moment the window happened to start — for the
  // moment the position opened, and reports settled money missing everything the
  // position earned or paid before that as though it were complete.
  it('gives no start for a position the window opens in the middle of', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', quantity: '2', price: '100', realizedPnl: '0', time: 1_000 }),
      fill({ id: 2, side: 'BUY', quantity: '3', price: '105', realizedPnl: '0', time: 2_000 }),
    ])
    const open = rounds.filter(round => round.open)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ partial: true, entryImplied: false, openTime: 1_000 })
    expect(readFuturesOpenPositionStarts(rounds, ['BEATUSDT'])).toEqual({})
  })

  // And the reading built on it says so, rather than presenting the window's
  // total as the position's.
  it('reports a position older than the window as window-bounded', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', quantity: '2', price: '100', realizedPnl: '0', time: 1_000 }),
      fill({ id: 2, side: 'BUY', quantity: '3', price: '105', realizedPnl: '0', time: 2_000 }),
    ])
    const [reading] = Object.values(foldFuturesSettledMoney([
      {
        symbol: 'BEATUSDT', incomeType: 'REALIZED_PNL', income: '40',
        asset: 'USDT', time: 2_500, tranId: '1', tradeId: null,
      },
    ], { starts: readFuturesOpenPositionStarts(rounds, ['BEATUSDT']) }))
    expect(reading.complete).toBe(false)
    expect(reading.from).toBeNull()
  })

  it('gives a start for a position the window saw opened', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', quantity: '1', price: '100', time: 4_000 }),
      fill({ id: 2, side: 'BUY', quantity: '1', price: '102', time: 5_000 }),
    ])
    expect(readFuturesOpenPositionStarts(rounds, ['BEATUSDT'])).toEqual({ BEATUSDT: 4_000 })
  })
})

describe('readFuturesSettledIncomeFrame', () => {
  it('carries the window the rows were read over', () => {
    expect(readFuturesSettledIncomeFrame({
      rows: [row()],
      from: 1_000,
      readAt: 5_000,
      complete: true,
    })).toMatchObject({ from: 1_000, readAt: 5_000, complete: true })
  })

  // A contract with no row inside the window is indistinguishable from one the
  // read never reached, so a frame that cannot say what it covers is no reading.
  it('refuses a frame that does not state its window', () => {
    expect(readFuturesSettledIncomeFrame({ rows: [row()] })).toBeNull()
    expect(readFuturesSettledIncomeFrame({ from: 1, readAt: 2 })).toBeNull()
    expect(readFuturesSettledIncomeFrame(null)).toBeNull()
  })

  // A walk that stopped at its page budget has rows the desk never saw.
  it('carries an incomplete walk as incomplete', () => {
    expect(readFuturesSettledIncomeFrame({
      rows: [], from: 1, readAt: 2, complete: false,
    }).complete).toBe(false)
  })
})
