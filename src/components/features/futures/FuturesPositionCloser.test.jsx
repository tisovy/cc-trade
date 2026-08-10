import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesPositionCloser from './FuturesPositionCloser.jsx'

const contract = Object.freeze({
  symbol: 'BTCUSDT',
  filters: Object.freeze({
    price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
    quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
    minimumNotional: '5',
  }),
})

const position = Object.freeze({
  symbol: 'BTCUSDT',
  positionSide: 'BOTH',
  quantity: '0.500',
  entryPrice: '57000',
  markPrice: '58445.07',
  unrealizedPnl: '722.53',
})

const renderCloser = (overrides = {}) => {
  const handlers = {
    onCloseMarket: vi.fn(),
    onCloseLimit: vi.fn(),
    onClose: vi.fn(),
  }
  render(
    <FuturesPositionCloser
      position={position}
      contract={contract}
      anchor={{ x: 200, y: 150 }}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('FuturesPositionCloser', () => {
  it('opens on the whole position, ready to close at market', () => {
    renderCloser()
    expect(screen.getByLabelText('Close size')).toHaveValue('0.5')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('SELL · reduce-only')
    expect(screen.queryByLabelText('Close price')).not.toBeInTheDocument()
  })

  it('closes at market for the requested size', () => {
    const { onCloseMarket, onClose } = renderCloser()
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close at market' }))
    expect(onCloseMarket).toHaveBeenCalledExactlyOnceWith(position, { quantity: '0.25' })
    expect(onClose).toHaveBeenCalled()
  })

  it('places a reduce-only limit on the side that reduces the position', () => {
    const { onCloseLimit } = renderCloser()
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))
    fireEvent.change(screen.getByLabelText('Close price'), { target: { value: '59000.07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place close limit' }))
    expect(onCloseLimit).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'SELL',
      price: '59000',
      quantity: '0.5',
    })
  })

  it('buys back a short instead of selling more of it', () => {
    const { onCloseMarket } = renderCloser({
      position: { ...position, quantity: '-0.500' },
    })
    expect(screen.getByLabelText('Close BTCUSDT SHORT position')).toHaveTextContent('BUY · reduce-only')
    fireEvent.click(screen.getByRole('button', { name: 'Close at market' }))
    expect(onCloseMarket).toHaveBeenCalledWith(
      { ...position, quantity: '-0.500' },
      { quantity: '0.5' },
    )
  })

  it('refuses a size larger than the open position', () => {
    const { onCloseMarket } = renderCloser()
    fireEvent.change(screen.getByLabelText('Close size'), { target: { value: '2' } })
    expect(screen.getByRole('button', { name: 'Close at market' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('larger than the open position')
    expect(onCloseMarket).not.toHaveBeenCalled()
  })

  it('closes on an outside click', () => {
    const { onClose } = renderCloser()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
