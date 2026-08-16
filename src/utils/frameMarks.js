// Where a frame has been, carried on the frame.
//
// The desk could say that a book recovery happened and how long a bootstrap
// took, and nothing else about time. So when the operator says the price crawled
// on a spike, or that an order sat on the chart after the market went through
// it, there was no way to answer where that frame actually waited — in the Node
// loop, in the local socket, or in a React commit. These are the marks that
// answer it.
//
// **The marks belong to the transport envelope and never to the protocol.** That
// is not a preference, it is the lesson already written into
// `splitMarketGenerationStamp`: the workstation channel validates an exact key
// set, so a frame still carrying a stamp is rejected as malformed — which is how
// a chart, a book and a tape that were correct on both sides went dark between
// them. The stamp goes on after the event has been built and validated, and it
// comes off before the far side validates it. Nothing in
// `futuresWorkstationProtocolShared.js` knows this file exists, and the protocol
// version does not move.

// The one key the envelope may carry. Short, and namespaced by being a word no
// workstation event uses.
export const FRAME_MARKS_KEY = 'marks'

// One sampled frame per resource per this long. Time-based rather than one in
// every N frames, because what has to stay bounded is the *record's* line rate,
// and the frame rate is the market's business: at ten books a second a
// one-in-fifty rule writes five lines a second on a busy contract and none at
// all on a quiet one, which is backwards on both counts.
//
// The arithmetic this number is chosen by: the desk delivers about five
// resources at once, so this is a line every two seconds across the workspace,
// ~30 a minute, ~150 bytes each — about 6 MB a day against the record's 32 MB
// bound and its own measured pathological ceiling of ~600 lines a minute. It
// leaves room for everything else the record keeps.
export const FRAME_MARK_SAMPLE_MS = 10_000

/**
 * Decides which frames carry marks.
 *
 * One per resource per `intervalMs`, and the rule lives here rather than at the
 * call site so there is one place to read it and one place to change it.
 */
export const createFrameMarkSampler = ({
  now = () => Date.now(),
  intervalMs = FRAME_MARK_SAMPLE_MS,
} = {}) => {
  const lastSampledAt = new Map()
  return {
    shouldSample: (resource) => {
      const key = typeof resource === 'string' ? resource : '-'
      const at = now()
      if (!Number.isFinite(at)) return false
      const previous = lastSampledAt.get(key)
      if (previous !== undefined && at - previous < intervalMs) return false
      lastSampledAt.set(key, at)
      return true
    },
    forget: () => lastSampledAt.clear(),
  }
}

const isMark = value => Number.isSafeInteger(value) && value >= 0

/**
 * Puts the marks on a frame that has already been serialized.
 *
 * By splicing rather than by re-serializing: the frame was serialized once on
 * purpose — measuring one string and sending another meant serializing a
 * hundred-and-eighteen-kilobyte book twice, ten times a second — and parsing it
 * back to add a field would give that cost straight back.
 *
 * Answers the frame unchanged when the marks will not fit under `maxBytes`.
 * **This guard is the whole reason the function takes a ceiling.** A book frame
 * sitting just under the protocol's limit, stamped, becomes a frame the far side
 * refuses to parse — and a frame the payload rules accept but the parser refuses
 * is a feed that simply stops. A diagnostic must never be able to do that, so a
 * sample that would not fit is not taken.
 *
 * `frameBytes` is the caller's own measurement, which it already has: the sender
 * measures every frame against the protocol ceiling before sending it. Passing it
 * in keeps this from walking a hundred-and-eighteen-kilobyte string a second time
 * for a number that was just computed — and keeps `Buffer` out of a module the
 * renderer imports. The stamp itself is pure ASCII, so the bytes it adds are its
 * own length.
 */
export const stampFrameMarks = (text, marks, { frameBytes, maxBytes = Infinity } = {}) => {
  if (typeof text !== 'string' || text.length === 0 || text[0] !== '{') return text
  if (marks === null || typeof marks !== 'object') return text
  const { exchangeAt = null, receivedAt, queuedAt } = marks
  if (!isMark(receivedAt) || !isMark(queuedAt)) return text
  if (exchangeAt !== null && !isMark(exchangeAt)) return text
  const stamp = `"${FRAME_MARKS_KEY}":${JSON.stringify({ exchangeAt, receivedAt, queuedAt })},`
  const measured = Number.isFinite(frameBytes) ? frameBytes : text.length
  if (measured + stamp.length > maxBytes) return text
  // An empty object has no following key to separate the stamp from.
  return text === '{}' ? `{${stamp.slice(0, -1)}}` : `{${stamp}${text.slice(1)}`
}

/**
 * Takes the marks back off a parsed frame, answering the frame the protocol
 * should see and the marks it was carrying.
 *
 * Always answers a value the validator can read — a malformed stamp costs the
 * marks and never the frame. A diagnostic that could refuse a book would be
 * worse than no diagnostic at all.
 */
export const splitFrameMarks = (value) => {
  if (value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || !Object.hasOwn(value, FRAME_MARKS_KEY)) {
    return { frame: value, marks: null }
  }
  const { [FRAME_MARKS_KEY]: carried, ...frame } = value
  return { frame, marks: readFrameMarks(carried) }
}

/**
 * The marks as the far side may believe them.
 *
 * `exchangeAt` is the only one that may be absent, and absent means *not
 * knowable* rather than zero — see `desk-diagnostic-record.js`, where the same
 * distinction is what keeps the record from claiming the exchange reached the
 * desk instantly.
 */
export const readFrameMarks = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { exchangeAt = null, receivedAt, queuedAt } = value
  if (!isMark(receivedAt) || !isMark(queuedAt)) return null
  if (exchangeAt !== null && !isMark(exchangeAt)) return null
  if (queuedAt < receivedAt) return null
  return Object.freeze({ exchangeAt, receivedAt, queuedAt })
}

/**
 * The four gaps between the five marks, and the whole, as the record keeps them.
 *
 * Every mark but `exchangeAt` is taken from one clock — the main process and the
 * renderer are the same machine — so those gaps are differences and not
 * estimates. `exchangeAt` comes from Binance's clock, and the desk's own measured
 * skew against it is around 170 ms on a leg of 345 ms. So a stated event time
 * *ahead* of local receipt is a disagreement between two clocks rather than a leg
 * that took no time, and it is reported as unknown for exactly the same reason an
 * absent one is: `0` would say the exchange reached the desk instantly, and send
 * the next reader looking in the wrong place.
 */
export const measureFrameMarks = (marks, { receivedAt, committedAt }) => {
  if (marks === null || !isMark(receivedAt) || !isMark(committedAt)) return null
  if (receivedAt < marks.queuedAt || committedAt < receivedAt) return null
  const upstreamMs = marks.exchangeAt === null || marks.receivedAt < marks.exchangeAt
    ? null
    : marks.receivedAt - marks.exchangeAt
  return Object.freeze({
    upstreamMs,
    queuedMs: marks.queuedAt - marks.receivedAt,
    deliveredMs: receivedAt - marks.queuedAt,
    committedMs: committedAt - receivedAt,
    // Stated rather than left to be summed. With `upstreamMs` unknown a reader
    // adding the parts would get the desk's own share and call it the journey.
    totalMs: committedAt - (upstreamMs === null ? marks.receivedAt : marks.exchangeAt),
  })
}
