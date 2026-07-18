import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from '../../../utils/futuresProductionExecutionProtocol.js'
import FuturesProductionExecutionTicket from './FuturesProductionExecutionTicket.jsx'

const FINGERPRINT = 'a'.repeat(64)
const REQUEST_ID = '0123456789abcdef0123456789abcdef'
const selectedContract = Object.freeze({
  symbol: 'BTCUSDT',
  filters: Object.freeze({
    price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
    quantity: Object.freeze({ min: '0.001', max: '100', stepSize: '0.001' }),
    minimumNotional: '5',
  }),
})

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
    allowedSymbols: ['BTCUSDT'],
    maxLeverage: 2,
    maxOrderNotionalUsdt: '10',
    maxDailyNotionalUsdt: '50',
    minAvailableBalanceUsdt: '10',
    minLiquidationDistanceBps: '1000',
    dailyUsedNotionalUsdt: '0',
    utcDay: '2026-07-13',
  },
  killSwitch: { engaged: false, policy: 'v1-persistent-block-new-exposure' },
  capabilities: {
    placeOrder: true,
    adjustMargin: false,
    amendOrder: false,
    cancelAllOpenOrders: true,
    closePositions: true,
    engageKillSwitch: true,
    disengageKillSwitch: false,
    code: 'FUTURES_PRODUCTION_GATES_SATISFIED',
  },
  intent: null,
  attempt: null,
  reconciliation: null,
  recovery: { required: false, state: 'healthy', code: 'FUTURES_PRODUCTION_RECOVERY_HEALTHY' },
  portfolio: { state: 'live', observedAt: 1_783_957_600_000, positions: [], openOrders: [] },
  ...overrides,
})

const createIntent = kind => ({
  requestId: REQUEST_ID,
  kind,
  revision: '2',
  expiresAt: 1_783_957_630_000,
})

const hedgePortfolio = Object.freeze({
  state: 'live',
  observedAt: 1_783_957_600_000,
  openOrders: [],
  positions: Object.freeze([
    Object.freeze({ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.001' }),
    Object.freeze({ symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '0.001' }),
  ]),
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
  onPrepareDisengageKillSwitchIntent: vi.fn(() => true),
  onDisengageKillSwitch: vi.fn(() => true),
  onRefreshPortfolio: vi.fn(() => true),
  onPrepareMarginAdjustment: vi.fn(() => true),
  onAdjustMargin: vi.fn(() => true),
  onPrepareOrderAmendment: vi.fn(() => true),
  onAmendOrder: vi.fn(() => true),
  ...overrides,
})

const renderTicket = ({ state = createState(), handlers = callbacks(), ...props } = {}) => ({
  handlers,
  ...render(
    <FuturesProductionExecutionTicket
      state={state}
      selectedSymbol="BTCUSDT"
      selectedContract={selectedContract}
      {...handlers}
      {...props}
    />,
  ),
})

const selectFullSize = () => fireEvent.click(screen.getByRole('button', { name: '100%' }))

afterEach(() => cleanup())

describe('FuturesProductionExecutionTicket', () => {
  it('shows the exact Hedge isolated 2x profile and keeps diagnostics collapsed', () => {
    renderTicket()
    expect(screen.getByText('FUTURES · USDⓈ-M')).toBeInTheDocument()
    expect(screen.getByText('ISOLATED · 2× · HEDGE')).toBeInTheDocument()
    expect(screen.getByText('ARMED')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Order' })).toHaveAttribute('aria-selected', 'true')
    const safety = screen.getByText('Advanced safety').closest('details')
    expect(safety).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Advanced safety'))
    expect(screen.getByLabelText('Backend production identity and mode')).toHaveTextContent(
      `Accountreviewed-account-1Fingerprint${FINGERPRINT}`,
    )
  })

  it('synchronizes the percentage and USDT controls and derives exact 2x margin', async () => {
    renderTicket({ draftPrice: '7000.09' })
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('2.5')
    selectFullSize()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('10'))
    const order = screen.getByLabelText('Production order action')
    expect(order).toHaveTextContent('Price7000')
    expect(order).toHaveTextContent('Quantity0.001')
    expect(order).toHaveTextContent('Notional7 USDT')
    expect(order).toHaveTextContent('Est. margin3.5 USDT')
  })

  it.each([
    ['Enter LONG', 'BUY', 'LONG', 'ENTRY'],
    ['Exit LONG', 'SELL', 'LONG', 'EXIT'],
    ['Enter SHORT', 'SELL', 'SHORT', 'ENTRY'],
    ['Exit SHORT', 'BUY', 'SHORT', 'EXIT'],
  ])('prepares the exact %s Hedge draft', async (label, side, positionSide, positionEffect) => {
    const handlers = callbacks()
    renderTicket({
      handlers,
      draftPrice: '7000',
      state: createState({ portfolio: hedgePortfolio }),
    })
    selectFullSize()
    fireEvent.click(screen.getByRole('button', { name: label }))
    const prepare = await screen.findByRole('button', { name: `Prepare ${label}` })
    await waitFor(() => expect(prepare).toBeEnabled())
    fireEvent.click(prepare)
    expect(handlers.onPrepareOrderIntent).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      side,
      positionSide,
      positionEffect,
      quantity: '0.001',
      price: '7000',
    })
  })

  it('turns a recognized shortcut into one prepared intent and never a final submit', async () => {
    const handlers = callbacks()
    const base = {
      state: createState(),
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      draftPrice: '7000',
      ...handlers,
    }
    const { rerender } = render(<FuturesProductionExecutionTicket {...base} />)
    selectFullSize()
    rerender(<FuturesProductionExecutionTicket {...base} gestureRequest={{
      id: 1,
      price: '7000',
      side: 'SELL',
      positionSide: 'SHORT',
      positionEffect: 'ENTRY',
      source: 'chart',
    }} />)
    await waitFor(() => expect(handlers.onPrepareOrderIntent).toHaveBeenCalledTimes(1))
    expect(handlers.onPrepareOrderIntent).toHaveBeenCalledWith(expect.objectContaining({
      side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY',
    }))
    expect(screen.getByRole('button', { name: 'Enter SHORT' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(handlers.onPlaceOrder).not.toHaveBeenCalled()
  })

  it('turns one owned-order drag into prepare only and requires exact final confirmation', async () => {
    const handlers = callbacks()
    const amendmentCapabilities = {
      ...createState().capabilities,
      amendOrder: true,
    }
    const base = {
      state: createState({ capabilities: amendmentCapabilities }),
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      ...handlers,
    }
    const amendment = {
      id: 1,
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: `cc7-${REQUEST_ID}`,
      price: '70100.19',
      modifier: 'ctrl',
    }
    const { rerender } = render(
      <FuturesProductionExecutionTicket {...base} orderAmendRequest={amendment} />,
    )
    await waitFor(() => expect(handlers.onPrepareOrderAmendment).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: `cc7-${REQUEST_ID}`,
      price: '70100.1',
    }))
    expect(handlers.onAmendOrder).not.toHaveBeenCalled()

    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        revision: '2',
        capabilities: amendmentCapabilities,
        intent: createIntent('order_amendment'),
      })}
      orderAmendRequest={amendment}
    />)
    const finalButton = screen.getByRole('button', { name: 'Move real futures order' })
    expect(finalButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Type exactly: MOVE REAL FUTURES ORDER' }), {
      target: { value: 'MOVE REAL FUTURES ORDER' },
    })
    fireEvent.click(finalButton)
    expect(handlers.onAmendOrder).toHaveBeenCalledExactlyOnceWith('MOVE REAL FUTURES ORDER')
  })

  it('keeps entries blocked by the kill switch while allowing a bounded exit draft', async () => {
    renderTicket({
      state: createState({
        killSwitch: { engaged: true, policy: 'v1-persistent-block-new-exposure' },
        portfolio: hedgePortfolio,
      }),
      draftPrice: '7000',
    })
    selectFullSize()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare Enter LONG' })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Exit LONG' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare Exit LONG' })).toBeEnabled())
  })

  it('requires the exact typed confirmation and synchronously blocks duplicate final sends', () => {
    const handlers = callbacks()
    renderTicket({ state: createState({ revision: '2', intent: createIntent('order') }), handlers })
    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS['futures.production.placeOrder']
    const input = screen.getByRole('textbox', { name: `Type exactly: ${confirmation}` })
    const place = screen.getByRole('button', { name: 'Place real futures order' })
    fireEvent.change(input, { target: { value: confirmation } })
    fireEvent.keyDown(input, { key: 'Enter', bubbles: true })
    expect(handlers.onPlaceOrder).not.toHaveBeenCalled()
    fireEvent.click(place)
    fireEvent.click(place)
    expect(handlers.onPlaceOrder).toHaveBeenCalledTimes(1)
  })

  it('moves destructive bulk controls into Advanced safety without removing them', () => {
    renderTicket()
    expect(screen.getByRole('button', { name: 'Prepare cancel-all' }).closest('details'))
      .not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Advanced safety'))
    expect(screen.getByRole('button', { name: 'Prepare cancel-all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare close-all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare kill switch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare ARM LIVE intent' })).toBeInTheDocument()
  })

  it('shows separate position legs and add/reduce isolated-margin controls', () => {
    const onPrepareMarginAdjustment = vi.fn(() => true)
    renderTicket({
      state: createState({
        capabilities: { ...createState().capabilities, adjustMargin: true },
        portfolio: {
          state: 'live',
          observedAt: 1_783_957_600_000,
          openOrders: [],
          positions: [{
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            quantity: '0.001',
            isolatedMarginUsdt: '35',
            unrealizedPnlUsdt: '2.5',
            liquidationPrice: '50000',
          }],
        },
      }),
      onPrepareMarginAdjustment,
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Positions' }))
    expect(screen.getByLabelText('Hedge positions')).toHaveTextContent('BTCUSDTLONG')
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reduce margin' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add margin' }))
    fireEvent.change(screen.getByLabelText('Isolated margin amount USDT'), {
      target: { value: '5.25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare add margin' }))
    expect(onPrepareMarginAdjustment).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      marginAction: 'ADD',
      amount: '5.25',
    })
  })

  it('requires exact typed confirmation for an isolated-margin final command', () => {
    const onAdjustMargin = vi.fn(() => true)
    renderTicket({
      state: createState({
        capabilities: { ...createState().capabilities, adjustMargin: true },
        intent: createIntent('margin_adjustment'),
        portfolio: {
          state: 'live',
          observedAt: 1_783_957_600_000,
          openOrders: [],
          positions: [{
            symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.001',
            isolatedMarginUsdt: '35', unrealizedPnlUsdt: '2.5', liquidationPrice: '50000',
          }],
        },
      }),
      onAdjustMargin,
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Positions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add margin' }))
    const finalButton = screen.getByRole('button', { name: 'Adjust real isolated margin' })
    expect(finalButton).toBeDisabled()
    fireEvent.change(screen.getByText(/Type exactly:/).closest('label').querySelector('input'), {
      target: { value: 'ADJUST REAL FUTURES ISOLATED MARGIN' },
    })
    fireEvent.click(finalButton)
    expect(onAdjustMargin).toHaveBeenCalledWith('ADJUST REAL FUTURES ISOLATED MARGIN')
  })

  it('renders UNKNOWN/PARTIAL as non-success owned by backend reconciliation', () => {
    renderTicket({
      state: createState({
        attempt: {
          acknowledgement: 'unknown',
          state: 'result_unknown',
        },
      }),
    })
    expect(screen.getByLabelText('Backend production attempt')).toHaveTextContent(
      'UNKNOWNresult_unknownNot success',
    )
  })
})
