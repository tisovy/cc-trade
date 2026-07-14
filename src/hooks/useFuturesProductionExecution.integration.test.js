import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FUTURES_PRODUCTION_EXECUTION_ACTIONS,
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from '../../electron/services/futures-production-execution-protocol.js'
import {
  createFuturesProductionExecutionService,
} from '../../electron/services/futures-production-execution-service.js'
import useFuturesProductionExecution from './useFuturesProductionExecution.js'

const ACCOUNT_FINGERPRINT = 'a'.repeat(64)
const CREDENTIAL_BINDING = 'b'.repeat(64)
const REQUEST_ID = '1'.repeat(32)

const CONFIG = Object.freeze({
  environment: 'production',
  enabled: true,
  configured: true,
  liveAuthorized: true,
  code: 'FUTURES_PRODUCTION_EXECUTION_ENABLED',
  credentials: Object.freeze({ apiKey: 'fake-key', apiSecret: 'fake-secret' }),
  recoveryAuthorization: 'r'.repeat(32),
  account: Object.freeze({ alias: 'reviewed-production-account', fingerprint: ACCOUNT_FINGERPRINT }),
  policy: Object.freeze({
    allowedSymbols: Object.freeze(['BTCUSDT']),
    maxLeverage: 3,
    maxOrderNotionalUsdt: '10000',
    maxDailyNotionalUsdt: '50000',
    minAvailableBalanceUsdt: '10',
    minLiquidationDistanceBps: '1000',
    killSwitchPolicy: 'v1-persistent-block-new-exposure',
  }),
})

const receipt = (endpointId) => ({
  operation: endpointId,
  endpointId,
  status: 200,
  bodyDigest: 'd'.repeat(64),
  rateLimitHeaders: {},
})

class IntegrationLedger {
  constructor() {
    this.records = []
    this.opened = false
    this.killSwitchEngaged = false
    this.setKillSwitchCalls = []
  }

  async open() { this.opened = true }

  async close() { this.opened = false }

  async append(record) {
    this.records.push({ ...record })
    return { sequence: String(this.records.length), record }
  }

  async setKillSwitch({ engaged, ...record }) {
    this.killSwitchEngaged = engaged
    this.setKillSwitchCalls.push({ engaged, ...record })
    return this.append({
      ...record,
      eventType: 'kill_switch_transition',
      category: 'safety',
      outcome: engaged ? 'engaged' : 'disengaged',
      observedAt: 1,
      state: engaged ? 'engaged' : 'disengaged',
    })
  }

  async assertHealthy() { return true }

  getHealth() { return { healthy: this.opened } }

  getRevision() { return String(this.records.length) }

  getRecords() { return [...this.records] }

  getReplaySnapshot() {
    return { killSwitchEngaged: this.killSwitchEngaged, lastServerTime: null }
  }

  getOrderRateState() {
    return {
      dispatchTimes: [],
      pauseUntil: 0,
      dailyReservations: {},
      lastUtcDay: null,
      lastServerTime: null,
    }
  }

  getActiveOperations() { return [] }

  findRequest(id) {
    return [...this.records].reverse().find((record) => record.requestId === id) ?? null
  }
}

const createService = (ledger) => {
  let clock = 1_783_814_400_000
  const result = (endpointId, data) => ({ data, receipt: receipt(endpointId) })
  const facade = {
    getServerTime: vi.fn().mockImplementation(() => result('server-time', {
      serverTime: clock++,
      sentAt: clock,
      receivedAt: clock,
      roundTripMs: 0,
    })),
    getAccountConfig: vi.fn().mockResolvedValue(result('account-config', {
      canTrade: true,
      dualSidePosition: false,
      multiAssetsMargin: false,
    })),
    getBalance: vi.fn().mockResolvedValue(result('balance', [{
      asset: 'USDT',
      accountAlias: CONFIG.account.alias,
      marginAvailable: true,
    }])),
  }
  const coordinator = {
    beginPreflight: vi.fn(async () => ({
      executeGet: async (operation) => operation(),
      release: vi.fn(),
    })),
    restoreOrderState: vi.fn(),
    getOrderAdmissionSnapshot: () => ({
      dailyReservations: {},
      dispatchTimes: [],
      pauseUntil: 0,
    }),
  }
  return createFuturesProductionExecutionService({
    config: CONFIG,
    credentialBinding: CREDENTIAL_BINDING,
    ledger,
    facade,
    coordinator,
    randomBytes: () => Buffer.from(REQUEST_ID, 'hex'),
    now: () => clock++,
    setTimeoutFn: vi.fn(),
    clearTimeoutFn: vi.fn(),
  })
}

const createBackendSocket = ({ service, connectionId, pending }) => {
  const listeners = new Map()
  return {
    readyState: 1,
    sent: [],
    received: [],
    send(raw) {
      this.sent.push(raw)
      const operation = service.handleRequest(raw, {
        connectionId,
        emit: (status) => {
          this.received.push(status)
          const event = { data: JSON.stringify(status) }
          for (const listener of [...(listeners.get('message') ?? [])]) listener(event)
        },
      })
      pending.push(operation)
    },
    addEventListener(type, listener) {
      const group = listeners.get(type) ?? new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
  }
}

const sentActions = (socket, action) => socket.sent
  .map((raw) => JSON.parse(raw))
  .filter((message) => message.action === action)

const drainBackend = async (pending) => {
  while (pending.length > 0) {
    await Promise.all(pending.splice(0))
  }
  await Promise.resolve()
}

describe('Futures production service-to-renderer intent ownership', () => {
  let originalWebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = { OPEN: 1 }
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('parses an owner-only backend intent and permits exactly one final submission', async () => {
    const ledger = new IntegrationLedger()
    const service = createService(ledger)
    const pending = []
    await service.start()

    const ownerSocket = createBackendSocket({
      service,
      connectionId: 'c'.repeat(32),
      pending,
    })
    const peerSocket = createBackendSocket({
      service,
      connectionId: 'd'.repeat(32),
      pending,
    })
    const owner = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: ownerSocket,
    }))
    const peer = renderHook(() => useFuturesProductionExecution({
      enabled: true,
      wsConnection: peerSocket,
    }))

    try {
      await act(async () => drainBackend(pending))
      expect(owner.result.current.capabilities.engageKillSwitch).toBe(true)
      expect(peer.result.current.capabilities.engageKillSwitch).toBe(true)

      await act(async () => {
        expect(owner.result.current.prepareEngageKillSwitchIntent()).toBe(true)
        await drainBackend(pending)
      })

      expect(owner.result.current.intent).toMatchObject({
        requestId: REQUEST_ID,
        kind: 'engage_kill_switch',
      })
      expect(owner.result.current.capabilities).toMatchObject({
        placeOrder: false,
        cancelAllOpenOrders: false,
        closePositions: false,
        engageKillSwitch: true,
      })
      expect(peer.result.current.intent).toBeNull()
      expect(peer.result.current.capabilities).toMatchObject({
        placeOrder: false,
        cancelAllOpenOrders: false,
        closePositions: false,
        engageKillSwitch: false,
      })

      const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH
      ]
      act(() => {
        expect(peer.result.current.engageKillSwitch(confirmation)).toBe(false)
        expect(owner.result.current.engageKillSwitch(confirmation)).toBe(true)
        expect(owner.result.current.engageKillSwitch(confirmation)).toBe(false)
      })
      await act(async () => drainBackend(pending))

      expect(sentActions(
        ownerSocket,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
      )).toHaveLength(1)
      expect(sentActions(
        peerSocket,
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
      )).toHaveLength(0)
      expect(ledger.setKillSwitchCalls).toHaveLength(1)
      expect(ledger.killSwitchEngaged).toBe(true)
      expect(ledger.records.filter(({ eventType }) => eventType === 'intent_consumed')).toHaveLength(1)
    } finally {
      owner.unmount()
      peer.unmount()
      await act(async () => drainBackend(pending))
      await service.shutdown()
    }
  })
})
