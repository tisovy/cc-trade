import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesTradingTicket from './FuturesTradingTicket.jsx'

const contract = Object.freeze({
  symbol: 'BTCUSDT',
  tradable: true,
  filters: Object.freeze({
    price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
    quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
    minimumNotional: '100',
  }),
})

const createState = (overrides = {}) => ({
  connected: true,
  balances: { USDT: { available: '1000', total: '1000' } },
  openOrders: [],
  positions: [],
  lastExecution: null,
  lastError: null,
  placeOrder: vi.fn(() => true),
  cancelOrder: vi.fn(() => true),
  cancelAll: vi.fn(() => true),
  closePosition: vi.fn(() => true),
  refresh: vi.fn(() => true),
  ...overrides,
})

describe('FuturesTradingTicket', () => {
  it('reaches READY with a tradable contract and synced balances', () => {
    render(
      <FuturesTradingTicket
        state={createState()}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    expect(screen.getByText('READY')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeEnabled()
  })

  it('shows fail-closed reasons while state is incomplete', () => {
    const { rerender } = render(
      <FuturesTradingTicket state={createState({ connected: false })} selectedSymbol="BTCUSDT" />,
    )
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()

    rerender(
      <FuturesTradingTicket state={createState()} selectedSymbol="BTCUSDT" selectedContract={null} />,
    )
    expect(screen.getByText('CONTRACT')).toBeInTheDocument()

    rerender(
      <FuturesTradingTicket
        state={createState({ balances: null })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )
    expect(screen.getByText('SYNC')).toBeInTheDocument()
  })

  it('places a limit order immediately for a chart gesture with exact rounding', () => {
    const state = createState()
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={{
          id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.03',
        }}
      />,
    )
    expect(state.placeOrder).toHaveBeenCalledOnce()
    const order = state.placeOrder.mock.calls[0][0]
    expect(order).toMatchObject({ symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT' })
    expect(order.price).toBe('58445')
    expect(Number(order.quantity)).toBeGreaterThan(0)
    expect(order.reduceOnly).toBeUndefined()
  })

  it('marks exit gestures reduce-only and handles the same gesture only once', () => {
    const state = createState()
    const gesture = {
      id: 7, side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', price: '58445.0',
    }
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    expect(state.placeOrder).toHaveBeenCalledOnce()
    expect(state.placeOrder.mock.calls[0][0]).toMatchObject({ reduceOnly: true, side: 'SELL' })
  })

  it('refuses gestures when the notional cannot satisfy exchange filters', () => {
    const state = createState({ balances: { USDT: { available: '10', total: '10' } } })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={{
          id: 3, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
        }}
      />,
    )
    // 25% of 10 USDT is far below the 100 USDT minimum notional.
    expect(state.placeOrder).not.toHaveBeenCalled()
  })

  it('lists open orders with cancel and cancel-all controls', () => {
    const state = createState({
      openOrders: [{
        symbol: 'BTCUSDT', orderId: 11, side: 'BUY', positionSide: 'LONG',
        type: 'LIMIT', status: 'NEW', price: '58445.00', origQty: '0.004', z: '0',
      }],
    })
    render(
      <FuturesTradingTicket state={state} selectedSymbol="BTCUSDT" selectedContract={contract} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }))
    const panel = screen.getByLabelText('Current Futures orders')
    expect(panel).toHaveTextContent('BUY · LONG')
    expect(panel).toHaveTextContent('58445.00')

    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(state.cancelOrder).toHaveBeenCalledWith({ symbol: 'BTCUSDT', orderId: 11 })

    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel all BTCUSDT' }))
    expect(state.cancelAll).toHaveBeenCalledWith('BTCUSDT')
  })

  it('lists positions with a market close control', () => {
    const position = {
      symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.010', entryPrice: '57000',
      markPrice: '58445', unrealizedPnl: '14.45', liquidationPrice: '29000',
      leverage: '2', marginType: 'ISOLATED',
    }
    const state = createState({ positions: [position] })
    render(
      <FuturesTradingTicket state={state} selectedSymbol="BTCUSDT" selectedContract={contract} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Positions/ }))
    const panel = screen.getByLabelText('Open positions')
    expect(panel).toHaveTextContent('LONG')

    fireEvent.click(within(panel).getByRole('button', { name: 'Close (market)' }))
    expect(state.closePosition).toHaveBeenCalledWith(position)
  })

  it('shows PAUSED, blocks gestures, and toggles the pause state', () => {
    const state = createState({ tradingPaused: true, setTradingPaused: vi.fn(() => true) })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={{
          id: 9, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
        }}
      />,
    )
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
    expect(state.placeOrder).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Resume trading' }))
    expect(state.setTradingPaused).toHaveBeenCalledWith(false)
  })

  it('skips drag amendments while paused instead of cancelling half-way', () => {
    const state = createState({
      tradingPaused: true,
      openOrders: [{
        symbol: 'BTCUSDT', orderId: 11, side: 'BUY', positionSide: 'LONG',
        type: 'LIMIT', status: 'NEW', price: '58445.00', origQty: '0.004', z: '0',
        clientOrderId: 'abc',
      }],
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        orderAmendRequest={{ id: 4, clientOrderId: 'abc', price: '58500.0' }}
      />,
    )
    expect(state.cancelOrder).not.toHaveBeenCalled()
    expect(state.placeOrder).not.toHaveBeenCalled()
  })

  it('surfaces backend rejections', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          lastError: { code: 'FUTURES_API_ERROR', message: 'Margin is insufficient.' },
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )
    expect(screen.getByLabelText('Futures command rejection'))
      .toHaveTextContent('Margin is insufficient.')
  })
})
