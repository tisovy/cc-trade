// Reads back a day of the desk's own record.
//
// A thousand lines read by eye is not how an anomaly gets noticed, so this
// answers the three questions the record exists for: how often did each thing
// happen, what did every resynchronization say it was for, and which phases
// were slow. It reads the file alone — the application does not have to be
// running, and nothing here talks to the exchange.
//
// Usage:
//   node scripts/read-desk-record.mjs                  # the latest day on disk
//   node scripts/read-desk-record.mjs --day 2026-08-10
//   node scripts/read-desk-record.mjs --dir /path/to/diagnostics --list
//
// Times in the record are UTC, and so are the day names: the exchange's day is
// the one a market question is asked about.

import { readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const SEGMENT_NAME = /^desk-(\d{4}-\d{2}-\d{2})-(\d{3})\.jsonl$/
const APPLICATION_DIRECTORY = 'cc-trade'
const RECORD_DIRECTORY = 'diagnostics'
const SLOWEST_PHASES = 12

// Electron's own `app.getPath('userData')`, resolved without Electron so the
// summary can be run against a desk that is not started.
export const defaultDeskRecordDirectory = (platform = process.platform, environment = process.env) => {
  const home = environment.HOME ?? os.homedir()
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APPLICATION_DIRECTORY, RECORD_DIRECTORY)
  }
  if (platform === 'win32') {
    return path.join(
      environment.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      APPLICATION_DIRECTORY,
      RECORD_DIRECTORY,
    )
  }
  return path.join(
    environment.XDG_CONFIG_HOME ?? path.join(home, '.config'),
    APPLICATION_DIRECTORY,
    RECORD_DIRECTORY,
  )
}

export const listDeskRecordSegments = (directory, readDirectory = readdirSync) => {
  let names = []
  try {
    names = readDirectory(directory)
  } catch {
    return []
  }
  return names
    .map((name) => {
      const match = SEGMENT_NAME.exec(name)
      return match === null ? null : { name, day: match[1] }
    })
    .filter(entry => entry !== null)
    .sort((left, right) => (left.name < right.name ? -1 : 1))
}

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

const bump = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1)
const descending = entries => [...entries]
  .map(([key, count]) => ({ key, count }))
  .sort((left, right) => right.count - left.count || (left.key < right.key ? -1 : 1))

// A refused frame names its size in the phase (`oversized-frame:40657`), which
// would give every burst a thousand distinct phases. The size stays on the line;
// the summary groups by the phase itself.
const phaseFamily = phase => phase.split(':')[0]

/**
 * The whole of the reading. Takes the record's lines as text and answers what
 * the day held — no filesystem, so it is provable against a fixture.
 */
export const summarizeDeskDiagnosticRecord = (text) => {
  const codes = new Map()
  const kinds = new Map()
  const durations = new Map()
  const resynchronizations = []
  const refusals = new Map()
  const sessions = []
  const commands = []
  // How long each kind of command took to answer. Keyed by the action, because
  // a placement and a cancellation are not the same wait and averaging them
  // hides whichever is the slow one.
  const answers = new Map()
  // How often the desk went to the exchange for the signed account, and what
  // for. Keyed by the reason the read site stated, because "the desk reads a
  // lot" and "the desk reads when it must" are the same number without it.
  const reads = new Map()
  let refused = 0
  let first = null
  let last = null

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let line = null
    try {
      line = JSON.parse(raw)
    } catch {
      // A line torn in half is the tail of a run that ended mid-write. It is
      // counted, not guessed at.
      refused += 1
      continue
    }
    if (line === null || typeof line !== 'object' || typeof line.kind !== 'string') {
      refused += 1
      continue
    }
    bump(kinds, line.kind)
    if (typeof line.at === 'string') {
      if (first === null || line.at < first) first = line.at
      if (last === null || line.at > last) last = line.at
    }
    if (typeof line.code === 'string') bump(codes, line.code)

    if (line.kind === 'timing' && typeof line.phase === 'string') {
      const family = phaseFamily(line.phase)
      const observed = durations.get(family) ?? []
      observed.push({ durationMs: Number(line.durationMs) || 0, at: line.at, outcome: line.outcome })
      durations.set(family, observed)
    }
    if (line.kind === 'status'
      && (line.state === 'resynchronizing' || line.state === 'unavailable')) {
      resynchronizations.push({
        at: line.at, symbol: line.symbol, state: line.state, code: line.code ?? null,
      })
    }
    // A command the exchange resolved is a warning being withdrawn, not a
    // refusal. Only the two that ended badly are counted here.
    if (line.kind === 'outcome' && (line.result === 'rejected' || line.result === 'unresolved')) {
      bump(refusals, line.exchangeCode ?? '(the exchange stated none)')
    }
    if (line.kind === 'answer' && typeof line.action === 'string') {
      const observed = answers.get(line.action) ?? []
      observed.push({ durationMs: Number(line.durationMs) || 0, at: line.at, outcome: line.outcome })
      answers.set(line.action, observed)
    }
    if (line.kind === 'read' && typeof line.reason === 'string') {
      const observed = reads.get(line.reason) ?? { count: 0, weight: 0, resources: 0 }
      observed.count += 1
      observed.weight += Number(line.weight) || 0
      observed.resources += Number(line.resources) || 0
      reads.set(line.reason, observed)
    }
    if (line.kind === 'session') sessions.push({ at: line.at, event: line.event, version: line.version ?? null })
    if (line.kind === 'command') {
      commands.push({
        at: line.at,
        action: line.action,
        market: line.market,
        symbol: line.symbol ?? null,
        side: line.side ?? null,
        orderType: line.orderType ?? null,
        identity: line.identity ?? null,
      })
    }
  }

  const observedAs = entries => [...entries]
    .map(([key, observed]) => {
      const values = observed.map(entry => entry.durationMs)
      const slowest = observed.reduce(
        (worst, entry) => (entry.durationMs > worst.durationMs ? entry : worst),
        observed[0],
      )
      return {
        key,
        count: observed.length,
        medianMs: median(values),
        slowestMs: slowest.durationMs,
        slowestAt: slowest.at ?? null,
        errors: observed.filter(entry => entry.outcome === 'error').length,
      }
    })
    .sort((left, right) => right.slowestMs - left.slowestMs)

  const phases = observedAs(durations.entries())
    .map(({ key, ...rest }) => ({ phase: key, ...rest }))

  return {
    lines: [...kinds.values()].reduce((sum, count) => sum + count, 0),
    refused,
    from: first,
    to: last,
    kinds: descending(kinds.entries()),
    codes: descending(codes.entries()),
    resynchronizations,
    refusals: descending(refusals.entries()),
    sessions,
    commands,
    phases,
    answers: observedAs(answers.entries()),
    reads: [...reads.entries()]
      .map(([reason, observed]) => ({ reason, ...observed }))
      .sort((left, right) => right.weight - left.weight),
  }
}

export const formatDeskDiagnosticSummary = (summary, { day = null } = {}) => {
  const out = []
  out.push(`Desk record${day === null ? '' : ` for ${day}`} — ${summary.lines} events`
    + (summary.refused === 0 ? '' : `, ${summary.refused} unreadable`))
  if (summary.from !== null) out.push(`  from ${summary.from} to ${summary.to} (UTC)`)

  out.push('', 'By kind')
  if (summary.kinds.length === 0) out.push('  (nothing)')
  for (const { key, count } of summary.kinds) out.push(`  ${String(count).padStart(6)}  ${key}`)

  out.push('', 'By code')
  if (summary.codes.length === 0) out.push('  (nothing)')
  for (const { key, count } of summary.codes) out.push(`  ${String(count).padStart(6)}  ${key}`)

  out.push('', `Resynchronizations (${summary.resynchronizations.length})`)
  if (summary.resynchronizations.length === 0) out.push('  (none)')
  for (const entry of summary.resynchronizations) {
    out.push(
      `  ${entry.at ?? '-'}  ${String(entry.state).padEnd(16)}`
      + ` ${String(entry.symbol ?? '-').padEnd(12)} ${entry.code ?? '-'}`,
    )
  }

  // Only when there were any: a day with nothing refused should not carry an
  // empty heading saying so.
  if (summary.refusals.length > 0) {
    const refused = summary.refusals.reduce((sum, entry) => sum + entry.count, 0)
    out.push('', `Refusals by the code the exchange gave (${refused})`)
    for (const { key, count } of summary.refusals) {
      out.push(`  ${String(count).padStart(6)}  ${key}`)
    }
  }

  out.push('', 'Slowest phases')
  if (summary.phases.length === 0) out.push('  (none)')
  for (const phase of summary.phases.slice(0, SLOWEST_PHASES)) {
    out.push(
      `  ${phase.phase.padEnd(22)} n=${String(phase.count).padStart(5)}`
      + `  median ${String(phase.medianMs).padStart(6)}ms`
      + `  slowest ${String(phase.slowestMs).padStart(6)}ms`
      + (phase.slowestAt === null ? '' : ` at ${phase.slowestAt}`)
      + (phase.errors === 0 ? '' : `  (${phase.errors} failed)`),
    )
  }

  if (summary.answers.length > 0) {
    out.push('', 'How long commands took to answer')
    for (const answer of summary.answers) {
      out.push(
        `  ${answer.key.padEnd(22)} n=${String(answer.count).padStart(5)}`
        + `  median ${String(answer.medianMs).padStart(6)}ms`
        + `  slowest ${String(answer.slowestMs).padStart(6)}ms`
        + (answer.slowestAt === null ? '' : ` at ${answer.slowestAt}`)
        + (answer.errors === 0 ? '' : `  (${answer.errors} failed)`),
      )
    }
  }

  if (summary.reads.length > 0) {
    const weight = summary.reads.reduce((total, entry) => total + entry.weight, 0)
    const passes = summary.reads.reduce((total, entry) => total + entry.count, 0)
    out.push('', `Why the account was read (${passes} passes, weight ${weight})`)
    for (const entry of summary.reads) {
      out.push(
        `  ${entry.reason.padEnd(22)} n=${String(entry.count).padStart(5)}`
        + `  weight ${String(entry.weight).padStart(6)}`
        + `  resources ${String(entry.resources).padStart(5)}`,
      )
    }
  }

  if (summary.sessions.length > 0) {
    out.push('', 'Runs')
    for (const entry of summary.sessions) {
      out.push(`  ${entry.at}  ${entry.event}${entry.version === null ? '' : ` ${entry.version}`}`)
    }
  }

  if (summary.commands.length > 0) {
    out.push('', `Commands (${summary.commands.length})`)
    for (const entry of summary.commands) {
      // Every field is coerced: the record is a file on the operator's disk, and
      // a summary that throws over one edited line is a summary of nothing.
      out.push(
        `  ${entry.at ?? '-'}  ${String(entry.action ?? '-').padEnd(24)}`
        + ` ${String(entry.market ?? '-').padEnd(8)}`
        + ` ${String(entry.symbol ?? '-').padEnd(12)} ${entry.side ?? '-'}`
        + ` ${entry.orderType ?? '-'} ${entry.identity ?? '-'}`,
      )
    }
  }

  return out.join('\n')
}

const readArguments = (argv) => {
  const options = { directory: null, day: null, list: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dir') options.directory = argv[index += 1] ?? null
    else if (argv[index] === '--day') options.day = argv[index += 1] ?? null
    else if (argv[index] === '--list') options.list = true
  }
  return options
}

export const runDeskRecordSummary = (argv = process.argv.slice(2)) => {
  const options = readArguments(argv)
  const directory = options.directory ?? defaultDeskRecordDirectory()
  const segments = listDeskRecordSegments(directory)
  if (segments.length === 0) {
    console.error(`No desk record found in ${directory}`)
    return false
  }
  if (options.list) {
    const days = [...new Set(segments.map(entry => entry.day))]
    console.log(`Desk record in ${directory}`)
    for (const day of days) {
      const held = segments.filter(entry => entry.day === day).length
      console.log(`  ${day}  ${held} file${held === 1 ? '' : 's'}`)
    }
    return true
  }
  const day = options.day ?? segments[segments.length - 1].day
  const chosen = segments.filter(entry => entry.day === day)
  if (chosen.length === 0) {
    console.error(`No desk record for ${day} in ${directory}`)
    return false
  }
  const text = chosen
    .map(entry => readFileSync(path.join(directory, entry.name), 'utf8'))
    .join('')
  console.log(formatDeskDiagnosticSummary(summarizeDeskDiagnosticRecord(text), { day }))
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runDeskRecordSummary() ? 0 : 1
}
