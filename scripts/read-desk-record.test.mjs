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
    ].join(''))
    expect(damaged.refused).toBe(0)
    expect(() => formatDeskDiagnosticSummary(damaged, { day: '2026-08-10' })).not.toThrow()
    expect(formatDeskDiagnosticSummary(damaged)).toContain('Commands (2)')
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
