import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesOrderEditor from './FuturesOrderEditor.jsx'

const contract = Object.freeze({
  symbol: 'BTCUSDT',
  filters: Object.freeze({
    price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
    quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
    minimumNotional: '5',
  }),
})

const order = Object.freeze({
  symbol: 'BTCUSDT',
  orderId: 11,
  clientOrderId: 'abc',
  side: 'BUY',
  positionSide: 'BOTH',
  price: '58445.0',
  origQty: '0.004',
  z: '0',
})

const renderEditor = (overrides = {}) => {
  const handlers = {
    onSubmit: vi.fn(),
    onCancelOrder: vi.fn(),
    onClose: vi.fn(),
  }
  render(
    <FuturesOrderEditor
      order={order}
      contract={contract}
      anchor={{ x: 300, y: 200 }}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('FuturesOrderEditor', () => {
  it('opens on the order with its current price and USDT amount', () => {
    renderEditor()
    expect(screen.getByLabelText('Order price')).toHaveValue('58445.0')
    expect(screen.getByLabelText('Order amount in USDT')).toHaveValue('234')
    expect(screen.getByLabelText('Edit BTCUSDT BUY order')).toHaveTextContent('BUY LONG')
  })

  it('amends price and amount through one atomic submission', () => {
    const { onSubmit, onClose } = renderEditor()
    fireEvent.change(screen.getByLabelText('Order price'), { target: { value: '58500.07' } })
    fireEvent.change(screen.getByLabelText('Order amount in USDT'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderId: 11,
      origClientOrderId: undefined,
      price: '58500',
      quantity: '0.008',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses an amount the exchange filters would reject', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Order amount in USDT'), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('below the exchange minimum')
  })

  // The audit's case, at the panel where it was found: the ceiling was checked
  // on placement only, so this editor could grow a working order past it.
  it('refuses an amendment that would take a 160 USDT order to 10 000 under a 200 USDT ceiling', () => {
    const { onSubmit } = renderEditor({
      order: { ...order, price: '40000.0', origQty: '0.004' },
      maxOrderNotionalUsdt: '200',
    })
    expect(screen.getByLabelText('Order amount in USDT')).toHaveValue('160')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Order amount in USDT'), { target: { value: '10000' } })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('above the local 200 USDT order limit')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('leaves a reduce-only order uncapped so a position stays closable', () => {
    const { onSubmit } = renderEditor({
      order: { ...order, price: '40000.0', origQty: '0.004', reduceOnly: true },
      maxOrderNotionalUsdt: '200',
    })
    fireEvent.change(screen.getByLabelText('Order amount in USDT'), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('refuses to size an order whose contract filters are not loaded', () => {
    renderEditor({ contract: null })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Open BTCUSDT to edit this order')
  })

  it('cancels the order from the panel', () => {
    const { onCancelOrder, onClose } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    expect(onCancelOrder).toHaveBeenCalledWith({ symbol: 'BTCUSDT', orderId: 11 })
    expect(onClose).toHaveBeenCalled()
  })

  it('is draggable by its handle and closes on an outside click or Escape', () => {
    const { onClose } = renderEditor()
    const panel = screen.getByLabelText('Edit BTCUSDT BUY order')
    expect(panel).toHaveStyle({ left: '300px', top: '200px' })

    const handle = panel.querySelector('.futures-order-editor-handle')
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 310, clientY: 210 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 410, clientY: 260 })
    fireEvent.pointerUp(handle, { pointerId: 3 })
    expect(panel).toHaveStyle({ left: '400px', top: '250px' })

    fireEvent.pointerDown(panel)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
