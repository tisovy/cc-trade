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

const sizeSlider = () => screen.getByLabelText('Close size, percent of the position')

describe('FuturesPositionCloser', () => {
  it('opens on the whole position, ready to close at market', () => {
    renderCloser()
    expect(screen.getByLabelText('Close size')).toHaveValue('0.5')
    expect(sizeSlider()).toHaveValue('100')
    expect(screen.queryByLabelText('Close price')).not.toBeInTheDocument()
  })

  // The panel spent two cells restating the header — the exit's side, and that it
  // is reduce-only, which every close is. What an exit settles is what the
  // operator is deciding on, so that is what the cells carry.
  it('states what closing this much would settle', () => {
    renderCloser()
    const panel = screen.getByLabelText('Close BTCUSDT LONG position')
    expect(panel).toHaveTextContent('Value, USDT')
    expect(panel).toHaveTextContent('29222.53')
    expect(panel).toHaveTextContent('Est. PnL')
    // 0.5 sold at the mark against a 57000 entry — the position's whole profit,
    // because the whole position is being closed.
    expect(panel).toHaveTextContent('+722.53')
    expect(panel).toHaveTextContent('Leaves')
    expect(panel).not.toHaveTextContent('reduce-only')
  })

  // Four percentage buttons could offer four of the hundred sizes a position can
  // be cut to; a slider offers all of them, snapped to the same lot step.
  it('closes at market for the size the slider was dragged to', () => {
    const { onCloseMarket, onClose } = renderCloser()
    fireEvent.change(sizeSlider(), { target: { value: '50' } })
    expect(screen.getByLabelText('Close size')).toHaveValue('0.25')
    const panel = screen.getByLabelText('Close BTCUSDT LONG position')
    expect(panel).toHaveTextContent('14611.27')
    expect(panel).toHaveTextContent('+361.27')
    // Half of the position stays open, and the panel says so before the exit.
    expect(panel).toHaveTextContent(/Leaves\s*0\.25/)
    fireEvent.click(screen.getByRole('button', { name: 'Close at market' }))
    expect(onCloseMarket).toHaveBeenCalledExactlyOnceWith(position, { quantity: '0.25' })
    expect(onClose).toHaveBeenCalled()
  })

  // Exchange decimals, so the share is exact: 0.3 of a position read as a float
  // is 29.999…%, and a slider computed that way drifts a stop on every read.
  it('moves the slider to a size that was typed instead', () => {
    renderCloser()
    fireEvent.change(screen.getByLabelText('Close size'), { target: { value: '0.15' } })
    expect(sizeSlider()).toHaveValue('30')
  })

  // Dragged to nothing the panel holds no size, rather than a size of zero the
  // exchange would refuse.
  it('clears the size when the slider is dragged off the left', () => {
    renderCloser()
    fireEvent.change(sizeSlider(), { target: { value: '0' } })
    expect(screen.getByLabelText('Close size')).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Enter the size to close.')
    expect(screen.getByRole('button', { name: 'Close at market' })).toBeDisabled()
  })

  it('places a reduce-only limit on the side that reduces the position', () => {
    const { onCloseLimit } = renderCloser()
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))
    // The side is worth stating on a limit: the level rests on one book or the
    // other, and it is read against that.
    expect(screen.getByLabelText('Close BTCUSDT LONG position'))
      .toHaveTextContent('Close price · SELL reduce-only')
    fireEvent.change(screen.getByLabelText('Close price'), { target: { value: '59000.07' } })
    // Valued at the level, not at the mark: choosing a level is the point.
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('29500.00')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('+1000.00')
    fireEvent.click(screen.getByRole('button', { name: 'Place close limit' }))
    expect(onCloseLimit).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'SELL',
      price: '59000',
      quantity: '0.5',
    })
  })

  it('revalues a partial market close live without resetting its drafts', () => {
    const initialPosition = {
      ...position,
      valuationPrice: '58500',
    }
    const properties = {
      contract,
      anchor: { x: 200, y: 150 },
      onCloseMarket: vi.fn(),
      onCloseLimit: vi.fn(),
      onClose: vi.fn(),
    }
    const { rerender } = render(
      <FuturesPositionCloser position={initialPosition} {...properties} />,
    )

    fireEvent.change(screen.getByLabelText('Close size'), { target: { value: '0.2' } })
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('11700.00')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('+300.00')

    const livePosition = {
      ...initialPosition,
      valuationPrice: '58600',
    }
    rerender(<FuturesPositionCloser position={livePosition} {...properties} />)

    expect(screen.getByLabelText('Close size')).toHaveValue('0.2')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('11720.00')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('+320.00')

    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))
    fireEvent.change(screen.getByLabelText('Close price'), { target: { value: '59000.07' } })
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('11800.00')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('+400.00')

    rerender(
      <FuturesPositionCloser
        position={{ ...livePosition, valuationPrice: '60000', markPrice: '60000' }}
        {...properties}
      />,
    )

    expect(screen.getByRole('button', { name: 'Limit' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Close size')).toHaveValue('0.2')
    expect(screen.getByLabelText('Close price')).toHaveValue('59000.07')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('11800.00')
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('+400.00')
  })

  it('buys back a short instead of selling more of it', () => {
    const { onCloseMarket } = renderCloser({
      position: { ...position, quantity: '-0.500' },
    })
    // The same mark above the same entry is a loss on the other side of the book.
    expect(screen.getByLabelText('Close BTCUSDT SHORT position')).toHaveTextContent('−722.53')
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))
    expect(screen.getByLabelText('Close BTCUSDT SHORT position'))
      .toHaveTextContent('Close price · BUY reduce-only')
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Market' }))
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
    // The slider cannot show more than the whole position, whatever was typed.
    expect(sizeSlider()).toHaveValue('100')
    expect(onCloseMarket).not.toHaveBeenCalled()
  })

  it('closes on an outside click', () => {
    const { onClose } = renderCloser()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // A closed panel reads as a closed position. It may only close when the
  // command actually reached the backend.
  it('stays open and states the failure when the close could not be sent', () => {
    const { onClose } = renderCloser({ onCloseMarket: vi.fn(() => false) })
    fireEvent.click(screen.getByRole('button', { name: 'Close at market' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('the position was not closed')
  })

})
