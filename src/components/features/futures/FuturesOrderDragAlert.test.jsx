import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesOrderDragAlert from './FuturesOrderDragAlert.jsx'

const lostAlert = Object.freeze({
  id: 1,
  tone: 'lost',
  title: 'Order cancelled and NOT replaced',
  detail: 'BTCUSDT BUY 0.004 @ 58500 was cancelled and could not be placed again. Margin is insufficient.',
  order: { symbol: 'BTCUSDT', side: 'BUY', price: '58500', quantity: '0.004' },
  retryPrice: '58445.00',
})

describe('FuturesOrderDragAlert', () => {
  it('says nothing when the drag owes nothing', () => {
    render(<FuturesOrderDragAlert alerts={[]} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // An order that is gone and not replaced is not a log line: it names the
  // order, gives the reason, and carries the control that puts it back.
  it('names the order that is gone and offers to place it again', () => {
    const onRetry = vi.fn()
    render(<FuturesOrderDragAlert alerts={[lostAlert]} onRetry={onRetry} onDismiss={vi.fn()} />)

    const alert = screen.getByRole('alert', { name: 'Futures order drag outcome for BTCUSDT' })
    expect(alert).toHaveTextContent('BTCUSDT BUY 0.004 @ 58500')
    expect(alert).toHaveTextContent('Margin is insufficient.')

    fireEvent.click(screen.getByRole('button', { name: 'Place it again at 58445.00' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows the placement as in flight rather than as a second chance', () => {
    render(<FuturesOrderDragAlert alerts={[lostAlert]} busy onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Placing…' })).toBeDisabled()
  })

  // After silence there is no button at all: retrying is how two real orders
  // end up resting on the book.
  it('offers no retry when the outcome is unknown', () => {
    render(<FuturesOrderDragAlert
      alerts={[{
        id: 2,
        tone: 'unresolved',
        title: 'Replacement NOT confirmed',
        detail: 'Check BTCUSDT on Binance before placing anything.',
        order: null,
        retryPrice: null,
      }]}
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
    />)

    expect(screen.queryByRole('button', { name: /Place it again/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss drag outcome' })).toBeInTheDocument()
  })
})
