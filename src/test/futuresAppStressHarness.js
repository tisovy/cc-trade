import { createFuturesProductionWorkstationEvent } from '../utils/futuresProductionWorkstationProtocol.js'
import {
  FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE,
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
} from '../utils/futuresWorkstationProtocolShared.js'
import { groupFuturesBookLevels } from '../utils/futuresOrderBook.js'

export const FUTURES_APP_STRESS_BYTES_PER_CYCLE = 2 * 1024 * 1024
export const FUTURES_APP_STRESS_CYCLE_MS = 100
export const FUTURES_APP_STRESS_CYCLES = 3

// A full-width delivery is now the rows the panel draws rather than the levels
// they are grouped from, so a frame is a fraction of what it was and the same
// two megabytes a cycle arrive as many more of them. That is the harder case for
// the renderer, not the easier one: the work per frame fell, the frames per
// second rose, and what this test guards is that the newest book still reaches
// the screen and the panel stays interactive while they do.
const ROWS_PER_SIDE = FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE
const LEVEL_QUANTITY = '1.123456789012345678'
const utf8Bytes = value => new TextEncoder().encode(value).byteLength

// Built through the panel's own grouping pass, ungrouped — one level to a row —
// so the harness states rows the desk could actually have sent rather than a
// shape invented here.
const frozenLevel = (price, side = 'bid') => {
  const [row] = groupFuturesBookLevels({
    levels: [{ price, quantity: LEVEL_QUANTITY }],
    side,
    step: null,
    limit: 1,
  })
  return Object.freeze({
    price: row.price,
    quantity: row.quantity,
    value: row.value,
    groupKey: row.groupKey,
    whole: true,
  })
}

// The first row changes with every revision so the rendered book proves which
// event reached it. The rest fill the frame out to a full-width delivery.
const BID_TAIL = Object.freeze(Array.from(
  { length: ROWS_PER_SIDE - 1 },
  (_unused, index) => frozenLevel((59_999.9 - (index / 10)).toFixed(1)),
))
const ASK_TAIL = Object.freeze(Array.from(
  { length: ROWS_PER_SIDE - 1 },
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
        step: null,
        bids: [frozenLevel(newestBid), ...BID_TAIL],
        asks: [frozenLevel(newestAsk, 'ask'), ...ASK_TAIL],
        spread: String(Number(newestAsk) - Number(newestBid)),
        reach: null,
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
