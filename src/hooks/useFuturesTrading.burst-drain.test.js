// The commit that answers a burst. Measured 2026-08-30
// (desk-2026-08-30-002.jsonl): 25–59 PARTIALLY_FILLED a minute arrived as
// clusters of frames, one React commit each, and the commit leg went to
// 400 ms against a quiet 17 ms while the operator dragged an order. The
// drain folds a cluster into one commit, loses none of it, tells the
// journal the truth about the frames it folded, and keeps the review
// arithmetic off the commit path.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useFuturesTrading from './useFuturesTrading.js'

const ACCOUNT_FINGERPRINT = '0123456789abcdef'
const HISTORY_READ_AT = 1_784_000_000_000

const createSocket = () => {
  const listeners = new Map()
  return {
    readyState: 1,
    sent: [],
    send(payload) {
      this.sent.push(JSON.parse(payload))
    },
    addEventListener(event, handler) {
      listeners.set(event, handler)
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) listeners.delete(event)
    },
    receive(payload) {
      listeners.get('message')?.({ data: JSON.stringify(payload) })
    },
  }
}

const accountEnvelope = (resources = {}, fingerprint = ACCOUNT_FINGERPRINT) => ({
  version: 1,
  type: 'futures_account_state',
  accountFingerprint: fingerprint,
  resources,
})

const historyEnvelope = history => ({
  futures_history: {
    ...history,
    accountFingerprint: ACCOUNT_FINGERPRINT,
    readAt: HISTORY_READ_AT,
  },
})

const subscribe = (socket) => {
  const rendered = renderHook(() => useFuturesTrading({
    enabled: true,
    symbol: 'BTCUSDT',
    wsConnection: socket,
  }))
  act(() => socket.receive(accountEnvelope()))
  return rendered
}

const readingArrives = (socket) => {
  act(() => {
    socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      orders: [{ symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 }],
      trades: [{ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 }],
      symbols: ['BTCUSDT'],
      discovered: 1,
      error: null,
    }))
  })
}

const fillReport = (orderId, { z, tradeId, time, status = 'PARTIALLY_FILLED' }) => ({
  futures_execution_update: {
    symbol: 'BTCUSDT',
    orderId,
    status,
    side: 'BUY',
    price: '1',
    origQty: '9',
    z: String(z),
    executedQty: String(z),
    tradeId,
    lastFilledQty: '1',
    lastFilledPrice: '1',
    realizedPnl: '0',
    time,
  },
})

const stamped = payload => ({
  marks: {
    exchangeAt: Date.now() - 300,
    receivedAt: Date.now() - 120,
    queuedAt: Date.now() - 100,
  },
  ...payload,
})

const reportedMarks = socket => socket.sent.filter(
  message => message.action === 'report_frame_marks',
)

const settleWindow = () => act(async () => {
  await vi.advanceTimersByTimeAsync(150)
})

const orderOnScreen = (result, orderId) => result.current.openOrders
  .find(order => String(order.orderId) === String(orderId)) ?? null

describe('the one commit a cluster gets', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('folds a cluster of reports into one trailing commit and loses none of them', async () => {
    const socket = createSocket()
    const { result } = subscribe(socket)
    await settleWindow()
    readingArrives(socket)
    await settleWindow()

    // The first report after quiet is applied at once — the start of the
    // burst is seen immediately.
    act(() => socket.receive(fillReport(2, { z: 1, tradeId: 21, time: 9_000 })))
    expect(orderOnScreen(result, 2)).toMatchObject({ z: '1' })
    expect(result.current.history.trades).toHaveLength(2)

    // The rest of the cluster arrives within the window: queued for the one
    // trailing commit, not applied one commit each.
    act(() => {
      socket.receive(fillReport(2, { z: 2, tradeId: 22, time: 9_100 }))
      socket.receive(fillReport(2, { z: 3, tradeId: 23, time: 9_200 }))
      socket.receive(fillReport(3, { z: 1, tradeId: 24, time: 9_250 }))
    })
    expect(orderOnScreen(result, 2)).toMatchObject({ z: '1' })
    expect(result.current.history.trades).toHaveLength(2)

    // The trailing commit folds every report in arrival order — the newest
    // state is on the screen and every fill reached the held history.
    await settleWindow()
    expect(orderOnScreen(result, 2)).toMatchObject({ z: '3' })
    expect(orderOnScreen(result, 3)).toMatchObject({ z: '1' })
    const tradeIds = result.current.history.trades.map(trade => trade.id)
    expect(tradeIds).toEqual(expect.arrayContaining([21, 22, 23, 24]))
    expect(result.current.history.trades).toHaveLength(5)
  })

  // A guard, not a bite: the lone report never waited before either. It pins
  // the window's other edge — quiet costs nothing.
  it('applies a lone report after quiet immediately', async () => {
    const socket = createSocket()
    const { result } = subscribe(socket)
    await settleWindow()

    act(() => socket.receive(fillReport(5, { z: 1, tradeId: 31, time: 9_000 })))
    expect(orderOnScreen(result, 5)).toMatchObject({ z: '1' })
  })

  it('reads an older report of one order in the same commit as superseded', async () => {
    const socket = createSocket()
    const { result } = subscribe(socket)
    await settleWindow()

    act(() => socket.receive(stamped(fillReport(7, { z: 1, tradeId: 41, time: 9_000 }))))
    expect(reportedMarks(socket)).toHaveLength(1)
    expect(reportedMarks(socket)[0]).toMatchObject({ identity: 7, code: 'DELIVERED' })
    expect(orderOnScreen(result, 7)).toMatchObject({ z: '1' })

    act(() => {
      socket.receive(stamped(fillReport(7, { z: 2, tradeId: 42, time: 9_100 })))
      socket.receive(stamped(fillReport(7, { z: 3, tradeId: 43, time: 9_200 })))
    })
    await settleWindow()

    // One commit folded both. The older report is superseded within it — its
    // fill is in the held history, and the screen rightly shows its newer
    // sibling. Only the newest is judged against the screen, and it was
    // drawn. Nothing here reads as the fault code.
    const marks = reportedMarks(socket)
    expect(marks).toHaveLength(3)
    expect(marks[1]).toMatchObject({ identity: 7, status: 'PARTIALLY_FILLED', code: 'SUPERSEDED' })
    expect(marks[2]).toMatchObject({ identity: 7, code: 'DELIVERED' })
  })

  // A guard, not a bite: audited 2026-08-31 and equivalent both ways. The
  // drain defers the fold of these reports past the first-naming reset, but
  // the fold no-ops on the reset's idle history (isHeld gate), and a held
  // history under a null fingerprint is unreachable — a reading applies only
  // when its fingerprint matches the account's. This pins that equivalence.
  it('wipes reports queued ahead of the first-naming envelope, as applied one at a time', async () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    await settleWindow()

    // First frame after quiet applies at once, into the unnamed account.
    act(() => socket.receive(fillReport(11, { z: 1, tradeId: 51, time: 9_000 })))
    // Within the window: one more report, then the envelope that first
    // names the account — both queued for the same trailing commit.
    act(() => {
      socket.receive(fillReport(11, { z: 2, tradeId: 52, time: 9_100 }))
      socket.receive(accountEnvelope())
    })
    await settleWindow()

    expect(result.current.accountFingerprint).toBe(ACCOUNT_FINGERPRINT)
    const tradeIds = result.current.history.trades.map(trade => trade.id)
    expect(tradeIds).not.toContain(51)
    expect(tradeIds).not.toContain(52)
  })

  it('bounds the review refold to its trailing window while orders stay immediate', async () => {
    const socket = createSocket()
    const { result } = subscribe(socket)
    await settleWindow()
    readingArrives(socket)
    await settleWindow()

    const indexes = [result.current.tradeRoundIndex]
    const noteIndex = () => {
      if (indexes.at(-1) !== result.current.tradeRoundIndex) {
        indexes.push(result.current.tradeRoundIndex)
      }
    }

    // Twenty fills, one commit each (spaced past the commit window): the
    // working orders move on every commit, the review fold does not.
    let screenMoves = 0
    for (let step = 0; step < 20; step += 1) {
      const before = orderOnScreen(result, 9)
      act(() => socket.receive(fillReport(9, {
        z: step + 1,
        tradeId: 100 + step,
        time: 10_000 + (step * 100),
      })))
      if (orderOnScreen(result, 9) !== before) screenMoves += 1
      noteIndex()
      await settleWindow()
      noteIndex()
    }
    expect(screenMoves).toBe(20)
    // 20 fills over ~3 s of burst: at most one fold per trailing second,
    // plus the initial index — nowhere near one fold per commit.
    expect(indexes.length).toBeLessThanOrEqual(6)

    // The burst has ended: the armed trailing fold catches the review up
    // without another frame or an operator action, and then holds still.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200)
    })
    noteIndex()
    const settled = result.current.tradeRoundIndex
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.tradeRoundIndex).toBe(settled)
  })
})
