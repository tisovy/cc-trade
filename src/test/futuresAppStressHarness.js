import { createFuturesProductionWorkstationEvent } from '../utils/futuresProductionWorkstationProtocol.js'
import { FUTURES_WORKSTATION_EVENT_MAX_BYTES } from '../utils/futuresWorkstationProtocolShared.js'

export const FUTURES_APP_STRESS_BYTES_PER_CYCLE = 2 * 1024 * 1024
export const FUTURES_APP_STRESS_CYCLE_MS = 100
export const FUTURES_APP_STRESS_CYCLES = 3

const LEVELS_PER_SIDE = 1_000
const LEVEL_QUANTITY = '1.123456789012345678'
const utf8Bytes = value => new TextEncoder().encode(value).byteLength

const frozenLevel = price => Object.freeze({
  price,
  quantity: LEVEL_QUANTITY,
})

// The first level changes with every revision so the rendered book proves which
// event reached it. The other 999 levels make each frame a realistic full-width
// renderer event without taking it over the production per-event ceiling.
const BID_TAIL = Object.freeze(Array.from(
  { length: LEVELS_PER_SIDE - 1 },
  (_unused, index) => frozenLevel((59_999.9 - (index / 10)).toFixed(1)),
))
const ASK_TAIL = Object.freeze(Array.from(
  { length: LEVELS_PER_SIDE - 1 },
  (_unused, index) => frozenLevel((71_000 + (index / 10)).toFixed(1)),
))

export class FuturesAppStressSocket extends EventTarget {
  static CONNECTING = 0

  static OPEN = 1

  static CLOSED = 3

  static instances = []

  constructor(url) {
    super()
    this.url = url
    this.readyState = FuturesAppStressSocket.CONNECTING
    this.sent = []
    FuturesAppStressSocket.instances.push(this)
  }

  open() {
    this.readyState = FuturesAppStressSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  send(raw) {
    this.sent.push(JSON.parse(raw))
  }

  close() {
    this.readyState = FuturesAppStressSocket.CLOSED
  }

  emitMessage(value) {
    const data = typeof value === 'string' ? value : JSON.stringify(value)
    const event = new MessageEvent('message', { data })
    // A browser WebSocket delivers the same event to both the `onmessage`
    // property used by Gateway and listeners owned by the Futures hooks.
    this.onmessage?.(event)
    this.dispatchEvent(event)
  }

  static reset() {
    FuturesAppStressSocket.instances.length = 0
  }
}

export const createFuturesAppStressCycle = ({
  requestId,
  generation,
  firstRevision,
  observedAt,
}) => {
  const frames = []
  let bytes = 0
  let revision = firstRevision
  let newestBid = null

  while (bytes < FUTURES_APP_STRESS_BYTES_PER_CYCLE) {
    newestBid = (60_000 + revision).toFixed(1)
    const newestAsk = (70_000 + revision).toFixed(1)
    const event = createFuturesProductionWorkstationEvent({
      requestId,
      symbol: 'BTCUSDT',
      generation,
      revision,
      resource: 'depth',
      state: 'live',
      observedAt,
      payload: {
        lastUpdateId: String(revision),
        bids: [frozenLevel(newestBid), ...BID_TAIL],
        asks: [frozenLevel(newestAsk), ...ASK_TAIL],
        spread: String(Number(newestAsk) - Number(newestBid)),
      },
    })
    const raw = JSON.stringify(event)
    const frameBytes = utf8Bytes(raw)
    if (frameBytes > FUTURES_WORKSTATION_EVENT_MAX_BYTES) {
      throw new Error(`Stress frame exceeded production bound: ${frameBytes}`)
    }
    frames.push(raw)
    bytes += frameBytes
    revision += 1
  }

  return Object.freeze({
    frames: Object.freeze(frames),
    bytes,
    lastRevision: revision - 1,
    newestBid,
  })
}
