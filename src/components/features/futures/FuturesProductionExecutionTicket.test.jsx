import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from '../../../utils/futuresProductionExecutionProtocol.js'
import FuturesProductionExecutionTicket, {
  FuturesProductionExecutionTicket as UnmemoizedFuturesProductionExecutionTicket,
} from './FuturesProductionExecutionTicket.jsx'

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
    symbolConfigurations: [{
      symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 2, isAutoAddMargin: false,
    }],
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
  portfolio: {
    state: 'live',
    syncState: 'live',
    syncCode: 'FUTURES_PRODUCTION_USER_STREAM_LIVE',
    observedAt: 1_783_957_600_000,
    availableBalanceUsdt: '15',
    positions: [],
    openOrders: [],
  },
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
  syncState: 'live',
  syncCode: 'FUTURES_PRODUCTION_USER_STREAM_LIVE',
  observedAt: 1_783_957_600_000,
  availableBalanceUsdt: '15',
  openOrders: [],
  positions: Object.freeze([
    Object.freeze({
      symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.001',
      marginType: 'ISOLATED', leverage: 2,
    }),
    Object.freeze({
      symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '0.001',
      marginType: 'ISOLATED', leverage: 2,
    }),
  ]),
})

const externalOrder = Object.freeze({
  symbol: 'BTCUSDT',
  orderKind: 'REGULAR',
  orderId: '123456789',
  clientOrderId: 'external-mobile-order-42',
  side: 'SELL',
  positionSide: 'LONG',
  positionEffect: 'EXIT',
  price: '7000',
  originalQuantity: '0.002',
  executedQuantity: '0.001',
  status: 'PARTIALLY_FILLED',
  type: 'LIMIT',
  timeInForce: 'GTC',
  isAppOwned: false,
  updateTime: 1_783_957_600_000,
  syncState: 'synced',
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
  it('memoizes the default renderer boundary while retaining the named unit surface', () => {
    expect(FuturesProductionExecutionTicket.type).toBe(UnmemoizedFuturesProductionExecutionTicket)
  })

  it('shows the exact Hedge isolated 2x profile and keeps diagnostics collapsed', () => {
    renderTicket()
    expect(screen.getByText('FUTURES · USDⓈ-M')).toBeInTheDocument()
    expect(screen.getByText('ISOLATED · 2× · HEDGE')).toBeInTheDocument()
    expect(screen.getByText('READY')).toBeInTheDocument()
    expect(screen.getByText('Gesture execution ready.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Trade' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: /Enter LONG|Exit LONG|Enter SHORT|Exit SHORT/i }))
      .not.toBeInTheDocument()
    expect(screen.queryByText(/Gesture trading/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Place real futures order|Move real futures order/i }))
      .not.toBeInTheDocument()
    const safety = screen.getByText('Advanced safety').closest('details')
    expect(safety).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Advanced safety'))
    expect(screen.getByLabelText('Backend production identity and mode')).toHaveTextContent(
      `Accountreviewed-account-1Fingerprint${FINGERPRINT}`,
    )
  })

  it.each([
    { symbolConfigurations: [], label: 'CONFIG', reason: 'BTCUSDT Futures configuration is pending' },
    {
      symbolConfigurations: [{
        symbol: 'BTCUSDT', marginType: 'CROSSED', leverage: 2, isAutoAddMargin: false,
      }],
      label: 'MARGIN',
      reason: 'BTCUSDT uses Cross margin',
    },
    {
      symbolConfigurations: [{
        symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 2, isAutoAddMargin: true,
      }],
      label: 'AUTO ADD',
      reason: 'BTCUSDT auto-add margin is enabled',
    },
    {
      symbolConfigurations: [{
        symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 20, isAutoAddMargin: false,
      }],
      label: 'LEVERAGE',
      reason: 'BTCUSDT leverage is 20×',
    },
  ])('explains an actionable $label symbol-configuration gate', ({
    symbolConfigurations,
    label,
    reason,
  }) => {
    renderTicket({
      state: createState({
        caps: { ...createState().caps, symbolConfigurations },
      }),
    })
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(reason)).length).toBeGreaterThan(0)
  })

  it('becomes gesture-ready when the selected Binance symbol configuration arrives', () => {
    const baseCaps = createState().caps
    const { rerender } = render(
      <FuturesProductionExecutionTicket
        state={createState({ caps: { ...baseCaps, symbolConfigurations: [] } })}
        selectedSymbol="BTCUSDT"
        selectedContract={selectedContract}
      />,
    )
    expect(screen.getByText('CONFIG')).toBeInTheDocument()
    rerender(<FuturesProductionExecutionTicket
      state={createState()}
      selectedSymbol="BTCUSDT"
      selectedContract={selectedContract}
    />)
    expect(screen.getByText('READY')).toBeInTheDocument()
  })

  it('keeps the pre-status subscription window in SYNC instead of claiming setup failure', () => {
    renderTicket({
      state: createState({
        revision: null,
        configured: null,
        liveAuthorized: null,
        account: null,
        caps: null,
        capabilities: null,
        portfolio: null,
      }),
    })
    expect(screen.getByText('CONFIG SYNC')).toBeInTheDocument()
    expect(screen.getByText('SYNC')).toBeInTheDocument()
    expect(screen.getByText('Loading private Futures account state…')).toBeInTheDocument()
    expect(screen.queryByText('SETUP')).not.toBeInTheDocument()
  })

  it('does not report READY when Binance contract filters are unavailable', () => {
    renderTicket({ selectedContract: null })
    expect(screen.getByText('METADATA')).toBeInTheDocument()
    expect(screen.getByText('Binance symbol metadata is unavailable — retry the contract refresh.'))
      .toBeInTheDocument()
    expect(screen.queryByText('READY')).not.toBeInTheDocument()
  })

  it('shows an actionable account reason after Binance rejects private identity', () => {
    renderTicket({
      state: createState({
        capabilities: {
          ...createState().capabilities,
          placeOrder: false,
          code: 'FUTURES_PRODUCTION_ACCOUNT_IDENTITY_REJECTED',
        },
      }),
    })
    expect(screen.getByText('ACCOUNT')).toBeInTheDocument()
    expect(screen.getByText(/verify Futures API access, Hedge Mode, and single-asset margin/))
      .toBeInTheDocument()
  })

  it('explains and blocks a selected symbol outside the execution allowlist', async () => {
    const handlers = callbacks()
    renderTicket({
      handlers,
      selectedSymbol: 'ETHUSDT',
      draftPrice: '3500',
      gestureRequest: {
        id: 1,
        side: 'BUY',
        positionSide: 'LONG',
        positionEffect: 'ENTRY',
        price: '3500',
      },
    })

    expect(screen.getByText('SYMBOL')).toBeInTheDocument()
    expect(screen.getByText(
      'ETHUSDT is not enabled for live execution — select an allowed contract.',
    )).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeDisabled()
    await waitFor(() => expect(handlers.onPrepareOrderIntent).not.toHaveBeenCalled())
  })

  it('synchronizes the percentage and USDT controls and derives exact 2x margin', async () => {
    renderTicket({ draftPrice: '7000.09' })
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('2.5')
    fireEvent.change(screen.getByRole('slider', { name: 'Order size percent' }), {
      target: { value: '100' },
    })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('10'))
    const order = screen.getByLabelText('Futures order size and shortcuts')
    expect(order).toHaveTextContent('100%10 USDT')
    expect(order).toHaveTextContent('Price7000')
    expect(order).toHaveTextContent('Quantity0.001')
    expect(order).toHaveTextContent('Est. margin3.5 USDT')
    expect(order).toHaveTextContent('Available15 USDT')
  })

  it('immediately rebases percent, USDT, quantity, and margin on available account balance', async () => {
    renderTicket({
      state: createState({
        portfolio: {
          ...createState().portfolio,
          availableBalanceUsdt: '13.5',
        },
      }),
      draftPrice: '7000.09',
    })
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('1.75')
    fireEvent.change(screen.getByRole('slider', { name: 'Order size percent' }), {
      target: { value: '100' },
    })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('7'))
    const order = screen.getByLabelText('Futures order size and shortcuts')
    expect(order).toHaveTextContent('100%7 USDT')
    expect(order).toHaveTextContent('Quantity0.001')
    expect(order).toHaveTextContent('Est. margin3.5 USDT')
    expect(order).toHaveTextContent('Available13.5 USDT')
    expect(order).toHaveTextContent('Safe limit7 USDT')
  })

  it('keeps a custom USDT size linked to an authoritative budget change', async () => {
    const handlers = callbacks()
    const base = {
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      draftPrice: '1000',
      ...handlers,
    }
    const { rerender } = render(
      <FuturesProductionExecutionTicket {...base} state={createState()} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Order notional USDT' }), {
      target: { value: '5' },
    })
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toHaveValue('50')
    expect(screen.getByLabelText('Futures order size and shortcuts')).toHaveTextContent('50%5 USDT')

    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        portfolio: {
          ...createState().portfolio,
          availableBalanceUsdt: '14',
        },
      })}
    />)

    await waitFor(() => {
      expect(screen.getByRole('slider', { name: 'Order size percent' })).toHaveValue('62')
    })
    const order = screen.getByLabelText('Futures order size and shortcuts')
    expect(order).toHaveTextContent('62%5 USDT')
    expect(order).toHaveTextContent('Quantity0.005')
    expect(order).toHaveTextContent('Est. margin2.5 USDT')
    expect(order).toHaveTextContent('Safe limit8 USDT')
  })

  it.each([
    ['LONG entry', 'BUY', 'LONG', 'ENTRY'],
    ['LONG exit', 'SELL', 'LONG', 'EXIT'],
    ['SHORT entry', 'SELL', 'SHORT', 'ENTRY'],
    ['SHORT exit', 'BUY', 'SHORT', 'EXIT'],
  ])('prepares and automatically finalizes the exact %s Hedge draft once', async (
    label,
    side,
    positionSide,
    positionEffect,
  ) => {
    const handlers = callbacks()
    const base = {
      state: createState({ portfolio: hedgePortfolio }),
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      draftPrice: '7000',
      ...handlers,
    }
    const { rerender } = render(<FuturesProductionExecutionTicket {...base} />)
    selectFullSize()
    const gestureRequest = {
      id: 1,
      price: '7000',
      side,
      positionSide,
      positionEffect,
      source: 'chart',
    }
    rerender(<FuturesProductionExecutionTicket {...base} gestureRequest={gestureRequest} />)
    await waitFor(() => expect(handlers.onPrepareOrderIntent).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side,
      positionSide,
      positionEffect,
      quantity: '0.001',
      price: '7000',
    }))
    expect(screen.getByText(label, { selector: 'code' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(label, 'i') })).not.toBeInTheDocument()
    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        revision: '2',
        portfolio: hedgePortfolio,
        intent: createIntent('order'),
      })}
      gestureRequest={gestureRequest}
    />)
    const confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS['futures.production.placeOrder']
    await waitFor(() => expect(handlers.onPlaceOrder).toHaveBeenCalledExactlyOnceWith(confirmation))
    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        revision: '2',
        portfolio: hedgePortfolio,
        intent: createIntent('order'),
      })}
      gestureRequest={gestureRequest}
    />)
    expect(handlers.onPlaceOrder).toHaveBeenCalledTimes(1)
  })

  it('never auto-finalizes an order intent that did not originate from a recognized shortcut', async () => {
    const handlers = callbacks()
    renderTicket({
      state: createState({ revision: '2', intent: createIntent('order') }),
      handlers,
      draftPrice: '7000',
    })
    await waitFor(() => expect(handlers.onPrepareOrderIntent).not.toHaveBeenCalled())
    expect(handlers.onPlaceOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Place real futures order' })).not.toBeInTheDocument()
  })

  it('does not finalize a delayed gesture intent after the selected pair changes', async () => {
    const handlers = callbacks()
    const initialState = createState()
    const multiSymbolCaps = {
      ...initialState.caps,
      allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
      symbolConfigurations: [
        ...initialState.caps.symbolConfigurations,
        { symbol: 'ETHUSDT', marginType: 'ISOLATED', leverage: 2, isAutoAddMargin: false },
      ],
    }
    const base = {
      state: createState({ caps: multiSymbolCaps }),
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      draftPrice: '7000',
      ...handlers,
    }
    const gestureRequest = {
      id: 91,
      price: '7000',
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      source: 'chart',
    }
    const { rerender } = render(<FuturesProductionExecutionTicket {...base} />)
    selectFullSize()
    rerender(<FuturesProductionExecutionTicket {...base} gestureRequest={gestureRequest} />)
    await waitFor(() => expect(handlers.onPrepareOrderIntent).toHaveBeenCalledOnce())

    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        revision: '2',
        caps: multiSymbolCaps,
        intent: createIntent('order'),
      })}
      selectedSymbol="ETHUSDT"
      selectedContract={{ ...selectedContract, symbol: 'ETHUSDT' }}
      gestureRequest={null}
    />)

    expect(handlers.onPlaceOrder).not.toHaveBeenCalled()
  })

  it('automatically prepares and finalizes one external-order drag without duplicate sends', async () => {
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
      clientOrderId: 'external-mobile-order-42',
      price: '70100.19',
      modifier: 'ctrl',
    }
    const { rerender } = render(
      <FuturesProductionExecutionTicket {...base} orderAmendRequest={amendment} />,
    )
    await waitFor(() => expect(handlers.onPrepareOrderAmendment).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: 'external-mobile-order-42',
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
    await waitFor(() => expect(handlers.onAmendOrder).toHaveBeenCalledExactlyOnceWith(
      'MOVE REAL FUTURES ORDER',
    ))
    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        revision: '2',
        capabilities: amendmentCapabilities,
        intent: createIntent('order_amendment'),
      })}
      orderAmendRequest={amendment}
    />)
    expect(handlers.onAmendOrder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Move real futures order' })).not.toBeInTheDocument()
  })

  it('does not finalize a delayed amendment intent after the selected pair changes', async () => {
    const handlers = callbacks()
    const initialState = createState()
    const amendmentCapabilities = {
      ...initialState.capabilities,
      amendOrder: true,
    }
    const multiSymbolCaps = {
      ...initialState.caps,
      allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
      symbolConfigurations: [
        ...initialState.caps.symbolConfigurations,
        { symbol: 'ETHUSDT', marginType: 'ISOLATED', leverage: 2, isAutoAddMargin: false },
      ],
    }
    const amendment = {
      id: 92,
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: 'external-delayed-amendment',
      price: '70100.19',
      modifier: 'alt',
    }
    const base = {
      state: createState({ caps: multiSymbolCaps, capabilities: amendmentCapabilities }),
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      ...handlers,
    }
    const { rerender } = render(
      <FuturesProductionExecutionTicket {...base} orderAmendRequest={amendment} />,
    )
    await waitFor(() => expect(handlers.onPrepareOrderAmendment).toHaveBeenCalledOnce())

    rerender(<FuturesProductionExecutionTicket
      {...base}
      state={createState({
        revision: '2',
        caps: multiSymbolCaps,
        capabilities: amendmentCapabilities,
        intent: createIntent('order_amendment'),
      })}
      selectedSymbol="ETHUSDT"
      selectedContract={{ ...selectedContract, symbol: 'ETHUSDT' }}
      orderAmendRequest={null}
    />)

    expect(handlers.onAmendOrder).not.toHaveBeenCalled()
  })

  it('keeps entries blocked by the kill switch while allowing a bounded exit draft', async () => {
    const handlers = callbacks()
    const base = {
      state: createState({
        killSwitch: { engaged: true, policy: 'v1-persistent-block-new-exposure' },
        portfolio: hedgePortfolio,
      }),
      selectedSymbol: 'BTCUSDT',
      selectedContract,
      draftPrice: '7000',
      ...handlers,
    }
    const { rerender } = render(<FuturesProductionExecutionTicket {...base} />)
    expect(screen.getByText('LOCKED')).toBeInTheDocument()
    expect(screen.getByText(/New exposure is locked/)).toBeInTheDocument()
    selectFullSize()
    rerender(<FuturesProductionExecutionTicket {...base} gestureRequest={{
      id: 1,
      price: '7000',
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      source: 'chart',
    }} />)
    await waitFor(() => expect(handlers.onPrepareOrderIntent).not.toHaveBeenCalled())
    rerender(<FuturesProductionExecutionTicket {...base} gestureRequest={{
      id: 2,
      price: '7000',
      side: 'SELL',
      positionSide: 'LONG',
      positionEffect: 'EXIT',
      source: 'chart',
    }} />)
    expect(screen.getByText('READY')).toBeInTheDocument()
    expect(screen.queryByText(/New exposure is locked/)).not.toBeInTheDocument()
    await waitFor(() => expect(handlers.onPrepareOrderIntent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ positionSide: 'LONG', positionEffect: 'EXIT' }),
    ))
  })

  it('allows a bounded exit but no entry for a legacy cross high-leverage leg', async () => {
    const handlers = callbacks()
    const legacyCaps = {
      ...createState().caps,
      symbolConfigurations: [{
        symbol: 'BTCUSDT', marginType: 'CROSSED', leverage: 20, isAutoAddMargin: true,
      }],
    }
    const legacyPortfolio = {
      ...hedgePortfolio,
      positions: hedgePortfolio.positions.map(position => ({
        ...position,
        marginType: 'CROSSED',
        leverage: 20,
      })),
    }
    const base = {
      state: createState({ caps: legacyCaps, portfolio: legacyPortfolio }),
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
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      source: 'chart',
    }} />)
    await waitFor(() => expect(handlers.onPrepareOrderIntent).not.toHaveBeenCalled())

    rerender(<FuturesProductionExecutionTicket {...base} gestureRequest={{
      id: 2,
      price: '7000',
      side: 'SELL',
      positionSide: 'LONG',
      positionEffect: 'EXIT',
      source: 'chart',
    }} />)
    await waitFor(() => expect(handlers.onPrepareOrderIntent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ positionEffect: 'EXIT', positionSide: 'LONG' }),
    ))
    expect(screen.getByText('READY')).toBeInTheDocument()
  })

  it('keeps a bounded EXIT ready when available balance is temporarily absent', async () => {
    const handlers = callbacks()
    const portfolio = {
      ...hedgePortfolio,
      availableBalanceUsdt: undefined,
      positions: hedgePortfolio.positions.map(position => ({
        ...position,
        quantity: '0.004',
      })),
    }
    renderTicket({
      state: createState({ portfolio }),
      handlers,
      draftPrice: '7000',
      gestureRequest: {
        id: 301,
        price: '7000',
        side: 'SELL',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        source: 'chart',
      },
    })

    expect(screen.getByText('READY')).toBeInTheDocument()
    expect(screen.queryByText('BALANCE')).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeEnabled()
    await waitFor(() => expect(handlers.onPrepareOrderIntent).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'SELL',
      positionSide: 'LONG',
      positionEffect: 'EXIT',
      quantity: '0.001',
      price: '7000',
    }))
  })

  it('disables sizing with the exact missing private input and replaces generic blocked status', () => {
    renderTicket({
      state: createState({
        portfolio: {
          ...createState().portfolio,
          availableBalanceUsdt: undefined,
        },
      }),
      draftPrice: '7000',
    })
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toBeDisabled()
    expect(screen.getByText('Available Futures balance is unavailable — wait for private account sync'))
      .toBeInTheDocument()
    expect(screen.getByText('BALANCE')).toBeInTheDocument()
    expect(screen.getByText('Available Futures balance is pending — wait for private account sync.'))
      .toBeInTheDocument()
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument()
  })

  it('shows the exact startup configuration action when Live Futures is disabled', () => {
    renderTicket({
      state: createState({
        configured: false,
        liveAuthorized: false,
        account: null,
        caps: null,
        capabilities: null,
        portfolio: null,
      }),
    })
    expect(screen.getByText('SETUP')).toBeInTheDocument()
    expect(screen.getByText('SETUP REQUIRED')).toBeInTheDocument()
    expect(screen.getByText('Live Futures configuration was not accepted — complete the reviewed launch profile, then restart.'))
      .toBeInTheDocument()
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument()
  })

  it('shows pre-existing external orders with complete active-order fields', () => {
    renderTicket({
      state: createState({
        portfolio: { ...hedgePortfolio, openOrders: [externalOrder] },
      }),
    })
    fireEvent.click(screen.getByRole('tab', { name: /^Orders 1$/ }))
    const orders = screen.getByLabelText('Current Futures orders')
    expect(orders).toHaveTextContent('1 active')
    expect(orders).not.toHaveTextContent('app-owned')
    expect(orders).toHaveTextContent('BTCUSDTSELL · LONGPARTIALLY_FILLED')
    expect(orders).toHaveTextContent('TypeLIMIT')
    expect(orders).toHaveTextContent('Price7000')
    expect(orders).toHaveTextContent('Original qty0.002')
    expect(orders).toHaveTextContent('Filled qty0.001')
    expect(screen.getByRole('button', { name: 'Refresh positions and orders' })).toBeEnabled()
  })

  it('shows only the selected symbol inventory without filtering external ownership', () => {
    renderTicket({
      state: createState({
        portfolio: {
          ...hedgePortfolio,
          openOrders: [
            externalOrder,
            {
              ...externalOrder,
              symbol: 'ETHUSDT',
              orderId: '987654321',
              clientOrderId: 'external-eth-order',
            },
          ],
        },
      }),
    })
    fireEvent.click(screen.getByRole('tab', { name: /^Orders 1$/ }))
    expect(screen.getByLabelText('Current Futures orders')).toHaveTextContent('BTCUSDT')
    expect(screen.getByLabelText('Current Futures orders')).not.toHaveTextContent('ETHUSDT')
  })

  it('retains last confirmed active orders while the private stream resynchronizes', () => {
    renderTicket({
      state: createState({
        portfolio: {
          ...hedgePortfolio,
          syncState: 'resyncing',
          syncCode: 'FUTURES_PRODUCTION_USER_STREAM_RECONNECTING',
          openOrders: [externalOrder],
        },
      }),
    })
    fireEvent.click(screen.getByRole('tab', { name: /^Orders 1$/ }))
    expect(screen.getByText('Active orders are resyncing; last confirmed rows are retained.'))
      .toBeInTheDocument()
    expect(screen.getByLabelText('Current Futures orders')).toHaveTextContent(
      'BTCUSDTSELL · LONGPARTIALLY_FILLED',
    )
  })

  it('does not expose manual order confirmation controls for a server order intent', () => {
    const handlers = callbacks()
    renderTicket({ state: createState({ revision: '2', intent: createIntent('order') }), handlers })
    expect(screen.queryByText(/Type exactly: PLACE REAL FUTURES ORDER/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Place real futures order' })).not.toBeInTheDocument()
    expect(handlers.onPlaceOrder).not.toHaveBeenCalled()
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
            marginType: 'ISOLATED',
            leverage: 2,
            isolatedMarginUsdt: '35',
            unrealizedPnlUsdt: '2.5',
            liquidationPrice: '50000',
          }],
        },
      }),
      onPrepareMarginAdjustment,
    })
    fireEvent.click(screen.getByRole('tab', { name: /^Positions 1$/ }))
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

  it('does not offer isolated-margin mutations for a cross-margin position', () => {
    renderTicket({
      state: createState({
        capabilities: { ...createState().capabilities, adjustMargin: true },
        portfolio: {
          ...hedgePortfolio,
          positions: [{
            ...hedgePortfolio.positions[0],
            marginType: 'CROSSED',
            leverage: 20,
            isolatedMarginUsdt: '0',
          }],
        },
      }),
    })
    fireEvent.click(screen.getByRole('tab', { name: /^Positions 1$/ }))
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reduce margin' })).toBeDisabled()
    expect(screen.getByLabelText('Hedge positions')).toHaveTextContent('CROSSED · 20×')
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
            marginType: 'ISOLATED', leverage: 2,
            isolatedMarginUsdt: '35', unrealizedPnlUsdt: '2.5', liquidationPrice: '50000',
          }],
        },
      }),
      onAdjustMargin,
    })
    fireEvent.click(screen.getByRole('tab', { name: /^Positions 1$/ }))
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
