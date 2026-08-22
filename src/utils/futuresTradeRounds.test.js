import { describe, expect, it } from 'vitest'
import {
  auditFuturesFillAllocation,
  buildFuturesTradeRoundIndex,
  buildFuturesTradeRounds,
  futuresTradePositionKey,
} from './futuresTradeRounds.js'

const fill = (overrides = {}) => ({
  id: 1,
  orderId: 10,
  symbol: 'BICOUSDT',
  side: 'BUY',
  price: '2.554',
  quantity: '1000',
  commission: '0.0102',
  marginAsset: 'USDT',
  realizedPnl: '0',
  time: 1_784_000_000_000,
  ...overrides,
})

describe('auditFuturesFillAllocation', () => {
  it('conserves one reversal fill split into exact 4 + 2 quantity atoms', () => {
    const audit = auditFuturesFillAllocation({
      canonicalFills: [{ identity: 'fill:2', quantityAtoms: '600000000' }],
      contributions: [
        { identity: 'fill:2', quantityAtoms: '400000000', roundKey: 'round:closed' },
        { identity: 'fill:2', quantityAtoms: '200000000', roundKey: 'round:open' },
      ],
      roundKeys: ['round:closed', 'round:open'],
    })

    expect(audit).toMatchObject({
      conserved: true,
      canonicalFillCount: 1,
      assignedFillCount: 1,
      contributionCount: 2,
      canonicalQuantityAtoms: '600000000',
      assignedQuantityAtoms: '600000000',
      affectedFillIds: [],
      affectedRoundKeys: [],
      affectedAtomsByFill: [],
    })
  })

  it.each([
    {
      failure: 'under-allocation',
      contributions: [
        { identity: 'fill:2', quantityAtoms: '400000000', roundKey: 'round:closed' },
      ],
      expected: {
        missingFillIds: [], underallocatedFillIds: ['fill:2'],
        overallocatedFillIds: [], unknownFillIds: [],
      },
    },
    {
      failure: 'omitted assignment',
      contributions: [],
      expected: {
        missingFillIds: ['fill:2'], underallocatedFillIds: ['fill:2'],
        overallocatedFillIds: [], unknownFillIds: [],
      },
    },
    {
      failure: 'over-allocation',
      contributions: [
        { identity: 'fill:2', quantityAtoms: '400000000', roundKey: 'round:closed' },
        { identity: 'fill:2', quantityAtoms: '400000000', roundKey: 'round:open' },
      ],
      expected: {
        missingFillIds: [], underallocatedFillIds: [],
        overallocatedFillIds: ['fill:2'], unknownFillIds: [],
      },
    },
    {
      failure: 'unknown assignment',
      contributions: [
        { identity: 'fill:other', quantityAtoms: '600000000', roundKey: 'round:closed' },
      ],
      expected: {
        missingFillIds: ['fill:2'], underallocatedFillIds: ['fill:2'],
        overallocatedFillIds: [], unknownFillIds: ['fill:other'],
      },
    },
  ])('fails closed for $failure', ({ contributions, expected }) => {
    const audit = auditFuturesFillAllocation({
      canonicalFills: [{ identity: 'fill:2', quantityAtoms: '600000000' }],
      contributions,
      roundKeys: ['round:closed', 'round:open'],
    })

    expect(audit).toMatchObject({
      conserved: false,
      affectedRoundKeys: ['round:closed', 'round:open'],
      ...expected,
    })
    expect(audit.affectedFillIds).not.toHaveLength(0)
  })

  it('rejects an oversized atom coefficient before BigInt parsing', () => {
    const audit = auditFuturesFillAllocation({
      canonicalFills: [{ identity: 'fill:huge', quantityAtoms: '9'.repeat(137) }],
      contributions: [],
      roundKeys: ['round:affected'],
    })

    expect(audit).toMatchObject({
      conserved: false,
      canonicalFillCount: 0,
      invalidCanonicalFills: [{ identity: 'fill:huge', quantityAtoms: null }],
      affectedFillIds: ['fill:huge'],
      affectedRoundKeys: ['round:affected'],
    })
  })
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
      // What remains after the 400-contract reduction, not cumulative entry.
      quantity: '600',
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

  // The read reaches a bounded number of fills, so its window regularly opens
  // while the operator is already in a position. Adding to that position and
  // then closing all of it reduces more than the fills in hand say is held —
  // which was read as a flip, and put a position that never existed, priced at
  // both ends, into the closed-position review.
  it('closes the whole position when the window opened inside it', () => {
    const rounds = buildFuturesTradeRounds([
      // 3000 were already held; only these 2000 are in the window.
      fill({ id: 1, side: 'BUY', price: '1.5', quantity: '2000', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '1.4', quantity: '5000', realizedPnl: '-500', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '1.546', quantity: '3133', time: 3000 }),
    ])

    expect(rounds).toHaveLength(2)
    // The position that is running now, at its true size.
    expect(rounds[0]).toMatchObject({ positionSide: 'LONG', quantity: '3133', open: true })
    // One closed position, of everything that was closed — and its entry is the
    // exchange's own, recovered from what the close realized rather than
    // averaged over the part of the entry that happens to be in the window.
    expect(rounds[1]).toMatchObject({
      positionSide: 'LONG',
      quantity: '5000',
      entryPrice: 1.5,
      entryImplied: true,
      exitPrice: 1.4,
      realizedPnl: -500,
      open: false,
    })
  })

  // The same shape, where the position really did flip. Realized PnL settles it:
  // a flip realizes exactly what closing the part in hand realizes, and here it
  // does, so the short that was opened is reported.
  it('still reports a flip the fills account for', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '1.5', quantity: '5000', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '1.4', quantity: '8000', realizedPnl: '-500', time: 2000 }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds[0]).toMatchObject({ positionSide: 'SHORT', quantity: '3000', open: true })
    expect(rounds[1]).toMatchObject({
      positionSide: 'LONG', quantity: '5000', entryPrice: 1.5, realizedPnl: -500, open: false,
    })
  })

  // The check that tells a reversal from the tail of a pre-window position
  // compares one fill's realized PnL against what the round was entered at, and
  // the exchange settles that PnL against the average of what is *still held*.
  // A position scaled out of and back into at a different price leaves the two
  // averages apart: here the exchange held 190 and the average over everything
  // the round ever entered is 147.37. Read against the wrong one, a real
  // reversal was filed as a pre-window remainder — twenty-one units the account
  // never held, presented as one closed position with a recovered entry, and
  // the short that actually opened never shown at all.
  it('still reports a flip after the position was scaled out of and back into', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '100', quantity: '10', commission: '0', time: 1000 }),
      // Out at the price it went in at, so the exchange realizes nothing and the
      // average entry of the one unit left is still 100.
      fill({ id: 2, side: 'SELL', price: '100', quantity: '9', commission: '0', realizedPnl: '0', time: 2000 }),
      // Back in at twice the price: the exchange now holds ten at 190.
      fill({ id: 3, side: 'BUY', price: '200', quantity: '9', commission: '0', time: 3000 }),
      // Twelve out: ten close at 190 for 100, and two open a short.
      fill({ id: 4, side: 'SELL', price: '200', quantity: '12', commission: '0', realizedPnl: '100', time: 4000 }),
      fill({ id: 5, side: 'BUY', price: '150', quantity: '2', commission: '0', realizedPnl: '100', time: 5000 }),
    ])
    expect(rounds).toHaveLength(2)
    const long = rounds.find(round => round.positionSide === 'LONG')
    const short = rounds.find(round => round.positionSide === 'SHORT')
    expect(long).toMatchObject({
      quantity: '19',
      realizedPnl: 100,
      open: false,
      partial: false,
      // Read from its own fills. Nothing here is older than the window.
      entryImplied: false,
    })
    expect(long.entryPrice).toBeCloseTo(147.368421, 6)
    expect(long.exitPrice).toBeCloseTo(152.631579, 6)
    expect(short).toMatchObject({
      quantity: '2',
      entryPrice: 200,
      exitPrice: 150,
      realizedPnl: 100,
      open: false,
      partial: false,
      entryImplied: false,
    })
    // Nothing invented and nothing lost: what the review shows adds up to what
    // the exchange reported.
    expect(rounds.reduce((total, round) => total + round.realizedPnl, 0)).toBe(200)
  })

  // The same sequence stopped one fill earlier, which is what the operator
  // actually sees mid-session: the reversal has happened and the short it
  // opened is still on. Read against the wrong average this was the worse of
  // the two — the only round the walk produced was a *closed* long of
  // twenty-one units, so the tab stated a position that had ended while the
  // account was in the opposite one, and the short did not exist in the walk at
  // all. Asserted apart from the case above because the symptom is different:
  // there a closed row carried wrong numbers, here a live position is missing
  // and a finished one is invented beside it.
  it('does not close a position the account is still in', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '100', quantity: '10', commission: '0', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '100', quantity: '9', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '200', quantity: '9', commission: '0', time: 3000 }),
      // Twelve out of ten held: the long ends and a short of two begins, and
      // nothing after this says what became of the short.
      fill({ id: 4, side: 'SELL', price: '200', quantity: '12', commission: '0', realizedPnl: '100', time: 4000 }),
    ])
    const short = rounds.find(round => round.positionSide === 'SHORT')
    expect(short).toMatchObject({ quantity: '2', entryPrice: 200, open: true })
    // What the closed-position tab is left holding: the long that did end, at
    // the size it was, and nothing else.
    const closed = rounds.filter(round => !round.open)
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({
      positionSide: 'LONG',
      quantity: '19',
      open: false,
      partial: false,
      entryImplied: false,
    })
  })

  // Realized PnL is the evidence that a fill closed something, and it settles
  // every case but one: a close at exactly the position's own average entry
  // realizes nothing, which is what an opening fill also reports. At a window
  // edge the two are the same row of data, and read as an opening one it invented
  // a short, folded the real close into it as an increase — an increase carries
  // no realized PnL — and left it open, so the closed-position tab showed neither
  // the position nor its profit. The fills after it say which it was: inside a
  // run on one side the position only moves one way, so a later fill in that run
  // realizing anything proves the run is closing.
  it('reads a close that realized nothing as a close when the fills after it say so', () => {
    const rounds = buildFuturesTradeRounds([
      // Ten held at 100 from before the window. Four out at cost, then the rest.
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '120', quantity: '6', commission: '0', realizedPnl: '120', time: 2000 }),
    ])
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG',
      quantity: '10',
      // (4 × 100 + 6 × 120) / 10, and 112 − 120/10 back to the entry.
      exitPrice: 112,
      entryPrice: 100,
      entryImplied: true,
      realizedPnl: 120,
      partial: true,
      open: false,
    })
  })

  // The mirror. A short recovers its entry by adding the per-unit PnL where a
  // long subtracts it, so a fix that read one side only would pass the case
  // above and still lose this one.
  it('reads the same close on a short', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '80', quantity: '6', commission: '0', realizedPnl: '120', time: 2000 }),
    ])
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'SHORT',
      quantity: '10',
      exitPrice: 88,
      entryPrice: 100,
      entryImplied: true,
      realizedPnl: 120,
      open: false,
    })
  })

  it('reconstructs a long after a break-even edge close, add, and final close', () => {
    const rounds = buildFuturesTradeRounds([
      // Ten longs at 100 predate the window. Four close at break-even, two are
      // added at 90, then all eight that remain close at 120. The exchange
      // would report exactly 6×20 + 2×30 = 180 for that close — the PnL here
      // is what the story arithmetically settles to, so the implied entry the
      // round recovers is the true aggregate entry of everything it exited:
      // (4×100 + 6×100 + 2×90) / 12.
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '1', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '90', quantity: '2', commission: '2', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '120', quantity: '8', commission: '3', realizedPnl: '180', time: 3000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG',
      quantity: '12',
      entryImplied: true,
      realizedPnl: 180,
      fee: 6,
      netPnl: 174,
      fills: 3,
      partial: true,
      open: false,
    })
    expect(rounds[0].entryPrice).toBeCloseTo(1180 / 12, 6)
    expect(rounds[0].exitPrice).toBeCloseTo(113.333333, 6)
    expect(rounds.some(round => round.positionSide === 'SHORT')).toBe(false)
  })

  it('reconstructs the short mirror without inventing a long', () => {
    const rounds = buildFuturesTradeRounds([
      // The mirror story settles to 6×20 + 2×30 = 180 as well, and the implied
      // entry to (4×100 + 6×100 + 2×110) / 12.
      fill({ id: 1, side: 'BUY', price: '100', quantity: '4', commission: '1', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '110', quantity: '2', commission: '2', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '80', quantity: '8', commission: '3', realizedPnl: '180', time: 3000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'SHORT',
      quantity: '12',
      entryImplied: true,
      realizedPnl: 180,
      fee: 6,
      netPnl: 174,
      fills: 3,
      partial: true,
      open: false,
    })
    expect(rounds[0].entryPrice).toBeCloseTo(1220 / 12, 6)
    expect(rounds[0].exitPrice).toBeCloseTo(86.666667, 6)
    expect(rounds.some(round => round.positionSide === 'LONG')).toBe(false)
  })

  it('keeps a genuine opening when its first reduction realizes the predicted break-even', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '100', quantity: '2', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '90', quantity: '2', commission: '0', realizedPnl: '20', time: 3000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'SHORT',
      quantity: '4',
      entryPrice: 100,
      entryImplied: false,
      realizedPnl: 20,
      partial: false,
      open: false,
    })
  })

  it('keeps a PnL-consistent reversal and its opposite remainder', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      // Four close the short for 40; two open the long.
      fill({ id: 2, side: 'BUY', price: '90', quantity: '6', commission: '0', realizedPnl: '40', time: 2000 }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds.find(round => !round.open)).toMatchObject({
      positionSide: 'SHORT', quantity: '4', realizedPnl: 40, partial: false,
    })
    expect(rounds.find(round => round.open)).toMatchObject({
      positionSide: 'LONG', quantity: '2', entryPrice: 90, partial: false,
    })
  })

  it('does not use an opposite hedge leg to restart or consume a round', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', positionSide: 'SHORT', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', positionSide: 'LONG', price: '90', quantity: '2', commission: '0', realizedPnl: '0', time: 2000 }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds.find(round => round.leg === 'SHORT')).toMatchObject({
      positionSide: 'SHORT', quantity: '4', entryImplied: false, partial: false, open: true,
    })
    expect(rounds.find(round => round.leg === 'LONG')).toMatchObject({
      positionSide: 'LONG', quantity: '2', entryImplied: false, partial: false, open: true,
    })
  })

  it('finishes the reconstructed partial round before an add after reclosing', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '90', quantity: '2', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '120', quantity: '3', commission: '0', realizedPnl: '70', time: 3000 }),
      fill({ id: 4, side: 'BUY', price: '95', quantity: '1', commission: '0', realizedPnl: '0', time: 4000 }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG', quantity: '1', entryPrice: 95, open: true, partial: false,
    })
    expect(rounds[1]).toMatchObject({
      positionSide: 'LONG', quantity: '7', realizedPnl: 70, fills: 3, open: false, partial: true,
    })
    expect(rounds.some(round => round.positionSide === 'SHORT')).toBe(false)
  })

  // The closed-position review lists rounds that are not open. A restarted
  // edge round that is still holding what it added is a live position, and
  // published closed it filed a phantom closed trade in that review while the
  // operator was still in it.
  it('keeps a restarted edge round open while its add is still held', () => {
    const rounds = buildFuturesTradeRounds([
      // A pre-window long: four close at break-even, six are added at 110,
      // and the window ends with the position live.
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0.1', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '110', quantity: '6', commission: '0.1', realizedPnl: '0', time: 2000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG',
      quantity: '6',
      fills: 2,
      partial: true,
      open: true,
    })
    // The live row is what is held, at what it was bought for. The implied
    // entry recovers 100 — the exited pre-window units — which is the wrong
    // figure for the six still held at 110.
    expect(rounds[0].entryPrice).toBe(110)
    expect(rounds[0].entryImplied).toBe(false)
    expect(rounds[0].notional).toBe(660)
    expect(rounds.filter(round => !round.open)).toHaveLength(0)
  })

  // An open restarted round that has re-closed part of its add holds neither
  // everything it added nor everything it ever entered. Published from
  // entryAtoms, the row claimed six held when four were.
  it('values an open restarted round at what it still holds', () => {
    const rounds = buildFuturesTradeRounds([
      // A pre-window long: four close at break-even, six are added at 110,
      // two of the add close at 115, and the window ends with four live.
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '110', quantity: '6', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '115', quantity: '2', commission: '0', realizedPnl: '10', time: 3000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG',
      quantity: '4',
      entryPrice: 110,
      entryImplied: false,
      notional: 440,
      realizedPnl: 10,
      fills: 3,
      partial: true,
      open: true,
    })
  })

  // Once the re-close has taken back everything the restarted round added, a
  // further same-side fill is indistinguishable from a new position opening.
  // Absorbed on faith, a genuinely new short was folded into the closed long
  // as extra exited contracts, and the short's own round held only its
  // closing fill.
  it('does not absorb a new position into a fully reclosed edge round', () => {
    const rounds = buildFuturesTradeRounds([
      // Ten longs at 100 predate the window: four close at break-even, six
      // are added at 110, and the whole twelve close at 120 — the exchange
      // settles 6×20 + 6×10 = 180. Then a new five-lot short at 121 closes
      // at 119 for its own 10.
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '110', quantity: '6', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '120', quantity: '12', commission: '0', realizedPnl: '180', time: 3000 }),
      fill({ id: 4, side: 'SELL', price: '121', quantity: '5', commission: '0', realizedPnl: '0', time: 4000 }),
      fill({ id: 5, side: 'BUY', price: '119', quantity: '5', commission: '0', realizedPnl: '10', time: 5000 }),
    ])

    expect(rounds).toHaveLength(2)
    const long = rounds.find(round => round.positionSide === 'LONG')
    expect(long).toMatchObject({
      quantity: '16',
      realizedPnl: 180,
      fills: 3,
      partial: true,
      open: false,
    })
    // The recovered entry is the true aggregate of everything the long
    // exited: (4×100 + 6×100 + 6×110) / 16.
    expect(long.entryPrice).toBeCloseTo(103.75, 6)
    const short = rounds.find(round => round.positionSide === 'SHORT')
    expect(short).toMatchObject({
      quantity: '5',
      entryPrice: 121,
      entryImplied: false,
      exitPrice: 119,
      realizedPnl: 10,
      fills: 2,
      partial: false,
      open: false,
    })
  })

  // Only a reduction realizes anything. An increase that arrives carrying
  // realized PnL is therefore proof the round's direction reading is wrong —
  // absorbed as entry anyway, its PnL was silently destroyed and the whole
  // window collapsed into one open round the review then filtered out.
  it('ends a round whose add realizes profit instead of absorbing it', () => {
    const rounds = buildFuturesTradeRounds([
      // A pre-window short: two cover at 90, eight more short at 99, six of
      // those cover at 100, and the nine-lot sell that follows realizes 66 —
      // it is closing an older long, not adding to the short.
      fill({ id: 1, side: 'BUY', price: '90', quantity: '2', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '99', quantity: '8', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '100', quantity: '6', commission: '0', realizedPnl: '0', time: 3000 }),
      fill({ id: 4, side: 'SELL', price: '107', quantity: '9', commission: '0', realizedPnl: '66', time: 4000 }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds.filter(round => round.open)).toHaveLength(0)
    const long = rounds.find(round => round.positionSide === 'LONG')
    expect(long).toMatchObject({
      quantity: '9',
      realizedPnl: 66,
      fills: 1,
      partial: true,
      open: false,
    })
    // Recovered from what the nine lots realized: 107 − 66/9.
    expect(long.entryPrice).toBeCloseTo(107 - 66 / 9, 6)
    const short = rounds.find(round => round.positionSide === 'SHORT')
    expect(short).toMatchObject({
      quantity: '8',
      realizedPnl: 0,
      fills: 3,
      partial: true,
      open: false,
    })
  })

  // The mirror rule for reductions: a new position's opener realizes nothing,
  // so a reducing fill that goes on realizing after the re-close has drained
  // can only be more of the old close. Split on faith, one staged close was
  // filed as two closed trades.
  it('keeps a staged close in one round while its fills go on realizing', () => {
    const rounds = buildFuturesTradeRounds([
      // A pre-window long of ten at 100: four close at break-even, six are
      // added at 110, then the whole thirteen leave in two stages — six at
      // 115 for 60 and three at 116 for 33.
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', price: '110', quantity: '6', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'SELL', price: '115', quantity: '6', commission: '0', realizedPnl: '60', time: 3000 }),
      fill({ id: 4, side: 'SELL', price: '116', quantity: '3', commission: '0', realizedPnl: '33', time: 4000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'LONG',
      quantity: '13',
      realizedPnl: 93,
      fills: 4,
      partial: true,
      open: false,
    })
    // The true aggregate of everything the long exited:
    // (400 + 690 + 348 − 93) / 13.
    expect(rounds[0].entryPrice).toBeCloseTo(1345 / 13, 6)
  })

  // The other half of the same rule, and the one that catches it firing where it
  // should not: a run of fills that realizes nothing throughout is a position
  // being built, and must stay one.
  it('still reads a position being built as the position it opened', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'SELL', price: '120', quantity: '6', commission: '0', realizedPnl: '0', time: 2000 }),
      fill({ id: 3, side: 'BUY', price: '110', quantity: '10', commission: '0', realizedPnl: '20', time: 3000 }),
    ])
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'SHORT',
      quantity: '10',
      // Read from its own fills: (4 × 100 + 6 × 120) / 10.
      entryPrice: 112,
      entryImplied: false,
      exitPrice: 110,
      realizedPnl: 20,
      partial: false,
      open: false,
    })
  })

  // A hedge account names two independent positions on one contract. The short
  // opener cannot be consumed by the long close merely because both are sells.
  it('folds opposite hedge legs into independent position states', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000, positionSide: 'SHORT' }),
      fill({ id: 2, side: 'SELL', price: '120', quantity: '6', commission: '0', realizedPnl: '120', time: 2000, positionSide: 'LONG' }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds.find(round => round.positionKey === 'BICOUSDT:SHORT')).toMatchObject({
      positionSide: 'SHORT', quantity: '4', entryImplied: false, partial: false, open: true,
    })
    expect(rounds.find(round => round.positionKey === 'BICOUSDT:LONG')).toMatchObject({
      positionSide: 'LONG', quantity: '6', realizedPnl: 120, partial: true, open: false,
    })
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

describe('buildFuturesTradeRoundIndex', () => {
  const generation = 'position-generation-2'
  const indexedFill = (overrides = {}) => fill({
    symbol: 'BTCUSDT',
    positionSide: 'BOTH',
    side: 'BUY',
    price: '100',
    quantity: '1',
    commission: '0',
    commissionAsset: 'USDT',
    realizedPnl: '0',
    time: 1_000,
    ...overrides,
  })
  const coverageFor = (...positionKeys) => Object.fromEntries(positionKeys.map(positionKey => [
    positionKey,
    {
      version: 2,
      generation,
      flatBoundary: true,
      pageLimited: false,
      retentionLimited: false,
      continuityComplete: true,
    },
  ]))

  it('keeps simultaneous LONG and SHORT positions independent', () => {
    expect(futuresTradePositionKey(' btcusdt ', 'long')).toBe('BTCUSDT:LONG')
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', positionSide: 'LONG', side: 'BUY', quantity: '2', price: '100' }),
      indexedFill({ id: '2', positionSide: 'SHORT', side: 'SELL', quantity: '3', price: '120' }),
    ], {
      coverage: coverageFor('BTCUSDT:LONG', 'BTCUSDT:SHORT'),
      generation,
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2', entryPrice: '100' },
        { symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '-3', entryPrice: '120' },
      ],
    })

    expect(index.unresolved).toEqual([])
    expect(index.open).toHaveLength(2)
    expect(index.open.map(round => round.positionKey).sort()).toEqual([
      'BTCUSDT:LONG',
      'BTCUSDT:SHORT',
    ])
    for (const round of index.open) {
      expect(round.resolved).toBe(true)
      expect(round.fillIds).toBe(round.tradeIds)
      expect(round.key).toContain(round.positionKey)
    }
  })

  it('preserves retention-limited coverage for a snapshot-only current key', () => {
    const coverage = coverageFor('BTCUSDT:LONG')
    coverage['BTCUSDT:LONG'] = {
      ...coverage['BTCUSDT:LONG'],
      coveredFrom: 10_000,
      coveredTo: 20_000,
      flatBoundary: false,
      retentionLimited: true,
    }
    const index = buildFuturesTradeRoundIndex([], {
      coverage,
      generation,
      positions: [{
        symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1', entryPrice: '100',
      }],
    })

    expect(index.rounds).toEqual([])
    expect(index.byPosition['BTCUSDT:LONG'].coverage).toMatchObject({
      coveredFrom: 10_000,
      coveredTo: 20_000,
      retentionLimited: true,
      sourceVersionCompatible: true,
      sourceGenerationCompatible: true,
      terminalReconciled: false,
    })
    expect(index.unresolved).toHaveLength(1)
    expect(index.unresolved[0].reasons).toEqual(expect.arrayContaining([
      'fill-basis-missing',
      'terminal-snapshot-mismatch',
      'history-retention-limited',
    ]))
    for (const field of ['realizedPnl', 'fee', 'netPnl', 'fillNetPnl']) {
      expect(index.unresolved[0]).not.toHaveProperty(field)
    }
  })

  it('reconciles independent partial closes against each hedge snapshot', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', positionSide: 'LONG', side: 'BUY', quantity: '2', price: '100', time: 1_000 }),
      indexedFill({ id: '2', positionSide: 'SHORT', side: 'SELL', quantity: '3', price: '120', time: 1_000 }),
      indexedFill({ id: '3', positionSide: 'LONG', side: 'SELL', quantity: '1', price: '110', realizedPnl: '10', time: 2_000 }),
      indexedFill({ id: '4', positionSide: 'SHORT', side: 'BUY', quantity: '1', price: '110', realizedPnl: '10', time: 2_000 }),
    ], {
      coverage: coverageFor('BTCUSDT:LONG', 'BTCUSDT:SHORT'),
      generation,
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1', entryPrice: '100' },
        { symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '-2', entryPrice: '120' },
      ],
    })

    expect(index.unresolved).toEqual([])
    expect(index.open).toHaveLength(2)
    expect(index.open.find(round => round.leg === 'LONG')).toMatchObject({
      quantity: '1', realizedPnl: 10, open: true, resolved: true,
    })
    expect(index.open.find(round => round.leg === 'SHORT')).toMatchObject({
      quantity: '2', realizedPnl: 10, open: true, resolved: true,
    })
  })

  it('closes both hedge legs without either leg consuming the other', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', positionSide: 'LONG', side: 'BUY', quantity: '2', price: '100', time: 1_000 }),
      indexedFill({ id: '2', positionSide: 'SHORT', side: 'SELL', quantity: '3', price: '120', time: 1_000 }),
      indexedFill({ id: '3', positionSide: 'LONG', side: 'SELL', quantity: '2', price: '110', realizedPnl: '20', time: 2_000 }),
      indexedFill({ id: '4', positionSide: 'SHORT', side: 'BUY', quantity: '3', price: '110', realizedPnl: '30', time: 2_000 }),
    ], {
      coverage: coverageFor('BTCUSDT:LONG', 'BTCUSDT:SHORT'),
      generation,
      positions: [],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(2)
    expect(index.closed.map(round => [round.positionKey, round.realizedPnl]).sort()).toEqual([
      ['BTCUSDT:LONG', 20],
      ['BTCUSDT:SHORT', 30],
    ])
  })

  it('orders same-millisecond fills by integer trade ids above Number precision', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '9007199254740993', side: 'SELL', price: '110', realizedPnl: '10', time: 2_000 }),
      indexedFill({ id: '9007199254740992', side: 'BUY', price: '100', time: 2_000 }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({ entryPrice: 100, exitPrice: 110, realizedPnl: 10 })
    expect(index.closed[0].fillIds).toEqual([
      '9007199254740992',
      '9007199254740993',
    ])
  })

  it('folds duplicate REST and stream delivery of one reliable trade identity once', () => {
    const opening = indexedFill({
      id: '1', side: 'BUY', price: '100', commission: '1', time: 1_000,
    })
    const closing = indexedFill({
      id: '2', side: 'SELL', price: '110', commission: '1',
      realizedPnl: '10', time: 2_000,
    })
    const deliveries = [
      opening,
      { ...opening },
      closing,
      { ...closing },
    ]
    const options = {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    }
    const index = buildFuturesTradeRoundIndex(deliveries, options)
    const reversed = buildFuturesTradeRoundIndex([...deliveries].reverse(), options)

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({
      quantity: '1',
      realizedPnlExact: '10',
      feeExact: '2',
      fills: 2,
      fillIds: ['1', '2'],
      tradeCoverage: { complete: true, fills: 2, identified: 2 },
      commissionCoverage: { complete: true, fills: 2 },
    })
    expect(index.closed[0].fillContributions).toEqual([
      {
        identity: 'BTCUSDT:BOTH:trade:1', tradeId: '1', reliable: true, share: 1,
        quantityAtoms: '100000000',
      },
      {
        identity: 'BTCUSDT:BOTH:trade:2', tradeId: '2', reliable: true, share: 1,
        quantityAtoms: '100000000',
      },
    ])
    expect(index.fillConservation).toEqual(reversed.fillConservation)
    expect(index.fillConservation).toMatchObject({
      conserved: true,
      affectedPositionKeys: [],
      byPosition: {
        'BTCUSDT:BOTH': {
          conserved: true,
          canonicalFillCount: 2,
          assignedFillCount: 2,
          canonicalQuantityAtoms: '200000000',
          assignedQuantityAtoms: '200000000',
        },
      },
    })
  })

  it('monotonically preserves rich evidence when a sparse duplicate arrives later', () => {
    const opening = indexedFill({
      id: '1', side: 'BUY', price: '100', commission: '1', time: 1_000,
    })
    const index = buildFuturesTradeRoundIndex([
      opening,
      { ...opening, realizedPnl: null, commission: null, commissionAsset: null, marginAsset: null },
      indexedFill({
        id: '2', side: 'SELL', price: '110', commission: '1',
        realizedPnl: '10', time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({
      realizedPnlExact: '10',
      feeExact: '2',
      tradeCoverage: { complete: true },
      commissionCoverage: { complete: true },
    })
  })

  it.each([
    ['realized PnL', { realizedPnl: 'garbage' }],
    ['commission', { commission: 'garbage' }],
    ['commission asset', { commission: '1', commissionAsset: 123 }],
    ['settlement asset', { marginAsset: 123 }],
  ])('does not enrich away malformed duplicate %s evidence', (_field, malformed) => {
    const opening = indexedFill({
      id: '1', side: 'BUY', quantity: '1', price: '100', commission: '1', time: 1_000,
    })
    const closing = indexedFill({
      id: '2', side: 'SELL', quantity: '1', price: '110', commission: '1',
      realizedPnl: '10', time: 2_000,
    })
    const options = {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    }
    const deliveries = [opening, { ...opening, ...malformed }, closing]

    for (const index of [
      buildFuturesTradeRoundIndex(deliveries, options),
      buildFuturesTradeRoundIndex([...deliveries].reverse(), options),
    ]) {
      expect(index.closed).toEqual([])
      expect(index.rounds).toEqual([])
      expect(index.unresolved.flatMap(segment => segment.reasons)).toEqual(
        expect.arrayContaining(['conflicting-fill-identity', 'history-continuity-unproven']),
      )
    }
  })

  it.each([
    ['malformed settlement asset', { marginAsset: '@@@' }, 'trade-coverage-incomplete'],
    ['oversized settlement asset', { marginAsset: 'A'.repeat(33) }, 'trade-coverage-incomplete'],
    ['wrong-type settlement asset', { marginAsset: 123 }, 'trade-coverage-incomplete'],
    ['malformed commission asset', { commission: '1', commissionAsset: '@@@' }, 'commission-coverage-incomplete'],
    ['oversized commission asset', { commission: '1', commissionAsset: 'A'.repeat(33) }, 'commission-coverage-incomplete'],
  ])('keeps direct-fold %s evidence out of exact NET', (_field, malformed, reason) => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({
        id: '1', side: 'BUY', quantity: '1', price: '100', commission: '1',
        time: 1_000, ...malformed,
      }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1', price: '110', commission: '1',
        realizedPnl: '10', time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.closed).toEqual([])
    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toContain(reason)
  })

  it.each([
    ['realized PnL', { realizedPnl: '999' }],
    ['quantity', { quantity: '2' }],
  ])('fails conflicting duplicate %s evidence closed', (_field, conflict) => {
    const closing = indexedFill({
      id: '2', side: 'SELL', quantity: '1', price: '110',
      realizedPnl: '10', time: 2_000,
    })
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      closing,
      { ...closing, ...conflict },
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.closed).toEqual([])
    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toEqual(
      expect.arrayContaining(['conflicting-fill-identity', 'history-continuity-unproven']),
    )
  })

  it('keeps a malformed retained fill from being skipped around an exact NET', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'BUY', quantity: '1', price: null, time: 1_500 }),
      indexedFill({
        id: '3', side: 'SELL', quantity: '1', price: '110',
        realizedPnl: '10', time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.closed).toEqual([])
    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toEqual(
      expect.arrayContaining(['invalid-fill', 'history-continuity-unproven']),
    )
  })

  it('lets one valid canonical identity replace its malformed projection', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1', price: null,
        realizedPnl: '10', time: 2_000,
      }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1', price: '110',
        realizedPnl: '10', time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({ fillIds: ['1', '2'], realizedPnlExact: '10' })
  })

  it('keeps a conflicting present field from hiding inside an incomplete duplicate', () => {
    const closing = indexedFill({
      id: '2', side: 'SELL', quantity: '1', price: '110',
      realizedPnl: '10', time: 2_000,
    })
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      closing,
      { ...closing, quantity: null, price: '999' },
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.closed).toEqual([])
    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toEqual(
      expect.arrayContaining(['conflicting-fill-identity', 'history-continuity-unproven']),
    )
  })

  it('does not prove a later round by truncating unsupported quantity scale', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1.000000009', price: '100', time: 1_000 }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1.000000001', price: '110',
        realizedPnl: '10', time: 2_000,
      }),
      indexedFill({ id: '3', side: 'BUY', quantity: '1', price: '120', time: 3_000 }),
      indexedFill({
        id: '4', side: 'SELL', quantity: '1', price: '130',
        realizedPnl: '10', time: 4_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toEqual(
      expect.arrayContaining(['invalid-fill', 'history-continuity-unproven']),
    )
  })

  it('keeps an unknown-owner malformed fill from qualifying any supplied contract', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', symbol: 'BTCUSDT', side: 'BUY', time: 1_000 }),
      indexedFill({
        id: '2', symbol: 'BTCUSDT', side: 'SELL', price: '110',
        realizedPnl: '10', time: 2_000,
      }),
      indexedFill({ id: '3', symbol: null, side: 'BUY', time: 2_500 }),
      indexedFill({ id: '4', symbol: 'ETHUSDT', side: 'BUY', time: 3_000 }),
      indexedFill({
        id: '5', symbol: 'ETHUSDT', side: 'SELL', price: '110',
        realizedPnl: '10', time: 4_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH', 'ETHUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toEqual(
      expect.arrayContaining(['invalid-fill', 'history-continuity-unproven']),
    )
  })

  it('fails oversized and lossy scientific fill decimals closed', () => {
    const exactCoverage = coverageFor('BTCUSDT:BOTH')
    const oversized = '1'.repeat(129)
    const oversizedQuantity = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: oversized, time: 1_000 }),
    ], { coverage: exactCoverage, generation, positions: [] })
    const oversizedMoney = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1', price: '110',
        realizedPnl: oversized, time: 2_000,
      }),
    ], { coverage: exactCoverage, generation, positions: [] })
    const oversizedCommission = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1', price: '110',
        realizedPnl: '10', commission: oversized, time: 2_000,
      }),
    ], { coverage: exactCoverage, generation, positions: [] })
    const scientificMoney = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({
        id: '2', side: 'SELL', quantity: '1', price: '110',
        realizedPnl: 1e-9, commission: 1e-9, time: 2_000,
      }),
    ], { coverage: exactCoverage, generation, positions: [] })
    const scientificQuantity = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: 1e-9, price: '100', time: 1_000 }),
    ], { coverage: exactCoverage, generation, positions: [] })

    expect(oversizedQuantity.rounds).toEqual([])
    expect(oversizedQuantity.unresolved.flatMap(segment => segment.reasons))
      .toContain('invalid-fill')
    expect(oversizedMoney.rounds).toEqual([])
    expect(oversizedMoney.unresolved.flatMap(segment => segment.reasons))
      .toContain('trade-coverage-incomplete')
    expect(oversizedCommission.rounds).toEqual([])
    expect(oversizedCommission.unresolved.flatMap(segment => segment.reasons))
      .toContain('commission-coverage-incomplete')
    expect(scientificMoney.rounds).toEqual([])
    expect(scientificMoney.unresolved.flatMap(segment => segment.reasons))
      .toEqual(expect.arrayContaining([
        'trade-coverage-incomplete',
        'commission-coverage-incomplete',
      ]))
    expect(scientificQuantity.rounds).toEqual([])
    expect(scientificQuantity.unresolved.flatMap(segment => segment.reasons))
      .toContain('invalid-fill')
  })

  it.each([
    ['realized PnL', { realizedPnl: null }, 'trade-coverage-incomplete'],
    ['commission', { commission: null }, 'commission-coverage-incomplete'],
    ['price', { price: null }, 'invalid-fill'],
    ['quantity', { quantity: null }, 'invalid-fill'],
    ['time', { time: null }, 'invalid-fill'],
  ])('keeps a REST fill with missing %s evidence unresolved', (
    _field,
    missing,
    reason,
  ) => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', time: 1_000 }),
      indexedFill({
        id: '2', side: 'SELL', price: '110', realizedPnl: '10', time: 2_000,
        ...missing,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.rounds).toEqual([])
    expect(index.unresolved.flatMap(segment => segment.reasons)).toContain(reason)
  })

  it('carries one proven USDC settlement asset through the resolved round', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({
        id: '1', symbol: 'BTCUSDC', side: 'BUY', price: '100',
        commissionAsset: 'USDC', marginAsset: 'USDC', time: 1_000,
      }),
      indexedFill({
        id: '2', symbol: 'BTCUSDC', side: 'SELL', price: '110',
        commission: '1', commissionAsset: 'USDC', marginAsset: 'USDC',
        realizedPnl: '10', time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDC:BOTH'),
      generation,
      positions: [],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({
      symbol: 'BTCUSDC',
      settlementAsset: 'USDC',
      realizedPnlExact: '10',
      feeExact: '1',
      netPnl: 9,
      resolved: true,
      tradeCoverage: { complete: true },
    })
  })

  it('uses one canonical commission asset for completeness and settlement NET', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({
        id: '1', side: 'BUY', commission: '0.5', commissionAsset: ' usdt ', time: 1_000,
      }),
      indexedFill({
        id: '2', side: 'SELL', price: '110', commission: '0.5',
        commissionAsset: 'usdt', realizedPnl: '10', time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({
      realizedPnlExact: '10',
      feeExact: '1',
      netPnl: 9,
      commissionCoverage: { complete: true },
      feesByAsset: [{ asset: 'USDT', amount: 1, amountExact: '1' }],
    })
  })

  it.each([
    {
      evidence: 'missing',
      openingAsset: null,
      closingAsset: null,
    },
    {
      evidence: 'conflicting',
      openingAsset: 'USDC',
      closingAsset: 'USDT',
    },
  ])('keeps $evidence settlement-asset evidence unresolved', ({
    openingAsset,
    closingAsset,
  }) => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({
        id: '1', symbol: 'BTCUSDC', side: 'BUY', marginAsset: openingAsset, time: 1_000,
      }),
      indexedFill({
        id: '2', symbol: 'BTCUSDC', side: 'SELL', price: '110',
        realizedPnl: '10', marginAsset: closingAsset, time: 2_000,
      }),
    ], {
      coverage: coverageFor('BTCUSDC:BOTH'),
      generation,
      positions: [],
    })

    expect(index.closed).toEqual([])
    expect(index.rounds).toEqual([])
    expect(index.unresolved).toHaveLength(1)
    expect(index.unresolved[0]).toMatchObject({
      symbol: 'BTCUSDC',
      reasons: expect.arrayContaining(['trade-coverage-incomplete']),
      tradeCoverage: { complete: false },
    })
    for (const moneyField of ['settlementAsset', 'realizedPnl', 'fee', 'netPnl']) {
      expect(index.unresolved[0]).not.toHaveProperty(moneyField)
    }
  })

  it('splits a one-way reversal into a closed round and a live remainder', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '4', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '6', price: '110', realizedPnl: '40', time: 2_000 }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '-2', entryPrice: '110' },
      ],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({
      positionKey: 'BTCUSDT:BOTH', positionSide: 'LONG', quantity: '4', realizedPnl: 40,
    })
    expect(index.open).toHaveLength(1)
    expect(index.open[0]).toMatchObject({
      positionKey: 'BTCUSDT:BOTH', positionSide: 'SHORT', quantity: '2', entryPrice: 110,
    })
    expect(index.closed[0].fillIds).toContain('2')
    expect(index.open[0].fillIds).toEqual(['2'])
    expect(index.fillConservation).toMatchObject({
      conserved: true,
      affectedPositionKeys: [],
      byPosition: {
        'BTCUSDT:BOTH': {
          conserved: true,
          canonicalFillCount: 2,
          assignedFillCount: 2,
          canonicalQuantityAtoms: '1000000000',
          assignedQuantityAtoms: '1000000000',
        },
      },
    })
    expect(index.closed[0].fillContributions).toContainEqual(expect.objectContaining({
      identity: 'BTCUSDT:BOTH:trade:2', quantityAtoms: '400000000', share: 4 / 6,
    }))
    expect(index.open[0].fillContributions).toContainEqual(expect.objectContaining({
      identity: 'BTCUSDT:BOTH:trade:2', quantityAtoms: '200000000', share: 2 / 6,
    }))
  })

  it('does not accept a 0.5 PnL disagreement as one-percent rounding', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '2', price: '100.5', realizedPnl: '0', time: 2_000 }),
    ], { positions: [] })

    expect(index.rounds).toEqual([])
    expect(index.open).toEqual([])
    expect(index.unresolved).not.toHaveLength(0)
    expect(index.unresolved.flatMap(segment => segment.reasons)).toContain('left-boundary-unproven')
  })

  it('marks an exact endpoint page unresolved until its opener is proved', () => {
    const trades = Array.from({ length: 1_000 }, (_, offset) => indexedFill({
      id: String(offset + 1),
      side: 'BUY',
      quantity: '1',
      price: '100',
      time: 10_000 + offset,
    }))
    const index = buildFuturesTradeRoundIndex(trades, {
      generation,
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1000', entryPrice: '100' },
      ],
    })

    expect(index.rounds).toEqual([])
    expect(index.byPosition['BTCUSDT:BOTH'].coverage.pageLimited).toBe(true)
    expect(index.unresolved[0].reasons).toEqual(expect.arrayContaining([
      'left-boundary-unproven',
      'history-page-limited',
    ]))
  })

  it('keeps a break-even first close unresolved instead of inventing an opener', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'SELL', quantity: '1', price: '100', realizedPnl: '0', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '1', price: '110', realizedPnl: '10', time: 2_000 }),
    ], { positions: [] })

    expect(index.rounds).toEqual([])
    expect(index.unresolved).toHaveLength(1)
    expect(index.unresolved[0]).toMatchObject({ open: false, reasons: expect.arrayContaining(['left-boundary-unproven']) })
  })

  it('keeps exact held basis through scale-out and re-entry', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '10', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '9', price: '100', realizedPnl: '0', time: 2_000 }),
      indexedFill({ id: '3', side: 'BUY', quantity: '9', price: '200', time: 3_000 }),
      indexedFill({ id: '4', side: 'SELL', quantity: '10', price: '200', realizedPnl: '100', time: 4_000 }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [],
    })

    expect(index.unresolved).toEqual([])
    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({ quantity: '19', realizedPnl: 100, resolved: true })
    expect(index.closed[0].entryPrice).toBeCloseTo(147.368421, 6)
    expect(index.closed[0].exitPrice).toBeCloseTo(152.631579, 6)
  })

  it('rejects a terminal exposure that disagrees with the current snapshot', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100' }),
    ], {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '2', entryPrice: '100' },
      ],
    })

    expect(index.rounds).toEqual([])
    expect(index.unresolved[0].reasons).toContain('terminal-snapshot-mismatch')
    expect(index.byPosition['BTCUSDT:BOTH'].terminal.reconciled).toBe(false)
  })

  it('fails duplicate or malformed authoritative snapshot keys closed independent of order', () => {
    const trades = [
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100' }),
    ]
    const matching = {
      symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1', entryPrice: '100',
    }
    const conflicting = {
      symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '2', entryPrice: '100',
    }
    const fold = positions => buildFuturesTradeRoundIndex(trades, {
      coverage: coverageFor('BTCUSDT:BOTH'),
      generation,
      positions,
    })

    for (const positions of [
      [matching, conflicting],
      [conflicting, matching],
      [matching, { ...matching }],
      [{ ...matching, quantity: 'not-a-decimal' }],
    ]) {
      const index = fold(positions)
      expect(index.rounds).toEqual([])
      expect(index.unresolved[0].reasons).toContain('terminal-snapshot-mismatch')
      expect(index.byPosition['BTCUSDT:BOTH'].terminal.reconciled).toBe(false)
    }
  })

  it('reconciles an exact sub-micro entry whose numeric view uses exponent notation', () => {
    const index = buildFuturesTradeRoundIndex([
      indexedFill({
        id: '1', symbol: 'PEPEUSDT', side: 'BUY',
        quantity: '1', price: '0.0000001', time: 1_000,
      }),
    ], {
      coverage: coverageFor('PEPEUSDT:BOTH'),
      generation,
      positions: [
        {
          symbol: 'PEPEUSDT', positionSide: 'BOTH',
          quantity: '1', entryPrice: '0.0000001',
        },
      ],
    })

    expect(index.unresolved).toEqual([])
    expect(index.open).toHaveLength(1)
    expect(index.open[0]).toMatchObject({ entryPrice: 1e-7, resolved: true })
    expect(index.byPosition['PEPEUSDT:BOTH'].terminal).toMatchObject({
      entryPrice: 1e-7,
      reconciled: true,
    })
  })

  it('invalidates stale-generation and symbol-only coverage records', () => {
    const trades = [
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '1', price: '110', realizedPnl: '10', time: 2_000 }),
    ]
    const symbolOnly = buildFuturesTradeRoundIndex(trades, {
      coverage: {
        BTCUSDT: { version: 2, generation, flatBoundary: true, pageLimited: false },
      },
      generation,
      positions: [],
    })
    const staleGeneration = buildFuturesTradeRoundIndex(trades, {
      coverage: {
        'BTCUSDT:BOTH': {
          version: 2,
          generation: 'position-generation-1',
          flatBoundary: true,
          pageLimited: false,
        },
      },
      generation,
      positions: [],
    })

    expect(symbolOnly.rounds).toEqual([])
    expect(symbolOnly.byPosition['BTCUSDT:BOTH'].coverage.sourceVersionCompatible).toBe(false)
    expect(staleGeneration.rounds).toEqual([])
    expect(staleGeneration.byPosition['BTCUSDT:BOTH'].coverage.sourceGenerationCompatible).toBe(false)
    expect(staleGeneration.unresolved[0].reasons).toContain('coverage-generation-unproven')
  })

  it('withholds resolved money when the history suffix is not contiguous', () => {
    const exact = coverageFor('BTCUSDT:BOTH')
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '1', price: '110', realizedPnl: '10', time: 2_000 }),
    ], {
      coverage: {
        'BTCUSDT:BOTH': {
          ...exact['BTCUSDT:BOTH'],
          continuityComplete: false,
        },
      },
      generation,
      positions: [],
    })

    expect(index.rounds).toEqual([])
    expect(index.unresolved).toHaveLength(1)
    expect(index.unresolved[0].reasons).toContain('history-continuity-unproven')
    for (const moneyField of ['realizedPnl', 'fee', 'netPnl', 'fillNetPnl']) {
      expect(index.unresolved[0]).not.toHaveProperty(moneyField)
    }
  })

  it('resolves rounds only after an observed flat boundary and strips money from unresolved output', () => {
    const exact = coverageFor('BTCUSDT:BOTH')
    const index = buildFuturesTradeRoundIndex([
      indexedFill({ id: '1', side: 'BUY', quantity: '1', price: '100', time: 1_000 }),
      indexedFill({ id: '2', side: 'SELL', quantity: '1', price: '110', realizedPnl: '10', time: 2_000 }),
      indexedFill({ id: '3', side: 'BUY', quantity: '1', price: '120', time: 3_000 }),
      indexedFill({ id: '4', side: 'SELL', quantity: '1', price: '130', realizedPnl: '10', time: 4_000 }),
    ], {
      coverage: {
        'BTCUSDT:BOTH': {
          ...exact['BTCUSDT:BOTH'],
          flatBoundary: false,
        },
      },
      generation,
      positions: [],
    })

    expect(index.closed).toHaveLength(1)
    expect(index.closed[0]).toMatchObject({
      key: expect.stringContaining('trade:3'), resolved: true, realizedPnl: 10,
    })
    expect(index.unresolved).toHaveLength(1)
    expect(index.unresolved[0].fillIds).toEqual(['1', '2'])
    for (const moneyField of ['realizedPnl', 'fee', 'netPnl', 'fillNetPnl']) {
      expect(index.unresolved[0]).not.toHaveProperty(moneyField)
    }
  })

})

describe('buildFuturesTradeRounds fill money', () => {
  const fill = (overrides = {}) => ({
    symbol: 'BEATUSDT', side: 'BUY', positionSide: 'BOTH',
    price: '100', quantity: '1', realizedPnl: '0',
    commission: '0', commissionAsset: 'USDT', marginAsset: 'USDT',
    time: 1_000, id: 1, ...overrides,
  })
  // A BNB fee added into a USDT result is not a quantity of anything.
  it('keeps a commission charged in another asset out of the result', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', quantity: '10', price: '100', commission: '0.004', commissionAsset: 'BNB', time: 1_000 }),
      fill({ id: 2, side: 'SELL', quantity: '10', price: '112', realizedPnl: '120', commission: '0.0045', commissionAsset: 'BNB', time: 5_000 }),
    ])
    expect(round.fee).toBe(0)
    expect(round.netPnl).toBeCloseTo(120, 6)
    expect(round.feesByAsset).toEqual([expect.objectContaining({
      asset: 'BNB', amount: expect.closeTo(0.0085, 8), amountExact: '0.0085',
    })])
  })

  // A fill that names no commission asset paid in the asset the contract settles
  // in, which is what a USDⓈ-M contract does unless the account opted into BNB.
  it('treats an unnamed commission asset as the settlement asset', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', quantity: '10', price: '100', commission: '2', commissionAsset: undefined, time: 1_000 }),
      fill({ id: 2, side: 'SELL', quantity: '10', price: '112', realizedPnl: '120', commission: '2', commissionAsset: undefined, time: 5_000 }),
    ])
    expect(round.fee).toBeCloseTo(4, 6)
    expect(round.netPnl).toBeCloseTo(116, 6)
  })
})
