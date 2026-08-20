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

  it('does not use an opposite fill from another hedge leg to restart a round', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', positionSide: 'SHORT', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000 }),
      fill({ id: 2, side: 'BUY', positionSide: 'LONG', price: '90', quantity: '2', commission: '0', realizedPnl: '0', time: 2000 }),
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({
      positionSide: 'SHORT',
      entryImplied: false,
      partial: false,
      open: true,
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

  // A hedge account names the leg each fill belongs to, and two sells in a row
  // can be one position opening beside another closing. The run stops at the leg
  // boundary rather than reading the second sell as evidence about the first.
  it('does not read one position leg as evidence about the other', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'SELL', price: '100', quantity: '4', commission: '0', realizedPnl: '0', time: 1000, positionSide: 'SHORT' }),
      fill({ id: 2, side: 'SELL', price: '120', quantity: '6', commission: '0', realizedPnl: '120', time: 2000, positionSide: 'LONG' }),
    ])
    // The walk still folds both legs into one contract's exposure, which is its
    // own limitation — what this asserts is only that the first fill was not
    // re-read as a close on the strength of the second.
    expect(rounds[0].entryImplied).toBe(false)
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


// Two records with opposite sign conventions meet in a round's result, and only
// one of them is negated. Getting it backwards hands a fee to the operator as
// profit.
describe('attachFuturesRoundIncome', () => {
  const fill = (overrides = {}) => ({
    symbol: 'BEATUSDT', side: 'BUY', positionSide: 'BOTH',
    price: '100', quantity: '1', realizedPnl: '0',
    commission: '0', commissionAsset: 'USDT', time: 1_000, id: 1, ...overrides,
  })
  const roundTrip = [
    fill({ id: 1, side: 'BUY', quantity: '10', price: '100', commission: '2', time: 1_000 }),
    fill({ id: 2, side: 'SELL', quantity: '10', price: '112', realizedPnl: '120', commission: '2', time: 5_000 }),
  ]

  it('adds an already-negative income row rather than subtracting it', () => {
    const [round] = buildFuturesTradeRounds(roundTrip, {
      income: [{ symbol: 'BEATUSDT', component: 'funding', amount: -7.1, asset: 'USDT', time: 3_000 }],
      incomeFrom: 500,
    })
    expect(round.realizedPnl).toBeCloseTo(120, 6)
    expect(round.fee).toBeCloseTo(4, 6)
    expect(round.funding).toBeCloseTo(-7.1, 6)
    // 120 − 4 + (−7.1). Subtracting the funding would give 116 + 7.1.
    expect(round.netPnl).toBeCloseTo(108.9, 6)
  })

  it('counts only the charges that landed while the round was held', () => {
    const [round] = buildFuturesTradeRounds(roundTrip, {
      income: [
        { symbol: 'BEATUSDT', component: 'funding', amount: -1, asset: 'USDT', time: 500 },
        { symbol: 'BEATUSDT', component: 'funding', amount: -2, asset: 'USDT', time: 3_000 },
        { symbol: 'BEATUSDT', component: 'funding', amount: -4, asset: 'USDT', time: 8_000 },
      ],
      incomeFrom: 100,
    })
    expect(round.funding).toBeCloseTo(-2, 6)
  })

  // A charge stamped exactly at the open or the close belongs to the round: the
  // exchange's bounds are inclusive and a charge has to land somewhere.
  it('keeps a charge stamped exactly at the round’s edges', () => {
    const [round] = buildFuturesTradeRounds(roundTrip, {
      income: [
        { symbol: 'BEATUSDT', component: 'funding', amount: -1, asset: 'USDT', time: 1_000 },
        { symbol: 'BEATUSDT', component: 'funding', amount: -2, asset: 'USDT', time: 5_000 },
      ],
      incomeFrom: 100,
    })
    expect(round.funding).toBeCloseTo(-3, 6)
  })

  it('carries insurance clearance apart from funding', () => {
    const [round] = buildFuturesTradeRounds(roundTrip, {
      income: [{ symbol: 'BEATUSDT', component: 'insuranceClear', amount: -1.5, asset: 'USDT', time: 3_000 }],
      incomeFrom: 100,
    })
    expect(round.insuranceClear).toBeCloseTo(-1.5, 6)
    expect(round.funding).toBeNull()
    expect(round.netPnl).toBeCloseTo(114.5, 6)
  })

  it('says so when the income read begins after the round opened', () => {
    const [covered] = buildFuturesTradeRounds(roundTrip, { income: [], incomeFrom: 100 })
    const [uncovered] = buildFuturesTradeRounds(roundTrip, { income: [], incomeFrom: 3_000 })
    expect(covered.fundingComplete).toBe(true)
    expect(uncovered.fundingComplete).toBe(false)
  })

  // Nothing read is not the same as nothing charged.
  it('reports a round built without the income record as uncovered', () => {
    const [round] = buildFuturesTradeRounds(roundTrip)
    expect(round.fundingComplete).toBe(false)
    expect(round.funding).toBeNull()
  })

  // An income row states no position leg, and funding names no trade to reach one
  // through, so a charge is the contract's. Exposure is folded per contract, so
  // rounds on one contract do not overlap — except at a shared edge, where one
  // closes in the same millisecond the next opens. A charge stamped there is
  // inside both, and belongs to neither more than the other.
  it('marks a charge shared when it lands on the edge two rounds share', () => {
    const rounds = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', quantity: '5', price: '100', time: 1_000 }),
      fill({ id: 2, side: 'SELL', quantity: '5', price: '110', realizedPnl: '50', time: 4_000 }),
      fill({ id: 3, side: 'BUY', quantity: '5', price: '110', time: 4_000 }),
      fill({ id: 4, side: 'SELL', quantity: '5', price: '120', realizedPnl: '50', time: 9_000 }),
    ], {
      income: [{ symbol: 'BEATUSDT', component: 'funding', amount: -3, asset: 'USDT', time: 4_000 }],
      incomeFrom: 100,
    })
    const touching = rounds.filter(round => round.funding !== null)
    expect(touching).toHaveLength(2)
    for (const round of touching) {
      expect(round.fundingShared).toBe(true)
      expect(round.funding).toBeCloseTo(-3, 6)
    }
    // And a charge inside exactly one round is that round's alone.
    const [alone] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', quantity: '5', price: '100', time: 1_000 }),
      fill({ id: 2, side: 'SELL', quantity: '5', price: '110', realizedPnl: '50', time: 4_000 }),
    ], {
      income: [{ symbol: 'BEATUSDT', component: 'funding', amount: -3, asset: 'USDT', time: 2_000 }],
      incomeFrom: 100,
    })
    expect(alone.fundingShared).toBe(false)
  })

  // A BNB fee added into a USDT result is not a quantity of anything.
  it('keeps a commission charged in another asset out of the result', () => {
    const [round] = buildFuturesTradeRounds([
      fill({ id: 1, side: 'BUY', quantity: '10', price: '100', commission: '0.004', commissionAsset: 'BNB', time: 1_000 }),
      fill({ id: 2, side: 'SELL', quantity: '10', price: '112', realizedPnl: '120', commission: '0.0045', commissionAsset: 'BNB', time: 5_000 }),
    ])
    expect(round.fee).toBe(0)
    expect(round.netPnl).toBeCloseTo(120, 6)
    expect(round.feesByAsset).toEqual([{ asset: 'BNB', amount: expect.closeTo(0.0085, 8) }])
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
