import { describe, expect, it, vi } from 'vitest'
import {
  DESK_FRAME_KINDS,
  createDeskFrameRouter,
  ensureDeskFrameRouter,
  readDeskFrame,
} from './deskFrameRouter.js'
import {
  createFuturesProductionWorkstationEvent,
  createFuturesProductionWorkstationHistoryOutcome,
} from './futuresProductionWorkstationProtocol.js'

const workstationEvent = (overrides = {}) => createFuturesProductionWorkstationEvent({
  requestId: 'router-1',
  symbol: 'BTCUSDT',
  generation: 1,
  revision: 1,
  resource: 'depth',
  state: 'live',
  observedAt: 1_784_000_000_000,
  payload: Object.freeze({
    lastUpdateId: '9001',
    step: null,
    bids: Object.freeze([Object.freeze({
      price: '58400.00',
      quantity: '1.5',
      value: '87600.00',
      groupKey: '58400000000000000000000',
      whole: true,
    })]),
    asks: Object.freeze([Object.freeze({
      price: '58401.00',
      quantity: '2.5',
      value: '146002.50',
      groupKey: '58401000000000000000000',
      whole: true,
    })]),
    spread: '1.00',
    reach: null,
  }),
  ...overrides,
})

const socket = () => {
  const listeners = new Set()
  return {
    listeners,
    addEventListener: vi.fn((type, listener) => {
      if (type === 'message') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (type === 'message') listeners.delete(listener)
    }),
    deliver: (value) => {
      const event = { data: typeof value === 'string' ? value : JSON.stringify(value) }
      for (const listener of [...listeners]) listener(event)
    },
  }
}

describe('readDeskFrame', () => {
  it('names a workstation event and validates it under the protocol', () => {
    const event = workstationEvent()

    const frame = readDeskFrame(JSON.stringify(event))

    expect(frame.kind).toBe(DESK_FRAME_KINDS.WORKSTATION)
    expect(frame.payload).toMatchObject({ resource: 'depth', symbol: 'BTCUSDT' })
  })

  it('names a validated history outcome as workstation traffic', () => {
    const outcome = createFuturesProductionWorkstationHistoryOutcome({
      requestId: 'router-history-1',
      symbol: 'BTCUSDT',
      interval: '1m',
      endTime: 1_784_000_000_000,
    })

    const frame = readDeskFrame(JSON.stringify(outcome))

    expect(frame.kind).toBe(DESK_FRAME_KINDS.WORKSTATION)
    expect(frame.payload).toEqual(outcome)
    expect(frame.payload).not.toHaveProperty('generation')
  })

  // The channel's name appears in the text of a rejection about the channel. A
  // sniff that took that for the event itself would have dropped the one frame
  // that says why the workstation refused to open.
  it('keeps a rejection that merely names the workstation channel', () => {
    const frame = readDeskFrame(JSON.stringify({
      command_rejected: {
        request: 'futures.production.workstation',
        code: 'EXECUTION_NOT_CONFIGURED',
        message: 'Futures is not configured.',
      },
    }))

    expect(frame.kind).toBe(DESK_FRAME_KINDS.ACCOUNT)
  })

  it('refuses a frame that states the workstation event type but breaks its rules', () => {
    expect(readDeskFrame(JSON.stringify({
      ...workstationEvent(),
      revision: -1,
    }))).toBeNull()
  })

  it.each([
    ['startup', { type: 'startup_status', state: 'READY' }, DESK_FRAME_KINDS.STARTUP],
    ['activation', { type: 'market_activation', marketMode: 'spot', generation: 1 }, DESK_FRAME_KINDS.ACTIVATION],
    ['a ticker snapshot', { ticker: [] }, DESK_FRAME_KINDS.MARKET],
    ['a ticker batch', { ticker_batch: [] }, DESK_FRAME_KINDS.MARKET],
    ['a channel chart', { channelId: 'detail-BTCUSDT-1h', type: 'chart', payload: [] }, DESK_FRAME_KINDS.MARKET],
    ['an account envelope', { type: 'futures_account_state' }, DESK_FRAME_KINDS.ACCOUNT],
    ['symbol configuration', { futures_symbol_configs: {} }, DESK_FRAME_KINDS.ACCOUNT],
    // Nothing names it, so it stays in the lane an account subscriber reads.
    ['a frame nothing names', { something: 'else' }, DESK_FRAME_KINDS.ACCOUNT],
  ])('names %s', (_label, payload, kind) => {
    expect(readDeskFrame(JSON.stringify(payload)).kind).toBe(kind)
  })

  it.each([
    ['a frame that is not text', { data: 'object' }],
    ['a frame that is not JSON', 'not json at all'],
    ['a frame that is not an object', '"a string"'],
    ['a frame that is a list', '[1,2,3]'],
  ])('answers nothing for %s', (_label, data) => {
    expect(readDeskFrame(data)).toBeNull()
  })
})

describe('readDeskFrame, account marks', () => {
  // The account lane went untimed for as long as the marks existed, so a fill
  // the operator said was drawn late could not be answered from the record at
  // all. Both halves matter here: the marks reach the subscriber, and the frame
  // it is handed is the frame the protocol expects — a stamp left on the payload
  // is how a correct desk goes dark between two correct sides.
  it('takes the marks off an account frame and answers when it arrived', () => {
    const frame = readDeskFrame(JSON.stringify({
      marks: { exchangeAt: 1_000, receivedAt: 1_100, queuedAt: 1_150 },
      futures_execution_update: { symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED' },
    }))

    expect(frame.kind).toBe(DESK_FRAME_KINDS.ACCOUNT)
    expect(frame.marks).toEqual({ exchangeAt: 1_000, receivedAt: 1_100, queuedAt: 1_150 })
    expect(Number.isSafeInteger(frame.receivedAt)).toBe(true)
    expect(frame.payload).toEqual({
      futures_execution_update: { symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED' },
    })
  })

  it('answers no marks for the frames that carry none, which is most of them', () => {
    const frame = readDeskFrame(JSON.stringify({ type: 'futures_account_state', version: 1 }))

    expect(frame.kind).toBe(DESK_FRAME_KINDS.ACCOUNT)
    expect(frame.marks).toBeNull()
    expect(frame.payload).toEqual({ type: 'futures_account_state', version: 1 })
  })

  // A malformed stamp costs the measurement and never the frame: a diagnostic
  // that could refuse an execution report would be worse than no diagnostic.
  it('loses a malformed stamp and keeps the frame', () => {
    const frame = readDeskFrame(JSON.stringify({
      marks: { exchangeAt: 'soon', receivedAt: 1_100, queuedAt: 1_150 },
      futures_execution_update: { symbol: 'TUTUSDT', orderId: 41 },
    }))

    expect(frame.marks).toBeNull()
    expect(frame.payload.futures_execution_update).toEqual({ symbol: 'TUTUSDT', orderId: 41 })
  })

  // The collision this lane has and the workstation lane does not: `marks` is
  // the word the desk already uses for the live mark price of every open
  // position. Taking it off by name alone emptied that frame — the positions
  // kept their snapshot price and stopped ticking. So a value under that name
  // which is not a stamp stays exactly where it is.
  it('leaves the position marks alone, which are carried under the same word', () => {
    const frame = readDeskFrame(JSON.stringify({
      type: 'futures_position_marks',
      version: 1,
      marks: { BMTUSDT: { markPrice: '0.03600', updatedAt: 200 } },
    }))

    expect(frame.marks).toBeNull()
    expect(frame.payload).toEqual({
      type: 'futures_position_marks',
      version: 1,
      marks: { BMTUSDT: { markPrice: '0.03600', updatedAt: 200 } },
    })
  })
})

describe('createDeskFrameRouter', () => {
  // The measured cost the change is about: the trading hook parsed a
  // hundred-and-eighteen-kilobyte book ten times a second to find out it was not
  // an account envelope.
  it('hands a book to the workstation and never to an account subscriber', () => {
    const connection = socket()
    const router = createDeskFrameRouter(connection)
    const workstation = vi.fn()
    const account = vi.fn()
    router.subscribe(DESK_FRAME_KINDS.WORKSTATION, workstation)
    router.subscribe(DESK_FRAME_KINDS.ACCOUNT, account)

    connection.deliver(workstationEvent())

    expect(workstation).toHaveBeenCalledOnce()
    expect(workstation.mock.calls[0][0].payload).toMatchObject({ resource: 'depth' })
    expect(account).not.toHaveBeenCalled()
  })

  it('reads the frame once whatever the number of subscribers', () => {
    const connection = socket()
    const router = createDeskFrameRouter(connection)
    const parse = vi.spyOn(JSON, 'parse')
    for (let index = 0; index < 4; index += 1) {
      router.subscribe(DESK_FRAME_KINDS.ACCOUNT, vi.fn())
    }

    parse.mockClear()
    connection.deliver({ type: 'futures_account_state' })

    expect(parse).toHaveBeenCalledTimes(1)
    parse.mockRestore()
  })

  it('takes a subscriber several kinds at once', () => {
    const connection = socket()
    const router = createDeskFrameRouter(connection)
    const listener = vi.fn()
    router.subscribe([DESK_FRAME_KINDS.MARKET, DESK_FRAME_KINDS.ACCOUNT], listener)

    connection.deliver({ ticker_batch: [] })
    connection.deliver({ type: 'futures_account_state' })
    connection.deliver({ type: 'startup_status' })

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('stops delivering once a subscription ends', () => {
    const connection = socket()
    const router = createDeskFrameRouter(connection)
    const listener = vi.fn()
    const unsubscribe = router.subscribe(DESK_FRAME_KINDS.ACCOUNT, listener)

    unsubscribe()
    connection.deliver({ type: 'futures_account_state' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('reads nothing at all while nothing is listening', () => {
    const connection = socket()
    createDeskFrameRouter(connection)
    const parse = vi.spyOn(JSON, 'parse')

    connection.deliver({ type: 'futures_account_state' })

    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
  })
})

describe('ensureDeskFrameRouter', () => {
  it('gives one socket one router, whoever asks first', () => {
    const connection = socket()

    const first = ensureDeskFrameRouter(connection)

    expect(ensureDeskFrameRouter(connection)).toBe(first)
    expect(connection.addEventListener).toHaveBeenCalledOnce()
  })

  it('answers nothing for something that is not a socket', () => {
    expect(ensureDeskFrameRouter(null)).toBeNull()
    expect(ensureDeskFrameRouter({})).toBeNull()
  })
})
