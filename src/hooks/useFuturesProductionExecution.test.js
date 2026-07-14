import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from '../utils/futuresProductionExecutionProtocol.js'
import useFuturesProductionExecution, {
  BOOTSTRAP_ACCOUNT_FINGERPRINT,
} from './useFuturesProductionExecution.js'

const FINGERPRINT = 'a'.repeat(64)
const REQUEST_ID = '0123456789abcdef0123456789abcdef'

const createSocket = (readyState = 1) => {
  const listeners = new Map()
  return {
    readyState,
    sent: [],
    send(raw) {
      this.sent.push(raw)
    },
    addEventListener(type, listener) {
      const group = listeners.get(type) || new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event)
    },
    handlers(type) {
      return [...(listeners.get(type) || [])]
    },
  }
}

const createStatus = (overrides = {}) => ({
  channelId: 'futures-production-execution',
  action: 'futures.production.status',
  version: 1,
  revision: '1',
  marketType: 'futures',
  environment: 'production',
  mode: 'production',
  liveAuthorized: true,
  configured: true,
  account: { alias: 'reviewed-account-1', fingerprint: FINGERPRINT },
  caps: {
    allowedSymbols: ['BTCUSDT'],
    maxLeverage: 1,
    maxOrderNotionalUsdt: '10',
    maxDailyNotionalUsdt: '50',
    minAvailableBalanceUsdt: '10',
    minLiquidationDistanceBps: '1000',
    dailyUsedNotionalUsdt: '0',
    utcDay: '2026-07-13',
  },
  killSwitch: {
    engaged: false,
    policy: 'v1-persistent-block-new-exposure',
  },
  capabilities: {
    placeOrder: true,
    cancelAllOpenOrders: true,
    closePositions: true,
    engageKillSwitch: true,
    disengageKillSwitch: false,
    code: 'FUTURES_PRODUCTION_GATES_SATISFIED',
  },
  intent: null,
  attempt: null,
  reconciliation: null,
  recovery: {
    required: false,
    state: 'healthy',
    code: 'FUTURES_PRODUCTION_RECOVERY_HEALTHY',
  },
  ...overrides,
})

const intent = (kind, revision = '2') => ({
  requestId: REQUEST_ID,
  kind,
  revision,
  expiresAt: 1_783_957_630_000,
})

const sentMessages = (socket) => socket.sent.map((raw) => JSON.parse(raw))

describe('useFuturesProductionExecution', () => {
  let originalWebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = { OPEN: 1 }
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('bootstraps only status ownership with the non-account sentinel and tears down without cancellation', () => {
    const socket = createSocket()
    const { result, unmount } = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: socket,
    }))

    expect(result.current).toMatchObject({ connected: true, subscribed: true, revision: null })
    expect(sentMessages(socket)).toEqual([{
      action: 'futures.production.subscribeStatus',
      version: 1,
      revision: '0',
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: BOOTSTRAP_ACCOUNT_FINGERPRINT,
    }])

    unmount()
    expect(sentMessages(socket)[1]).toEqual({
      action: 'futures.production.unsubscribeStatus',
      version: 1,
      revision: '0',
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: BOOTSTRAP_ACCOUNT_FINGERPRINT,
    })
    expect(socket.sent.some((raw) => /cancel|closePositions|placeOrder/.test(raw))).toBe(false)
    expect(socket.handlers('message')).toHaveLength(0)
  })

  it('accepts only strict increasing backend status and pins the first account fingerprint', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: socket,
    }))

    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ revision: '9007199254740992' })),
    }))
    expect(result.current).toMatchObject({
      revision: '9007199254740992',
      mode: 'production',
      account: { fingerprint: FINGERPRINT },
    })

    act(() => {
      socket.emit('message', {
        data: JSON.stringify(createStatus({
          revision: '9007199254740991',
          killSwitch: {
            engaged: true,
            policy: 'v1-persistent-block-new-exposure',
          },
        })),
      })
      socket.emit('message', {
        data: JSON.stringify(createStatus({
          revision: '9007199254740993',
          account: { alias: 'drifted', fingerprint: 'b'.repeat(64) },
        })),
      })
      socket.emit('message', { data: '{' })
    })

    expect(result.current.revision).toBe('9007199254740992')
    expect(result.current.killSwitch.engaged).toBe(false)
  })

  it('binds the exact order draft only to prepare and blocks synchronous duplicate sends', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: socket,
    }))
    act(() => socket.emit('message', { data: JSON.stringify(createStatus()) }))

    act(() => {
      expect(result.current.prepareOrderIntent({
        symbol: 'BTCUSDT',
        side: 'SELL',
        quantity: '0.0100',
        price: '60000.1200',
        reduceOnly: true,
      })).toBe(true)
      expect(result.current.prepareOrderIntent({
        symbol: 'ETHUSDT',
        side: 'BUY',
        quantity: '1',
        price: '1',
        reduceOnly: false,
      })).toBe(false)
    })

    expect(sentMessages(socket).filter(({ action }) => (
      action === 'futures.production.prepareOrderIntent'
    ))).toEqual([{
      action: 'futures.production.prepareOrderIntent',
      version: 1,
      revision: '1',
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: FINGERPRINT,
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.0100',
      price: '60000.1200',
      reduceOnly: true,
    }])
    expect(result.current.submissionLocked).toBe(true)
  })

  it('sends a one-use final order without mutable values and does not unlock on equal status', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: socket,
    }))
    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({
        revision: '2',
        intent: intent('order'),
      })),
    }))

    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
      'futures.production.placeOrder'
    ]
    act(() => {
      expect(result.current.placeOrder(confirmation)).toBe(true)
      expect(result.current.placeOrder(confirmation)).toBe(false)
    })

    const orders = sentMessages(socket).filter(({ action }) => action === 'futures.production.placeOrder')
    expect(orders).toEqual([{
      action: 'futures.production.placeOrder',
      version: 1,
      revision: '2',
      requestId: REQUEST_ID,
      marketType: 'futures',
      environment: 'production',
      accountFingerprint: FINGERPRINT,
      confirmation,
    }])
    expect(orders[0]).not.toHaveProperty('quantity')

    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ revision: '2', intent: intent('order') })),
    }))
    expect(result.current.submissionLocked).toBe(true)
    expect(result.current.revision).toBe('2')
  })

  it.each([
    [
      'cancel_all_open_orders',
      'prepareCancelAllOpenOrdersIntent',
      'cancelAllOpenOrders',
      'futures.production.prepareCancelAllOpenOrdersIntent',
      'futures.production.cancelAllOpenOrders',
    ],
    [
      'close_positions',
      'prepareClosePositionsIntent',
      'closePositions',
      'futures.production.prepareClosePositionsIntent',
      'futures.production.closePositions',
    ],
    [
      'engage_kill_switch',
      'prepareEngageKillSwitchIntent',
      'engageKillSwitch',
      'futures.production.prepareEngageKillSwitchIntent',
      'futures.production.engageKillSwitch',
    ],
    [
      'disengage_kill_switch',
      'prepareDisengageKillSwitchIntent',
      'disengageKillSwitch',
      'futures.production.prepareDisengageKillSwitchIntent',
      'futures.production.disengageKillSwitch',
      {
        killSwitch: {
          engaged: true,
          policy: 'v1-persistent-block-new-exposure',
        },
        capabilities: {
          placeOrder: false,
          cancelAllOpenOrders: true,
          closePositions: true,
          engageKillSwitch: false,
          disengageKillSwitch: true,
          code: 'FUTURES_PRODUCTION_GATES_SATISFIED',
        },
      },
    ],
  ])('keeps %s prepare and final actions distinct', (
    kind,
    prepareMethod,
    finalMethod,
    prepareAction,
    finalAction,
    statusOverrides = {},
  ) => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: socket,
    }))
    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus(statusOverrides)),
    }))
    act(() => expect(result.current[prepareMethod]()).toBe(true))
    expect(sentMessages(socket).at(-1).action).toBe(prepareAction)

    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({
        ...statusOverrides,
        revision: '2',
        intent: intent(kind),
      })),
    }))
    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[finalAction]
    act(() => expect(result.current[finalMethod](confirmation)).toBe(true))
    expect(sentMessages(socket).at(-1)).toMatchObject({
      action: finalAction,
      requestId: REQUEST_ID,
      confirmation,
    })
  })

  it('releases a local validation failure but never invents a backend attempt', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: socket,
    }))
    act(() => socket.emit('message', { data: JSON.stringify(createStatus()) }))

    act(() => expect(result.current.prepareOrderIntent({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: '1e-2',
      price: '60000',
      reduceOnly: false,
    })).toBe(false))

    expect(result.current.submissionLocked).toBe(false)
    expect(result.current.attempt).toBeNull()
    expect(sentMessages(socket).filter(({ action }) => action.includes('prepareOrder'))).toHaveLength(0)
  })

  it('retires old listeners and exposes no commands when disabled or closed', () => {
    const first = createSocket()
    const second = createSocket()
    const { result, rerender } = renderHook(
      ({ enabled, socket }) => useFuturesProductionExecution({
        enabled,
        wsConnection: socket,
      }),
      { initialProps: { enabled: true, socket: first } },
    )
    const retiredHandler = first.handlers('message')[0]

    rerender({ enabled: true, socket: second })
    act(() => retiredHandler({ data: JSON.stringify(createStatus({ revision: '99' })) }))
    expect(result.current.revision).toBeNull()

    act(() => second.emit('close', { code: 1006 }))
    expect(result.current).toMatchObject({ connected: false, subscribed: false })
    expect(result.current.prepareClosePositionsIntent()).toBe(false)

    rerender({ enabled: false, socket: second })
    expect(result.current.account).toBeNull()
    expect(result.current.capabilities).toBeNull()
  })
})
