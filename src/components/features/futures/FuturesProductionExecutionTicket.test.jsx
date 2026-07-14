import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from '../../../utils/futuresProductionExecutionProtocol.js'
import FuturesProductionExecutionTicket from './FuturesProductionExecutionTicket.jsx'

const FINGERPRINT = 'a'.repeat(64)
const REQUEST_ID = '0123456789abcdef0123456789abcdef'

const createState = (overrides = {}) => ({
  connected: true,
  subscribed: true,
  submissionLocked: false,
  revision: '1',
  mode: 'production',
  liveAuthorized: true,
  configured: true,
  account: { alias: 'reviewed-account-1', fingerprint: FINGERPRINT },
  caps: {
    allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
    maxLeverage: 3,
    maxOrderNotionalUsdt: '10000.0000',
    maxDailyNotionalUsdt: '50000.0000',
    minAvailableBalanceUsdt: '10.0000',
    minLiquidationDistanceBps: '1000',
    dailyUsedNotionalUsdt: '10000.000000000000000001',
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

const createIntent = (kind, requestId = REQUEST_ID) => ({
  requestId,
  kind,
  revision: '2',
  expiresAt: 1_783_957_630_000,
})

const callbacks = (overrides = {}) => ({
  onPrepareOrderIntent: vi.fn(() => true),
  onPlaceOrder: vi.fn(() => true),
  onPrepareCancelAllOpenOrdersIntent: vi.fn(() => true),
  onCancelAllOpenOrders: vi.fn(() => true),
  onPrepareClosePositionsIntent: vi.fn(() => true),
  onClosePositions: vi.fn(() => true),
  onPrepareEngageKillSwitchIntent: vi.fn(() => true),
  onEngageKillSwitch: vi.fn(() => true),
  ...overrides,
})

const renderTicket = (state = createState(), handlers = callbacks()) => ({
  handlers,
  ...render(<FuturesProductionExecutionTicket state={state} {...handlers} />),
})

afterEach(() => cleanup())

describe('FuturesProductionExecutionTicket', () => {
  it('is unmistakably production and displays the exact backend-owned identity, caps, kill, and recovery state', () => {
    renderTicket()

    expect(screen.getByText('USDⓈ-M PRODUCTION · REAL ORDERS')).toBeInTheDocument()
    expect(screen.getByText('LIVE AUTHORIZED')).toBeInTheDocument()
    expect(screen.getByText('reviewed-account-1')).toBeInTheDocument()
    expect(screen.getByText(FINGERPRINT)).toBeInTheDocument()
    expect(screen.getByText('BTCUSDT, ETHUSDT')).toBeInTheDocument()
    expect(screen.getByText('3×')).toBeInTheDocument()
    expect(screen.getByText('10000.0000 USDT')).toBeInTheDocument()
    expect(screen.getByText('50000.0000 USDT')).toBeInTheDocument()
    expect(screen.getByText('10.0000 USDT')).toBeInTheDocument()
    expect(screen.getByText('1000 bps')).toBeInTheDocument()
    expect(screen.getByText('10000.000000000000000001 USDT')).toBeInTheDocument()
    expect(screen.getByText('DISENGAGED')).toBeInTheDocument()
    expect(screen.getByLabelText('Backend production recovery')).toHaveTextContent('healthy')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('keeps cancel-all, close-positions, and kill-switch controls explicit and separate', () => {
    renderTicket()

    expect(screen.getByRole('button', { name: 'Prepare cancel-all intent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare close-positions intent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare kill-switch intent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cancel and close/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /disengage|disable kill/i })).not.toBeInTheDocument()
  })

  it('preserves exact order strings, prevents Enter, and synchronously blocks duplicate prepare', () => {
    const handlers = callbacks()
    renderTicket(createState(), handlers)
    const symbol = screen.getByRole('textbox', { name: 'Symbol' })
    const quantity = screen.getByRole('textbox', { name: 'Exact quantity' })
    const price = screen.getByRole('textbox', { name: 'Exact limit price' })
    const side = screen.getByRole('combobox', { name: 'Side' })
    const reduceOnly = screen.getByRole('checkbox', { name: 'Reduce only' })
    const prepare = screen.getByRole('button', { name: 'Prepare real order intent' })

    fireEvent.change(symbol, { target: { value: 'ethusdt' } })
    fireEvent.change(side, { target: { value: 'SELL' } })
    fireEvent.change(quantity, { target: { value: '0.0100' } })
    fireEvent.change(price, { target: { value: '60000.1200' } })
    fireEvent.click(reduceOnly)
    fireEvent.keyDown(quantity, { key: 'Enter', bubbles: true })
    fireEvent.keyDown(prepare, { key: 'Enter', bubbles: true })
    expect(handlers.onPrepareOrderIntent).not.toHaveBeenCalled()

    fireEvent.click(prepare)
    fireEvent.click(prepare)
    expect(handlers.onPrepareOrderIntent).toHaveBeenCalledTimes(1)
    expect(handlers.onPrepareOrderIntent).toHaveBeenCalledWith({
      symbol: 'ETHUSDT',
      side: 'SELL',
      quantity: '0.0100',
      price: '60000.1200',
      reduceOnly: true,
    })
  })

  it('requires the exact action-specific confirmation and blocks final double submission', () => {
    const handlers = callbacks()
    renderTicket(createState({
      revision: '2',
      intent: createIntent('order'),
    }), handlers)
    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS['futures.production.placeOrder']
    const input = screen.getByRole('textbox', { name: `Type exactly: ${confirmation}` })
    const place = screen.getByRole('button', { name: 'Place real futures order' })

    fireEvent.change(input, { target: { value: 'PLACE FUTURES ORDER' } })
    expect(place).toBeDisabled()
    fireEvent.change(input, { target: { value: confirmation } })
    fireEvent.keyDown(input, { key: 'Enter', bubbles: true })
    fireEvent.keyDown(place, { key: 'Enter', bubbles: true })
    expect(handlers.onPlaceOrder).not.toHaveBeenCalled()

    fireEvent.click(place)
    fireEvent.click(place)
    expect(handlers.onPlaceOrder).toHaveBeenCalledTimes(1)
    expect(handlers.onPlaceOrder).toHaveBeenCalledWith(confirmation)
  })

  it.each([
    [
      'cancel_all_open_orders',
      'futures.production.cancelAllOpenOrders',
      'Cancel all real futures orders',
      'onCancelAllOpenOrders',
    ],
    [
      'close_positions',
      'futures.production.closePositions',
      'Close all real futures positions',
      'onClosePositions',
    ],
    [
      'engage_kill_switch',
      'futures.production.engageKillSwitch',
      'Engage real futures kill switch',
      'onEngageKillSwitch',
    ],
  ])('uses the dedicated %s confirmation and final callback', (
    kind,
    action,
    buttonLabel,
    callbackName,
  ) => {
    const handlers = callbacks()
    renderTicket(createState({
      revision: '2',
      intent: createIntent(kind),
    }), handlers)
    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action]
    const input = screen.getByRole('textbox', { name: `Type exactly: ${confirmation}` })

    fireEvent.change(input, { target: { value: confirmation } })
    fireEvent.click(screen.getByRole('button', { name: buttonLabel }))
    expect(handlers[callbackName]).toHaveBeenCalledTimes(1)
    expect(handlers[callbackName]).toHaveBeenCalledWith(confirmation)
  })

  it('resets the component submission guard and typed challenge on a new backend intent', () => {
    const handlers = callbacks()
    const firstId = REQUEST_ID
    const secondId = 'fedcba9876543210fedcba9876543210'
    const { rerender } = render(
      <FuturesProductionExecutionTicket
        state={createState({ revision: '2', intent: createIntent('close_positions', firstId) })}
        {...handlers}
      />,
    )
    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS['futures.production.closePositions']
    fireEvent.change(
      screen.getByRole('textbox', { name: `Type exactly: ${confirmation}` }),
      { target: { value: confirmation } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close all real futures positions' }))

    rerender(
      <FuturesProductionExecutionTicket
        state={createState({ revision: '3', intent: createIntent('close_positions', secondId) })}
        {...handlers}
      />,
    )
    const freshInput = screen.getByRole('textbox', { name: `Type exactly: ${confirmation}` })
    expect(freshInput).toHaveValue('')
    fireEvent.change(freshInput, { target: { value: confirmation } })
    fireEvent.click(screen.getByRole('button', { name: 'Close all real futures positions' }))
    expect(handlers.onClosePositions).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['unknown', 'result_unknown', 'UNKNOWN — not success or rejection'],
    ['partial', 'partial', 'PARTIAL — incomplete and never treated as success'],
  ])('renders %s as an explicit non-success outcome with exact item detail', (
    acknowledgement,
    state,
    warning,
  ) => {
    renderTicket(createState({
      capabilities: {
        placeOrder: false,
        cancelAllOpenOrders: false,
        closePositions: false,
        engageKillSwitch: false,
        code: 'FUTURES_PRODUCTION_RECOVERY_REQUIRED',
      },
      attempt: {
        requestId: REQUEST_ID,
        kind: 'close_positions',
        revision: '4',
        acknowledgement,
        state,
        code: 'FUTURES_PRODUCTION_RESULT_NOT_COMPLETE',
        observedAt: 1_783_957_600_000,
        items: [
          { symbol: 'BTCUSDT', outcome: 'unknown', code: 'FUTURES_PRODUCTION_ITEM_UNKNOWN' },
          { symbol: 'ETHUSDT', outcome: 'closed', code: 'FUTURES_PRODUCTION_ITEM_CLOSED' },
        ],
      },
      reconciliation: {
        required: true,
        state: 'scheduled',
        nextAttemptAt: 1_783_957_601_000,
      },
      recovery: {
        required: true,
        state: 'blocked',
        code: 'FUTURES_PRODUCTION_RECOVERY_REQUIRED',
      },
    }))

    const result = screen.getByLabelText('Backend production attempt')
    expect(result).toHaveTextContent(acknowledgement.toUpperCase())
    expect(result).toHaveTextContent(state)
    expect(result).toHaveTextContent(warning)
    expect(within(result).getByLabelText('Backend production item outcomes')).toHaveTextContent('BTCUSDT')
    expect(result).not.toHaveClass('is-accepted')
    expect(screen.getByLabelText('Backend production reconciliation')).toHaveTextContent('scheduled')
    expect(screen.getByLabelText('Backend production recovery')).toHaveTextContent('blocked')
  })

  it('does not write browser storage, clipboard, analytics, or activate through generic keys', () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const sessionStorageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const clipboardWrite = vi.fn()
    const previousClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })
    const handlers = callbacks({ onPrepareCancelAllOpenOrdersIntent: vi.fn(() => false) })

    renderTicket(createState(), handlers)
    fireEvent.keyDown(document, { key: 'Enter', bubbles: true })
    fireEvent.keyDown(document, { key: 'B', bubbles: true })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Prepare cancel-all intent' }), {
      key: 'Enter',
      bubbles: true,
    })

    expect(handlers.onPrepareCancelAllOpenOrdersIntent).not.toHaveBeenCalled()
    expect(localStorageSpy).not.toHaveBeenCalled()
    expect(sessionStorageSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(clipboardWrite).not.toHaveBeenCalled()

    localStorageSpy.mockRestore()
    sessionStorageSpy.mockRestore()
    fetchSpy.mockRestore()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: previousClipboard,
    })
  })

  it('shows backend-disabled state and leaves every prepare control unavailable', () => {
    const handlers = callbacks()
    renderTicket(createState({
      liveAuthorized: false,
      configured: false,
      account: null,
      caps: null,
      capabilities: {
        placeOrder: false,
        cancelAllOpenOrders: false,
        closePositions: false,
        engageKillSwitch: false,
        code: 'FUTURES_PRODUCTION_LIVE_AUTHORIZATION_REJECTED',
      },
    }), handlers)

    expect(screen.getByText('LIVE BLOCKED')).toBeInTheDocument()
    expect(screen.getByText('DISABLED')).toBeInTheDocument()
    for (const name of [
      'Prepare real order intent',
      'Prepare cancel-all intent',
      'Prepare close-positions intent',
      'Prepare kill-switch intent',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })
})
