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
  line({ at: '2026-08-10T15:00:00.400Z', kind: 'outcome', action: 'trade.placeOrder', result: 'rejected', code: 'FUTURES_MIN_NOTIONAL', market: 'futures', symbol: 'BTCUSDT', identity: 'f-m9x2k1-4a7bd0e2' }),
].join('')

describe('summarizeDeskDiagnosticRecord', () => {
  const summary = summarizeDeskDiagnosticRecord(DAY)

  it('counts what happened, by kind and by code', () => {
    expect(summary.lines).toBe(13)
    expect(Object.fromEntries(summary.kinds.map(entry => [entry.key, entry.count]))).toEqual({
      timing: 5, status: 3, fault: 2, session: 1, command: 1, outcome: 1,
    })
    expect(summary.codes.slice(0, 2)).toEqual([
      { key: 'DEPTH_SEQUENCE_GAP', count: 2 },
      { key: 'CONNECTION_ROTATED', count: 1 },
    ])
    expect(summary.from).toBe('2026-08-10T09:00:00.000Z')
    expect(summary.to).toBe('2026-08-10T15:00:00.400Z')
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

  it('gathers a burst of refused frames under one phase', () => {
    // Each refusal names its own byte count, so counting them by phase verbatim
    // would report a thousand phases seen once each.
    expect(summary.phases.find(entry => entry.phase === 'oversized-frame'))
      .toMatchObject({ count: 2, errors: 2 })
  })

  it('counts a line it cannot read rather than guessing at it', () => {
    const torn = summarizeDeskDiagnosticRecord(`${DAY}{"at":"2026-08-10T15:01:00.000Z","kind":"fa`)
    expect(torn.refused).toBe(1)
    expect(torn.lines).toBe(13)
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
    expect(report).toContain('Desk record for 2026-08-10 — 14 events')
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
