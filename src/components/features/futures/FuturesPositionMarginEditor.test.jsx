import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesPositionMarginEditor from './FuturesPositionMarginEditor.jsx'

const isolatedPosition = Object.freeze({
  symbol: 'BTCUSDT',
  positionSide: 'BOTH',
  quantity: '0.500',
  entryPrice: '57000',
  markPrice: '58445.07',
  isolatedWallet: '1200',
  unrealizedPnl: '722.53',
})

const renderEditor = (overrides = {}) => {
  const handlers = { onSubmit: vi.fn(), onClose: vi.fn() }
  render(
    <FuturesPositionMarginEditor
      position={isolatedPosition}
      availableUsdt="5000"
      anchor={{ x: 200, y: 150 }}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('FuturesPositionMarginEditor', () => {
  it('opens on the position it was called for, stating its margin and what is available', () => {
    renderEditor()
    const panel = screen.getByLabelText('Adjust BTCUSDT LONG position margin')
    expect(panel).toHaveTextContent('1200.00 isolated')
    expect(panel).toHaveTextContent('5000.00')
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeDisabled()
  })

  it('adds margin to the named position and leg', () => {
    const { onSubmit, onClose } = renderEditor()
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add margin' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      direction: 'ADD',
      amount: '250',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('removes margin and shows what the position would be left holding', () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '200' } })
    expect(screen.getByLabelText('Adjust BTCUSDT LONG position margin')).toHaveTextContent('1000.00')
    fireEvent.click(screen.getByRole('button', { name: 'Remove margin' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      direction: 'REMOVE',
      amount: '200',
    })
  })

  // Both bounds are facts about the account, not policy: the ceiling on order
  // notional deliberately has nothing to say about moving margin.
  it('refuses to add more than the wallet holds', () => {
    const { onSubmit } = renderEditor({ availableUsdt: '300' })
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '400' } })
    expect(screen.getByRole('status')).toHaveTextContent('Only 300.00 USDT is available')
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses to remove more than the position holds', () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1500' } })
    expect(screen.getByRole('status')).toHaveTextContent('Only 1200.00 USDT is committed')
    expect(screen.getByRole('button', { name: 'Remove margin' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // The panel exists on a cross row precisely to say this. Binance would refuse
  // the transfer anyway; being told why here costs no round trip.
  it('explains why a cross position cannot have margin moved into it', () => {
    const { onSubmit } = renderEditor({
      position: { ...isolatedPosition, isolatedWallet: '0', initialMargin: '2850' },
    })
    expect(screen.getByLabelText('Adjust BTCUSDT LONG position margin'))
      .toHaveTextContent('2850.00 cross')
    expect(screen.getByRole('status')).toHaveTextContent('backed by the whole account')
    expect(screen.getByLabelText('Margin amount in USDT')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add margin' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('closes on an outside click without submitting anything', () => {
    const { onSubmit, onClose } = renderEditor()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
