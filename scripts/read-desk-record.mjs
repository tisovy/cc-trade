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
//   node scripts/read-desk-record.mjs /path/to/desk-2026-08-10-000.jsonl
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
const ESTIMATE_VALUES = Object.freeze([
  'notional',
  'initial-margin',
  'maintenance-margin',
  'liquidation-price',
  'free-margin',
])
const ESTIMATE_VALUE_SET = new Set(ESTIMATE_VALUES)

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
  // Commands the renderer withheld before they left it — an exit refused for a
  // readiness condition, a second cancel of an order whose cancel was in
  // flight. Counted apart from refusals: nothing was asked of the exchange.
  const withholdings = new Map()
  // Charged weight per route, from the request lines. On 2026-09-02 two
  // thousand weight-5 lines could be attributed only by their cadence.
  const routes = new Map()
  // What a fault left behind: every stream close with who ended it and how
  // late the last frame before it was, and the crossings by contract. Kept
  // whole rather than aggregated — there are a handful of closes in a day and
  // each one is read for its own lag.
  const closes = []
  const crossings = new Map()
  // The exchange's own refusals — a request answered 429 or 418 — by route.
  // The skew headroom of the desk's limiter against the exchange's is a
  // question this answers from the record rather than from a guess
  // (2026-09-03); nothing is retuned on the strength of it here.
  const exchangeRefusals = new Map()
  // Every fault by its phase and code. The codes alone merge a socket close
  // with the parking it caused; the phase says which was which.
  const faults = new Map()
  // The two reads that confirm the stream against the exchange, and what they
  // found (2026-09-03). Thirty daily summaries of zeros here are the evidence
  // for ending a read; one non-zero keeps it. Settled passes are counted
  // apart from the passes that compared: an extension pass compares nothing
  // and its zeros are silence. History reads are kept by the reason the read
  // stated, and their unreported/differing are stated twice — over every
  // pass, and over the vouched passes alone, which are the ones that count.
  const settledScore = { passes: 0, compared: 0, missing: 0, differing: 0 }
  const historyScore = new Map()
  // Where the chart's candles came from (2026-09-03): the local store's
  // windows and pages, the exchange's, and what the store could not give.
  // A store page is a thousand candles the exchange did not have to send at
  // weight five; a day can be asked what the store saved and whether it was
  // there at all.
  const candleReads = {
    windows: { store: 0, exchange: 0 },
    pages: { store: 0, exchange: 0 },
    store: { misses: 0, errors: 0, skipped: 0, aborted: 0 },
  }
  const sessions = []
  const commands = []
  // How long each kind of command took to answer. Keyed by action and market
  // both: a placement and a cancellation are not the same wait, and neither
  // are a spot answer and a futures answer to the same action — averaging
  // either pair hides whichever is the slow one.
  const answers = new Map()
  // How often the desk went to the exchange for the signed account, and what
  // for. Keyed by the reason the read site stated, because "the desk reads a
  // lot" and "the desk reads when it must" are the same number without it.
  const reads = new Map()
  // One aggregate event per value per applicable account read. Both pass and
  // row counts matter: a pass with one missing hedge leg is different evidence
  // from a pass where nothing could be computed at all.
  const estimates = new Map()
  // How far behind the renderer fell, per resource. The operator's complaint is
  // always "the screen was late", and this is the only reading that separates a
  // desk that was behind from a market that was fast.
  const backlogs = new Map()
  // Where a sampled frame spent its time, per resource. The backlog reading
  // above says the desk was behind; this says which step it was behind in,
  // which is the difference between "the desk is slow" and an answer.
  const frames = new Map()
  // Every account frame, kept whole rather than aggregated. There are tens of
  // them in a day against tens of thousands of market frames, and they are read
  // for a different question: the operator reports one moment and one order, and
  // a median cannot be opened at it.
  const orderFrames = []
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
      if (family === 'candle-store-window' || family === 'candle-store-page') {
        const kind = family === 'candle-store-window' ? 'windows' : 'pages'
        if (line.outcome === 'ok' && line.cache === 'hit') candleReads[kind].store += 1
        else if (line.outcome === 'ok') candleReads.store.misses += 1
        else if (line.outcome === 'skipped') candleReads.store.skipped += 1
        // A read the session abandoned — the operator moved on before the
        // store answered — is not the store failing.
        else if (line.outcome === 'aborted') candleReads.store.aborted += 1
        else candleReads.store.errors += 1
      }
      if (family === 'contract-klines' && line.outcome === 'ok') candleReads.windows.exchange += 1
      if (family === 'candle-history' && line.outcome === 'ok') candleReads.pages.exchange += 1
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
      // Named with the market for the same reason answers are: the markets do
      // not share a code namespace, so one merged count reads as one problem
      // when there may be two. A desk-side refusal has no exchange code but
      // may name its own condition (`cause`, since 2026-08-24) — folding those
      // into "(the exchange stated none)" would hide exactly the difference
      // the named condition exists to state.
      bump(
        refusals,
        `${line.cause ?? line.exchangeCode ?? '(the exchange stated none)'}`
        + `[${typeof line.market === 'string' ? line.market : '-'}]`,
      )
    }
    if (line.kind === 'outcome' && line.result === 'withheld') {
      bump(
        withholdings,
        `${line.code ?? '(unnamed)'}[${typeof line.market === 'string' ? line.market : '-'}]`,
      )
    }
    if (line.kind === 'evidence' && line.phase === 'stream-close') {
      closes.push({
        at: line.at ?? null,
        symbol: line.symbol ?? null,
        code: line.code ?? null,
        closedBy: line.closedBy ?? null,
        closeCode: line.closeCode ?? null,
        lastUpstreamMs: line.lastUpstreamMs ?? null,
      })
    }
    if (line.kind === 'evidence' && line.code === 'CROSSED_ORDER_BOOK') {
      bump(crossings, `${line.symbol ?? '-'}`)
    }
    if (line.kind === 'fault' && typeof line.phase === 'string') {
      bump(faults, `${phaseFamily(line.phase)} ${line.code ?? '-'}`)
    }
    if (line.kind === 'settled') {
      settledScore.passes += 1
      if (Number(line.verified) > 0) {
        settledScore.compared += 1
        settledScore.missing += Number(line.missing) || 0
        settledScore.differing += Number(line.differing) || 0
      }
    }
    if (line.kind === 'history') {
      const reason = typeof line.reason === 'string' ? line.reason : '(unstated)'
      const observed = historyScore.get(reason) ?? {
        count: 0,
        vouched: 0,
        reads: 0,
        returned: 0,
        restated: 0,
        held: 0,
        unreported: 0,
        differing: 0,
        vouchedUnreported: 0,
        vouchedDiffering: 0,
      }
      observed.count += 1
      observed.reads += Number(line.reads) || 0
      observed.returned += Number(line.returned) || 0
      observed.restated += Number(line.restated) || 0
      observed.held += Number(line.held) || 0
      observed.unreported += Number(line.unreported) || 0
      observed.differing += Number(line.differing) || 0
      if (Number(line.vouched) === 1) {
        observed.vouched += 1
        observed.vouchedUnreported += Number(line.unreported) || 0
        observed.vouchedDiffering += Number(line.differing) || 0
      }
      historyScore.set(reason, observed)
    }
    if (line.kind === 'request') {
      const route = typeof line.route === 'string' ? line.route : '(unnamed)'
      const observed = routes.get(route) ?? { count: 0, weight: 0 }
      observed.count += 1
      observed.weight += Number(line.chargedWeight) || 0
      routes.set(route, observed)
      const status = Number(line.status)
      if (status === 429 || status === 418) bump(exchangeRefusals, `${status} ${route}`)
    }
    if (line.kind === 'answer' && typeof line.action === 'string') {
      // Keyed by market as well as by action, because the same action does not
      // measure the same span on both markets: a futures answer is the
      // command's round trip, a spot answer is the round trip plus the account
      // re-read behind it. Folded into one distribution, the summary of
      // 2026-08-16 reported "slowest 3285ms" over a day of futures orders when
      // that sample was a spot re-read — the number was true and the reading
      // of it was not. The market on the line is the writer's own; `-` can
      // only come from a hand-edited file.
      const key = `${line.action}[${typeof line.market === 'string' ? line.market : '-'}]`
      const observed = answers.get(key) ?? []
      observed.push({ durationMs: Number(line.durationMs) || 0, at: line.at, outcome: line.outcome })
      answers.set(key, observed)
    }
    if (line.kind === 'read' && typeof line.reason === 'string') {
      const observed = reads.get(line.reason) ?? { count: 0, weight: 0, resources: 0 }
      observed.count += 1
      observed.weight += Number(line.weight) || 0
      observed.resources += Number(line.resources) || 0
      reads.set(line.reason, observed)
    }
    if (line.kind === 'estimate' && ESTIMATE_VALUE_SET.has(line.value)) {
      const compared = Number.isSafeInteger(line.compared) && line.compared >= 0
        ? line.compared
        : null
      const unavailable = Number.isSafeInteger(line.unavailable) && line.unavailable >= 0
        ? line.unavailable
        : null
      const deviationBps = line.deviationBps === null
        ? null
        : Number.isSafeInteger(line.deviationBps) && line.deviationBps >= 0
          ? line.deviationBps
          : undefined
      if (compared !== null && unavailable !== null && deviationBps !== undefined) {
        const observed = estimates.get(line.value) ?? {
          value: line.value,
          passes: 0,
          comparedPasses: 0,
          agreedPasses: 0,
          unavailablePasses: 0,
          uncomputedPasses: 0,
          comparedRows: 0,
          unavailableRows: 0,
          worstBps: null,
          worstSymbol: null,
          worstAt: null,
        }
        observed.passes += 1
        observed.comparedRows += compared
        observed.unavailableRows += unavailable
        if (compared > 0) observed.comparedPasses += 1
        if (unavailable > 0) observed.unavailablePasses += 1
        if (compared === 0 && unavailable > 0) observed.uncomputedPasses += 1
        if (compared > 0 && unavailable === 0 && deviationBps === 0) {
          observed.agreedPasses += 1
        }
        if (deviationBps !== null
          && (observed.worstBps === null || deviationBps > observed.worstBps)) {
          observed.worstBps = deviationBps
          observed.worstSymbol = typeof line.symbol === 'string' ? line.symbol : null
          observed.worstAt = line.at ?? null
        }
        estimates.set(line.value, observed)
      }
    }
    if (line.kind === 'backlog') {
      const key = `${line.resource ?? '-'} ${line.symbol ?? '-'}`
      const observed = backlogs.get(key)
        ?? { count: 0, superseded: 0, dropped: 0, peakFrames: 0, peakBytes: 0, worstAt: null }
      observed.count += 1
      observed.superseded += Number(line.superseded) || 0
      observed.dropped += Number(line.dropped) || 0
      // The deepest single backlog, and the time it happened — one line's two
      // readings, kept together. The heaviest backlog is tracked separately
      // because it need not be the same one: a hundred status lines and one
      // book are different shapes of behind, and a time attached to the wrong
      // one would send the operator to the wrong minute of the record.
      const frames = Number(line.frames) || 0
      if (frames > observed.peakFrames) {
        observed.peakFrames = frames
        observed.worstAt = line.at ?? null
      }
      observed.peakBytes = Math.max(observed.peakBytes, Number(line.bytes) || 0)
      backlogs.set(key, observed)
    }
    if (line.kind === 'frame') {
      const key = `${line.resource ?? '-'} ${line.symbol ?? '-'}`
      const observed = frames.get(key) ?? {
        count: 0,
        upstream: [],
        queued: [],
        delivered: [],
        committed: [],
        total: [],
        // The slowest frame and when it happened, kept together: the operator
        // reports a moment, and this is what lets the record be opened at it.
        worstTotalMs: 0,
        worstAt: null,
        // Frames whose upstream leg could not be measured — the exchange stated
        // no time, or its clock was ahead of this one. Counted rather than
        // folded into the median as zero, which would flatter the leg.
        upstreamUnknown: 0,
      }
      observed.count += 1
      if (Number.isFinite(line.upstreamMs)) observed.upstream.push(line.upstreamMs)
      else observed.upstreamUnknown += 1
      observed.queued.push(Number(line.queuedMs) || 0)
      observed.delivered.push(Number(line.deliveredMs) || 0)
      observed.committed.push(Number(line.committedMs) || 0)
      const total = Number(line.totalMs) || 0
      observed.total.push(total)
      if (total > observed.worstTotalMs) {
        observed.worstTotalMs = total
        observed.worstAt = line.at ?? null
      }
      frames.set(key, observed)
      if (line.identity != null || line.resource === 'orders' || line.resource === 'account') {
        orderFrames.push({
          at: line.at ?? null,
          resource: line.resource ?? '-',
          symbol: line.symbol ?? '-',
          identity: line.identity ?? '-',
          status: line.status ?? '-',
          code: line.code ?? '-',
          upstreamMs: Number.isFinite(line.upstreamMs) ? line.upstreamMs : null,
          queuedMs: Number(line.queuedMs) || 0,
          deliveredMs: Number(line.deliveredMs) || 0,
          committedMs: Number(line.committedMs) || 0,
          totalMs: Number(line.totalMs) || 0,
        })
      }
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
    withholdings: descending(withholdings.entries()),
    routes: [...routes.entries()]
      .map(([route, observed]) => ({ route, ...observed }))
      .sort((left, right) => right.weight - left.weight),
    closes,
    crossings: descending(crossings.entries()),
    exchangeRefusals: descending(exchangeRefusals.entries()),
    faults: descending(faults.entries()),
    candleReads,
    reconfirmation: {
      settled: settledScore,
      history: [...historyScore.entries()]
        .map(([reason, observed]) => ({ reason, ...observed }))
        .sort((left, right) => right.count - left.count),
    },
    sessions,
    commands,
    phases,
    answers: observedAs(answers.entries()),
    reads: [...reads.entries()]
      .map(([reason, observed]) => ({ reason, ...observed }))
      .sort((left, right) => right.weight - left.weight),
    estimates: ESTIMATE_VALUES
      .map(value => estimates.get(value))
      .filter(observed => observed !== undefined),
    backlogs: [...backlogs.entries()]
      .map(([key, observed]) => ({ key, ...observed }))
      .sort((left, right) => right.peakFrames - left.peakFrames),
    orderFrames,
    frames: [...frames.entries()]
      .map(([key, observed]) => ({
        key,
        count: observed.count,
        // Null, not `median([])`, which is 0. A leg nobody could measure must
        // not print as a leg that took no time — that is the one reading that
        // would send the operator looking in the wrong place.
        upstreamMs: observed.upstream.length === 0 ? null : median(observed.upstream),
        queuedMs: median(observed.queued),
        deliveredMs: median(observed.delivered),
        committedMs: median(observed.committed),
        totalMs: median(observed.total),
        worstTotalMs: observed.worstTotalMs,
        worstAt: observed.worstAt,
        upstreamUnknown: observed.upstreamUnknown,
      }))
      .sort((left, right) => right.worstTotalMs - left.worstTotalMs),
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
    // "Cause" is whichever word the line carries: the exchange's own code, or
    // the condition a desk-side refusal named for itself.
    out.push('', `Refusals by cause (${refused})`)
    for (const { key, count } of summary.refusals) {
      out.push(`  ${String(count).padStart(6)}  ${key}`)
    }
  }

  if (Array.isArray(summary.withholdings) && summary.withholdings.length > 0) {
    const withheld = summary.withholdings.reduce((sum, entry) => sum + entry.count, 0)
    out.push('', `Withheld by the renderer (${withheld})`)
    for (const { key, count } of summary.withholdings) {
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
    // One line per command per market. Never merged across markets: the two do
    // not measure the same span, and a merged "slowest" attributes one
    // market's wait to the other. A day that held one market prints only it.
    out.push('', 'How long commands took to answer')
    out.push('  each market is its own distribution; the two do not measure the same span')
    // Padded to the widest key the day actually held — the record already
    // carries a 35-character command, and a fixed pad bends the table at it.
    const width = summary.answers
      .reduce((widest, entry) => Math.max(widest, entry.key.length), 30)
    for (const answer of summary.answers) {
      out.push(
        `  ${answer.key.padEnd(width)} n=${String(answer.count).padStart(5)}`
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

  // Present whenever either read ran, zeros included: a day of zeros is the
  // reading the question wants, and a day the block is absent is a day
  // neither read ran at all.
  const reconfirmation = summary.reconfirmation ?? null
  const settledScore = reconfirmation?.settled ?? null
  const historyScore = Array.isArray(reconfirmation?.history) ? reconfirmation.history : []
  if ((settledScore !== null && settledScore.passes > 0) || historyScore.length > 0) {
    out.push('', 'Reconfirmation against the stream')
    if (settledScore !== null) {
      out.push(
        `  settled passes ${settledScore.passes}, compared ${settledScore.compared}`
        + `, missing ${settledScore.missing}, differing ${settledScore.differing}`,
      )
    }
    const total = historyScore.reduce((sum, entry) => ({
      count: sum.count + entry.count,
      vouched: sum.vouched + entry.vouched,
      reads: sum.reads + entry.reads,
      returned: sum.returned + entry.returned,
      restated: sum.restated + entry.restated,
      held: sum.held + entry.held,
      unreported: sum.unreported + entry.unreported,
      differing: sum.differing + entry.differing,
      vouchedUnreported: sum.vouchedUnreported + entry.vouchedUnreported,
      vouchedDiffering: sum.vouchedDiffering + entry.vouchedDiffering,
    }), {
      count: 0,
      vouched: 0,
      reads: 0,
      returned: 0,
      restated: 0,
      held: 0,
      unreported: 0,
      differing: 0,
      vouchedUnreported: 0,
      vouchedDiffering: 0,
    })
    out.push(
      `  history reads ${total.count} (vouched ${total.vouched}), requests ${total.reads}`
      + `, returned ${total.returned}, restated ${total.restated}, held ${total.held}`
      + `, unreported ${total.unreported} (on vouched ${total.vouchedUnreported})`
      + `, differing ${total.differing} (on vouched ${total.vouchedDiffering})`,
    )
    for (const entry of historyScore) {
      out.push(
        `    ${entry.reason.padEnd(14)} n=${String(entry.count).padStart(5)}`
        + `  vouched ${String(entry.vouched).padStart(5)}`
        + `  returned ${String(entry.returned).padStart(6)}`
        + `  restated ${String(entry.restated).padStart(6)}`
        + `  held ${String(entry.held).padStart(6)}`
        + `  unreported ${String(entry.unreported).padStart(4)}`
        + `  differing ${String(entry.differing).padStart(4)}`,
      )
    }
  }

  // Present whenever a candle was read at all. Pages from the store are the
  // exchange weight not spent: five per page of a thousand.
  const candleReads = summary.candleReads ?? null
  if (candleReads !== null && Object.values(candleReads).some(group => Object.values(group).some(count => count > 0))) {
    out.push(
      '',
      'Candle reads',
      `  windows: store ${candleReads.windows.store}, exchange ${candleReads.windows.exchange}`,
      `  pages: store ${candleReads.pages.store} (weight not spent ${candleReads.pages.store * 5})`
      + `, exchange ${candleReads.pages.exchange}`,
      `  store misses ${candleReads.store.misses}, errors ${candleReads.store.errors}`
      + `, skipped ${candleReads.store.skipped}, aborted ${candleReads.store.aborted}`,
    )
  }

  if (Array.isArray(summary.closes) && summary.closes.length > 0) {
    out.push('', `Stream closes (${summary.closes.length})`)
    for (const close of summary.closes) {
      out.push(
        `  ${close.at ?? '-'}  ${String(close.symbol ?? '-').padEnd(12)}`
        + ` ${String(close.code ?? '-').padEnd(20)}`
        + ` by ${String(close.closedBy ?? '?').padEnd(9)}`
        + ` code ${String(close.closeCode ?? '-').padEnd(4)}`
        + ` last frame ${close.lastUpstreamMs === null ? '-' : `${close.lastUpstreamMs}ms`} late`,
      )
    }
  }

  if (Array.isArray(summary.crossings) && summary.crossings.length > 0) {
    const crossed = summary.crossings.reduce((sum, entry) => sum + entry.count, 0)
    out.push('', `Crossed books by contract (${crossed})`)
    for (const { key, count } of summary.crossings) {
      out.push(`  ${String(count).padStart(6)}  ${key}`)
    }
  }

  if (Array.isArray(summary.faults) && summary.faults.length > 0) {
    const faulted = summary.faults.reduce((sum, entry) => sum + entry.count, 0)
    out.push('', `Faults by phase (${faulted})`)
    for (const { key, count } of summary.faults) {
      out.push(`  ${String(count).padStart(6)}  ${key}`)
    }
  }

  if (Array.isArray(summary.routes) && summary.routes.length > 0) {
    const weight = summary.routes.reduce((total, entry) => total + entry.weight, 0)
    const count = summary.routes.reduce((total, entry) => total + entry.count, 0)
    out.push('', `Requests by route (${count} attempts, weight ${weight})`)
    for (const entry of summary.routes) {
      out.push(
        `  ${entry.route.padEnd(22)} n=${String(entry.count).padStart(5)}`
        + `  weight ${String(entry.weight).padStart(6)}`,
      )
    }
    // Stated whenever there were requests, zero included: a day the exchange
    // refused nothing is the reading the skew question wants.
    const refusals = Array.isArray(summary.exchangeRefusals) ? summary.exchangeRefusals : []
    const refusedByExchange = refusals.reduce((sum, entry) => sum + entry.count, 0)
    out.push('', `Exchange refusals (${refusedByExchange})`)
    if (refusals.length === 0) out.push('  (none)')
    for (const { key, count } of refusals) {
      out.push(`  ${String(count).padStart(6)}  ${key}`)
    }
  }

  if (Array.isArray(summary.estimates) && summary.estimates.length > 0) {
    out.push('', 'Computed values beside exchange reads')
    for (const estimate of summary.estimates) {
      out.push(
        `  ${estimate.value.padEnd(22)}`
        + ` passes ${String(estimate.comparedPasses).padStart(5)}/${String(estimate.passes).padEnd(5)}`
        + ` agreed ${String(estimate.agreedPasses).padStart(5)}`
        + `  rows ${String(estimate.comparedRows).padStart(5)}`
        + `  unavailable ${String(estimate.unavailablePasses).padStart(5)} passes`
        + `/${String(estimate.unavailableRows).padStart(5)} rows`
        + ` (${String(estimate.uncomputedPasses).padStart(5)} wholly)`
        + (estimate.worstBps === null
          ? '  worst -'
          : `  worst ${estimate.worstBps} bps on ${estimate.worstSymbol ?? '-'}`
            + (estimate.worstAt === null ? '' : ` at ${estimate.worstAt}`)),
      )
    }
  }

  if (summary.backlogs.length > 0) {
    out.push('', 'How far behind the renderer fell')
    for (const entry of summary.backlogs) {
      out.push(
        `  ${entry.key.padEnd(22)} n=${String(entry.count).padStart(5)}`
        + `  deepest ${String(entry.peakFrames).padStart(4)} frames`
        + (entry.worstAt === null ? '' : ` at ${entry.worstAt}`)
        + `  heaviest ${String(Math.round(entry.peakBytes / 1024)).padStart(6)} KB`
        + `  superseded ${String(entry.superseded).padStart(5)}`
        + `  dropped ${String(entry.dropped).padStart(4)}`,
      )
    }
  }

  if (summary.frames.length > 0) {
    // The first column is the only one measured across two clocks, and it is
    // reported raw. Binance states when it sent the frame; this machine states
    // when it arrived; the difference between the two clocks sits inside that
    // number and is not corrected here, because correcting it needs a round trip
    // to `/fapi/v1/time` and this reader never talks to the exchange. Measured
    // 2026-08-13, the skew was around 170 ms against a true leg of about 345 ms
    // — so read this column as "roughly, and probably understated", and the four
    // that follow as exact. Those are all taken on one clock.
    out.push('', 'Where a frame spent its time (median, ms)')
    out.push('  exchange→desk spans two clocks and is uncorrected; the rest are exact')
    for (const entry of summary.frames) {
      out.push(
        `  ${entry.key.padEnd(22)} n=${String(entry.count).padStart(5)}`
        + `  exchange→desk ${String(entry.upstreamMs ?? '—').padStart(5)}`
        + `  →queue ${String(entry.queuedMs).padStart(4)}`
        + `  →renderer ${String(entry.deliveredMs).padStart(4)}`
        + `  →screen ${String(entry.committedMs).padStart(5)}`
        + `  total ${String(entry.totalMs).padStart(5)}`
        + `  worst ${String(entry.worstTotalMs).padStart(6)}`
        + (entry.worstAt === null ? '' : ` at ${entry.worstAt}`)
        + (entry.upstreamUnknown === 0
          ? ''
          : `  (${entry.upstreamUnknown} without a usable exchange time)`),
      )
    }
  }

  if (summary.orderFrames.length > 0) {
    // Listed, not averaged. This is the section that answers "the number on my
    // order updated late": when the exchange sent it, when the desk drew it, and
    // whether drawing it changed anything on the screen.
    out.push('', 'What the exchange said about an order, and when it was drawn (ms)')
    out.push('  exchange→desk spans two clocks and is uncorrected; the rest are exact')
    for (const entry of summary.orderFrames) {
      out.push(
        `  ${(entry.at ?? '-').padEnd(24)} ${entry.resource.padEnd(7)}`
        + ` ${entry.symbol.padEnd(10)} ${String(entry.identity).padEnd(12)}`
        + ` ${entry.status.padEnd(17)} ${entry.code.padEnd(9)}`
        + `  exchange→desk ${String(entry.upstreamMs ?? '—').padStart(5)}`
        + `  →queue ${String(entry.queuedMs).padStart(4)}`
        + `  →renderer ${String(entry.deliveredMs).padStart(4)}`
        + `  →screen ${String(entry.committedMs).padStart(5)}`
        + `  total ${String(entry.totalMs).padStart(5)}`,
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
  const options = { directory: null, day: null, list: false, files: [], unknown: null, dangling: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dir' || argv[index] === '--day') {
      // A flag whose value was forgotten used to read exactly like the flag
      // never given: it fell off the end and the reader answered a narrower
      // question than it was asked — `FILE --day` printed the file's summary
      // with the dangling flag dropped on the floor. A value that is itself a
      // flag is the same forgetting, one keystroke later.
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        options.dangling = options.dangling ?? argv[index]
        continue
      }
      if (argv[index] === '--dir') options.directory = value
      else options.day = value
      index += 1
    }
    else if (argv[index] === '--list') options.list = true
    // Anything else dashed is a misspelling, and anything else is a file. Both
    // used to be dropped on the floor, and what that printed was the latest
    // day: an operator asking about the 10th read a summary of the 19th with
    // nothing on the page saying so. An argument this reader does not
    // understand now stops it instead of steering it.
    else if (argv[index].startsWith('--')) options.unknown = options.unknown ?? argv[index]
    else options.files.push(argv[index])
  }
  return options
}

// The day a named record file belongs to, read off its own name so the summary
// can carry its heading — or null for a name this record never writes.
const dayOfSegmentFiles = (files) => {
  const days = new Set(files.map((file) => {
    const match = SEGMENT_NAME.exec(path.basename(file))
    return match === null ? null : match[1]
  }))
  const [day] = days
  return days.size === 1 && day !== null ? day : null
}

export const runDeskRecordSummary = (argv = process.argv.slice(2)) => {
  const options = readArguments(argv)
  if (options.unknown !== null) {
    console.error(
      `Unknown option ${options.unknown}. This reads --dir, --day, --list, or a record file's path.`,
    )
    return false
  }
  if (options.dangling !== null) {
    console.error(
      `${options.dangling} needs a value`
      + `${options.dangling === '--day' ? ' (like --day 2026-08-10)' : ' (a directory path)'}.`,
    )
    return false
  }
  if (options.files.length > 0) {
    // A named file already answers everything the flags ask — where to look
    // and which day. A call that names both is contradicting itself, and
    // half-obeying it is how the wrong day got printed before. Refused whole.
    if (options.directory !== null || options.day !== null || options.list) {
      console.error('Name a record file or ask a directory (--dir, --day, --list) — not both.')
      return false
    }
    const parts = []
    for (const file of options.files) {
      try {
        parts.push(readFileSync(file, 'utf8'))
      } catch (error) {
        // Never the latest day instead. A summary of the wrong day reads
        // exactly like a summary of the right one.
        console.error(`Cannot read ${file}: ${error?.code ?? error?.message ?? error}`)
        return false
      }
    }
    // Joined with a newline, never butted together: a hand-cut excerpt often
    // ends mid-line, and butting the next file straight onto it fused the cut
    // line with the next file's first — both counted unreadable. Blank lines
    // are skipped by the parser, so the seam costs nothing on whole files.
    console.log(formatDeskDiagnosticSummary(
      summarizeDeskDiagnosticRecord(parts.join('\n')),
      { day: dayOfSegmentFiles(options.files) },
    ))
    return true
  }
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
    .join('\n')
  console.log(formatDeskDiagnosticSummary(summarizeDeskDiagnosticRecord(text), { day }))
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runDeskRecordSummary() ? 0 : 1
}
