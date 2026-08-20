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
    ], { starts: { BEATUSDT: 1_000 }, from: 900 }))
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

  // Knowing when a position began is not the same as having read back to it. On
  // 2026-08-20 the read covered one day of a seven-day window and every contract
  // in it was reported completely accounted for, so the desk presented a total
  // missing days of funding as though it were the whole of what the position had
  // settled — and marked nothing.
  it('is incomplete when the read does not reach back to the position', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ income: '10', time: 5_000, tranId: '1' }),
    ], { starts: { BEATUSDT: 1_000 }, from: 4_000 }))
    expect(reading.complete).toBe(false)
    expect(reading.from).toBe(1_000)
  })

  // The absence of a stated coverage is not a coverage of zero. `Number(null)`
  // is 0, and 0 is the epoch: every position that ever opened would read as
  // covered by a read that stated nothing at all.
  it('treats an unstated coverage as unknown rather than as the epoch', () => {
    const [reading] = Object.values(foldFuturesSettledMoney([
      row({ income: '10', time: 5_000, tranId: '1' }),
    ], { starts: { BEATUSDT: 1_000 } }))
    expect(reading.complete).toBe(false)
  })

  // A contract the read reached and found nothing against is a different answer
  // from one it never reached far enough to look at.
  it('separates nothing settled from not read back far enough', () => {
    const reached = Object.values(foldFuturesSettledMoney([], {
      starts: { BEATUSDT: 1_000 }, from: 900,
    }))[0]
    const short = Object.values(foldFuturesSettledMoney([], {
      starts: { BEATUSDT: 1_000 }, from: 4_000,
    }))[0]
    expect(reached.total).toBeNull()
    expect(reached.complete).toBe(true)
    expect(short.total).toBeNull()
    expect(short.complete).toBe(false)
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
      from: 900,
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

// The test that was missing. Both halves of this path had tests and the path
// did not, so a transform applied twice emptied the operator's column without a
// single failure: the main process read the rows, the renderer read them again
// looking for exchange fields the first read had consumed, and every row was
// dropped. Drive the whole seam, with the numbers the operator read off the
// Binance app for the position that showed `—`.
describe('the settled-money path, end to end', () => {
  const exchangeRows = [
    { symbol: 'BTWUSDT', incomeType: 'FUNDING_FEE', income: '-229.43', asset: 'USDT', time: 2_000, tranId: '1', tradeId: null },
    { symbol: 'BTWUSDT', incomeType: 'COMMISSION', income: '-34.95', asset: 'USDT', time: 2_000, tranId: '2', tradeId: '9' },
    // The operator moving their own money is not the position earning it.
    { symbol: null, incomeType: 'TRANSFER', income: '5000', asset: 'USDT', time: 2_100, tranId: '4', tradeId: null },
  ]

  it('carries the exchange’s charges from the read to the column', () => {
    // Main process → wire → renderer boundary → hook.
    const broadcast = readFuturesSettledIncome(exchangeRows)
    const frame = readFuturesSettledIncomeFrame({
      rows: broadcast, from: 1_000, readAt: 3_000, complete: true,
    })
    const reading = foldFuturesSettledMoney(frame.rows, { starts: { BTWUSDT: 1_000 } }).BTWUSDT
    expect(reading.funding).toBeCloseTo(-229.43, 6)
    expect(reading.commission).toBeCloseTo(-34.95, 6)
    // Nothing was ever cleared against insurance, so it is absent rather than 0.
    expect(reading.insuranceClear).toBeNull()
    expect(reading.total).toBeCloseTo(-264.38, 6)
  })

  // The property that makes the seam safe. Three points on this path read the
  // same rows; a reader that only worked on the exchange's shape turned the
  // second and third into silent data loss.
  it('reads the same rows any number of times without losing them', () => {
    const once = readFuturesSettledIncome(exchangeRows)
    const twice = readFuturesSettledIncome(once)
    const thrice = readFuturesSettledIncome(twice)
    expect(twice).toEqual(once)
    expect(thrice).toEqual(once)
    expect(foldFuturesSettledMoney(thrice, { starts: { BTWUSDT: 1_000 } }).BTWUSDT.total)
      .toBeCloseTo(-264.38, 6)
  })

  // Reading an entry back must not reopen it to the dedup that already ran, nor
  // let an already-read row in without a contract on it.
  it('holds an already-read entry to the same rules as a fresh row', () => {
    expect(readFuturesSettledIncome([
      { symbol: 'BTWUSDT', component: 'funding', amount: -1, asset: 'USDT', time: 1 },
      { symbol: '', component: 'funding', amount: -2, asset: 'USDT', time: 2 },
      { symbol: 'BTWUSDT', component: 'nonsense', amount: -3, asset: 'USDT', time: 3 },
      { symbol: 'BTWUSDT', component: 'funding', amount: Number.NaN, asset: 'USDT', time: 4 },
    ])).toEqual([
      { symbol: 'BTWUSDT', component: 'funding', amount: -1, asset: 'USDT', time: 1 },
    ])
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

// The failure of 2026-08-20. `starts` is what scopes a contract's income to the
// position holding it; without it the fold summed the contract's whole covered
// window — realized PnL of rounds closed days before the position was opened
// included — and the column presented that as what the position had settled.
describe('a contract whose position start is unknown', () => {
  const T = Date.parse('2026-08-20T12:00:00.000Z')
  const income = [
    { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '900', asset: 'USDT', time: T - 3 * 86400000, tranId: '1' },
    { symbol: 'BTCUSDT', incomeType: 'COMMISSION', income: '-40', asset: 'USDT', time: T - 3 * 86400000, tranId: '2' },
    { symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', income: '-4.7', asset: 'USDT', time: T - 3600000, tranId: '3' },
  ]

  it('states no amount at all rather than the contract\u2019s own history', () => {
    const folded = foldFuturesSettledMoney(income, { starts: {}, from: T - 7 * 86400000 })
    const reading = folded.BTCUSDT
    expect(reading).toBeDefined()
    expect(reading.total).toBeNull()
    // Not one component either: each of them would be the contract's.
    expect(reading.realizedPnl).toBeNull()
    expect(reading.funding).toBeNull()
    expect(reading.commission).toBeNull()
    // And `from` stays absent, which is what a surface reads to say why.
    expect(reading.from).toBeNull()
    expect(reading.complete).toBe(false)
  })

  it('still states the position\u2019s own money once the start is known', () => {
    const folded = foldFuturesSettledMoney(income, {
      starts: { BTCUSDT: T - 6 * 3600000 },
      from: T - 7 * 86400000,
    })
    const reading = folded.BTCUSDT
    // Only the funding charged since the position opened; the closed round's
    // +900 and its commission belong to a position that no longer exists.
    expect(reading.funding).toBe(-4.7)
    expect(reading.realizedPnl).toBeNull()
    expect(reading.total).toBe(-4.7)
    expect(reading.complete).toBe(true)
  })
})

// Binance hands `tranId` back as a JSON integer; one past 2^53 has lost digits
// before it is parsed, and the adapter refuses a rounded identity rather than
// page from it. The rows then arrive with none, and keying them all alike is how
// twenty funding charges became one.
describe('rows the exchange gave no usable identity to', () => {
  const charge = (at, income) => ({
    symbol: 'BEATUSDT',
    incomeType: 'FUNDING_FEE',
    income,
    asset: 'USDT',
    time: Date.parse(at),
    tranId: null,
  })

  it('keeps each of them, and still counts a repeated one once', () => {
    const rows = [
      charge('2026-08-19T20:00:00.000Z', '-32.9282'),
      charge('2026-08-20T00:00:00.000Z', '-34.8880'),
      charge('2026-08-20T04:00:00.000Z', '-10.8291'),
    ]
    const read = readFuturesSettledIncome(rows)
    expect(read).toHaveLength(3)
    expect(read.reduce((sum, entry) => sum + entry.amount, 0)).toBeCloseTo(-78.6453, 4)
    // A page boundary inside one millisecond hands the same row back twice.
    const withRepeat = readFuturesSettledIncome([...rows, charge('2026-08-20T04:00:00.000Z', '-10.8291')])
    expect(withRepeat).toHaveLength(3)
  })

  // Funding cannot collide with itself — a contract is charged once per
  // settlement. Commission can, and on the account this desk runs on it does:
  // every fill is charged, and filling the same size at the same price twice in
  // one millisecond pays the same fee twice. Told apart by the fill each was
  // charged on, which the exchange states and which is small enough to survive
  // being parsed.
  const fee = (tradeId) => ({
    symbol: 'BEATUSDT',
    incomeType: 'COMMISSION',
    income: '-0.0141',
    asset: 'USDT',
    time: Date.parse('2026-08-20T09:14:22.418Z'),
    tranId: null,
    tradeId: String(tradeId),
  })

  it('keeps two identical charges the exchange made on two different fills', () => {
    const read = readFuturesSettledIncome([fee(11884301), fee(11884302), fee(11884303)])
    expect(read).toHaveLength(3)
    expect(read.reduce((sum, entry) => sum + entry.amount, 0)).toBeCloseTo(-0.0423, 4)
    // The same fill handed back twice is still one charge.
    expect(readFuturesSettledIncome([fee(11884301), fee(11884302), fee(11884301)]))
      .toHaveLength(2)
  })
})
