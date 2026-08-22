import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  acquireCanonicalFuturesProbeIncome,
  buildCanonicalFuturesProbeReport,
} from './futures-settled-probe-report.mjs'

const fill = ({
  id,
  side,
  price,
  realizedPnl,
  time,
}) => ({
  id: String(id),
  orderId: String(1_000 + Number(id)),
  symbol: 'BTCUSDC',
  side,
  positionSide: 'BOTH',
  price,
  quantity: '1',
  quoteQty: price,
  realizedPnl,
  commission: '1',
  commissionAsset: 'USDC',
  marginAsset: 'USDC',
  maker: false,
  time,
})

describe('canonical Futures settled probe report', () => {
  it('uses explicit page continuation for timestamp peers and keeps bounded failure partial', async () => {
    const denseRows = ['-1', '-2', '-3'].map((income, index) => ({
      symbol: 'BTCUSDC',
      incomeType: 'FUNDING_FEE',
      income,
      asset: 'USDC',
      time: 1_500,
      tranId: String(9_000 + index),
      tradeId: null,
    }))
    const calls = []
    const reading = await acquireCanonicalFuturesProbeIncome({
      readPage: async request => {
        calls.push(request)
        return { rows: request.page === 1 ? denseRows.slice(0, 2) : denseRows.slice(2) }
      },
      now: 2_000,
      windowFrom: 1_000,
      incomeTypes: ['FUNDING_FEE'],
      limits: {
        PAGE_LIMIT: 2,
        MAX_PAGES_PER_LANE: 1,
        MAX_PAGES_PER_TARGET: 3,
      },
    })

    expect(calls.map(call => call.page)).toEqual([1, 2])
    expect(calls.every(call => call.startTime === 1_000 && call.endTime === 2_000))
      .toBe(true)
    expect(reading).toMatchObject({ requests: 2, passes: 2, exhausted: false })
    expect(reading.rows.map(row => row.income)).toEqual(['-1', '-2', '-3'])
    expect(reading.resource).toMatchObject({ status: 'ready', complete: true })

    const bounded = await acquireCanonicalFuturesProbeIncome({
      readPage: async () => ({ rows: denseRows.slice(0, 2) }),
      now: 2_000,
      windowFrom: 1_000,
      incomeTypes: ['FUNDING_FEE'],
      limits: {
        PAGE_LIMIT: 2,
        MAX_PAGES_PER_LANE: 1,
        MAX_PAGES_PER_TARGET: 3,
        MAX_ROWS_PER_LANE: 2,
      },
    })
    expect(bounded.resource).toMatchObject({ status: 'stale', complete: false })
    expect(bounded.resource.lanes.FUNDING_FEE).toMatchObject({
      status: 'error',
      complete: false,
      error: { code: 'ROW_LIMIT_REACHED' },
    })
    expect(bounded.rows).toHaveLength(2)

    const report = buildCanonicalFuturesProbeReport({
      fills: [fill({ id: 1, side: 'BUY', price: '100', realizedPnl: '0', time: 1_000 })],
      income: bounded.rows,
      coverageBySymbol: {
        BTCUSDC: {
          coveredFrom: 900,
          coveredTo: 2_000,
          flatBoundary: 900,
          continuityComplete: true,
        },
      },
      positions: [{
        symbol: 'BTCUSDC',
        positionSide: 'BOTH',
        positionAmt: '1',
        entryPrice: '100',
      }],
      incomeCoverage: bounded.resource.complete,
    })
    expect(report.open[0].wallet).toMatchObject({
      walletNet: null,
      qualifications: expect.arrayContaining(['FUNDING_COVERAGE_INCOMPLETE']),
    })
  })

  it('preserves USDC and conserves one shared funding identity without legacy overlap', () => {
    const report = buildCanonicalFuturesProbeReport({
      fills: [
        fill({ id: 1, side: 'BUY', price: '100', realizedPnl: '0', time: 1_000 }),
        fill({ id: 2, side: 'SELL', price: '110', realizedPnl: '10', time: 2_000 }),
        fill({ id: 3, side: 'BUY', price: '120', realizedPnl: '0', time: 3_000 }),
        fill({ id: 4, side: 'SELL', price: '140', realizedPnl: '20', time: 4_000 }),
      ],
      income: [
        {
          symbol: 'BTCUSDC',
          incomeType: 'FUNDING_FEE',
          income: '-3',
          asset: 'USDC',
          time: 2_500,
          tranId: '9007199254740993',
          tradeId: null,
        },
        // These are derivable from the fills and must not be counted again.
        {
          symbol: 'BTCUSDC',
          incomeType: 'REALIZED_PNL',
          income: '30',
          asset: 'USDC',
          time: 4_000,
          tranId: '9007199254740994',
          tradeId: '4',
        },
        {
          symbol: 'BTCUSDC',
          incomeType: 'COMMISSION',
          income: '-4',
          asset: 'USDC',
          time: 4_000,
          tranId: '9007199254740995',
          tradeId: '4',
        },
      ],
      coverageBySymbol: {
        BTCUSDC: {
          version: 2,
          coveredFrom: 0,
          coveredTo: 5_000,
          flatBoundary: true,
          pageLimited: false,
          retentionLimited: false,
          continuityComplete: true,
        },
      },
      positions: [],
      generation: 'probe-test',
      incomeCoverage: true,
    })

    expect(report.closed).toHaveLength(2)
    expect(report.closed.every(({ round }) => round.settlementAsset === 'USDC')).toBe(true)
    expect(report.closed.map(({ wallet }) => wallet.walletNet).sort((left, right) => (
      Number(left.amount) - Number(right.amount)
    ))).toEqual([
      { asset: 'USDC', amount: '8' },
      { asset: 'USDC', amount: '18' },
    ])

    const sharedFunding = report.shared.flatMap(bucket => bucket.entries)
      .filter(entry => entry.component === 'funding')
    expect(sharedFunding).toHaveLength(1)
    expect(sharedFunding[0]).toMatchObject({
      amount: '-3',
      asset: 'USDC',
      identityReliable: true,
    })
    expect(report.walletLedger.ownership.roundOwned.flatMap(bucket => bucket.entries)
      .filter(entry => entry.component === 'funding')).toEqual([])

    expect(report.walletLedger.audit).toMatchObject({
      canonicalTotals: [{ asset: 'USDC', amount: '23' }],
      assignedTotals: [{ asset: 'USDC', amount: '23' }],
      conserved: true,
      disjoint: true,
      presentationDisjoint: true,
      additive: true,
    })
    expect(report.walletLedger.audit.skippedIncome).toHaveLength(2)
  })

  it('preserves a numeric flat boundary and maps an open round to one per-asset wallet result', () => {
    const input = {
      fills: [
        fill({ id: 1, side: 'BUY', price: '100', realizedPnl: '0', time: 1_000 }),
      ],
      income: [{
        symbol: 'BTCUSDC',
        incomeType: 'FUNDING_FEE',
        income: '-2',
        asset: 'USDC',
        time: 1_500,
        tranId: '9007199254740993',
        tradeId: null,
      }],
      positions: [{
        symbol: 'BTCUSDC',
        positionSide: 'BOTH',
        positionAmt: '1',
        entryPrice: '100',
      }],
      generation: 'probe-open-test',
      incomeCoverage: true,
    }
    const reportForBoundary = flatBoundary => buildCanonicalFuturesProbeReport({
      ...input,
      coverageBySymbol: {
        BTCUSDC: {
          version: 2,
          coveredFrom: 1_000,
          coveredTo: 2_000,
          flatBoundary,
          pageLimited: false,
          retentionLimited: false,
          continuityComplete: true,
        },
      },
    })

    const report = reportForBoundary(900)

    expect(report.open).toHaveLength(1)
    const [{ round, wallet }] = report.open
    expect(round).toBe(report.roundIndex.open[0])
    expect(round).toMatchObject({
      positionKey: 'BTCUSDC:BOTH',
      open: true,
      settlementAsset: 'USDC',
      incomeCoverage: 'not-attached',
      funding: null,
      insuranceClear: null,
      fillNetPnl: -1,
      netPnl: -1,
      coverage: {
        coveredFrom: 1_000,
        flatBoundary: true,
        terminalReconciled: true,
      },
    })
    expect(wallet).toMatchObject({
      roundId: round.key,
      visibleNet: [{ asset: 'USDC', amount: '-3' }],
      walletNet: { asset: 'USDC', amount: '-3' },
      qualifications: [],
    })
    expect(wallet.entries.filter(entry => entry.component === 'funding')).toEqual([
      expect.objectContaining({ amount: '-2', asset: 'USDC', source: 'income' }),
    ])
    expect(report.shared).toEqual([])
    expect(report.walletLedger.audit).toMatchObject({
      canonicalTotals: [{ asset: 'USDC', amount: '-3' }],
      assignedTotals: [{ asset: 'USDC', amount: '-3' }],
      conserved: true,
      disjoint: true,
      additive: true,
    })

    const lateBoundary = reportForBoundary(1_001)
    expect(lateBoundary.open).toEqual([])
    expect(lateBoundary.roundIndex.unresolved).toEqual([
      expect.objectContaining({
        reasons: expect.arrayContaining(['left-boundary-unproven']),
      }),
    ])
  })

  it('keeps live acquisition output count-only and excludes obsolete probe arithmetic', () => {
    const source = readFileSync('scripts/probe-futures-settled.mjs', 'utf8')
    const acquisitionStart = source.indexOf('// Aggregate shape only.')
    const acquisitionEnd = source.indexOf('const isolatedPositions', acquisitionStart)

    expect(acquisitionStart).toBeGreaterThanOrEqual(0)
    expect(acquisitionEnd).toBeGreaterThan(acquisitionStart)

    const acquisitionSource = source.slice(acquisitionStart, acquisitionEnd)
    const acquisitionOutput = (acquisitionSource.match(/say\([\s\S]*?\);/g) ?? []).join('\n')
    for (const countField of [
      'reason=operator-probe',
      'lanes=',
      'pages=',
      'reads=',
      'physical-attempts=',
      'charged-weight=',
      'coverage-gained=',
    ]) {
      expect(source).toContain(countField)
    }
    expect(acquisitionOutput).toContain('rebate rows in the window')
    expect(acquisitionOutput).toContain('contract evidence present')
    expect(acquisitionOutput).toContain('trade identity present')
    expect(acquisitionOutput).not.toMatch(
      /\.income|\.amount|\.asset|\.symbol|\.tradeId|\.tranId|usdt\(|JSON\.stringify|totalling/i,
    )

    for (const obsolete of [
      'since open ->',
      'SETTLED TOTAL',
      'buildFuturesTradeRounds',
      'attachFuturesRoundIncome',
      'round.funding',
      'round.insuranceClear',
      'round.netPnl',
    ]) {
      expect(source).not.toContain(obsolete)
    }
  })
})
