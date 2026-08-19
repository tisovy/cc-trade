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
  it('counts refusals by the code the exchange gave', () => {
    expect(summary.refusals).toEqual([
      { key: '-2019', count: 2 },
      { key: '(the exchange stated none)', count: 1 },
      { key: '-4164', count: 1 },
    ])
    const report = formatDeskDiagnosticSummary(summary)
    expect(report).toContain('Refusals by the code the exchange gave (4)')
    // The command that ended well is a warning being withdrawn, not a refusal.
    expect(summary.kinds.find(entry => entry.key === 'outcome').count).toBe(5)
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
