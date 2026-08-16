import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import {
  RENDERER_OUTBOX_LANES,
  createRendererOutbox,
} from '../electron/services/renderer-outbox.js'
import { FuturesAppStressSocket } from './test/futuresAppStressHarness.js'
import { attachMockLocalStorage } from './test/mocks/index.js'
import { createFuturesProductionWorkstationEvent } from './utils/futuresProductionWorkstationProtocol.js'
import {
  FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE,
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
} from './utils/futuresWorkstationProtocolShared.js'
import {
  MARKET_WORKSPACES,
  MARKET_WORKSPACE_STORAGE_KEY,
} from './utils/marketWorkspaceStorage.js'

vi.mock('./components/features/futures/FuturesWorkstationChart.jsx', () => ({
  default: () => <div data-testid="burst-chart-surface" />,
}))

const OBSERVED_AT = 1_784_000_000_000
const BURST_CYCLES = 6
const BURST_CADENCE_MS = 100
const BURST_CADENCE_TOLERANCE_MS = 25
const EXECUTION_CYCLE = 2
// Final harness calibration, isolated n=20: p99 342.358 ms, max 342.391 ms;
// aggregate n=6: p99 470.952 ms, max 471.735 ms. Six hundred is the aggregate
// maximum plus one 100 ms scheduler interval, rounded to a cadence boundary.
const EXECUTION_APPLY_BOUND_MS = 600
const utf8Bytes = value => new TextEncoder().encode(value).byteLength
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const contractFilters = Object.freeze({
  price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
  quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
  marketQuantity: Object.freeze({ min: '0.001', max: '100', stepSize: '0.001' }),
  percentPrice: Object.freeze({
    multiplierUp: '1.1500',
    multiplierDown: '0.8500',
    multiplierDecimal: 4,
  }),
  maximumOrders: 200,
  maximumAlgoOrders: 100,
  minimumNotional: '5',
})

const resourceEvent = (requestId, revision, resource, payload, observedAt = OBSERVED_AT) => (
  createFuturesProductionWorkstationEvent({
    requestId,
    symbol: 'BTCUSDT',
    generation: 1,
    revision,
    resource,
    state: 'live',
    observedAt,
    payload,
  })
)

const depthRow = (revision, index, side) => {
  const integer = side === 'bid'
    ? 900_000 + revision - index
    : 910_000 + revision + index
  const identity = String(index).padStart(63, '0')
  return Object.freeze({
    // Six integer digits, a point and 57 fractional digits: the protocol's
    // full 64-character decimal allowance on every row.
    price: `${integer}.${(side === 'bid' ? '1' : '2').repeat(57)}`,
    quantity: (side === 'bid' ? '7' : '8').repeat(64),
    value: (side === 'bid' ? '8' : '9').repeat(64),
    groupKey: `${side === 'bid' ? '8' : '9'}${identity}`,
    whole: true,
  })
}

const widestDepthFrame = ({ requestId, revision, observedAt }) => {
  const payload = Object.freeze({
    lastUpdateId: '18446744073709551615',
    step: `0.${'1'.repeat(62)}`,
    bids: Object.freeze(Array.from(
      { length: FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE },
      (_, index) => depthRow(revision, index, 'bid'),
    )),
    asks: Object.freeze(Array.from(
      { length: FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE },
      (_, index) => depthRow(revision, index, 'ask'),
    )),
    spread: '9'.repeat(64),
    reach: Object.freeze({ below: '8'.repeat(64), above: '9'.repeat(64) }),
  })
  const event = resourceEvent(requestId, revision, 'depth', payload, observedAt)
  const raw = JSON.stringify(event)
  return Object.freeze({ event, raw, bytes: utf8Bytes(raw), newestBid: payload.bids[0].price })
}

const candleFrame = ({ requestId, revision, observedAt }) => JSON.stringify(resourceEvent(
  requestId,
  revision,
  'candles',
  Object.freeze({
    series: 'contract',
    interval: '1m',
    rows: Object.freeze([Object.freeze({
      openTime: observedAt - (observedAt % 60_000),
      closeTime: observedAt - (observedAt % 60_000) + 59_999,
      open: '900000',
      high: '910000',
      low: '890000',
      close: String(900_000 + revision),
      volume: '100.5',
      closed: false,
    })]),
  }),
  observedAt,
))

const createOutboxConnection = socket => {
  const handlers = new Map()
  const connection = {
    connected: true,
    outputBufferFull: false,
    sendUTF: vi.fn(text => socket.emitMessage(text)),
    close: vi.fn(() => { connection.connected = false }),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    stall: () => { connection.outputBufferFull = true },
    drain: () => {
      connection.outputBufferFull = false
      handlers.get('drain')?.()
    },
  }
  return connection
}

const openFuturesApp = async () => {
  const rendered = render(<App />)
  const socket = FuturesAppStressSocket.instances[0]

  act(() => socket.open())
  act(() => socket.emitMessage({
    type: 'startup_status',
    version: 2,
    state: 'READY',
    code: 'READY',
    ready: true,
    missingFields: [],
    retiredFields: [],
  }))
  await waitFor(() => expect(socket.sent).toContainEqual({
    action: 'activate_market',
    marketMode: MARKET_WORKSPACES.FUTURES_LIVE,
  }))

  act(() => socket.emitMessage({
    type: 'market_activation',
    version: 1,
    marketMode: MARKET_WORKSPACES.FUTURES_LIVE,
    generation: 1,
  }))
  expect(await screen.findByTestId('futures-production-workstation')).toBeInTheDocument()

  const subscription = await waitFor(() => {
    const request = socket.sent.find(message => (
      message.action === 'futures.production.workstation.subscribe'
    ))
    expect(request).toBeDefined()
    return request
  })

  act(() => {
    socket.emitMessage(resourceEvent(subscription.requestId, 1, 'status', {
      connected: true,
      reasonCode: null,
    }))
    socket.emitMessage(resourceEvent(subscription.requestId, 2, 'catalog', {
      offset: 0,
      total: 1,
      complete: true,
      contracts: [{
        symbol: 'BTCUSDT',
        pair: 'BTCUSDT',
        contractType: 'PERPETUAL',
        status: 'TRADING',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        marginAsset: 'USDT',
        tradable: true,
        filters: contractFilters,
      }],
    }))
    socket.emitMessage(resourceEvent(subscription.requestId, 3, 'header', {
      lastPrice: '900000',
      markPrice: '900000',
      indexPrice: '900000',
      basis: '0',
      priceChange: '0',
      priceChangePercent: '0',
      highPrice: '910000',
      lowPrice: '890000',
      volume: '1000',
      quoteVolume: '900000000',
      lastQuantity: '1',
      fundingRate: '0',
      fundingRatePercent: '0',
      nextFundingTime: OBSERVED_AT + 3_600_000,
      eventTime: OBSERVED_AT,
      contractStatus: 'TRADING',
    }))
    socket.emitMessage({
      version: 1,
      type: 'futures_account_state',
      resources: {
        regularOrders: {
          status: 'ready',
          lastSuccessfulAt: OBSERVED_AT,
          data: [{
            symbol: 'BTCUSDT',
            orderId: 42,
            status: 'NEW',
            side: 'BUY',
            orderKind: 'REGULAR',
            price: '899000',
            origQty: '1',
          }],
        },
        algoOrders: { status: 'ready', lastSuccessfulAt: OBSERVED_AT, data: [] },
        positions: { status: 'ready', lastSuccessfulAt: OBSERVED_AT, data: [] },
      },
    })
  })

  const ordersTab = await screen.findByRole('tab', { name: /Orders\s*1/ })
  fireEvent.click(ordersTab)
  expect(screen.getByText('1 account-wide · 1 BTCUSDT')).toBeInTheDocument()
  return { ...rendered, socket, subscription }
}

describe('Futures exchange-to-screen burst', () => {
  let localStorageMock

  beforeEach(() => {
    localStorageMock = attachMockLocalStorage()
    localStorageMock.setItem(MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.FUTURES_LIVE)
    FuturesAppStressSocket.reset()
    vi.stubGlobal('WebSocket', FuturesAppStressSocket)
    vi.stubGlobal('ccTradeRuntime', {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14_477,
        token: 'burst-session',
        tokenParam: 'token',
      },
    })
  })

  afterEach(() => {
    cleanup()
    FuturesAppStressSocket.reset()
    localStorageMock.clear()
    vi.unstubAllGlobals()
  })

  it('applies a terminal execution and the newest full-width book during a 100 ms burst', async () => {
    const { container, socket, subscription } = await openFuturesApp()
    const connection = createOutboxConnection(socket)
    const backlog = vi.fn()
    const outbox = createRendererOutbox(connection, { onBacklog: backlog })
    const depthDelivery = Object.freeze({
      lane: RENDERER_OUTBOX_LANES.MARKET,
      resource: 'depth',
      symbol: 'BTCUSDT',
      supersede: true,
    })
    const candleDelivery = Object.freeze({
      lane: RENDERER_OUTBOX_LANES.MARKET,
      resource: 'candles',
      symbol: 'BTCUSDT',
      variant: 'contract',
      supersede: true,
    })
    const accountDelivery = Object.freeze({ lane: RENDERER_OUTBOX_LANES.ACCOUNT })
    const cycleOffers = []
    const depthFrameBytes = []
    let issuedAt = null
    let latestDepth = null
    // Keep every envelope revision at the same width so all six maximal depth
    // payloads are also exactly the same frame size.
    let nextRevision = 100

    connection.stall()
    const burstStartedAt = performance.now()
    for (let cycle = 0; cycle < BURST_CYCLES; cycle += 1) {
      const observedAt = OBSERVED_AT + (cycle * BURST_CADENCE_MS)
      latestDepth = widestDepthFrame({
        requestId: subscription.requestId,
        revision: nextRevision + 1,
        observedAt,
      })
      depthFrameBytes.push(latestDepth.bytes)
      const candles = candleFrame({
        requestId: subscription.requestId,
        revision: nextRevision,
        observedAt,
      })

      await act(async () => {
        // Measure cadence where the frame is actually offered to the outbox,
        // after constructing and serializing it.
        cycleOffers.push(performance.now())
        outbox.send(latestDepth.raw, depthDelivery)
        outbox.send(candles, candleDelivery)
        if (cycle === EXECUTION_CYCLE) {
          issuedAt = performance.now()
          outbox.send(JSON.stringify({
            futures_execution_update: {
              symbol: 'BTCUSDT',
              orderId: 42,
              status: 'FILLED',
              side: 'BUY',
              orderKind: 'REGULAR',
              price: '899000',
              origQty: '1',
              executedQty: '1',
              T: observedAt,
            },
          }), accountDelivery)
        }
      })

      expect(latestDepth.event.payload.bids).toHaveLength(FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE)
      expect(latestDepth.event.payload.asks).toHaveLength(FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE)
      const depthRows = [
        ...latestDepth.event.payload.bids,
        ...latestDepth.event.payload.asks,
      ]
      expect(depthRows.every(row => (
        row.price.length === 64
        && row.quantity.length === 64
        && row.value.length === 64
        && row.groupKey.length === 64
      ))).toBe(true)
      expect(latestDepth.event.payload.step).toHaveLength(64)
      expect(latestDepth.event.payload.spread).toHaveLength(64)
      expect(latestDepth.event.payload.reach.below).toHaveLength(64)
      expect(latestDepth.event.payload.reach.above).toHaveLength(64)
      expect(latestDepth.bytes).toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES)

      nextRevision += 2
      if (cycle < BURST_CYCLES - 1) {
        const nextCycleAt = burstStartedAt + ((cycle + 1) * BURST_CADENCE_MS)
        await act(async () => delay(Math.max(0, nextCycleAt - performance.now())))
      }
    }

    await act(async () => connection.drain())
    await waitFor(() => expect(
      screen.getByRole('tab', { name: /Orders\s*0/ }),
    ).toBeInTheDocument())
    const executionAppliedAt = performance.now()

    expect(issuedAt).not.toBeNull()
    const executionApplyMs = executionAppliedAt - issuedAt
    expect(screen.getByText('No active Futures orders.')).toBeInTheDocument()
    expect(container.querySelector('.futures-workstation-chart')).toHaveAttribute('data-state', 'live')
    expect(screen.getByRole('button', {
      name: new RegExp(`^Bid book level: price ${latestDepth.newestBid.replace('.', '\\.')}`),
    })).toBeInTheDocument()

    const depthBacklog = backlog.mock.calls.map(([reading]) => reading)
      .find(reading => reading.resource === 'depth')
    const candleBacklog = backlog.mock.calls.map(([reading]) => reading)
      .find(reading => reading.resource === 'candles')
    expect(depthBacklog).toMatchObject({
      symbol: 'BTCUSDT',
      superseded: BURST_CYCLES - 2,
      dropped: 0,
      frames: 1,
      bytes: latestDepth.bytes,
    })
    expect(candleBacklog).toMatchObject({
      symbol: 'BTCUSDT',
      superseded: BURST_CYCLES - 1,
      dropped: 0,
      frames: 1,
    })
    expect(cycleOffers).toHaveLength(BURST_CYCLES)
    expect(depthFrameBytes).toHaveLength(BURST_CYCLES)
    expect(new Set(depthFrameBytes)).toEqual(new Set([latestDepth.bytes]))
    const cadenceIntervals = cycleOffers.slice(1).map(
      (offeredAt, index) => offeredAt - cycleOffers[index],
    )
    expect(cadenceIntervals).toHaveLength(BURST_CYCLES - 1)
    cadenceIntervals.forEach((interval) => {
      expect(Math.abs(interval - BURST_CADENCE_MS))
        .toBeLessThanOrEqual(BURST_CADENCE_TOLERANCE_MS)
    })

    const metrics = Object.freeze({
      executionApplyMs: Number(executionApplyMs.toFixed(3)),
      burstMs: Number((executionAppliedAt - burstStartedAt).toFixed(3)),
      cadenceMs: BURST_CADENCE_MS,
      cadenceMinMs: Number(Math.min(...cadenceIntervals).toFixed(3)),
      cadenceMaxMs: Number(Math.max(...cadenceIntervals).toFixed(3)),
      cycles: BURST_CYCLES,
      depthFrameBytes: latestDepth.bytes,
      depthSuperseded: depthBacklog.superseded,
      candleSuperseded: candleBacklog.superseded,
    })
    console.info(`FUTURES_BURST_METRIC ${JSON.stringify(metrics)}`)
    expect(executionApplyMs).toBeLessThanOrEqual(EXECUTION_APPLY_BOUND_MS)
  }, 20_000)
})
