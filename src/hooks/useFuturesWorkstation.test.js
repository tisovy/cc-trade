import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useFuturesTestnetWorkstation from './useFuturesTestnetWorkstation.js'
import useFuturesProductionWorkstation from './useFuturesProductionWorkstation.js'
import {
  FUTURES_TESTNET_WORKSTATION_ACTIONS,
  createFuturesTestnetWorkstationEvent,
} from '../utils/futuresTestnetWorkstationProtocol.js'
import {
  FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  createFuturesProductionWorkstationEvent,
} from '../utils/futuresProductionWorkstationProtocol.js'

class LocalSocket extends EventTarget {
  constructor(readyState = 1) {
    super()
    this.readyState = readyState
  }

  emitMessage(value) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }

  closeLocally() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const eventValues = (requestId, overrides = {}) => ({
  requestId,
  symbol: 'BTCUSDT',
  generation: 1,
  revision: 1,
  resource: 'status',
  state: 'live',
  observedAt: 1_784_000_000_000,
  payload: Object.freeze({ connected: true, reasonCode: null }),
  ...overrides,
})

const defaultProps = (socket, sendMessage, overrides = {}) => ({
  enabled: true,
  symbol: 'BTCUSDT',
  interval: '1m',
  wsConnection: socket,
  sendMessage,
  ...overrides,
})

describe('Testnet workstation hook ownership', () => {
  it('subscribes with a separately named exact protocol and accepts its active generation', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesTestnetWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const request = sendMessage.mock.calls[0][0]
    expect(request.action).toBe(FUTURES_TESTNET_WORKSTATION_ACTIONS.SUBSCRIBE)
    expect(request.environment).toBe('TESTNET')
    expect(request).not.toHaveProperty('host')
    expect(result.current.status).toBe('loading')

    act(() => socket.emitMessage(createFuturesTestnetWorkstationEvent(
      eventValues(request.requestId),
    )))
    expect(result.current).toMatchObject({
      status: 'live',
      environment: 'TESTNET',
      symbol: 'BTCUSDT',
      generation: 1,
      revision: 1,
    })
    expect(result.current.resources.status.connected).toBe(true)
  })

  it('rejects duplicate, reordered, wrong-request and production events', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesTestnetWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    const accepted = createFuturesTestnetWorkstationEvent(eventValues(requestId, { revision: 5 }))
    act(() => socket.emitMessage(accepted))
    const acceptedState = result.current
    act(() => {
      socket.emitMessage(createFuturesTestnetWorkstationEvent(eventValues(requestId, { revision: 4 })))
      socket.emitMessage(createFuturesTestnetWorkstationEvent(eventValues('wrong-request', { revision: 6 })))
      socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(requestId, { revision: 7 })))
    })
    expect(result.current).toBe(acceptedState)
  })

  it('uses symbol and interval actions and drops late events from the old owner', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesTestnetWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const first = sendMessage.mock.calls[0][0]
    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT' }))
    const symbolRequest = sendMessage.mock.calls.at(-1)[0]
    expect(sendMessage.mock.calls[1][0].action).toBe(FUTURES_TESTNET_WORKSTATION_ACTIONS.UNSUBSCRIBE)
    expect(symbolRequest.action).toBe(FUTURES_TESTNET_WORKSTATION_ACTIONS.SELECT_SYMBOL)
    act(() => socket.emitMessage(createFuturesTestnetWorkstationEvent(eventValues(first.requestId))))
    expect(result.current.symbol).toBe('ETHUSDT')
    expect(result.current.status).toBe('loading')

    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT', interval: '5m' }))
    expect(sendMessage.mock.calls.at(-1)[0].action)
      .toBe(FUTURES_TESTNET_WORKSTATION_ACTIONS.SELECT_INTERVAL)
  })

  it('marks local disconnect and subscribe rejection explicitly', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesTestnetWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    act(() => socket.closeLocally())
    expect(result.current).toMatchObject({
      status: 'disconnected',
      reasonCode: 'LOCAL_CONNECTION_CLOSED',
    })

    const rejected = renderHook(props => useFuturesTestnetWorkstation(props), {
      initialProps: defaultProps(new LocalSocket(), vi.fn(() => false)),
    })
    expect(rejected.result.current).toMatchObject({
      status: 'unavailable',
      reasonCode: 'LOCAL_SUBSCRIBE_REJECTED',
    })
  })

  it('does not subscribe on a closed local socket', () => {
    const sendMessage = vi.fn()
    const { result } = renderHook(props => useFuturesTestnetWorkstation(props), {
      initialProps: defaultProps(new LocalSocket(3), sendMessage),
    })
    expect(result.current.status).toBe('disconnected')
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('production workstation hook isolation', () => {
  it('uses only the production channel and ignores Testnet events', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const request = sendMessage.mock.calls[0][0]
    expect(request.action).toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE)
    expect(request.environment).toBe('PRODUCTION')
    act(() => socket.emitMessage(createFuturesTestnetWorkstationEvent(
      eventValues(request.requestId),
    )))
    expect(result.current.status).toBe('loading')
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(request.requestId),
    )))
    expect(result.current.status).toBe('live')
  })

  it('unsubscribes its exact request on teardown', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { unmount } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    unmount()
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
      requestId,
      environment: 'PRODUCTION',
    })
  })
})
