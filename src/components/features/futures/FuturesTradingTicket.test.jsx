import { readFileSync } from 'node:fs'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
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

const tutContract = Object.freeze({
  symbol: 'TUTUSDT',
  tradable: true,
  filters: Object.freeze({
    price: Object.freeze({ min: '0.0000100', max: '200', tickSize: '0.0000100' }),
    quantity: Object.freeze({ min: '1', max: '40000000', stepSize: '1' }),
    minimumNotional: '5',
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
  modifyOrder: vi.fn(() => true),
  cancelOrder: vi.fn(() => true),
  cancelAll: vi.fn(() => true),
  closePosition: vi.fn(() => true),
  refresh: vi.fn(() => true),
  ...overrides,
})

// Sizing starts at zero, so a test that wants a submittable draft must size it
// the way an operator does.
const sizeTo = (percent) => {
  fireEvent.change(
    screen.getByRole('slider', { name: 'Order size percent' }),
    { target: { value: String(percent) } },
  )
}

// A gesture only stages an order: nothing reaches the exchange until the
// operator confirms what it does to the position.
const confirmStagedOrder = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Send · Enter' }))
}

describe('FuturesTradingTicket', () => {
  it('keeps the ready order controls without routine status or redundant chrome', () => {
    render(
      <FuturesTradingTicket
        state={createState()}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeEnabled()
    sizeTo(25)
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeEnabled()
    expect(screen.queryByText('READY')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pause trading|Resume trading/ }))
      .not.toBeInTheDocument()
    expect(screen.queryByLabelText('Order size anchors')).not.toBeInTheDocument()
    expect(screen.queryByText('Quantity')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Futures mouse shortcuts')).not.toBeInTheDocument()
    expect(screen.queryByText('Awaiting shortcut')).not.toBeInTheDocument()
  })

  it('shows one emphasized notional readout and sizes confirmation at 8.5 percent', () => {
    const state = createState({
      balances: { USDT: { available: '2000', total: '2000' } },
    })
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    const slider = screen.getByRole('slider', { name: 'Order size percent' })
    expect(slider).toHaveAttribute('step', '0.5')

    sizeTo(8.5)
    expect(slider).toHaveValue('8.5')
    expect(within(slider.closest('label')).queryByText(/USDT/)).not.toBeInTheDocument()
    const notionalLabel = screen.getByText('Notional, USDT').parentElement
    expect(notionalLabel).toHaveClass('futures-production-notional-label')
    expect(notionalLabel).toHaveTextContent('Notional, USDT8.5%')
    expect(screen.getByRole('status', { name: 'Size 8.5' })).toHaveTextContent('8.5%')
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' }))
      .toHaveClass('futures-production-notional-input')
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('170')

    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 85,
          side: 'BUY',
          positionSide: 'LONG',
          positionEffect: 'ENTRY',
          price: '58445.03',
        }}
      />,
    )
    expect(within(screen.getByRole('alertdialog')).getByTitle('0.002 contracts'))
      .toBeInTheDocument()
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderType: 'LIMIT',
      price: '58445',
      quantity: '0.002',
    })
  })

  // Nothing on the desk stated the multiple an entry is taken at, and the margin
  // it costs is the notional divided by it — at 20× a 250 USDT position holds
  // 12.50, which is the number an operator sizes against.
  it('states the leverage of the contract and what an entry costs in margin', () => {
    const onLeverageEdit = vi.fn()
    const { rerender } = render(
      <FuturesTradingTicket
        state={createState()}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        leverage={20}
        onLeverageEdit={onLeverageEdit}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    expect(screen.getByTitle('Notional ÷ 20× leverage')).toBeInTheDocument()
    expect(screen.getByText('11.69 USDT')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set BTCUSDT leverage' }))
    expect(onLeverageEdit).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }))

    // A leverage the exchange has not reported yet is absent, never 1×; the margin
    // reading then states the whole notional, which overstates the cost rather
    // than understating it.
    rerender(
      <FuturesTradingTicket
        state={createState()}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        leverage={null}
        onLeverageEdit={onLeverageEdit}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    expect(screen.getByRole('button', { name: 'Set BTCUSDT leverage' })).toHaveTextContent('Lev')
    expect(screen.getByText('233.78 USDT')).toBeInTheDocument()
  })

  it('starts unsized so a gesture cannot fire a size the operator never chose', () => {
    const state = createState()
    const { container, rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toHaveValue('0')
    expect(screen.getByRole('status', { name: 'Size 0' })).toHaveTextContent('0%')
    expect(screen.queryByRole('button', { name: '0%' })).not.toBeInTheDocument()
    expect(container.querySelector('.futures-production-draft-reason')).toBeNull()
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SHORT entry' })).toBeDisabled()

    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={{
          id: 42, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
        }}
      />,
    )
    expect(state.placeOrder).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Futures gesture feedback'))
      .toHaveTextContent('Order size is 0 — choose a size first.')
  })

  it('describes invalid positive draft input without blaming Binance filters', () => {
    render(
      <FuturesTradingTicket
        state={createState()}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="not-a-price"
      />,
    )
    sizeTo(25)

    expect(screen.getByText('Enter a valid limit price and order size')).toBeInTheDocument()
    expect(screen.queryByText('Price or Binance symbol filters are unavailable'))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeDisabled()
  })

  it('values a position size request at the price the operator is working at', () => {
    const state = createState()
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        sizeRequest={{ id: 1, quantity: 0.004 }}
      />,
    )
    // 0.004 × 58445 is 233.78 USDT, floored to whole USDT.
    expect(screen.getByLabelText('Order notional USDT')).toHaveValue('233')
  })

  it('refuses a position size request while no price is picked', () => {
    const state = createState()
    const { rerender } = render(
      <FuturesTradingTicket state={state} selectedSymbol="BTCUSDT" selectedContract={contract} />,
    )
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        sizeRequest={{ id: 1, quantity: 0.004 }}
      />,
    )
    expect(screen.getByLabelText('Futures gesture feedback')).toHaveTextContent('Pick a price first')
  })

  it('drops a size chosen for the previous contract when the symbol changes', () => {
    const state = createState()
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(50)
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toHaveValue('50')

    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="TUTUSDT"
        selectedContract={tutContract}
        draftPrice="0.0250000"
      />,
    )
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toHaveValue('0')
  })

  it('keeps decision context and colours direction without a readiness header', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          balances: {
            USDT: { available: '245228.33961912', total: '249728.33961912' },
          },
          openOrders: [
            { symbol: 'BTCUSDT', orderId: 1, side: 'BUY', price: '58445.0', origQty: '2' },
            // Reduce-only exits hold no margin at the exchange, but they are
            // orders on the operator's list and so are in the total.
            {
              symbol: 'ETHUSDT',
              orderId: 2,
              side: 'SELL',
              price: '2500.5',
              origQty: '12',
              reduceOnly: true,
            },
          ],
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    expect(screen.queryByText('READY')).not.toBeInTheDocument()
    expect(screen.queryByText('orders submit immediately')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause trading' })).not.toBeInTheDocument()

    const actions = screen.getByLabelText('Manual Futures orders')
    expect(within(actions).getByRole('button', { name: 'LONG entry' })).toHaveClass('is-long', 'is-entry')
    expect(within(actions).getByRole('button', { name: 'SHORT entry' })).toHaveClass('is-short', 'is-entry')

    // Funds read whole: at six figures the cents cost a glance and change
    // nothing. The exact value the exchange sent stays on the cell's title.
    const available = screen.getByText('Available').closest('div')
    expect(within(available).getByText('245228 USDT')).toBeInTheDocument()
    expect(within(available).getByText('245228 USDT'))
      .toHaveAttribute('title', '245228.33961912')

    // What the resting orders come to, summed the way the operator sums the
    // list: 2 × 58445 plus 12 × 2500.5. Not the exchange's order margin, which
    // is a fraction of this at leverage and nothing for the reduce-only leg.
    const onOrder = screen.getByText('On order').closest('div')
    expect(within(onOrder).getByText('146896 USDT')).toBeInTheDocument()
    expect(within(onOrder).getByText('146896 USDT'))
      .toHaveAttribute('title', '146896.00 USDT across 2 working orders')
  })

  it('states an empty order list as zero and an unsynchronized one as absent', () => {
    const { rerender } = render(
      <FuturesTradingTicket
        state={createState({ openOrders: [] })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    // Nothing resting is a reading, not a gap.
    expect(within(screen.getByText('On order').closest('div')).getByText('0 USDT'))
      .toBeInTheDocument()

    rerender(
      <FuturesTradingTicket
        state={createState({
          openOrders: [],
          accountResources: {
            regularOrders: { status: 'error', lastSuccessfulAt: null, data: null, error: 'x' },
          },
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    // A list that has never synchronized cannot be totalled: an empty one and
    // an unread one would otherwise both read as zero.
    expect(within(screen.getByText('On order').closest('div')).getByText('—')).toBeInTheDocument()
  })

  it('totals orders the exchange prices at a trigger rather than a limit', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          openOrders: [
            {
              symbol: 'BTCUSDT',
              orderId: 7,
              side: 'SELL',
              orderKind: 'ALGO',
              price: '0',
              triggerPrice: '60000',
              origQty: '0.5',
            },
          ],
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    expect(within(screen.getByText('On order').closest('div')).getByText('30000 USDT'))
      .toBeInTheDocument()
  })

  // The working-orders list is one of the three surfaces that drew a fired stop
  // as an order resting at its trigger. It is the list the operator scans for
  // what is still on the book.
  it('states a fired algo in the working-orders list instead of listing it as working', () => {
    const onOrderEdit = vi.fn()
    render(
      <FuturesTradingTicket
        state={createState({
          openOrders: [
            {
              symbol: 'BTCUSDT',
              orderId: 7,
              side: 'SELL',
              orderKind: 'ALGO',
              algoType: 'CONDITIONAL',
              price: '0',
              triggerPrice: '60000',
              origQty: '0.5',
              actualOrderId: '990281234',
              actualPrice: '59980.1',
            },
          ],
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        onOrderEdit={onOrderEdit}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }))
    const row = screen.getByRole('table', { name: 'Working orders' })
      .querySelector('.futures-production-order-row')

    expect(row).toHaveClass('is-triggered')
    expect(row).toHaveTextContent('FIRED')
    expect(row).not.toHaveTextContent('60000')
    expect(row).toHaveTextContent('59980.1')
    expect(within(row).getByTitle(/no longer working, so it cannot be moved or cancelled/))
      .toBeInTheDocument()

    // The editor never opened on an algo row and must not start now.
    fireEvent.doubleClick(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onOrderEdit).not.toHaveBeenCalled()
    expect(row).not.toHaveAttribute('tabindex')
    expect(row).not.toHaveAttribute('aria-label')
  })

  it('keeps sizing and reduce-only exits usable while the local entry cap is exceeded', () => {
    render(
      <FuturesTradingTicket
        state={createState({ maxOrderNotionalUsdt: '200' })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )

    // 25% of the 1000 USDT balance is 250 USDT, over the 200 USDT cap.
    sizeTo(25)
    expect(screen.getByText('Order notional exceeds the local 200 USDT limit.'))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SHORT entry' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'LONG exit' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'SHORT exit' })).toBeEnabled()

    const slider = screen.getByRole('slider', { name: 'Order size percent' })
    expect(slider).toBeEnabled()
    fireEvent.change(slider, { target: { value: '20' } })

    expect(screen.queryByText('Order notional exceeds the local 200 USDT limit.'))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'SHORT entry' })).toBeEnabled()
  })

  it('enables and submits TUTUSDT using its current integer quantity filters', () => {
    const state = createState({
      balances: { USDT: { available: '100', total: '100' } },
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="TUTUSDT"
        selectedContract={tutContract}
        draftPrice="0.0250000"
      />,
    )

    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeEnabled()
    sizeTo(25)
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'LONG entry' }))
    expect(state.placeOrder).toHaveBeenCalledWith({
      symbol: 'TUTUSDT',
      side: 'BUY',
      orderType: 'LIMIT',
      price: '0.025',
      quantity: '1000',
    })
  })

  it('shows contextual fail-closed reasons without restoring status labels', () => {
    const { rerender } = render(
      <FuturesTradingTicket state={createState({ connected: false })} selectedSymbol="BTCUSDT" />,
    )
    expect(screen.getByText('Local backend connection unavailable — reconnect.'))
      .toBeInTheDocument()
    expect(screen.queryByText('OFFLINE')).not.toBeInTheDocument()

    rerender(
      <FuturesTradingTicket state={createState()} selectedSymbol="BTCUSDT" selectedContract={null} />,
    )
    expect(screen.getByText('Select an active USDⓈ-M contract.')).toBeInTheDocument()
    expect(screen.queryByText('CONTRACT')).not.toBeInTheDocument()

    rerender(
      <FuturesTradingTicket
        state={createState()}
        selectedSymbol="BTCUSDT"
        selectedContract={{ symbol: 'BTCUSDT', tradable: true, filters: null }}
        draftPrice="58445.0"
      />,
    )
    expect(screen.getByText('Loading exact Binance price, quantity, and notional filters…'))
      .toBeInTheDocument()

    rerender(
      <FuturesTradingTicket
        state={createState({ balances: null })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeDisabled()
    expect(screen.queryByText('SYNC')).not.toBeInTheDocument()
  })

  it('places a limit order with exact rounding once a chart gesture is confirmed', () => {
    const state = createState()
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    rerender(
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
    expect(state.placeOrder).not.toHaveBeenCalled()
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    const order = state.placeOrder.mock.calls[0][0]
    expect(order).toMatchObject({ symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT' })
    expect(order.price).toBe('58445')
    expect(Number(order.quantity)).toBeGreaterThan(0)
    expect(order.reduceOnly).toBeUndefined()
  })

  it('resizes a staged entry from the confirmation slider before Send', () => {
    const state = createState()
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 201,
          side: 'BUY',
          positionSide: 'LONG',
          positionEffect: 'ENTRY',
          price: '58445.0',
        }}
      />,
    )

    const panel = screen.getByRole('alertdialog')
    const slider = within(panel).getByRole('slider', { name: 'Confirmation order size percent' })
    expect(slider).toHaveAttribute('step', '0.5')
    expect(slider).toHaveValue('25')

    fireEvent.change(slider, { target: { value: '37.5' } })
    expect(within(panel).getByText('375 USDT')).toHaveClass('futures-order-confirm-notional')
    expect(within(panel).getByTitle('0.006 contracts')).toBeInTheDocument()
    expect(state.placeOrder).not.toHaveBeenCalled()

    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderType: 'LIMIT',
      price: '58445',
      quantity: '0.006',
    })
  })

  // The size is one value, not two. Resizing at the cursor used to leave the
  // rail showing whatever the operator had set there earlier — the panel said
  // one amount while the order about to be sent was for another.
  it('carries a confirmation resize back to the rail', () => {
    const state = createState()
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('250')

    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 202,
          side: 'BUY',
          positionSide: 'LONG',
          positionEffect: 'ENTRY',
          price: '58445.0',
        }}
      />,
    )
    fireEvent.change(
      within(screen.getByRole('alertdialog'))
        .getByRole('slider', { name: 'Confirmation order size percent' }),
      { target: { value: '37.5' } },
    )

    // The rail follows, both readings of it: the amount and the share.
    expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toHaveValue('375')
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toHaveValue('37.5')
  })

  it('resizes a staged exit from the matching position before Send', () => {
    const state = createState({
      positions: [{
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        quantity: '10',
        entryPrice: '90',
        markPrice: '100',
      }],
    })
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '100.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 202,
          side: 'SELL',
          positionSide: 'LONG',
          positionEffect: 'EXIT',
          price: '100.0',
        }}
      />,
    )

    const panel = screen.getByRole('alertdialog')
    const slider = within(panel).getByRole('slider', { name: 'Confirmation order size percent' })
    expect(slider).toHaveValue('25')
    fireEvent.change(slider, { target: { value: '50' } })

    expect(within(panel).getByText('500 USDT')).toBeInTheDocument()
    expect(within(panel).getByTitle('5 contracts')).toBeInTheDocument()
    expect(panel).toHaveTextContent('1000 → 500')
    expect(state.placeOrder).not.toHaveBeenCalled()

    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'LIMIT',
      price: '100',
      quantity: '5',
      reduceOnly: true,
    })
  })

  it('disables only the confirmation slider when an exit position is unavailable', () => {
    const state = createState()
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 203,
          side: 'SELL',
          positionSide: 'LONG',
          positionEffect: 'EXIT',
          price: '58445.0',
        }}
      />,
    )

    const panel = screen.getByRole('alertdialog')
    expect(within(panel).getByRole('slider', { name: 'Confirmation order size percent' }))
      .toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Send · Enter' })).toBeEnabled()
    expect(within(panel).getByText('250 USDT')).toBeInTheDocument()
  })

  it('does not resize an exit from a stale position snapshot', () => {
    const position = {
      symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '10', entryPrice: '90', markPrice: '100',
    }
    const state = createState({
      positions: [position],
      accountResources: {
        positions: { status: 'stale', data: [position], lastSuccessfulAt: 100, error: null },
      },
    })
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '100.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 205,
          side: 'SELL',
          positionSide: 'LONG',
          positionEffect: 'EXIT',
          price: '100.0',
        }}
      />,
    )

    const slider = within(screen.getByRole('alertdialog'))
      .getByRole('slider', { name: 'Confirmation order size percent' })
    expect(slider).toBeDisabled()

    rerender(
      <FuturesTradingTicket
        {...props}
        state={{
          ...state,
          accountResources: {
            positions: { status: 'loading', data: [position], lastSuccessfulAt: 100, error: null },
          },
        }}
        gestureRequest={{
          id: 205,
          side: 'SELL',
          positionSide: 'LONG',
          positionEffect: 'EXIT',
          price: '100.0',
        }}
      />,
    )
    expect(slider).toBeEnabled()
  })

  it('blocks Send when the confirmation slider selects an invalid low stop', () => {
    const state = createState({
      positions: [{
        symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.5', entryPrice: '58000', markPrice: '58445',
      }],
    })
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 204,
          side: 'BUY',
          positionSide: 'LONG',
          positionEffect: 'ENTRY',
          price: '58445.0',
        }}
      />,
    )

    const panel = screen.getByRole('alertdialog')
    fireEvent.change(
      within(panel).getByRole('slider', { name: 'Confirmation order size percent' }),
      { target: { value: '0.5' } },
    )

    expect(within(panel).getByText('5 USDT')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Send · Enter' })).toBeDisabled()
    expect(within(panel).getByRole('status')).toHaveTextContent('below the Binance minimum')
    expect(within(panel).getByText('Position').parentElement).toHaveTextContent('Position—')
    expect(panel).not.toHaveTextContent('This does NOT close your LONG')
    expect(state.placeOrder).not.toHaveBeenCalled()
  })

  // The confirmation is the one place where what is read and what is sent must
  // be the same numbers. Confirm used to re-derive the size from the balance,
  // so a refresh landing while the panel was open sent an order the operator
  // had never seen.
  it('sends the staged quantity when the balance grows under an open confirmation', () => {
    const state = createState()
    const gesture = {
      id: 11, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
    }
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(50)
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    const staged = within(screen.getByRole('alertdialog'))
      .getByTitle(/contracts$/)
      .getAttribute('title')
    expect(staged).toBe('0.008 contracts')
    expect(screen.queryByText('Quantity')).not.toBeInTheDocument()
    rerender(
      <FuturesTradingTicket
        state={createState({
          balances: { USDT: { available: '4000', total: '4000' } },
          placeOrder: state.placeOrder,
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    const order = state.placeOrder.mock.calls[0][0]
    expect(staged).toContain(order.quantity)
    // 50% of 1000 USDT, not 50% of the 4000 that arrived while the panel was up.
    expect(Number(order.quantity) * Number(order.price)).toBeLessThan(1000)
  })

  // The staged draft is what Confirm sends, and it names one contract. Leaving
  // it confirmable after the ticket moved to another would send that contract's
  // quantity and price against this one's symbol.
  it('withdraws a staged order when the ticket moves to another contract', () => {
    const state = createState()
    const gesture = {
      id: 13, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
    }
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(50)
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="TUTUSDT"
        selectedContract={tutContract}
        draftPrice="0.0250000"
        gestureRequest={gesture}
      />,
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(state.placeOrder).not.toHaveBeenCalled()
  })

  it('refuses a staged order the balance no longer covers instead of re-sizing it', () => {
    const state = createState()
    const gesture = {
      id: 12, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
    }
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(100)
    rerender(
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
        state={createState({
          balances: { USDT: { available: '200', total: '200' } },
          placeOrder: state.placeOrder,
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    confirmStagedOrder()
    expect(state.placeOrder).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Futures gesture feedback'))
      .toHaveTextContent('was not sent and was not re-sized')
  })

  it('keeps the staged size when the size controls move under the confirmation', () => {
    const state = createState()
    const gesture = {
      id: 13, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
    }
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={gesture}
      />,
    )
    sizeTo(75)
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    const order = state.placeOrder.mock.calls[0][0]
    expect(Number(order.quantity) * Number(order.price)).toBeLessThan(300)
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
      />,
    )
    sizeTo(25)
    rerender(
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
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    expect(state.placeOrder.mock.calls[0][0]).toMatchObject({ reduceOnly: true, side: 'SELL' })
  })

  // Alt+right ("exit LONG") and Ctrl+right ("enter SHORT") are the same SELL, at
  // the same price, for the same size. Only their effect on the position tells
  // them apart, so that is what the confirmation has to lead with.
  it('tells closing a long apart from opening a short on identical SELL gestures', () => {
    const state = createState({
      positions: [{
        symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.5', entryPrice: '58000', markPrice: '58445',
      }],
    })
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)

    rerender(<FuturesTradingTicket
      {...props}
      gestureRequest={{
        id: 1, side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', price: '58445.0',
      }}
    />)
    const exitPanel = screen.getByRole('alertdialog')
    expect(exitPanel).toHaveTextContent('CLOSE LONG')
    expect(within(exitPanel).queryByRole('alert')).not.toBeInTheDocument()

    rerender(<FuturesTradingTicket
      {...props}
      gestureRequest={{
        id: 2, side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)
    const entryPanel = screen.getByRole('alertdialog')
    expect(entryPanel).toHaveTextContent('OPEN SHORT')
    expect(within(entryPanel).getByRole('alert')).toHaveTextContent('does NOT close your LONG')
    expect(state.placeOrder).not.toHaveBeenCalled()
  })

  // The terms an entry is carried at were on no surface the operator's eye
  // passes on the way to Enter: an entry sized in USDT went out at whatever the
  // account was set to. The confirmation is the last place it can be read.
  it('states the leverage the entry will be carried at in the confirmation', () => {
    const state = createState()
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} leverage={20} />)
    sizeTo(25)

    rerender(<FuturesTradingTicket
      {...props}
      leverage={20}
      gestureRequest={{
        id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)
    const panel = screen.getByRole('alertdialog')
    expect(within(panel).getByTitle('This position will be carried at 20× leverage'))
      .toHaveTextContent('20×')
  })

  // The desk stopped refusing a click on a chart that is not live, so the thing
  // it owes the operator instead is the age of the number that click produced —
  // in the last second before the order goes.
  it('confirms a price taken off a non-live surface with its age', () => {
    const state = createState()
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const reading = Object.freeze({
      surface: 'chart',
      surfaceLabel: 'chart',
      state: 'quiet',
      live: false,
      observedAt: Date.now() - 47_000,
    })
    const { rerender } = render(<FuturesTradingTicket {...props} draftPriceReading={reading} />)
    sizeTo(25)
    // Stated on the ticket too, while the operator is still sizing the order.
    expect(document.querySelector('.futures-production-price-age'))
      .toHaveTextContent(/^QUIET chart · 4[67]s old$/)

    rerender(<FuturesTradingTicket
      {...props}
      draftPriceReading={reading}
      gestureRequest={{
        id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0', reading,
      }}
    />)
    const panel = screen.getByRole('alertdialog')
    expect(within(panel).getByText(/^QUIET chart · 4[67]s old$/)).toBeInTheDocument()
  })

  it('states no age for a live reading or for a price the operator typed', () => {
    const state = createState()
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const live = Object.freeze({
      surface: 'order-book',
      surfaceLabel: 'order book',
      state: 'live',
      live: true,
      observedAt: Date.now() - 47_000,
    })
    const { rerender } = render(<FuturesTradingTicket {...props} draftPriceReading={live} />)
    sizeTo(25)
    expect(document.querySelector('.futures-production-price-age')).toBeNull()

    rerender(<FuturesTradingTicket
      {...props}
      draftPriceReading={live}
      gestureRequest={{
        id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0', reading: live,
      }}
    />)
    expect(within(screen.getByRole('alertdialog')).queryByText(/old$/)).not.toBeInTheDocument()

    // A typed price carries no reading at all, and the panel says nothing about
    // an age it has no business claiming to know.
    rerender(<FuturesTradingTicket
      {...props}
      draftPriceReading={null}
      gestureRequest={{
        id: 2, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)
    expect(within(screen.getByRole('alertdialog')).queryByText(/old$/)).not.toBeInTheDocument()
  })

  // A panel left open while the operator thinks about it must not still claim
  // the price is four seconds old a minute later.
  it('counts the age up while the confirmation stays open', () => {
    vi.useFakeTimers()
    try {
      const state = createState()
      const reading = Object.freeze({
        surface: 'chart',
        surfaceLabel: 'chart',
        state: 'stale',
        live: false,
        observedAt: Date.now() - 4_000,
      })
      const props = {
        state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
      }
      const { rerender } = render(<FuturesTradingTicket {...props} />)
      sizeTo(25)
      rerender(<FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0', reading,
        }}
      />)
      const panel = screen.getByRole('alertdialog')
      expect(within(panel).getByText('STALE chart · 4s old')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(30_000) })
      expect(within(panel).getByText('STALE chart · 34s old')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // A multiple nobody reported must not be printed as one: an operator reading
  // "1×" on a contract the exchange holds at 20× is worse off than one reading
  // nothing at all.
  it('states an unreported leverage as unknown in the confirmation', () => {
    const state = createState()
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} leverage={null} />)
    sizeTo(25)

    rerender(<FuturesTradingTicket
      {...props}
      leverage={null}
      gestureRequest={{
        id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)
    const panel = screen.getByRole('alertdialog')
    expect(panel).toHaveTextContent('LEV ?')
    expect(panel).not.toHaveTextContent('1×')
  })

  // A leveraged position is worth more than the balance left over almost by
  // definition, so budgeting the exit would lock the operator out of closing.
  // The same size as an entry stays refused.
  it('lets an exit exceed the free balance while still budgeting an entry', () => {
    const state = createState({
      positions: [{
        symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.5', entryPrice: '58000', markPrice: '58445',
      }],
    })
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Order notional USDT' }),
      { target: { value: '5000' } },
    )

    rerender(<FuturesTradingTicket
      {...props}
      gestureRequest={{
        id: 1, side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', price: '58445.0',
      }}
    />)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('CLOSE LONG')
    confirmStagedOrder()
    expect(state.placeOrder.mock.calls[0][0]).toMatchObject({ reduceOnly: true, side: 'SELL' })

    rerender(<FuturesTradingTicket
      {...props}
      gestureRequest={{
        id: 2, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Futures gesture feedback'))
      .toHaveTextContent('exceeds the confirmed available USDT balance')
  })

  it('cancels a staged order on Escape without adding a passive status banner', () => {
    const state = createState()
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(<FuturesTradingTicket
      {...props}
      gestureRequest={{
        id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(state.placeOrder).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Futures gesture feedback')).not.toBeInTheDocument()
  })

  it('cancels a staged order when the operator clicks outside the panel', () => {
    const state = createState()
    const props = {
      state, selectedSymbol: 'BTCUSDT', selectedContract: contract, draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(<FuturesTradingTicket
      {...props}
      gestureRequest={{
        id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
      }}
    />)

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(state.placeOrder).not.toHaveBeenCalled()
  })

  // A gesture whose order could never be sent is refused outright: staging it
  // would put a panel in front of the operator that only fails on confirmation.
  it('refuses gestures when the notional cannot satisfy exchange filters', () => {
    const state = createState({ balances: { USDT: { available: '10', total: '10' } } })
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(100)
    rerender(
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
    // The whole 10 USDT balance is still far below the 100 USDT minimum notional.
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
    const orderRow = panel.querySelector('.futures-production-order-row')
    expect(panel).toHaveTextContent('LONG')
    expect(panel).toHaveTextContent('234')
    expect(panel).toHaveTextContent('58445.0')
    expect(orderRow).not.toHaveAttribute('tabindex')
    expect(orderRow).not.toHaveAttribute('aria-label')
    expect(orderRow).not.toHaveClass('is-editable')

    fireEvent.click(within(panel).getByRole('button', {
      name: 'Cancel BTCUSDT BUY order at 58445.00',
    }))
    expect(state.cancelOrder).toHaveBeenCalledWith({ symbol: 'BTCUSDT', orderId: 11 })

    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel all BTCUSDT' }))
    expect(state.cancelAll).toHaveBeenCalledWith('BTCUSDT')
  })

  it('names the order columns once instead of repeating the unit on every row', () => {
    const state = createState({
      openOrders: [{
        symbol: 'GRVTUSDT', orderId: 21, side: 'BUY', positionSide: 'LONG',
        type: 'LIMIT', status: 'NEW', price: '0.0148410', origQty: '740000', z: '0',
      }],
    })
    render(
      <FuturesTradingTicket state={state} selectedSymbol="BTCUSDT" selectedContract={contract} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }))
    const panel = screen.getByLabelText('Current Futures orders')

    expect(within(panel).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Symbol', 'Side', 'Price', 'USDT', ''])
    // The unit is stated by the column, so no row carries it and none of them
    // has to give up its width to it.
    expect(panel).not.toHaveTextContent('10982 USDT')
    expect(within(panel).getByText('10982')).toBeInTheDocument()

    // The quote half of the name is the same on every contract this desk
    // trades, and the exchange's padding is not precision the contract quotes.
    expect(within(panel).getByText('GRVT')).toHaveAttribute('title', 'GRVTUSDT')
    expect(within(panel).getByText('0.014841')).toBeInTheDocument()
  })

  it('uses each order contract tick and keeps stop limit and trigger prices distinct', () => {
    const state = createState({
      openOrders: [
        {
          symbol: 'GRVTUSDT', orderId: 21, side: 'BUY', positionSide: 'LONG',
          type: 'LIMIT', status: 'NEW', price: '0.01480', origQty: '740000', z: '0',
        },
        {
          symbol: 'BTCUSDT', orderId: 22, side: 'SELL', positionSide: 'LONG',
          type: 'STOP', status: 'NEW', price: '57900', triggerPrice: '58000',
          origQty: '0.5', z: '0',
        },
        {
          symbol: 'BTCUSDT', orderId: 23, side: 'SELL', positionSide: 'LONG',
          type: 'STOP_MARKET', status: 'NEW', price: '0', triggerPrice: '58000',
          origQty: '0.5', z: '0',
        },
      ],
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        tickSizes={{ GRVTUSDT: '0.0000100', BTCUSDT: '0.1' }}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }))
    const panel = screen.getByLabelText('Current Futures orders')

    expect(within(panel).getByText('0.01480')).toBeInTheDocument()
    expect(within(panel).getByTitle('57900.0 · activates at 58000.0'))
      .toHaveTextContent('57900.0')
    expect(within(panel).getByTitle('58000.0')).toHaveTextContent('58000.0')
    expect(within(panel).getByText('28950')).toBeInTheDocument()
    expect(within(panel).getByText('29000')).toBeInTheDocument()
  })

  it('switches from an explicit order-symbol control and keeps a small price whole', () => {
    const onSymbolChange = vi.fn()
    const onOrderEdit = vi.fn()
    const state = createState({
      openOrders: [{
        symbol: 'TUTUSDT', orderId: 31, side: 'BUY', positionSide: 'LONG',
        type: 'LIMIT', status: 'NEW', price: '0.000123', origQty: '5000', z: '0',
      }],
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        onSymbolChange={onSymbolChange}
        onOrderEdit={onOrderEdit}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }))
    const panel = screen.getByLabelText('Current Futures orders')
    const symbol = within(panel).getByRole('button', { name: 'Show TUTUSDT' })

    expect(symbol).toHaveTextContent('TUT')
    expect(symbol).toHaveAttribute('title', 'TUTUSDT')
    expect(within(panel).getByText('0.000123').closest('[role="cell"]')).toHaveAttribute(
      'title',
      '0.000123',
    )

    fireEvent.click(symbol, { detail: 1 })
    expect(onSymbolChange).toHaveBeenCalledExactlyOnceWith('TUTUSDT')
    expect(onOrderEdit).not.toHaveBeenCalled()

    onSymbolChange.mockClear()
    // A native button's keyboard activation arrives at React as a click with
    // detail 0; the same handler must select without falling through to edit.
    fireEvent.click(symbol, { detail: 0 })
    expect(onSymbolChange).toHaveBeenCalledExactlyOnceWith('TUTUSDT')
    fireEvent.doubleClick(symbol)
    expect(onOrderEdit).not.toHaveBeenCalled()

    const stylesheet = readFileSync(
      'src/components/features/futures/FuturesProductionExecutionTicket.css',
      'utf8',
    )
    const rowTracks = stylesheet.match(
      /\.futures-production-order-head,\s*\.futures-production-order-row\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations
    expect(rowTracks).toContain('minmax(68px, 1.35fr)')
    expect(rowTracks).toContain('gap: 4px;')
  })

  it('opens the order editor once from Enter and Space at the row centre', () => {
    const onOrderEdit = vi.fn()
    const workingOrder = {
      symbol: 'BTCUSDT', orderId: 11, side: 'BUY', positionSide: 'BOTH',
      type: 'LIMIT', status: 'NEW', price: '58445.00', origQty: '0.004', z: '0',
    }
    const state = createState({ openOrders: [workingOrder] })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        onOrderEdit={onOrderEdit}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }))
    const row = screen.getByRole('row', {
      name: 'Edit BTCUSDT BUY order at 58445.00',
    })
    expect(row).toHaveAttribute('tabindex', '0')
    expect(row).toHaveClass('is-editable')
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 100,
      width: 180,
      height: 40,
      right: 200,
      bottom: 140,
      x: 20,
      y: 100,
      toJSON: () => ({}),
    })

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(workingOrder, { x: 110, y: 120 })

    onOrderEdit.mockClear()
    const space = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, space)
    expect(space.defaultPrevented).toBe(true)
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(workingOrder, { x: 110, y: 120 })

    onOrderEdit.mockClear()
    fireEvent.keyDown(row, { key: 'Enter', repeat: true })
    const repeatedSpace = createEvent.keyDown(row, { key: ' ', repeat: true })
    fireEvent(row, repeatedSpace)
    expect(repeatedSpace.defaultPrevented).toBe(true)
    expect(onOrderEdit).not.toHaveBeenCalled()

    fireEvent.keyDown(row, { key: 'Escape' })
    fireEvent.keyDown(within(row).getByRole('button', {
      name: 'Cancel BTCUSDT BUY order at 58445.00',
    }), { key: 'Enter' })
    expect(onOrderEdit).not.toHaveBeenCalled()
    expect(state.cancelOrder).not.toHaveBeenCalled()
  })

  it('preserves the order object and pointer coordinates on ticket double-click', () => {
    const onOrderEdit = vi.fn()
    const workingOrder = {
      symbol: 'BTCUSDT', orderId: 11, side: 'BUY', positionSide: 'BOTH',
      type: 'LIMIT', status: 'NEW', price: '58445.00', origQty: '0.004', z: '0',
    }
    const state = createState({
      openOrders: [workingOrder],
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        onOrderEdit={onOrderEdit}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Orders/ }))
    fireEvent.doubleClick(screen.getByText('58445.0'), { clientX: 120, clientY: 240 })
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(
      workingOrder,
      { x: 120, y: 240 },
    )
  })

  it('lists positions and opens the close panel', () => {
    const position = {
      symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.010', entryPrice: '57000',
      markPrice: '58445', unrealizedPnl: '14.45', liquidationPrice: '29000',
      leverage: '2', marginType: 'ISOLATED',
    }
    const state = createState({ positions: [position] })
    const onPositionClose = vi.fn()
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        onPositionClose={onPositionClose}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Positions/ }))
    const panel = screen.getByLabelText('Open positions')
    expect(panel).toHaveTextContent('LONG')
    // The liquidation price is a function of the margin, so the card that
    // states one states the other — and names the mode, since only an isolated
    // margin can be moved at all.
    expect(panel).toHaveTextContent('Margin')
    expect(panel).toHaveTextContent('285.00')
    expect(panel).toHaveTextContent('ISO')
    // /fapi/v3/positionRisk reports no leverage, so the dead cell that printed
    // one stays gone rather than showing a placeholder.
    expect(panel).not.toHaveTextContent('2×')

    fireEvent.click(within(panel).getByRole('button', { name: 'Close position' }))
    expect(onPositionClose).toHaveBeenCalledWith(position, expect.any(Object))
  })

  it('keeps backend pause enforcement without rendering a pause control', () => {
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
    expect(screen.getByText('Trading is paused — new orders are blocked until you resume.'))
      .toBeInTheDocument()
    expect(screen.queryByText('PAUSED')).not.toBeInTheDocument()
    expect(state.placeOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Resume trading' })).not.toBeInTheDocument()
    expect(state.setTradingPaused).not.toHaveBeenCalled()
  })

  // A drag no longer amends anything: it cancels the order and places its
  // replacement, so the ceiling, the reduce-only exemption and the paused-desk
  // refusal are proved where they now live — `useFuturesOrderDrag.test.js`.

  it('submits a confirmed gesture without adding a passive success banner', () => {
    const state = createState()
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={{
          id: 1, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
        }}
      />,
    )
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Futures gesture feedback')).not.toBeInTheDocument()
  })

  it('keeps a locally unsent order visible after removing passive success feedback', () => {
    const state = createState({ placeOrder: vi.fn(() => false) })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    fireEvent.click(screen.getByRole('button', { name: 'LONG entry' }))
    expect(screen.getByLabelText('Futures gesture feedback')).toHaveTextContent('LONG entry NOT sent')
    expect(screen.getByLabelText('Futures gesture feedback')).toHaveTextContent('reconnect')
  })

  it('explains why a gesture was ignored instead of dropping it silently', () => {
    const state = createState({ balances: null })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
        gestureRequest={{
          id: 2, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.0',
        }}
      />,
    )
    expect(state.placeOrder).not.toHaveBeenCalled()
    const feedback = screen.getByLabelText('Futures gesture feedback')
    expect(feedback).toHaveTextContent('LONG entry NOT sent')
    expect(feedback).toHaveTextContent('Loading Futures account state')
  })

  // The desk re-reads the account, and the read marks the balance `loading`
  // while it runs. Blanking the size and refusing the order for that window
  // made the sizing panel flash and the next order bounce every time the
  // operator traded — for a balance the desk was holding the whole time.
  it('keeps sizing and sends the order while the balance is being read again', () => {
    const state = createState({
      accountResources: {
        balances: {
          status: 'loading',
          data: { USDT: { available: '1000', total: '1000' } },
          lastSuccessfulAt: 1_000,
          error: null,
        },
      },
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(25)
    fireEvent.click(screen.getByRole('button', { name: 'LONG entry' }))

    expect(state.placeOrder).toHaveBeenCalledOnce()
    expect(screen.queryByText(/Loading Futures account state/)).not.toBeInTheDocument()
  })

  it('explains gestures blocked by exchange filters', () => {
    const state = createState({ balances: { USDT: { available: '10', total: '10' } } })
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    sizeTo(100)
    rerender(
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
    expect(state.placeOrder).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Futures gesture feedback'))
      .toHaveTextContent('Size is below the Binance minimum')
  })

  it('does not render a passive last-execution acknowledgement', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          lastExecution: {
            symbol: 'BTCUSDT', side: 'BUY', status: 'NEW', type: 'LIMIT',
            origQty: '0.004', price: '58445.00',
          },
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )
    expect(screen.queryByLabelText('Last Futures execution')).not.toBeInTheDocument()
  })

  // The price band is Binance's filter, not the desk's. A local copy of it is
  // one more thing to keep in sync for a refusal the exchange states better.
  it('submits a price below the contract band and shows Binance refusing it', () => {
    const bandContract = {
      ...contract,
      filters: {
        price: { min: '1000', max: '1000000', tickSize: '0.1' },
        quantity: { min: '0.001', max: '1000', stepSize: '0.001' },
        minimumNotional: '100',
      },
    }
    const state = createState()
    const { rerender } = render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={bandContract}
        draftPrice="500.0"
      />,
    )
    sizeTo(25)
    expect(screen.getByRole('button', { name: 'LONG entry' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'LONG entry' }))
    expect(state.placeOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ price: '500' }),
    )

    rerender(
      <FuturesTradingTicket
        state={{
          ...state,
          lastError: {
            code: 'FUTURES_API_ERROR',
            message: 'Binance rejected the order: Limit price cannot be lower than 1000 (-4024).',
          },
        }}
        selectedSymbol="BTCUSDT"
        selectedContract={bandContract}
        draftPrice="500.0"
      />,
    )
    const rejection = screen.getByLabelText('Futures command rejection')
    expect(rejection).toHaveTextContent('-4024')
    expect(rejection).toHaveTextContent('cannot be lower than 1000')
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

  it('states an unconfirmed outcome without offering a retry', () => {
    // Retrying an order that may already be live is exactly how a second real
    // order gets created, so this card carries no control at all.
    render(
      <FuturesTradingTicket
        state={createState({
          unresolvedCommand: {
            code: 'FUTURES_OUTCOME_UNKNOWN',
            message: 'Binance could not confirm whether this order exists.',
            details: { marketType: 'futures' },
          },
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )

    const card = screen.getByLabelText('Futures command outcome unconfirmed')
    expect(card).toHaveTextContent('FUTURES_OUTCOME_UNKNOWN')
    expect(card).toHaveTextContent('could not confirm')
    expect(card.querySelector('button')).toBeNull()
    expect(card).toHaveAttribute('role', 'alert')
  })

  it('lets an unconfirmed outcome outrank a stale account failure', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          unresolvedCommand: {
            code: 'FUTURES_OUTCOME_PENDING',
            message: 'Binance did not confirm this order either way.',
            details: { marketType: 'futures' },
          },
          lastError: { code: 'FUTURES_API_ERROR', message: 'Margin is insufficient.' },
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )

    // Both are facts about different commands — the unknown outcome is read
    // first, and the rejection is not hidden behind it.
    const unconfirmed = screen.getByLabelText('Futures command outcome unconfirmed')
    const rejection = screen.getByLabelText('Futures command rejection')
    expect(unconfirmed.compareDocumentPosition(rejection))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  // A background synchronization failure is not an answer about the order the
  // operator just sent, and used to displace it entirely.
  it('shows a command rejection with its exchange code beside an account failure', () => {
    const state = createState({
      accountResources: {
        balances: {
          status: 'error',
          data: null,
          lastSuccessfulAt: 100,
          error: { code: 'BALANCE_READ_FAILED', message: 'Balance read failed.' },
        },
      },
      lastError: {
        code: 'FUTURES_API_ERROR',
        message: 'Margin is insufficient.',
        details: { marketType: 'futures', binanceCode: -2019 },
      },
    })
    render(
      <FuturesTradingTicket
        state={state}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )

    const rejection = screen.getByLabelText('Futures command rejection')
    expect(rejection).toHaveTextContent('Margin is insufficient.')
    expect(rejection).toHaveTextContent('Binance -2019')
    expect(screen.getByLabelText('Futures account synchronization errors'))
      .toHaveTextContent('Balance read failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry account sync' }))
    expect(state.refresh).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
  })

  // The dock and the chart carry the word `exit` beside the leg. The rail cannot:
  // measured in Chromium, at a 281px rail the side cell has 69px and `SHORT` with
  // the badge needs 83, and since the badge trails the leg it is the badge that
  // gets cut — the new reading eaten by the old one. It rides on the element
  // instead. This is a guard: it holds the rail to stating the intent without
  // spending width it does not have.
  it('states an exit on the rail without a badge the row cannot hold', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          openOrders: [
            { symbol: 'BTCUSDT', orderId: 1, side: 'SELL', positionSide: 'BOTH', reduceOnly: true, price: '59900', origQty: '1', z: '0' },
            { symbol: 'BTCUSDT', orderId: 2, side: 'BUY', positionSide: 'BOTH', price: '58000', origQty: '1', z: '0' },
          ],
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }))

    const rows = within(screen.getByRole('table', { name: 'Working orders' })).getAllByRole('row')
    const closing = within(rows[1]).getAllByRole('cell')[1]
    expect(closing).toHaveTextContent('LONG')
    expect(closing).not.toHaveTextContent('exit')
    expect(closing.getAttribute('title')).toMatch(/^Exit — reduce-only/)

    const opening = within(rows[2]).getAllByRole('cell')[1]
    expect(opening).toHaveTextContent('LONG')
    expect(opening.getAttribute('title')).toBeNull()
  })

  // A panel that closes is this desk's way of saying "done". It closed first and
  // sent second, so a closed socket dismissed the confirmation exactly as a
  // delivered order did — and took the numbers the operator had just approved
  // off the screen with it.
  it('keeps the confirmation open with its numbers when the send does not leave', () => {
    const state = createState({ placeOrder: vi.fn(() => false) })
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 77, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.03',
        }}
      />,
    )
    const panel = screen.getByRole('alertdialog')
    const approvedPrice = within(panel).getByText('58445')

    confirmStagedOrder()

    expect(state.placeOrder).toHaveBeenCalledOnce()
    // Still open, still showing what would be sent, and saying why it was not.
    expect(screen.getByRole('alertdialog')).toBe(panel)
    expect(approvedPrice).toBeInTheDocument()
    expect(panel).toHaveTextContent('Local backend connection unavailable')
  })

  // The hook clears `lastError` on any execution report, including one about a
  // different order. A refusal of the order the operator just sent could be
  // wiped off the screen by an unrelated fill a moment later.
  it('holds a rejection on screen after the state stops carrying it', () => {
    const rejected = {
      code: 'FUTURES_API_ERROR',
      message: "Order's notional must be no smaller than 5.",
      details: { marketType: 'futures', binanceCode: -4164 },
    }
    const props = {
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(
      <FuturesTradingTicket {...props} state={createState({ lastError: rejected })} />,
    )
    const rejection = screen.getByLabelText('Futures command rejection')
    expect(rejection).toHaveTextContent('Binance -4164')

    // An unrelated fill lands and the hook drops the rejection.
    rerender(<FuturesTradingTicket {...props} state={createState({ lastError: null })} />)
    expect(screen.getByLabelText('Futures command rejection'))
      .toHaveTextContent("Order's notional must be no smaller than 5.")

    // It goes when the operator says it goes.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss rejection' }))
    expect(screen.queryByLabelText('Futures command rejection')).toBeNull()
  })

  it('lets go of a held rejection when the operator sends another order', () => {
    const state = createState({
      lastError: {
        code: 'FUTURES_API_ERROR',
        message: 'Margin is insufficient.',
        details: { marketType: 'futures', binanceCode: -2019 },
      },
    })
    const props = {
      state,
      selectedSymbol: 'BTCUSDT',
      selectedContract: contract,
      draftPrice: '58445.0',
    }
    const { rerender } = render(<FuturesTradingTicket {...props} />)
    expect(screen.getByLabelText('Futures command rejection')).toBeInTheDocument()
    sizeTo(25)
    rerender(
      <FuturesTradingTicket
        {...props}
        gestureRequest={{
          id: 78, side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58445.03',
        }}
      />,
    )
    confirmStagedOrder()
    expect(state.placeOrder).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Futures command rejection')).toBeNull()
  })

  // The seam, not either side of it. That a reconnect marks the balance stale is
  // proved in the hook, and that a stale balance blocks trading is proved in the
  // readiness derivation — and between them nothing said what the operator sees
  // on the ticket, which is where the sizing is done and where a figure of
  // unknown age would be acted on.
  it('states the age of a balance nothing has confirmed since the reconnect, and will not size against it', () => {
    vi.useFakeTimers()
    const confirmedAt = Date.now() - 92_000
    try {
      render(
        <FuturesTradingTicket
          state={createState({
            accountResources: {
              balances: {
                status: 'stale',
                data: { USDT: { available: '1000', total: '1000' } },
                lastSuccessfulAt: confirmedAt,
                error: {
                  code: 'TRANSPORT_LOST',
                  message: 'Not confirmed since the connection dropped — retry account synchronization.',
                },
              },
            },
          })}
          selectedSymbol="BTCUSDT"
          selectedContract={contract}
          draftPrice="58445.0"
        />,
      )

      // The number is still there — a blank ticket after a reconnect is worse —
      // and it says how old it is rather than leaving it to be inferred.
      const available = screen.getByText('1000 USDT')
      expect(available).toHaveTextContent('1m 32s old')

      // And it is not a balance an order may be sized as a share of.
      expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeDisabled()
      expect(screen.getByRole('textbox', { name: 'Order notional USDT' })).toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  // A guard, not a bite: it passed before this change too. It is here so the
  // age cannot creep onto a ticket that has nothing to disclose — a line that
  // is always on screen is a line nobody reads when it matters.
  it('says nothing about age once the balance is confirmed again', () => {
    render(
      <FuturesTradingTicket
        state={createState({
          accountResources: {
            balances: {
              status: 'ready',
              data: { USDT: { available: '1000', total: '1000' } },
              lastSuccessfulAt: Date.now() - 92_000,
              error: null,
            },
          },
        })}
        selectedSymbol="BTCUSDT"
        selectedContract={contract}
        draftPrice="58445.0"
      />,
    )
    expect(screen.getByText('1000 USDT')).not.toHaveTextContent('old')
    expect(screen.getByRole('slider', { name: 'Order size percent' })).not.toBeDisabled()
  })
})
