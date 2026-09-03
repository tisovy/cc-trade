// A day of the record, read back the way the operator will read it: without the
// application running, from the file alone.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultDeskRecordDirectory,
  formatDeskDiagnosticSummary,
  listDeskRecordSegments,
  runDeskRecordSummary,
  summarizeDeskDiagnosticRecord,
} from './read-desk-record.mjs'

const line = value => `${JSON.stringify(value)}\n`

const DAY = [
  line({ at: '2026-08-10T09:00:00.000Z', kind: 'session', event: 'started', version: '0.5.1' }),
  line({ at: '2026-08-10T09:00:01.100Z', kind: 'timing', phase: 'exchange-info', durationMs: 210, outcome: 'ok', cache: false }),
  line({ at: '2026-08-10T09:00:01.400Z', kind: 'timing', phase: 'depth', durationMs: 180, outcome: 'ok', cache: null }),
  line({ at: '2026-08-10T09:00:02.000Z', kind: 'status', symbol: 'BTCUSDT', state: 'live', code: null }),
  line({ at: '2026-08-10T14:19:58.000Z', kind: 'fault', phase: 'stream', code: 'DEPTH_SEQUENCE_GAP' }),
  line({ at: '2026-08-10T14:20:00.000Z', kind: 'status', symbol: 'BTCUSDT', state: 'resynchronizing', code: 'DEPTH_SEQUENCE_GAP' }),
  line({ at: '2026-08-10T14:20:04.000Z', kind: 'timing', phase: 'depth', durationMs: 2_400, outcome: 'error', cache: null }),
  line({ at: '2026-08-10T14:21:00.000Z', kind: 'status', symbol: 'BTCUSDT', state: 'resynchronizing', code: 'CONNECTION_ROTATED' }),
  line({ at: '2026-08-10T14:21:02.000Z', kind: 'timing', phase: 'oversized-frame:40657', durationMs: 0, outcome: 'error', cache: null }),
  line({ at: '2026-08-10T14:21:02.100Z', kind: 'timing', phase: 'oversized-frame:41022', durationMs: 0, outcome: 'error', cache: null }),
  line({ at: '2026-08-10T14:21:03.000Z', kind: 'fault', phase: 'stream-frame', code: 'STREAM_FRAME_REFUSED' }),
  line({ at: '2026-08-10T15:00:00.000Z', kind: 'command', action: 'trade.placeOrder', market: 'futures', symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT', identity: 'f-m9x2k1-4a7bd0e2' }),
  line({ at: '2026-08-10T15:00:00.400Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_MIN_NOTIONAL', market: 'futures', symbol: 'BTCUSDT', identity: 'f-m9x2k1-4a7bd0e2', exchangeCode: '-4164' }),
  line({ at: '2026-08-10T15:01:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_API_ERROR', market: 'futures', symbol: 'BTCUSDT', identity: 'f-m9x2k1-4a7bd0e3', exchangeCode: '-2019' }),
  line({ at: '2026-08-10T15:02:00.000Z', kind: 'outcome', action: 'trade.cancelOrder', result: 'rejected', code: 'FUTURES_API_ERROR', market: 'futures', symbol: 'BTCUSDT', identity: '84213377', exchangeCode: '-2019' }),
  line({ at: '2026-08-10T15:03:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'unresolved', code: 'FUTURES_OUTCOME_PENDING', market: 'futures', symbol: 'BTCUSDT', identity: 'f-m9x2k1-4a7bd0e4', exchangeCode: null }),
  line({ at: '2026-08-10T15:03:20.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'resolved', code: 'FUTURES_OUTCOME_EXECUTED', market: 'futures', symbol: 'BTCUSDT', identity: 'f-m9x2k1-4a7bd0e4', exchangeCode: null }),
].join('')

describe('summarizeDeskDiagnosticRecord', () => {
  const summary = summarizeDeskDiagnosticRecord(DAY)

  it('counts what happened, by kind and by code', () => {
    expect(summary.lines).toBe(17)
    expect(Object.fromEntries(summary.kinds.map(entry => [entry.key, entry.count]))).toEqual({
      timing: 5, outcome: 5, status: 3, fault: 2, session: 1, command: 1,
    })
    expect(summary.codes.slice(0, 2)).toEqual([
      { key: 'DEPTH_SEQUENCE_GAP', count: 2 },
      { key: 'FUTURES_API_ERROR', count: 2 },
    ])
    expect(summary.from).toBe('2026-08-10T09:00:00.000Z')
    expect(summary.to).toBe('2026-08-10T15:03:20.000Z')
  })

  it('names the cause every resynchronization stated', () => {
    expect(summary.resynchronizations).toEqual([
      {
        at: '2026-08-10T14:20:00.000Z',
        symbol: 'BTCUSDT',
        state: 'resynchronizing',
        code: 'DEPTH_SEQUENCE_GAP',
      },
      {
        at: '2026-08-10T14:21:00.000Z',
        symbol: 'BTCUSDT',
        state: 'resynchronizing',
        code: 'CONNECTION_ROTATED',
      },
    ])
  })

  it('reports the slowest phases and when they were slow', () => {
    expect(summary.phases[0]).toEqual({
      phase: 'depth',
      count: 2,
      medianMs: 1_290,
      slowestMs: 2_400,
      slowestAt: '2026-08-10T14:20:04.000Z',
      errors: 1,
    })
  })

  // "Nine orders refused, all -2019" is one cause. "Nine FUTURES_API_ERROR" is
  // what the record said before the exchange's own word was kept.
  it('counts refusals by the cause the line names', () => {
    expect(summary.refusals).toEqual([
      { key: '-2019[futures]', count: 2 },
      { key: '(the exchange stated none)[futures]', count: 1 },
      { key: '-4164[futures]', count: 1 },
    ])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Refusals by cause (4)')
    // The command that ended well is a warning being withdrawn, not a refusal.
    expect(summary.kinds.find(entry => entry.key === 'outcome').count).toBe(5)
  })

  // A desk-side refusal asked the exchange nothing, but since 2026-08-24 it
  // names its own condition. Five NO_READING evenings and five SIDE_MISMATCH
  // evenings are different problems, and the summary must not fold them back
  // into one "(the exchange stated none)" bucket — that fold is the exact
  // archaeology the named cause exists to end.
  it('counts a desk refusal by the condition it named', () => {
    const named = summarizeDeskDiagnosticRecord([
      line({ at: '2026-08-24T18:09:41.958Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_REDUCTION_NOT_CONFIRMED', market: 'futures', symbol: 'VELVETUSDT', identity: 'f-1', cause: 'NO_READING', exchangeCode: null }),
      line({ at: '2026-08-24T18:10:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_REDUCTION_NOT_CONFIRMED', market: 'futures', symbol: 'VELVETUSDT', identity: 'f-2', cause: 'NO_READING', exchangeCode: null }),
      line({ at: '2026-08-24T18:11:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_REDUCTION_NOT_CONFIRMED', market: 'futures', symbol: 'VELVETUSDT', identity: 'f-3', cause: 'SIDE_MISMATCH', exchangeCode: null }),
      line({ at: '2026-08-24T18:12:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_API_ERROR', market: 'futures', symbol: 'VELVETUSDT', identity: 'f-4', exchangeCode: '-2019' }),
    ].join(''))
    expect(named.refusals).toEqual([
      { key: 'NO_READING[futures]', count: 2 },
      { key: '-2019[futures]', count: 1 },
      { key: 'SIDE_MISMATCH[futures]', count: 1 },
    ])
  })

  it('counts the same code apart per market', () => {
    // The markets do not share a code namespace: -1013 names a spot filter and
    // a futures filter that are configured apart. One merged count reads as one
    // problem when there are two.
    const twoMarkets = summarizeDeskDiagnosticRecord([
      line({ at: '2026-08-10T15:00:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'SPOT_API_ERROR', market: 'spot', symbol: 'BTCUSDT', identity: 's-1', exchangeCode: '-1013' }),
      line({ at: '2026-08-10T15:01:00.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_API_ERROR', market: 'futures', symbol: 'BTCUSDT', identity: 'f-1', exchangeCode: '-1013' }),
    ].join(''))
    expect(twoMarkets.refusals).toEqual([
      { key: '-1013[futures]', count: 1 },
      { key: '-1013[spot]', count: 1 },
    ])
  })

  it('says nothing about refusals on a day that had none', () => {
    const quiet = summarizeDeskDiagnosticRecord(
      line({ at: '2026-08-10T09:00:00.000Z', kind: 'fault', phase: 'stream', code: 'A' }),
    )
    expect(quiet.refusals).toEqual([])
    expect(formatDeskDiagnosticSummary(quiet)).not.toContain('Refusals')
  })

  it('gathers a burst of refused frames under one phase', () => {
    // Each refusal names its own byte count, so counting them by phase verbatim
    // would report a thousand phases seen once each.
    expect(summary.phases.find(entry => entry.phase === 'oversized-frame'))
      .toMatchObject({ count: 2, errors: 2 })
  })

  it('counts a line it cannot read rather than guessing at it', () => {
    const torn = summarizeDeskDiagnosticRecord(`${DAY}{"at":"2026-08-10T15:01:00.000Z","kind":"fa`)
    expect(torn.refused).toBe(1)
    expect(torn.lines).toBe(17)
  })

  // The record is a file on the operator's disk: it can be edited, truncated,
  // or concatenated by hand. A summary that throws over one line summarizes
  // nothing.
  it('reports a day whose lines are missing fields rather than failing on them', () => {
    const damaged = summarizeDeskDiagnosticRecord([
      DAY,
      line({ kind: 'command' }),
      line({ at: '2026-08-10T15:02:00.000Z', kind: 'status', state: 'resynchronizing' }),
      line({ at: '2026-08-10T15:03:00.000Z', kind: 'timing', phase: 'depth' }),
      // The writer always states the market on an answer; only a hand-edited
      // file can lose it, and the summary must group it as unstated, not fail.
      line({ at: '2026-08-10T15:04:00.000Z', kind: 'answer', action: 'trade.placeOrder', durationMs: 640, outcome: 'ok' }),
    ].join(''))
    expect(damaged.refused).toBe(0)
    expect(() => formatDeskDiagnosticSummary(damaged, { day: '2026-08-10' })).not.toThrow()
    expect(formatDeskDiagnosticSummary(damaged)).toContain('Commands (2)')
  })

  // The same action does not measure the same span on both markets: a futures
  // answer is the command's round trip, a spot answer is the round trip plus
  // the account re-read behind it. Folded into one distribution, the summary of
  // 2026-08-16 reported "slowest 3285ms" over a day of futures orders when that
  // sample was a spot re-read. Every row here is shaped exactly as the writer
  // emits it (`answer` in electron/services/desk-diagnostic-record.js), values
  // from the real record of that day.
  it('times each market apart, never folding their answers together', () => {
    const answered = summarizeDeskDiagnosticRecord([
      line({ at: '2026-08-16T07:23:32.604Z', kind: 'answer', action: 'trade.placeOrder', market: 'futures', durationMs: 739, outcome: 'ok', symbol: 'ACEUSDT', identity: 'f-msvhaj6h-fpezm8wh' }),
      line({ at: '2026-08-16T07:23:35.105Z', kind: 'answer', action: 'trade.placeOrder', market: 'futures', durationMs: 729, outcome: 'ok', symbol: 'ACEUSDT', identity: 'f-msvhal48-x8ldk8lf' }),
      line({ at: '2026-08-16T17:39:53.435Z', kind: 'answer', action: 'trade.cancelOrder', market: 'spot', durationMs: 1_882, outcome: 'ok', symbol: 'BTCUSDT', identity: '65412066378' }),
      line({ at: '2026-08-16T17:39:57.902Z', kind: 'answer', action: 'trade.placeOrder', market: 'spot', durationMs: 3_285, outcome: 'ok', symbol: 'BTCUSDT', identity: 's-msw3b795-9n5yf9l9' }),
    ].join(''))

    expect(answered.answers).toEqual([
      { key: 'trade.placeOrder[spot]', count: 1, medianMs: 3_285, slowestMs: 3_285, slowestAt: '2026-08-16T17:39:57.902Z', errors: 0 },
      { key: 'trade.cancelOrder[spot]', count: 1, medianMs: 1_882, slowestMs: 1_882, slowestAt: '2026-08-16T17:39:53.435Z', errors: 0 },
      { key: 'trade.placeOrder[futures]', count: 2, medianMs: 734, slowestMs: 739, slowestAt: '2026-08-16T07:23:32.604Z', errors: 0 },
    ])

    // The load-bearing assertion: the futures group does not carry the spot
    // sample. Its slowest is its own 739, not the day's 3285.
    const futures = answered.answers.find(entry => entry.key === 'trade.placeOrder[futures]')
    expect(futures.count).toBe(2)
    expect(futures.slowestMs).toBe(739)
    expect(futures.slowestAt).toBe('2026-08-16T07:23:32.604Z')

    const printed = formatDeskDiagnosticSummary(answered)
    expect(printed).toContain('trade.placeOrder[spot]')
    expect(printed).toContain('trade.placeOrder[futures]')
    // No unlabeled row: a reader must never meet a distribution whose market
    // it has to guess.
    expect(printed).not.toMatch(/trade\.placeOrder\s+n=/)
    expect(printed).toContain('each market is its own distribution')
  })

  it('prints just the one market a day held', () => {
    const futuresOnly = summarizeDeskDiagnosticRecord(
      line({ at: '2026-08-16T07:23:36.046Z', kind: 'answer', action: 'trade.cancelOrder', market: 'futures', durationMs: 719, outcome: 'ok', symbol: 'ACEUSDT', identity: '5155004042' }),
    )
    expect(futuresOnly.answers).toEqual([
      { key: 'trade.cancelOrder[futures]', count: 1, medianMs: 719, slowestMs: 719, slowestAt: '2026-08-16T07:23:36.046Z', errors: 0 },
    ])
    const printed = formatDeskDiagnosticSummary(futuresOnly)
    expect(printed).toContain('trade.cancelOrder[futures]')
    expect(printed).not.toContain('[spot]')
  })

  it('aligns the answers table to its longest command', () => {
    // The real record already holds trade.adjustPositionMargin[futures] — 35
    // characters. A fixed pad narrower than the widest key bends the table at
    // exactly the row an operator is squinting at.
    const answered = summarizeDeskDiagnosticRecord([
      line({ at: '2026-08-16T07:23:32.604Z', kind: 'answer', action: 'trade.placeOrder', market: 'futures', durationMs: 739, outcome: 'ok', symbol: 'ACEUSDT', identity: 'f-1' }),
      line({ at: '2026-08-16T07:29:28.908Z', kind: 'answer', action: 'trade.adjustPositionMargin', market: 'futures', durationMs: 337, outcome: 'ok', symbol: 'ACEUSDT', identity: 'f-2' }),
    ].join(''))
    const columns = formatDeskDiagnosticSummary(answered)
      .split('\n')
      .filter(row => row.includes('  median '))
      .map(row => row.indexOf('median'))
    expect(columns).toHaveLength(2)
    expect(new Set(columns).size).toBe(1)
  })

  // The one question this whole design turns on: is the desk reading the signed
  // account when it must, or on every frame that arrives? Grouped by the reason
  // the read site stated, because the count alone answers neither.
  it('states why the account was read and what it cost', () => {
    const reads = summarizeDeskDiagnosticRecord([
      line({ at: '2026-08-10T09:00:00.000Z', kind: 'read', reason: 'bootstrap', resources: 4, weight: 90 }),
      line({ at: '2026-08-10T09:05:00.000Z', kind: 'read', reason: 'unstated', resources: 2, weight: 10 }),
      line({ at: '2026-08-10T09:05:30.000Z', kind: 'read', reason: 'unstated', resources: 1, weight: 5 }),
      line({ at: '2026-08-10T09:06:00.000Z', kind: 'read' }),
    ].join(''))
    expect(reads.reads).toEqual([
      { reason: 'bootstrap', count: 1, weight: 90, resources: 4 },
      { reason: 'unstated', count: 2, weight: 15, resources: 3 },
    ])
    const printed = formatDeskDiagnosticSummary(reads)
    expect(printed).toContain('Why the account was read (3 passes, weight 105)')
    expect(printed).toContain('unstated')
  })

  it('summarizes estimate disagreement and unavailable passes without amounts', () => {
    const compared = summarizeDeskDiagnosticRecord([
      line({
        at: '2026-08-10T09:00:00.000Z', kind: 'estimate', value: 'notional',
        compared: 2, unavailable: 0, deviationBps: 0, symbol: 'BTCUSDT',
      }),
      line({
        at: '2026-08-10T09:01:00.000Z', kind: 'estimate', value: 'notional',
        compared: 1, unavailable: 1, deviationBps: 25, symbol: 'ETHUSDT',
      }),
      line({
        at: '2026-08-10T09:02:00.000Z', kind: 'estimate', value: 'notional',
        compared: 0, unavailable: 2, deviationBps: null, symbol: null,
      }),
      line({
        at: '2026-08-10T09:02:01.000Z', kind: 'estimate', value: 'free-margin',
        compared: 0, unavailable: 1, deviationBps: null, symbol: null,
      }),
    ].join(''))

    expect(compared.estimates).toEqual([
      {
        value: 'notional',
        passes: 3,
        comparedPasses: 2,
        agreedPasses: 1,
        unavailablePasses: 2,
        uncomputedPasses: 1,
        comparedRows: 3,
        unavailableRows: 3,
        worstBps: 25,
        worstSymbol: 'ETHUSDT',
        worstAt: '2026-08-10T09:01:00.000Z',
      },
      {
        value: 'free-margin',
        passes: 1,
        comparedPasses: 0,
        agreedPasses: 0,
        unavailablePasses: 1,
        uncomputedPasses: 1,
        comparedRows: 0,
        unavailableRows: 1,
        worstBps: null,
        worstSymbol: null,
        worstAt: null,
      },
    ])
    const printed = formatDeskDiagnosticSummary(compared)
    expect(printed).toContain('Computed values beside exchange reads')
    expect(printed).toContain('worst 25 bps on ETHUSDT')
    expect(printed).toMatch(/free-margin\s+passes\s+0\/1/)
    expect(printed).not.toMatch(/58400|wallet|price/i)
  })

  // The backlog reading says the desk was behind. This says which step it was
  // behind in, which is the difference between "the desk is slow" and an answer
  // the operator can act on.
  it('names the step a late frame waited in', () => {
    const late = summarizeDeskDiagnosticRecord([
      line({
        at: '2026-08-16T09:00:00.000Z',
        kind: 'frame',
        phase: 'frame',
        code: 'DELIVERED',
        resource: 'depth',
        symbol: 'ACEUSDT',
        upstreamMs: 345,
        queuedMs: 1,
        deliveredMs: 12,
        committedMs: 30,
        totalMs: 388,
      }),
      line({
        at: '2026-08-16T09:00:10.000Z',
        kind: 'frame',
        phase: 'frame',
        code: 'DELIVERED',
        resource: 'depth',
        symbol: 'ACEUSDT',
        upstreamMs: 351,
        queuedMs: 1,
        deliveredMs: 40,
        committedMs: 900,
        totalMs: 1_292,
      }),
      // The exchange stated no usable time on this one. It must not be folded
      // into the upstream median as a zero.
      line({
        at: '2026-08-16T09:00:20.000Z',
        kind: 'frame',
        phase: 'frame',
        code: 'DELIVERED',
        resource: 'candles',
        symbol: 'ACEUSDT',
        upstreamMs: null,
        queuedMs: 0,
        deliveredMs: 4,
        committedMs: 9,
        totalMs: 13,
      }),
    ].join(''))

    expect(late.frames).toEqual([
      {
        key: 'depth ACEUSDT',
        count: 2,
        upstreamMs: 348,
        queuedMs: 1,
        deliveredMs: 26,
        committedMs: 465,
        totalMs: 840,
        worstTotalMs: 1_292,
        worstAt: '2026-08-16T09:00:10.000Z',
        upstreamUnknown: 0,
      },
      {
        key: 'candles ACEUSDT',
        count: 1,
        upstreamMs: null,
        queuedMs: 0,
        deliveredMs: 4,
        committedMs: 9,
        totalMs: 13,
        worstTotalMs: 13,
        worstAt: '2026-08-16T09:00:20.000Z',
        upstreamUnknown: 1,
      },
    ])

    const printed = formatDeskDiagnosticSummary(late)
    expect(printed).toContain('Where a frame spent its time')
    // The slow step is the one on screen, and it reads that way.
    expect(printed).toContain('→screen   465')
    // A leg nobody could measure prints as unmeasured, never as instant.
    expect(printed).toContain('exchange→desk     —')
    expect(printed).toContain('(1 without a usable exchange time)')
  })

  // The account lane is read for a different question than the market one. The
  // operator reports one moment and one order — "the number on my order updated
  // late" — and a median over the day cannot be opened at it. So these are
  // listed, and the market lane stays aggregated beside them.
  it('lists the order frames of a day and leaves the market lane aggregated', () => {
    const day = summarizeDeskDiagnosticRecord([
      line({
        at: '2026-08-18T09:00:00.000Z',
        kind: 'frame',
        phase: 'frame',
        code: 'DELIVERED',
        resource: 'depth',
        symbol: 'ACEUSDT',
        upstreamMs: 345,
        queuedMs: 1,
        deliveredMs: 12,
        committedMs: 30,
        totalMs: 388,
        identity: null,
        status: null,
      }),
      line({
        at: '2026-08-18T09:00:04.000Z',
        kind: 'frame',
        phase: 'frame',
        code: 'DELIVERED',
        resource: 'orders',
        symbol: 'TUTUSDT',
        upstreamMs: 210,
        queuedMs: 0,
        deliveredMs: 2,
        committedMs: 9,
        totalMs: 221,
        identity: '41',
        status: 'PARTIALLY_FILLED',
      }),
      line({
        at: '2026-08-18T09:00:04.100Z',
        kind: 'frame',
        phase: 'frame',
        code: 'UNCHANGED',
        resource: 'orders',
        symbol: 'TUTUSDT',
        upstreamMs: null,
        queuedMs: 0,
        deliveredMs: 1,
        committedMs: 3,
        totalMs: 4,
        identity: '41',
        status: 'FILLED',
      }),
      line({
        at: '2026-08-18T09:00:09.000Z',
        kind: 'frame',
        phase: 'frame',
        code: 'NOT_DRAWN',
        resource: 'orders',
        symbol: 'TUTUSDT',
        upstreamMs: 190,
        queuedMs: 0,
        deliveredMs: 1,
        committedMs: 2,
        totalMs: 193,
        identity: '42',
        status: 'PARTIALLY_FILLED',
      }),
    ].join(''))

    expect(day.orderFrames.map(entry => [entry.identity, entry.status, entry.code])).toEqual([
      ['41', 'PARTIALLY_FILLED', 'DELIVERED'],
      ['41', 'FILLED', 'UNCHANGED'],
      ['42', 'PARTIALLY_FILLED', 'NOT_DRAWN'],
    ])
    // The market frame is not in the list and is still in the aggregate.
    expect(day.frames.map(entry => entry.key)).toContain('depth ACEUSDT')

    const printed = formatDeskDiagnosticSummary(day)
    expect(printed).toContain('What the exchange said about an order, and when it was drawn')
    expect(printed).toContain('PARTIALLY_FILLED')
    // The two readings an operator saying "nothing updated" could be
    // describing, kept apart: already drawn, and not drawn at all.
    expect(printed).toContain('UNCHANGED')
    expect(printed).toContain('NOT_DRAWN')
    expect(printed).toContain('Where a frame spent its time')
  })

  it('prints no order section for a day that has none', () => {
    const day = summarizeDeskDiagnosticRecord(DAY)

    expect(day.orderFrames).toEqual([])
    expect(formatDeskDiagnosticSummary(day))
      .not.toContain('What the exchange said about an order')
  })

  // "The screen was late" is the complaint every change in this batch answers,
  // and until the backlog states its depth the record could say only that
  // something was superseded — never how far behind the renderer actually got,
  // or whether the frames it was holding were status lines or books.
  it('states how far behind the renderer fell, not only what it lost', () => {
    const behind = summarizeDeskDiagnosticRecord([
      line({
        at: '2026-08-10T09:00:00.000Z',
        kind: 'backlog',
        resource: 'depth',
        symbol: 'BTCUSDT',
        superseded: 19,
        dropped: 0,
        frames: 1,
        bytes: 512_000,
      }),
      line({
        at: '2026-08-10T09:04:00.000Z',
        kind: 'backlog',
        resource: 'depth',
        symbol: 'BTCUSDT',
        superseded: 4,
        dropped: 1,
        frames: 3,
        bytes: 356_352,
      }),
      line({
        at: '2026-08-10T09:05:00.000Z',
        kind: 'backlog',
        resource: null,
        symbol: null,
        superseded: 0,
        dropped: 0,
        frames: 2,
        bytes: 900,
      }),
    ].join(''))

    expect(behind.backlogs).toEqual([
      {
        key: 'depth BTCUSDT',
        count: 2,
        superseded: 23,
        dropped: 1,
        peakFrames: 3,
        peakBytes: 512_000,
        worstAt: '2026-08-10T09:04:00.000Z',
      },
      {
        key: '- -',
        count: 1,
        superseded: 0,
        dropped: 0,
        peakFrames: 2,
        peakBytes: 900,
        worstAt: '2026-08-10T09:05:00.000Z',
      },
    ])

    // The deepest backlog and the heaviest one are different lines here — one
    // book alone outweighs three status frames — so the time may be attached
    // only to the reading it was measured on. Printed as one run of text, the
    // KB figure would read as having happened at that moment too, and would
    // send the operator to the wrong minute of the record.
    const printed = formatDeskDiagnosticSummary(behind)
    expect(printed).toContain('How far behind the renderer fell')
    expect(printed).toContain(
      'deepest    3 frames at 2026-08-10T09:04:00.000Z  heaviest    500 KB',
    )
  })

  it('answers an empty record without failing', () => {
    const empty = summarizeDeskDiagnosticRecord('')
    expect(empty).toMatchObject({ lines: 0, refused: 0, from: null, to: null })
    expect(formatDeskDiagnosticSummary(empty)).toContain('(nothing)')
  })
})

describe('the summary as the operator runs it', () => {
  let directory
  const printed = []
  const errored = []
  let restoreLog
  let restoreError

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'desk-record-'))
    printed.length = 0
    errored.length = 0
    restoreLog = console.log
    restoreError = console.error
    console.log = message => printed.push(String(message))
    console.error = message => errored.push(String(message))
  })

  afterEach(async () => {
    console.log = restoreLog
    console.error = restoreError
    await rm(directory, { recursive: true, force: true })
  })

  it('reads a day out of the files on disk, application not running', async () => {
    await writeFile(path.join(directory, 'desk-2026-08-10-000.jsonl'), DAY, 'utf8')
    await writeFile(
      path.join(directory, 'desk-2026-08-10-001.jsonl'),
      line({ at: '2026-08-10T16:00:00.000Z', kind: 'fault', phase: 'freshness', code: 'CLOCK_REGRESSION' }),
      'utf8',
    )

    expect(runDeskRecordSummary(['--dir', directory, '--day', '2026-08-10'])).toBe(true)
    const report = printed.join('\n')
    expect(report).toContain('Desk record for 2026-08-10 — 18 events')
    expect(report).toContain('CLOCK_REGRESSION')
    expect(report).toContain('DEPTH_SEQUENCE_GAP')
    expect(report).toMatch(/depth\s+n=\s*2/)
  })

  it('reads the latest day when none is named', async () => {
    await writeFile(path.join(directory, 'desk-2026-08-09-000.jsonl'), DAY, 'utf8')
    await writeFile(
      path.join(directory, 'desk-2026-08-10-000.jsonl'),
      line({ at: '2026-08-10T16:00:00.000Z', kind: 'fault', phase: 'freshness', code: 'CLOCK_REGRESSION' }),
      'utf8',
    )

    runDeskRecordSummary(['--dir', directory])
    expect(printed.join('\n')).toContain('Desk record for 2026-08-10 — 1 events')
  })

  it('says where it looked when there is no record', () => {
    expect(runDeskRecordSummary(['--dir', directory])).toBe(false)
    expect(errored.join('\n')).toContain(directory)
  })

  // The runbook has told the operator to name a file —
  // `node scripts/read-desk-record.mjs ~/.config/cc-trade/diagnostics/desk-<day>-000.jsonl`
  // — since `time-the-fill-to-the-screen` §7.1. The reader used to drop the
  // name on the floor and print the latest day instead: a summary of the wrong
  // day, exit 0, nothing on the page saying so.
  it('reads the file it was named, not the latest day', async () => {
    await writeFile(path.join(directory, 'desk-2026-08-09-000.jsonl'), DAY, 'utf8')
    await writeFile(
      path.join(directory, 'desk-2026-08-10-000.jsonl'),
      line({ at: '2026-08-10T16:00:00.000Z', kind: 'fault', phase: 'freshness', code: 'CLOCK_REGRESSION' }),
      'utf8',
    )

    expect(runDeskRecordSummary([path.join(directory, 'desk-2026-08-09-000.jsonl')])).toBe(true)
    const report = printed.join('\n')
    expect(report).toContain('Desk record for 2026-08-09 — 17 events')
    // Nothing of the latest day leaked in.
    expect(report).not.toContain('CLOCK_REGRESSION')
  })

  it('reads every segment it is handed as one day', async () => {
    const first = path.join(directory, 'desk-2026-08-10-000.jsonl')
    const second = path.join(directory, 'desk-2026-08-10-001.jsonl')
    await writeFile(first, DAY, 'utf8')
    await writeFile(
      second,
      line({ at: '2026-08-10T16:00:00.000Z', kind: 'fault', phase: 'freshness', code: 'CLOCK_REGRESSION' }),
      'utf8',
    )
    expect(runDeskRecordSummary([first, second])).toBe(true)
    expect(printed.join('\n')).toContain('Desk record for 2026-08-10 — 18 events')
  })

  it('refuses a file it cannot read rather than substituting the latest day', async () => {
    await writeFile(path.join(directory, 'desk-2026-08-10-000.jsonl'), DAY, 'utf8')
    const missing = path.join(directory, 'desk-2026-08-01-000.jsonl')
    expect(runDeskRecordSummary([missing])).toBe(false)
    expect(errored.join('\n')).toContain(missing)
    // A refusal prints no summary at all — half an answer is the old defect.
    expect(printed).toEqual([])
  })

  it('refuses to be asked for a file and a day at once', async () => {
    const file = path.join(directory, 'desk-2026-08-10-000.jsonl')
    await writeFile(file, DAY, 'utf8')
    expect(runDeskRecordSummary(['--day', '2026-08-10', file])).toBe(false)
    expect(errored.join('\n')).toContain('not both')
    expect(printed).toEqual([])
  })

  it('refuses an option it does not know rather than reading the wrong thing', async () => {
    await writeFile(path.join(directory, 'desk-2026-08-10-000.jsonl'), DAY, 'utf8')
    expect(runDeskRecordSummary(['--dya', '2026-08-09', '--dir', directory])).toBe(false)
    expect(errored.join('\n')).toContain('--dya')
    expect(printed).toEqual([])
  })

  // `--day` with the day forgotten used to be indistinguishable from `--day`
  // never given: the flag fell off the end, and a call that named a file AND a
  // day-selection flag was half-obeyed — the file's summary printed, exit 0,
  // nothing on the page saying a flag was dropped.
  it('refuses a flag whose value is missing rather than dropping it', async () => {
    const file = path.join(directory, 'desk-2026-08-10-000.jsonl')
    await writeFile(file, DAY, 'utf8')
    expect(runDeskRecordSummary([file, '--day'])).toBe(false)
    expect(errored.join('\n')).toContain('--day')
    expect(printed).toEqual([])
  })

  it('refuses a flag that swallowed another flag as its value', async () => {
    await writeFile(path.join(directory, 'desk-2026-08-10-000.jsonl'), DAY, 'utf8')
    expect(runDeskRecordSummary(['--dir', '--list'])).toBe(false)
    expect(errored.join('\n')).toContain('--dir')
    expect(printed).toEqual([])
  })

  // A hand-cut excerpt often ends mid-line, without the newline the writer
  // always leaves. Concatenating the next file straight onto it fused the cut
  // line with the next file's first — both destroyed, counted unreadable,
  // exit 0.
  it('reads named files whole when the first ends without a newline', async () => {
    const first = path.join(directory, 'desk-2026-08-10-000.jsonl')
    const second = path.join(directory, 'desk-2026-08-10-001.jsonl')
    await writeFile(first, DAY.slice(0, -1), 'utf8')
    await writeFile(
      second,
      line({ at: '2026-08-10T16:00:00.000Z', kind: 'fault', phase: 'freshness', code: 'CLOCK_REGRESSION' }),
      'utf8',
    )
    expect(runDeskRecordSummary([first, second])).toBe(true)
    const report = printed.join('\n')
    expect(report).toContain('Desk record for 2026-08-10 — 18 events')
    expect(report).toContain('CLOCK_REGRESSION')
  })

  it('ignores whatever else is in the directory', async () => {
    await writeFile(path.join(directory, 'notes.txt'), 'not a record', 'utf8')
    await writeFile(path.join(directory, 'desk-2026-08-10.jsonl'), DAY, 'utf8')
    expect(listDeskRecordSegments(directory)).toEqual([])
  })
})

describe('where the record lives', () => {
  it('resolves the application data directory each platform uses', () => {
    expect(defaultDeskRecordDirectory('linux', { HOME: '/home/desk' }))
      .toBe('/home/desk/.config/cc-trade/diagnostics')
    expect(defaultDeskRecordDirectory('linux', { HOME: '/home/desk', XDG_CONFIG_HOME: '/cfg' }))
      .toBe('/cfg/cc-trade/diagnostics')
    expect(defaultDeskRecordDirectory('darwin', { HOME: '/Users/desk' }))
      .toBe('/Users/desk/Library/Application Support/cc-trade/diagnostics')
  })
})

// 2026-09-02: an exit withheld by the renderer left no line, and two thousand
// weight-5 request lines could be attributed only by their cadence. The
// summary now counts what the renderer withheld apart from what was refused,
// and charges each route with the weight its attempts cost.
describe('withholdings and routes', () => {
  const day = [
    line({ at: '2026-09-02T21:40:45.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'withheld', code: 'FUTURES_POSITION_UNCONFIRMED', market: 'futures', symbol: 'AKEUSDT', identity: null, cause: null, exchangeCode: null, requestedToLegBps: null }),
    line({ at: '2026-09-02T21:40:48.000Z', kind: 'outcome', action: 'trade.cancelOrder', result: 'withheld', code: 'CANCEL_IN_FLIGHT', market: 'futures', symbol: 'AKEUSDT', identity: '2348556301', cause: null, exchangeCode: null, requestedToLegBps: null }),
    line({ at: '2026-09-02T21:40:49.000Z', kind: 'outcome', action: 'trade.cancelOrder', result: 'withheld', code: 'CANCEL_IN_FLIGHT', market: 'futures', symbol: 'AKEUSDT', identity: '2348556301', cause: null, exchangeCode: null, requestedToLegBps: null }),
    line({ at: '2026-09-02T21:46:03.000Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_REDUCTION_NOT_CONFIRMED', market: 'futures', symbol: 'AKEUSDT', identity: null, cause: 'QUANTITY_EXCEEDS_LEG', exchangeCode: null, requestedToLegBps: 11_000 }),
    line({ at: '2026-09-02T21:48:00.000Z', kind: 'request', standing: 'ordinary', route: 'history-trades', attempts: 1, chargedWeight: 5, observedWeight: 700, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 0, outcome: 'ok', status: 200, code: null }),
    line({ at: '2026-09-02T21:48:01.000Z', kind: 'request', standing: 'ordinary', route: 'history-trades', attempts: 1, chargedWeight: 5, observedWeight: 705, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 0, outcome: 'ok', status: 200, code: null }),
    line({ at: '2026-09-02T21:48:02.000Z', kind: 'request', standing: 'ordinary', route: 'income', attempts: 1, chargedWeight: 30, observedWeight: 735, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 0, outcome: 'ok', status: 200, code: null }),
    line({ at: '2026-09-02T21:48:03.000Z', kind: 'request', standing: 'command', route: 'cancel', attempts: 1, chargedWeight: 1, observedWeight: 736, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 0, outcome: 'ok', status: 200, code: null }),
    line({ at: '2026-09-02T21:48:04.000Z', kind: 'request', standing: 'ordinary', attempts: 1, chargedWeight: 5, observedWeight: 741, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 0, outcome: 'ok', status: 200, code: null }),
  ].join('')
  const summary = summarizeDeskDiagnosticRecord(day)

  it('counts what the renderer withheld apart from what was refused', () => {
    expect(summary.withholdings).toEqual([
      { key: 'CANCEL_IN_FLIGHT[futures]', count: 2 },
      { key: 'FUTURES_POSITION_UNCONFIRMED[futures]', count: 1 },
    ])
    expect(summary.refusals).toEqual([
      { key: 'QUANTITY_EXCEEDS_LEG[futures]', count: 1 },
    ])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Withheld by the renderer (3)')
    expect(report).toContain('Refusals by cause (1)')
  })

  it('charges each route with the weight its attempts cost', () => {
    expect(summary.routes).toEqual([
      { route: 'income', count: 1, weight: 30 },
      { route: 'history-trades', count: 2, weight: 10 },
      { route: '(unnamed)', count: 1, weight: 5 },
      { route: 'cancel', count: 1, weight: 1 },
    ])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Requests by route (5 attempts, weight 46)')
    expect(report).toContain('history-trades')
  })

  it('says the exchange refused nothing when it refused nothing', () => {
    expect(summary.exchangeRefusals).toEqual([])
    expect(formatDeskDiagnosticSummary(summary)).toContain('Exchange refusals (0)\n  (none)')
  })
})

// The exchange's own refusals, by route: whether the desk's limiter is skewed
// against the exchange's is answered by the record (2026-09-03).
describe('the refusals the exchange stated', () => {
  const day = [
    line({ at: '2026-09-03T10:00:00.000Z', kind: 'request', standing: 'ordinary', route: 'depth', attempts: 2, chargedWeight: 20, observedWeight: 2390, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 1, outcome: 'error', status: 429, code: 'RATE_LIMITED' }),
    line({ at: '2026-09-03T10:00:01.000Z', kind: 'request', standing: 'ordinary', route: 'depth', attempts: 1, chargedWeight: 20, observedWeight: 2400, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 1, outcome: 'error', status: 429, code: 'RATE_LIMITED' }),
    line({ at: '2026-09-03T10:02:00.000Z', kind: 'request', standing: 'command', route: 'order', attempts: 1, chargedWeight: 1, observedWeight: 2401, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 1, outcome: 'error', status: 418, code: 'IP_BANNED' }),
    line({ at: '2026-09-03T10:03:00.000Z', kind: 'request', standing: 'ordinary', route: 'income', attempts: 1, chargedWeight: 30, observedWeight: 40, backpressureMs: 0, connectionRetries: 0, networkRetries: 0, timestampRetries: 0, rateLimitResponses: 0, outcome: 'ok', status: 200, code: null }),
  ].join('')
  const summary = summarizeDeskDiagnosticRecord(day)

  it('lists them by status and route', () => {
    expect(summary.exchangeRefusals).toEqual([
      { key: '429 depth', count: 2 },
      { key: '418 order', count: 1 },
    ])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Exchange refusals (3)')
    expect(report).toContain('     2  429 depth')
    expect(report).toContain('     1  418 order')
  })
})

// What a fault left behind is read beside it: the closes of 2026-09-02 each
// followed seconds of lag, and the crossings were a hundred lines with nothing
// to read them by.
describe('the evidence beside faults', () => {
  // One crossing on AKEUSDT is what the desk writes since 2026-09-03: the
  // evidence on the stream line, the fault of the round it began bare, and the
  // round's own fault lines after it. SKRUSDT crossed inside a round's replay,
  // which leaves its evidence under the round's phase. A background contract
  // parked and was woken in a free minute.
  const day = [
    line({ at: '2026-09-02T21:44:14.498Z', kind: 'fault', phase: 'stream-close', code: 'SOCKET_CLOSED', symbol: 'AKEUSDT' }),
    line({ at: '2026-09-02T21:44:14.498Z', kind: 'evidence', phase: 'stream-close', code: 'SOCKET_CLOSED', symbol: 'AKEUSDT', closeCode: 1006, closedBy: 'transport', lastUpstreamMs: 3_878, lastUpdateId: null, firstUpdateId: null, finalUpdateId: null, previousFinalUpdateId: null, crossedLevels: null }),
    line({ at: '2026-09-02T21:46:24.752Z', kind: 'fault', phase: 'stream', code: 'CROSSED_ORDER_BOOK', symbol: 'AKEUSDT' }),
    line({ at: '2026-09-02T21:46:24.752Z', kind: 'evidence', phase: 'stream', code: 'CROSSED_ORDER_BOOK', symbol: 'AKEUSDT', closeCode: null, closedBy: null, lastUpstreamMs: null, lastUpdateId: '7', firstUpdateId: '8', finalUpdateId: '9', previousFinalUpdateId: '7', crossedLevels: 2 }),
    line({ at: '2026-09-02T21:46:24.753Z', kind: 'fault', phase: 'book-recovery', code: 'CROSSED_ORDER_BOOK', symbol: 'AKEUSDT' }),
    line({ at: '2026-09-02T21:46:25.900Z', kind: 'fault', phase: 'book-recovery', code: 'DEPTH_BOOTSTRAP_NOT_BRIDGED', symbol: 'AKEUSDT' }),
    line({ at: '2026-09-02T21:46:25.000Z', kind: 'fault', phase: 'book-recovery', code: 'CROSSED_ORDER_BOOK', symbol: 'SKRUSDT' }),
    line({ at: '2026-09-02T21:46:25.000Z', kind: 'evidence', phase: 'book-recovery', code: 'CROSSED_ORDER_BOOK', symbol: 'SKRUSDT', closeCode: null, closedBy: null, lastUpstreamMs: null, lastUpdateId: '17', firstUpdateId: '18', finalUpdateId: '19', previousFinalUpdateId: '17', crossedLevels: 1 }),
    line({ at: '2026-09-02T21:47:00.000Z', kind: 'fault', phase: 'stream-close', code: 'SOCKET_CLOSED', symbol: 'SKRUSDT' }),
    line({ at: '2026-09-02T21:47:00.001Z', kind: 'fault', phase: 'park', code: 'SOCKET_CLOSED', symbol: 'SKRUSDT' }),
    line({ at: '2026-09-02T21:47:20.000Z', kind: 'timing', phase: 'lazy-bootstrap', durationMs: 1_240, outcome: 'ok', cache: null, code: null, symbol: 'SKRUSDT' }),
  ].join('')
  const summary = summarizeDeskDiagnosticRecord(day)

  it('lists every stream close with who ended it and how late the last frame was', () => {
    expect(summary.closes).toEqual([{
      at: '2026-09-02T21:44:14.498Z',
      symbol: 'AKEUSDT',
      code: 'SOCKET_CLOSED',
      closedBy: 'transport',
      closeCode: 1006,
      lastUpstreamMs: 3_878,
    }])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Stream closes (1)')
    expect(report).toContain('by transport')
    expect(report).toContain('last frame 3878ms late')
  })

  it('counts crossed books by contract, once each', () => {
    expect(summary.crossings).toEqual([
      { key: 'AKEUSDT', count: 1 },
      { key: 'SKRUSDT', count: 1 },
    ])
    expect(formatDeskDiagnosticSummary(summary)).toContain('Crossed books by contract (2)')
  })

  it('counts every fault under its phase, the parking apart from the close', () => {
    expect(summary.faults).toEqual([
      { key: 'book-recovery CROSSED_ORDER_BOOK', count: 2 },
      { key: 'stream-close SOCKET_CLOSED', count: 2 },
      { key: 'book-recovery DEPTH_BOOTSTRAP_NOT_BRIDGED', count: 1 },
      { key: 'park SOCKET_CLOSED', count: 1 },
      { key: 'stream CROSSED_ORDER_BOOK', count: 1 },
    ])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Faults by phase (7)')
    expect(report).toContain('     1  park SOCKET_CLOSED')
  })

  it('times a lazy wake under its own phase', () => {
    expect(summary.phases).toEqual([
      expect.objectContaining({ phase: 'lazy-bootstrap', count: 1, medianMs: 1_240 }),
    ])
    expect(formatDeskDiagnosticSummary(summary)).toContain('lazy-bootstrap')
  })
})

// Where the chart's candles came from (2026-09-03): the local store's windows
// and pages against the exchange's, and what the store could not give. The
// block is how a day is asked what the store saved and whether it was there.
describe('candle reads by source', () => {
  const timing = (phase, overrides = {}) => ({
    kind: 'timing', phase, durationMs: 12, outcome: 'ok', cache: null, code: null, symbol: null, ...overrides,
  })
  const record = [
    line({ at: '2026-09-03T09:00:00.000Z', ...timing('candle-store-window', { cache: 'hit' }) }),
    line({ at: '2026-09-03T09:00:01.000Z', ...timing('contract-klines') }),
    line({ at: '2026-09-03T09:00:02.000Z', ...timing('candle-store-page', { cache: 'hit' }) }),
    line({ at: '2026-09-03T09:00:03.000Z', ...timing('candle-store-page', { cache: 'hit' }) }),
    line({ at: '2026-09-03T09:00:04.000Z', ...timing('candle-store-page', { cache: 'miss', code: 'NOT_COVERED' }) }),
    line({ at: '2026-09-03T09:00:05.000Z', ...timing('candle-history') }),
    line({ at: '2026-09-03T09:00:06.000Z', ...timing('candle-store-window', { outcome: 'error', code: 'STORE_UNREACHABLE' }) }),
    line({ at: '2026-09-03T09:00:07.000Z', ...timing('candle-store-page', { outcome: 'skipped', code: 'STORE_UNREACHABLE' }) }),
    line({ at: '2026-09-03T09:00:08.000Z', ...timing('candle-history', { outcome: 'error', code: 'REQUEST_DEADLINE_EXCEEDED' }) }),
    line({ at: '2026-09-03T09:00:09.000Z', ...timing('candle-store-window', { outcome: 'aborted', code: 'REQUEST_ABORTED', symbol: 'BTCUSDT' }) }),
  ].join('')

  it('counts windows and pages by source, and what the store could not give', () => {
    expect(summarizeDeskDiagnosticRecord(record).candleReads).toEqual({
      windows: { store: 1, exchange: 1 },
      pages: { store: 2, exchange: 1 },
      store: { misses: 1, errors: 1, skipped: 1, aborted: 1 },
    })
  })

  it('prints the block with the weight the store\'s pages did not spend', () => {
    const text = formatDeskDiagnosticSummary(summarizeDeskDiagnosticRecord(record))
    expect(text).toContain('Candle reads\n  windows: store 1, exchange 1\n  pages: store 2 (weight not spent 10), exchange 1\n  store misses 1, errors 1, skipped 1, aborted 1')
  })

  it('leaves the block out of a day without a candle read', () => {
    const text = formatDeskDiagnosticSummary(summarizeDeskDiagnosticRecord(line({ at: '2026-09-03T09:00:00.000Z', kind: 'timing', phase: 'exchange-info', durationMs: 5, outcome: 'ok', cache: null, code: null, symbol: null })))
    expect(text).not.toContain('Candle reads')
  })
})

describe('the reconfirmation score', () => {
  const settled = (overrides = {}) => ({
    kind: 'settled', reason: 'verification', order: 'ascending', pages: 1, reads: 6, attempts: 6,
    chargedWeight: 180, types: 6, lanes: 6, restored: 0, verified: 6, missing: 0, differing: 0,
    rows: 12, kept: 12, contracts: 2, fundingRows: 4, rebateRows: 0, rebateSymbolRows: 0,
    rebateTradeRows: 0, recipients: 1, coveredMs: 604800000, coverageGainedMs: 0,
    outcome: 'complete', code: null, ...overrides,
  })
  const history = (overrides = {}) => ({
    kind: 'history', reason: 'fill', contracts: 1, reads: 1, returned: 3, restated: 1, held: 2,
    unreported: 0, differing: 0, vouched: 1, outcome: 'complete', code: null, ...overrides,
  })
  const record = [
    line({ at: '2026-09-03T09:00:00.000Z', ...settled({ reason: 'bootstrap', verified: 0 }) }),
    line({ at: '2026-09-03T10:00:00.000Z', ...settled({ missing: 1 }) }),
    line({ at: '2026-09-03T10:30:00.000Z', ...settled({ reason: 'extension', verified: 0, missing: 0 }) }),
    line({ at: '2026-09-03T11:00:00.000Z', ...settled({ differing: 2 }) }),
    line({ at: '2026-09-03T11:00:10.000Z', ...history() }),
    line({ at: '2026-09-03T11:00:20.000Z', ...history({ returned: 2, restated: 0, held: 2 }) }),
    line({ at: '2026-09-03T11:00:30.000Z', ...history({ reason: 'continuation', vouched: 0, unreported: 1, held: 0, returned: 2 }) }),
    line({ at: '2026-09-03T11:01:00.000Z', ...history({ reason: 'open', differing: 1, reads: 4, contracts: 3 }) }),
  ].join('')

  it('counts the passes that compared apart from the passes that ran', () => {
    const summary = summarizeDeskDiagnosticRecord(record)
    expect(summary.reconfirmation.settled).toEqual({
      passes: 4, compared: 2, missing: 1, differing: 2,
    })
  })

  it('keeps the history score by reason, and the vouched score apart', () => {
    const summary = summarizeDeskDiagnosticRecord(record)
    expect(summary.reconfirmation.history).toEqual([
      {
        reason: 'fill', count: 2, vouched: 2, reads: 2, returned: 5, restated: 1, held: 4,
        unreported: 0, differing: 0, vouchedUnreported: 0, vouchedDiffering: 0,
      },
      {
        reason: 'continuation', count: 1, vouched: 0, reads: 1, returned: 2, restated: 1, held: 0,
        unreported: 1, differing: 0, vouchedUnreported: 0, vouchedDiffering: 0,
      },
      {
        reason: 'open', count: 1, vouched: 1, reads: 4, returned: 3, restated: 1, held: 2,
        unreported: 0, differing: 1, vouchedUnreported: 0, vouchedDiffering: 1,
      },
    ])
  })

  it('prints both scores, and the unvouched non-zero as not counting', () => {
    const printed = formatDeskDiagnosticSummary(summarizeDeskDiagnosticRecord(record))
    expect(printed).toContain('Reconfirmation against the stream')
    expect(printed).toContain('  settled passes 4, compared 2, missing 1, differing 2')
    expect(printed).toContain(
      '  history reads 4 (vouched 3), requests 7, returned 10, restated 3, held 6'
      + ', unreported 1 (on vouched 0), differing 1 (on vouched 1)',
    )
    expect(printed).toMatch(/fill {11}n= {4}2 {2}vouched {5}2 {2}returned {6}5/)
  })

  it('states a day of zeros rather than leaving the block out', () => {
    const quiet = summarizeDeskDiagnosticRecord([
      line({ at: '2026-09-03T11:00:10.000Z', ...history({ returned: 0, restated: 0, held: 0 }) }),
    ].join(''))
    const printed = formatDeskDiagnosticSummary(quiet)
    expect(printed).toContain('  settled passes 0, compared 0, missing 0, differing 0')
    expect(printed).toContain('  history reads 1 (vouched 1), requests 1, returned 0')
  })

  it('leaves the block out of a day neither read ran', () => {
    expect(formatDeskDiagnosticSummary(summarizeDeskDiagnosticRecord(DAY)))
      .not.toContain('Reconfirmation')
  })
})
