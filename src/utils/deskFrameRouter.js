// The one place a frame from the local backend is read.
//
// Every subscriber used to receive the raw frame and parse it again to find out
// whether it wanted it. On the futures desk that was four passes over the same
// bytes — the socket hook, the gateway, the trading hook and the workstation —
// and the worst of them belonged to the trading hook, which parsed a
// hundred-and-eighteen-kilobyte book ten times a second in order to read one
// field, decide the frame was not an account envelope, and throw the result
// away. The code whose job is to take a filled order off the screen was spending
// its time on quotes it would never look at.
//
// So: read once here, name what the frame is, and hand each subscriber only the
// kinds it asked for. A subscriber that does not handle market data is never
// given market data, and pays nothing for it.

import {
  FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE,
  isPotentialFuturesProductionWorkstationFrame,
  parseMarkedFuturesProductionWorkstationEvent,
} from './futuresProductionWorkstationProtocol.js'

export const DESK_FRAME_KINDS = Object.freeze({
  // The backend's answer about its own configuration, and its acknowledgement of
  // which market is the activated one. Both are read by the gateway alone.
  STARTUP: 'startup',
  ACTIVATION: 'activation',
  // The futures workstation's own channel: the book, the chart, the tape, the
  // header, the catalog and the status line. Validated here, so what a
  // subscriber receives has already passed the protocol's rules.
  WORKSTATION: 'workstation',
  // Quotes. Nothing here is a fact about the account, which is the whole reason
  // the kind exists: it is what an account subscriber must never be handed.
  MARKET: 'market',
  // Everything else — account state, execution reports, symbol configuration,
  // command outcomes, history answers. The default, deliberately: a market frame
  // mistaken for an account frame costs a subscriber one wasted call, an account
  // frame mistaken for a market frame costs the operator a fill.
  ACCOUNT: 'account',
})

// A channel frame states what it carries. Only these are quotes; a channel type
// this list does not name is left in the account lane rather than guessed at.
const MARKET_CHANNEL_TYPES = new Set(['chart', 'depth', 'trades', 'ticker']);

const classifyDeskFrame = (payload) => {
  if (payload.type === 'startup_status') return DESK_FRAME_KINDS.STARTUP
  if (payload.type === 'market_activation') return DESK_FRAME_KINDS.ACTIVATION
  if (payload.ticker !== undefined
    || payload.ticker_batch !== undefined) return DESK_FRAME_KINDS.MARKET
  if (typeof payload.channelId === 'string'
    && MARKET_CHANNEL_TYPES.has(payload.type)) return DESK_FRAME_KINDS.MARKET
  return DESK_FRAME_KINDS.ACCOUNT
}

/**
 * Reads one frame and names what it is, or answers null for a frame that cannot
 * be read at all.
 *
 * A frame that looks like a workstation event is read under the workstation's
 * own rules — its byte ceiling enforced before the frame is read, its structure
 * validated after. One that fails them is not thrown away: a command rejection
 * naming the workstation channel carries that channel's name in its text and
 * nothing else of it, and the operator needs to be told about it.
 */
export const readDeskFrame = (data) => {
  if (typeof data !== 'string') return null
  // Taken before the frame is read, so the reading itself counts as the
  // renderer's own work rather than as time on the wire. This is one clock call
  // per frame on a path that already scans the string and parses it.
  const receivedAt = Date.now()
  if (isPotentialFuturesProductionWorkstationFrame(data)) {
    try {
      const { event, marks } = parseMarkedFuturesProductionWorkstationEvent(data)
      return Object.freeze({
        kind: DESK_FRAME_KINDS.WORKSTATION,
        payload: event,
        // Present only on a sampled frame; null on every other one, which is
        // almost all of them.
        marks,
        receivedAt,
      })
    } catch {
      // Not a workstation event after all. Read below as whatever it is.
    }
  }
  let payload
  try {
    payload = JSON.parse(data)
  } catch {
    return null
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  // A frame that names the workstation event type but did not survive the rules
  // above is refused rather than passed on as an account frame under its own
  // stated type.
  if (payload.type === FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE) return null
  return Object.freeze({ kind: classifyDeskFrame(payload), payload })
}

/**
 * Fans one socket's frames out by kind.
 *
 * `subscribe` answers the function that ends the subscription. A listener is
 * called with the frame and the message event it arrived on.
 */
export const createDeskFrameRouter = (socket) => {
  const listeners = new Map()

  const deliver = (event) => {
    if (listeners.size === 0) return
    const frame = readDeskFrame(event?.data)
    if (frame === null) return
    const held = listeners.get(frame.kind)
    if (held === undefined || held.size === 0) return
    // Copied, so a listener that unsubscribes while being called cannot skip the
    // one after it.
    for (const listener of [...held]) listener(frame, event)
  }

  socket.addEventListener('message', deliver)

  return {
    subscribe: (kinds, listener) => {
      const wanted = (Array.isArray(kinds) ? kinds : [kinds])
        .filter(kind => Object.values(DESK_FRAME_KINDS).includes(kind))
      if (wanted.length === 0 || typeof listener !== 'function') return () => {}
      for (const kind of wanted) {
        const held = listeners.get(kind) ?? new Set()
        held.add(listener)
        listeners.set(kind, held)
      }
      return () => {
        for (const kind of wanted) listeners.get(kind)?.delete(listener)
      }
    },
    dispose: () => {
      listeners.clear()
      socket.removeEventListener?.('message', deliver)
    },
  }
}

// One router per socket, whoever asks for it first. Held beside the socket
// rather than on it, so nothing here can collide with a property the platform
// owns, and so a closed socket takes its router with it.
const routers = new WeakMap()

export const ensureDeskFrameRouter = (socket) => {
  if (socket === null
    || typeof socket !== 'object'
    || typeof socket.addEventListener !== 'function') return null
  const held = routers.get(socket)
  if (held !== undefined) return held
  const router = createDeskFrameRouter(socket)
  routers.set(socket, router)
  return router
}
