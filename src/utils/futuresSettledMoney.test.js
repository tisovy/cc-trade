import { describe, expect, it } from 'vitest'
import {
  foldFuturesSettledMoney,
  readFuturesSettledIncome,
  readFuturesSettledIncomeFrame,
} from './futuresSettledMoney.js'

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
