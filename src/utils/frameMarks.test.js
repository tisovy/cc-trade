import { describe, expect, it } from 'vitest'
import {
  FRAME_MARK_SAMPLE_MS,
  createFrameMarkSampler,
  measureFrameMarks,
  readFrameMarks,
  splitFrameMarks,
  stampFrameMarks,
} from './frameMarks.js'
import {
  createFuturesProductionWorkstationEvent,
  readFuturesProductionWorkstationEvent,
} from './futuresProductionWorkstationProtocol.js'
import { DESK_FRAME_KINDS, readDeskFrame } from './deskFrameRouter.js'

const marks = { exchangeAt: 1_000, receivedAt: 1_345, queuedAt: 1_346 }

// Built through the protocol's own constructor rather than spelled out here, so
// this fixture cannot drift away from what the desk actually sends.
const workstationEvent = () => createFuturesProductionWorkstationEvent({
  requestId: 'r1',
  symbol: 'ACEUSDT',
  generation: 1,
  revision: 7,
  resource: 'trades',
  state: 'live',
  observedAt: 1_346,
  payload: { rows: [] },
})

describe('frame marks', () => {
  it('rides the envelope without the protocol ever seeing it', () => {
    const event = workstationEvent()
    const text = JSON.stringify(event)
    // The frame is valid before the stamp.
    expect(readFuturesProductionWorkstationEvent(JSON.parse(text))).toBeTruthy()

    const stamped = stampFrameMarks(text, marks, { frameBytes: text.length })
    expect(stamped).not.toEqual(text)
    expect(JSON.parse(stamped).marks).toEqual(marks)

    // This is the failure the market-generation stamp was written to prevent,
    // asserted rather than assumed: a frame still carrying the stamp is refused
    // by the exact-key rules, so the stamp MUST come off before validation.
    expect(() => readFuturesProductionWorkstationEvent(JSON.parse(stamped))).toThrow()

    const { frame, marks: carried } = splitFrameMarks(JSON.parse(stamped))
    expect(carried).toEqual(marks)
    expect(readFuturesProductionWorkstationEvent(frame)).toBeTruthy()
  })

  // The guard that keeps a diagnostic from being able to stop the feed. A frame
  // sitting just under the ceiling, stamped, is a frame the far side refuses to
  // parse — and a refused book is a market that looks like it went quiet.
  it('gives up the sample rather than push a frame over the ceiling', () => {
    const text = JSON.stringify(workstationEvent())
    const stamped = stampFrameMarks(text, marks, {
      frameBytes: text.length,
      maxBytes: text.length + 4,
    })
    expect(stamped).toEqual(text)
    // One byte of room more than the stamp needs, and it is taken.
    const roomy = stampFrameMarks(text, marks, {
      frameBytes: text.length,
      maxBytes: text.length + 128,
    })
    expect(roomy).not.toEqual(text)
  })

  it('costs the marks and never the frame when the stamp is malformed', () => {
    for (const bad of [null, 'marks', 42, { receivedAt: 1 }, { receivedAt: 2, queuedAt: 1 }]) {
      const { frame, marks: carried } = splitFrameMarks({ marks: bad, symbol: 'ACEUSDT' })
      expect(carried).toBeNull()
      expect(frame).toEqual({ symbol: 'ACEUSDT' })
    }
    expect(readFrameMarks({ exchangeAt: 1.5, receivedAt: 1, queuedAt: 2 })).toBeNull()
    // A frame that was never stamped is handed straight back.
    expect(splitFrameMarks({ symbol: 'ACEUSDT' }))
      .toEqual({ frame: { symbol: 'ACEUSDT' }, marks: null })
  })

  it('states the four gaps and the whole', () => {
    expect(measureFrameMarks(readFrameMarks(marks), { receivedAt: 1_358, committedAt: 1_388 }))
      .toEqual({
        upstreamMs: 345,
        queuedMs: 1,
        deliveredMs: 12,
        committedMs: 30,
        totalMs: 388,
      })
  })

  // Two clocks disagreeing is not a leg that took no time. The desk's own
  // measured skew against Binance is around 170 ms on a 345 ms leg, so this is
  // the ordinary case and not a corner.
  it('reports an unknowable upstream leg as unknown, and still measures the rest', () => {
    const ahead = readFrameMarks({ exchangeAt: 2_000, receivedAt: 1_345, queuedAt: 1_346 })
    const measured = measureFrameMarks(ahead, { receivedAt: 1_358, committedAt: 1_388 })
    expect(measured.upstreamMs).toBeNull()
    expect(measured).toMatchObject({ queuedMs: 1, deliveredMs: 12, committedMs: 30 })
    // The total falls back to the desk's own share rather than going negative.
    expect(measured.totalMs).toEqual(43)

    const stateless = readFrameMarks({ exchangeAt: null, receivedAt: 1_345, queuedAt: 1_346 })
    expect(measureFrameMarks(stateless, { receivedAt: 1_358, committedAt: 1_388 }))
      .toMatchObject({ upstreamMs: null, totalMs: 43 })
  })

  it('refuses marks that run backwards rather than reporting a negative leg', () => {
    expect(measureFrameMarks(readFrameMarks(marks), { receivedAt: 1_340, committedAt: 1_388 }))
      .toBeNull()
    expect(measureFrameMarks(readFrameMarks(marks), { receivedAt: 1_358, committedAt: 1_350 }))
      .toBeNull()
  })

  // The whole journey, through the code that actually carries it: a frame
  // stamped on the way out of the main process, read back by the router the
  // renderer receives on, and measured. Five marks, in the order they happen.
  it('carries all five marks from the wire to a measurement', () => {
    const text = JSON.stringify(workstationEvent())
    const stamped = stampFrameMarks(text, marks, { frameBytes: text.length })

    const frame = readDeskFrame(stamped)
    expect(frame.kind).toBe(DESK_FRAME_KINDS.WORKSTATION)
    // The frame the subscribers see is the protocol's, with nothing extra on it.
    expect(frame.payload.revision).toBe(7)
    expect(Object.hasOwn(frame.payload, 'marks')).toBe(false)
    expect(frame.marks).toEqual(marks)

    const committedAt = frame.receivedAt + 30
    const measured = measureFrameMarks(frame.marks, {
      receivedAt: frame.receivedAt,
      committedAt,
    })
    // In order: the exchange sent it, this process took it off the socket,
    // handed it to the transport, the renderer read it, the desk drew it.
    expect(marks.exchangeAt).toBeLessThanOrEqual(marks.receivedAt)
    expect(marks.receivedAt).toBeLessThanOrEqual(marks.queuedAt)
    expect(marks.queuedAt).toBeLessThanOrEqual(frame.receivedAt)
    expect(frame.receivedAt).toBeLessThanOrEqual(committedAt)
    for (const leg of ['upstreamMs', 'queuedMs', 'deliveredMs', 'committedMs', 'totalMs']) {
      expect(measured[leg]).toBeGreaterThanOrEqual(0)
    }
    expect(measured.committedMs).toBe(30)
  })

  // A frame nobody sampled carries nothing, which is almost every frame. The
  // router still reads it, and the subscribers cannot tell the difference.
  it('leaves an unstamped frame exactly as it was', () => {
    const text = JSON.stringify(workstationEvent())
    const frame = readDeskFrame(text)
    expect(frame.kind).toBe(DESK_FRAME_KINDS.WORKSTATION)
    expect(frame.marks).toBeNull()
    expect(frame.payload.revision).toBe(7)
  })

  // §1.4: producing the marks may not change what is delivered or when. So the
  // stamp has to be total — there is no input for which it raises, and no input
  // for which the frame that comes out is not still the frame that went in.
  // A diagnostic that could throw on the delivery path would cost the operator
  // the market to buy a measurement.
  it('never raises, and never alters the frame it declines to stamp', () => {
    const text = JSON.stringify(workstationEvent())
    const hostile = [
      null,
      undefined,
      42,
      'marks',
      {},
      { receivedAt: 1 },
      { queuedAt: 1 },
      { receivedAt: -1, queuedAt: 2 },
      { receivedAt: 1.5, queuedAt: 2 },
      { receivedAt: 1, queuedAt: 2, exchangeAt: 'now' },
      { receivedAt: Number.NaN, queuedAt: 2 },
      { receivedAt: Number.MAX_SAFE_INTEGER + 2, queuedAt: 2 },
    ]
    for (const bad of hostile) {
      let stamped
      expect(() => { stamped = stampFrameMarks(text, bad, { frameBytes: text.length }) })
        .not.toThrow()
      expect(stamped).toBe(text)
      expect(readFuturesProductionWorkstationEvent(JSON.parse(stamped))).toBeTruthy()
    }
    // And a frame that is not a frame is handed straight back rather than
    // becoming one.
    for (const notAFrame of [null, undefined, 42, '', '[1,2]', 'not json']) {
      expect(() => stampFrameMarks(notAFrame, marks, { frameBytes: 10 })).not.toThrow()
      expect(stampFrameMarks(notAFrame, marks, { frameBytes: 10 })).toBe(notAFrame)
    }
  })

  // One per resource per interval, so the record's line rate stays the desk's
  // business rather than the market's.
  it('samples one frame per resource per interval', () => {
    let clock = 0
    const sampler = createFrameMarkSampler({ now: () => clock })
    expect(sampler.shouldSample('depth')).toBe(true)
    expect(sampler.shouldSample('depth')).toBe(false)
    // A different resource is not held back by the first one's sample.
    expect(sampler.shouldSample('trades')).toBe(true)
    clock += FRAME_MARK_SAMPLE_MS - 1
    expect(sampler.shouldSample('depth')).toBe(false)
    clock += 1
    expect(sampler.shouldSample('depth')).toBe(true)
  })
})
