import { describe, expect, it } from 'vitest'
import {
  FUTURES_UNDERIVABLE_INCOME_TYPES,
  newerFuturesSettledIncomeFrame,
  readFuturesSettledIncome,
  readFuturesSettledIncomeFrame,
} from './futuresSettledMoney.js'
import { MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE } from './futuresSettledIncomeResource.js'

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
  it('keeps only supported flows and preserves their signed component evidence', () => {
    const kept = readFuturesSettledIncome([
      row({ incomeType: 'REALIZED_PNL', income: '10', tranId: '1' }),
      row({ incomeType: 'TRANSFER', tranId: '2' }),
      row({ incomeType: 'WELCOME_BONUS', tranId: '3' }),
      row({ incomeType: 'FUNDING_FEE', income: '-2', tranId: '4' }),
      row({ incomeType: 'COMMISSION', income: '-0.4', asset: 'BNB', tranId: '5' }),
      row({ incomeType: 'INSURANCE_CLEAR', income: '-3', tranId: '6' }),
      row({ incomeType: 'COMMISSION_REBATE', income: '0.1', tranId: '7' }),
    ])
    expect(kept.map(({ component, derivable, amount, asset }) => ({
      component, derivable, amount, asset,
    }))).toEqual([
      { component: 'realizedPnl', derivable: true, amount: 10, asset: 'USDT' },
      { component: 'funding', derivable: false, amount: -2, asset: 'USDT' },
      { component: 'commission', derivable: true, amount: -0.4, asset: 'BNB' },
      { component: 'insuranceClear', derivable: false, amount: -3, asset: 'USDT' },
      { component: 'commission', derivable: false, amount: 0.1, asset: 'USDT' },
    ])
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

// The parser runs on both sides of the renderer boundary. It must accept its own
// output or the second read silently empties an otherwise valid resource frame.
describe('the settled-income parser boundary', () => {
  const exchangeRows = [
    { symbol: 'BTWUSDT', incomeType: 'FUNDING_FEE', income: '-229.43', asset: 'USDT', time: 2_000, tranId: '1', tradeId: null },
    { symbol: 'BTWUSDT', incomeType: 'COMMISSION', income: '-34.95', asset: 'USDT', time: 2_000, tranId: '2', tradeId: '9' },
    // The operator moving their own money is not the position earning it.
    { symbol: null, incomeType: 'TRANSFER', income: '5000', asset: 'USDT', time: 2_100, tranId: '4', tradeId: null },
  ]

  it('carries signed charges through a repeated renderer-boundary read', () => {
    const broadcast = readFuturesSettledIncome(exchangeRows)
    const frame = readFuturesSettledIncomeFrame({
      rows: broadcast, from: 1_000, readAt: 3_000, complete: true,
    })
    expect(frame?.rows).toEqual(broadcast)
    expect(frame?.rows.map(({ component, amount }) => ({ component, amount }))).toEqual([
      { component: 'funding', amount: -229.43 },
      { component: 'commission', amount: -34.95 },
    ])
    expect(frame?.rows.reduce((sum, entry) => sum + entry.amount, 0))
      .toBeCloseTo(-264.38, 6)
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
    expect(thrice.reduce((sum, entry) => sum + entry.amount, 0))
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
      {
        symbol: 'BTWUSDT',
        component: 'funding',
        amount: -1,
        asset: 'USDT',
        time: 1,
        // An entry read before this flag existed is classified by what it is.
        // Funding is stated by no other record, so it stays.
        derivable: false,
      },
    ])
  })

  // An already-read commission entry is a charge the trade record states too.
  // Reading one back must preserve that classification so reconciliation can
  // exclude the duplicate evidence rather than count it twice.
  it('classifies an already-read entry the fills could have stated', () => {
    expect(readFuturesSettledIncome([
      { symbol: 'BTWUSDT', component: 'commission', amount: -0.5, asset: 'USDT', time: 1 },
      { symbol: 'BTWUSDT', component: 'realizedPnl', amount: 12, asset: 'USDT', time: 2 },
    ]).map(entry => entry.derivable)).toEqual([true, true])
  })
})

describe('readFuturesSettledIncomeFrame', () => {
  const fundingRow = (overrides = {}) => row({
    incomeType: 'FUNDING_FEE',
    income: '-1.25',
    tranId: '101',
    ...overrides,
  })
  const v2Frame = (overrides = {}) => {
    const lanes = Object.fromEntries(FUTURES_UNDERIVABLE_INCOME_TYPES.map(incomeType => [
      incomeType,
      {
        incomeType,
        rows: incomeType === 'FUNDING_FEE' ? [fundingRow()] : [],
        coveredFrom: 1_000,
        coveredTo: 5_000,
        targetTo: 5_000,
        status: 'ready',
        attemptedAt: 5_000,
        successfulAt: 5_000,
        complete: true,
        error: null,
      },
    ]))
    return {
      version: 2,
      accountFingerprint: '0123456789abcdef',
      lanes,
      rows: lanes.FUNDING_FEE.rows,
      coveredFrom: 1_000,
      coveredTo: 5_000,
      targetTo: 5_000,
      readAt: 5_000,
      attemptedAt: 5_000,
      successfulAt: 5_000,
      status: 'ready',
      completeByType: Object.fromEntries(
        FUTURES_UNDERIVABLE_INCOME_TYPES.map(incomeType => [incomeType, true]),
      ),
      complete: true,
      generation: 7,
      digest: 'canonical-digest',
      ...overrides,
    }
  }
  const setLaneClocks = (payload, attemptedAt, successfulAt = attemptedAt) => {
    for (const incomeType of FUTURES_UNDERIVABLE_INCOME_TYPES) {
      payload.lanes[incomeType] = {
        ...payload.lanes[incomeType],
        attemptedAt,
        successfulAt,
      }
    }
    return payload
  }

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

  it('does not restore epoch time or complete coverage from a contradictory v2 frame', () => {
    const lane = {
      incomeType: 'FUNDING_FEE',
      rows: [row({ incomeType: 'FUNDING_FEE' })],
      coveredFrom: 1_000,
      coveredTo: 5_000,
      targetTo: 5_000,
      status: 'loading',
      attemptedAt: 5_000,
      successfulAt: 4_000,
      complete: true,
      error: null,
    }
    const payload = {
      version: 2,
      accountFingerprint: '0123456789abcdef',
      lanes: [lane],
      rows: lane.rows,
      coveredFrom: 1_000,
      coveredTo: 5_000,
      readAt: 5_000,
      status: 'loading',
      complete: true,
      generation: 1,
      digest: 'canonical-digest',
    }

    expect(readFuturesSettledIncomeFrame(payload)).toBeNull()
    expect(readFuturesSettledIncomeFrame({ ...payload, readAt: null })).toBeNull()
    expect(readFuturesSettledIncomeFrame({ ...payload, readAt: ' ' })).toBeNull()
  })

  it('derives accepted aggregate rows from canonical lane authority', () => {
    const payload = v2Frame()
    delete payload.rows

    expect(readFuturesSettledIncomeFrame(payload)).toMatchObject({
      accountFingerprint: '0123456789abcdef',
      generation: 7,
      digest: 'canonical-digest',
      complete: true,
      rows: [{
        symbol: 'BEATUSDT',
        incomeType: 'FUNDING_FEE',
        income: '-1.25',
        asset: 'USDT',
        tranId: '101',
      }],
    })
  })

  it('keeps ready lanes complete through their independent targets', () => {
    const payload = v2Frame()
    payload.lanes.FUNDING_FEE = {
      ...payload.lanes.FUNDING_FEE,
      coveredTo: 6_000,
      targetTo: 6_000,
    }
    payload.targetTo = 6_000
    payload.readAt = 6_000
    payload.complete = false

    const accepted = readFuturesSettledIncomeFrame(payload)

    expect(accepted).not.toBeNull()
    expect(accepted).toMatchObject({
      coveredTo: 5_000,
      targetTo: 6_000,
      complete: false,
    })
    expect(accepted.lanes.FUNDING_FEE.complete).toBe(true)
    expect(accepted.lanes.FEE_RETURN).toMatchObject({
      coveredTo: 5_000,
      targetTo: 5_000,
      complete: true,
    })
  })

  it('carries confirmation debt and rejects it beside a ready lane', () => {
    const pending = v2Frame()
    pending.lanes.FUNDING_FEE = {
      ...pending.lanes.FUNDING_FEE,
      status: 'stale',
      complete: false,
      confirmationNotBefore: 7_000,
    }
    pending.status = 'stale'
    pending.completeByType.FUNDING_FEE = false
    pending.complete = false

    const accepted = readFuturesSettledIncomeFrame(pending)
    expect(accepted?.lanes.FUNDING_FEE).toMatchObject({
      status: 'stale',
      complete: false,
      confirmationNotBefore: 7_000,
    })

    const contradictory = v2Frame()
    contradictory.lanes.FUNDING_FEE.confirmationNotBefore = 7_000
    expect(readFuturesSettledIncomeFrame(contradictory)).toBeNull()

    const loadingDebt = structuredClone(pending)
    loadingDebt.lanes.FUNDING_FEE.status = 'loading'
    loadingDebt.status = 'loading'
    expect(readFuturesSettledIncomeFrame(loadingDebt)).toBeNull()

    const changedDeadline = structuredClone(pending)
    changedDeadline.readAt = 6_000
    changedDeadline.lanes.FUNDING_FEE.confirmationNotBefore = 8_000
    const changed = readFuturesSettledIncomeFrame(changedDeadline)
    expect(newerFuturesSettledIncomeFrame(accepted, changed)).toBe(accepted)
  })

  it('accepts stale confirmation debt without rows or earlier coverage', () => {
    const pending = v2Frame()
    pending.lanes.FUNDING_FEE = {
      ...pending.lanes.FUNDING_FEE,
      rows: [],
      coveredFrom: null,
      coveredTo: null,
      status: 'stale',
      attemptedAt: null,
      successfulAt: null,
      confirmationNotBefore: 7_000,
      complete: false,
    }
    pending.rows = []
    pending.coveredFrom = null
    pending.coveredTo = null
    pending.status = 'stale'
    pending.successfulAt = null
    pending.completeByType.FUNDING_FEE = false
    pending.complete = false

    expect(readFuturesSettledIncomeFrame(pending)?.lanes.FUNDING_FEE).toMatchObject({
      rows: [],
      coveredFrom: null,
      coveredTo: null,
      status: 'stale',
      confirmationNotBefore: 7_000,
      complete: false,
    })
  })

  it('rejects empty, partial, and extra lane sets before they become authority', () => {
    const empty = v2Frame({ lanes: {}, rows: [], completeByType: {} })
    const partial = v2Frame()
    delete partial.lanes.FEE_RETURN
    delete partial.completeByType.FEE_RETURN
    const extra = v2Frame()
    extra.lanes.TRANSFER = {
      ...extra.lanes.FUNDING_FEE,
      incomeType: 'TRANSFER',
      rows: [],
    }
    extra.completeByType.TRANSFER = true

    expect(readFuturesSettledIncomeFrame(empty)).toBeNull()
    expect(readFuturesSettledIncomeFrame(partial)).toBeNull()
    expect(readFuturesSettledIncomeFrame(extra)).toBeNull()
  })

  it('does not let a newer incomplete frame replace held lane authority', () => {
    const held = readFuturesSettledIncomeFrame(v2Frame())
    const partialPayload = v2Frame({
      generation: held.generation + 1,
      digest: 'newer-but-incomplete',
      readAt: held.readAt + 1,
    })
    delete partialPayload.lanes.API_REBATE
    delete partialPayload.completeByType.API_REBATE
    const partial = readFuturesSettledIncomeFrame(partialPayload)

    expect(partial).toBeNull()
    expect(newerFuturesSettledIncomeFrame(held, partial)).toBe(held)
  })

  it.each([
    ['malformed', [fundingRow({ asset: '' })]],
    ['wrong-lane', [fundingRow({ incomeType: 'INSURANCE_CLEAR' })]],
    ['duplicate', [fundingRow(), fundingRow()]],
    ['conflicting', [fundingRow(), fundingRow({ income: '-9.99' })]],
  ])('rejects a complete lane containing %s row evidence', (unusedCase, rows) => {
    const payload = v2Frame()
    payload.lanes.FUNDING_FEE.rows = rows
    payload.rows = rows

    expect(readFuturesSettledIncomeFrame(payload)).toBeNull()
  })

  it('rejects duplicate canonical lane names before either can overwrite the other', () => {
    const payload = v2Frame()
    payload.lanes = FUTURES_UNDERIVABLE_INCOME_TYPES.map(incomeType => ({
      ...payload.lanes[incomeType],
      incomeType,
    }))
    payload.lanes[payload.lanes.length - 1] = {
      ...payload.lanes.FUNDING_FEE,
      incomeType: 'funding_fee',
      rows: [],
    }

    expect(readFuturesSettledIncomeFrame(payload)).toBeNull()
  })

  it.each([
    ['missing', []],
    ['extra', [fundingRow(), fundingRow({ tranId: '102' })]],
    ['duplicate', [fundingRow(), fundingRow()]],
    ['conflicting', [fundingRow({ income: '-9.99' })]],
  ])('rejects %s aggregate rows rather than overriding lane authority', (unusedCase, rows) => {
    expect(readFuturesSettledIncomeFrame(v2Frame({ rows }))).toBeNull()
  })

  it('admits only monotonic observation time over the same content revision', () => {
    const held = readFuturesSettledIncomeFrame(v2Frame())
    const laterPayload = setLaneClocks(v2Frame({
      readAt: 6_000,
      attemptedAt: 6_000,
      successfulAt: 6_000,
    }), 6_000)
    const later = readFuturesSettledIncomeFrame(laterPayload)

    expect(newerFuturesSettledIncomeFrame(held, later)).toBe(later)
    const exactReplay = readFuturesSettledIncomeFrame(structuredClone(laterPayload))
    expect(newerFuturesSettledIncomeFrame(later, exactReplay)).toBe(later)
    expect(newerFuturesSettledIncomeFrame(later, exactReplay)).not.toBe(exactReplay)

    const conflicting = readFuturesSettledIncomeFrame({
      ...laterPayload,
      readAt: 7_000,
      digest: 'different-content',
    })
    expect(newerFuturesSettledIncomeFrame(later, conflicting)).toBe(later)

    const regressedPayload = setLaneClocks(v2Frame({
      readAt: 7_000,
      attemptedAt: 4_000,
      successfulAt: 4_000,
    }), 4_000)
    const regressed = readFuturesSettledIncomeFrame(regressedPayload)
    expect(newerFuturesSettledIncomeFrame(later, regressed)).toBe(later)
  })

  it('rejects ready clock, aggregate-state, and unsafe-time contradictions', () => {
    const missingSuccess = v2Frame()
    missingSuccess.lanes.FUNDING_FEE.successfulAt = null
    expect(readFuturesSettledIncomeFrame(missingSuccess)).toBeNull()

    const regressedAttempt = v2Frame()
    regressedAttempt.lanes.FUNDING_FEE.attemptedAt = 4_000
    expect(readFuturesSettledIncomeFrame(regressedAttempt)).toBeNull()

    const pendingReady = v2Frame()
    pendingReady.lanes.FUNDING_FEE.pending = {
      targetFrom: 1_000, targetTo: 5_000, nextPage: 2, rows: [],
    }
    expect(readFuturesSettledIncomeFrame(pendingReady)).toBeNull()

    for (const overrides of [
      { status: 'stale' },
      { coveredTo: 4_999 },
      { targetTo: 6_000 },
      { attemptedAt: 4_999 },
      { successfulAt: 4_999 },
      { complete: false },
      { completeByType: { FUNDING_FEE: false } },
      { readAt: -1 },
      { readAt: 1e100 },
      { readAt: 5_000.5 },
    ]) {
      expect(readFuturesSettledIncomeFrame(v2Frame(overrides))).toBeNull()
    }
  })

  it('does not accept changed money behind the same generation and digest label', () => {
    const held = readFuturesSettledIncomeFrame(v2Frame())
    const changedPayload = setLaneClocks(v2Frame({
      readAt: 6_000,
      attemptedAt: 6_000,
      successfulAt: 6_000,
    }), 6_000)
    changedPayload.lanes.FUNDING_FEE = {
      ...changedPayload.lanes.FUNDING_FEE,
      rows: [fundingRow({ income: '-99.00' })],
    }
    delete changedPayload.rows
    const changed = readFuturesSettledIncomeFrame(changedPayload)

    expect(changed).not.toBeNull()
    expect(newerFuturesSettledIncomeFrame(held, changed)).toBe(held)
  })

  it('rejects numeric money at renderer IPC and preserves held authority', () => {
    const held = readFuturesSettledIncomeFrame(v2Frame())
    const numericPayload = v2Frame({
      generation: held.generation + 1,
      digest: 'numeric-money-cannot-be-exact',
    })
    numericPayload.lanes.FUNDING_FEE = {
      ...numericPayload.lanes.FUNDING_FEE,
      rows: [fundingRow({ income: -1.25 })],
    }
    delete numericPayload.rows

    const rejected = readFuturesSettledIncomeFrame(numericPayload)
    expect(rejected).toBeNull()
    expect(newerFuturesSettledIncomeFrame(held, rejected)).toBe(held)
  })

  it('rejects over-ceiling lane and compatibility row arrays before canonicalization', () => {
    const oversizedLane = v2Frame()
    oversizedLane.lanes.FUNDING_FEE.rows = new Array(
      MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE + 1,
    )
    delete oversizedLane.rows
    expect(readFuturesSettledIncomeFrame(oversizedLane)).toBeNull()

    const oversizedAggregate = v2Frame()
    oversizedAggregate.rows = new Array(
      MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE
        * FUTURES_UNDERIVABLE_INCOME_TYPES.length + 1,
    )
    expect(readFuturesSettledIncomeFrame(oversizedAggregate)).toBeNull()
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
