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

  it('sizes an entry from available USDT in half-percentage steps', () => {
    const { onSubmit } = renderEditor({ availableUsdt: '1000' })
    const slider = screen.getByRole('slider', { name: 'Working order size percent' })
    expect(slider).toBeEnabled()
    expect(slider).toHaveAttribute('step', '0.5')

    fireEvent.change(slider, { target: { value: '37.5' } })
    expect(screen.getByLabelText('Order amount in USDT')).toHaveValue('375')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      side: 'BUY',
      price: '58445',
      quantity: '0.006',
    }))
  })

  it('sizes an exit from the matching position at the draft price', () => {
    const { onSubmit } = renderEditor({
      order: {
        ...order,
        side: 'SELL',
        positionSide: 'LONG',
        reduceOnly: true,
        price: '100.0',
        origQty: '10',
      },
      positionQuantity: '10',
    })
    const slider = screen.getByRole('slider', { name: 'Working order size percent' })
    fireEvent.change(slider, { target: { value: '50' } })

    expect(screen.getByLabelText('Order amount in USDT')).toHaveValue('500')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      side: 'SELL',
      price: '100',
      quantity: '5',
    }))
  })

  it('preserves a typed amount and positions the slider at its nearest half stop', () => {
    renderEditor({ availableUsdt: '1000' })
    const amount = screen.getByLabelText('Order amount in USDT')
    fireEvent.change(amount, { target: { value: '333' } })

    expect(amount).toHaveValue('333')
    expect(screen.getByRole('slider', { name: 'Working order size percent' }))
      .toHaveValue('33.5')
  })

  it('keeps manual amendment available when the sizing reference is unavailable', () => {
    const { onSubmit } = renderEditor()
    expect(screen.getByRole('slider', { name: 'Working order size percent' })).toBeDisabled()
    const amount = screen.getByLabelText('Order amount in USDT')
    expect(amount).toBeEnabled()

    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).toHaveBeenCalledOnce()
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

  it('keeps Apply disabled when a slider-derived amount exceeds the local ceiling', () => {
    const { onSubmit } = renderEditor({
      availableUsdt: '1000',
      maxOrderNotionalUsdt: '200',
    })
    fireEvent.change(
      screen.getByRole('slider', { name: 'Working order size percent' }),
      { target: { value: '25' } },
    )

    expect(screen.getByLabelText('Order amount in USDT')).toHaveValue('250')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('above the local 200 USDT order limit')
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

  // A panel that disappears is how this desk says "done". On a closed socket the
  // amendment never left the renderer, so the panel may not say it.
  it('stays open and states the failure when the amendment could not be sent', () => {
    const { onClose } = renderEditor({ onSubmit: vi.fn(() => false) })
    fireEvent.change(screen.getByLabelText('Order price'), { target: { value: '58500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('the order was not changed')
  })

  it('stays open and states the failure when the cancellation could not be sent', () => {
    const { onClose } = renderEditor({ onCancelOrder: vi.fn(() => false) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('the order was not cancelled')
  })


  // The panel seeds its price and amount from the order once, so its identity is
  // the order it was opened for. The workstation keys it on exactly this, and
  // this is what that key buys: without a remount the first order's draft would
  // be submitted against the second order's id.
  it('starts a fresh draft when it is keyed to a different order', () => {
    const onSubmit = vi.fn()
    const other = { ...order, orderId: 12, price: '41000.0', origQty: '0.010' }
    const editorFor = target => (
      <FuturesOrderEditor
        key={`${target.symbol}:REGULAR:${target.orderId}`}
        order={target}
        contract={contract}
        anchor={{ x: 300, y: 200 }}
        onSubmit={onSubmit}
        onCancelOrder={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const { rerender } = render(editorFor(order))
    fireEvent.change(screen.getByLabelText('Order price'), { target: { value: '59999' } })

    rerender(editorFor(other))
    expect(screen.getByLabelText('Order price')).toHaveValue('41000.0')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ orderId: 12, price: '41000' }))
  })

})
