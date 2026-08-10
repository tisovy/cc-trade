import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesLeverageEditor from './FuturesLeverageEditor.jsx'

const anchor = Object.freeze({ x: 400, y: 300 })

describe('FuturesLeverageEditor', () => {
  it('opens on the leverage the contract is set to and applies the one chosen', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={20}
        maxLeverage={125}
        anchor={anchor}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    expect(screen.getByLabelText('Leverage multiple')).toHaveValue('20')
    // Nothing to apply until it is a different number.
    expect(screen.getByRole('button', { name: 'Already 20×' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '50×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set 50×' }))
    expect(onSubmit).toHaveBeenCalledWith({ symbol: 'BTCUSDT', leverage: 50 })
    expect(onClose).toHaveBeenCalled()
  })

  // The ceiling is the contract's own bracket, and offering a stop the exchange
  // will refuse is offering a failure.
  it('offers no stop above the contract’s ceiling, and always offers the ceiling', () => {
    render(<FuturesLeverageEditor symbol="BICOUSDT" leverage={5} maxLeverage={12} anchor={anchor} />)
    expect(screen.getByRole('button', { name: '10×' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '12×' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '20×' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Leverage multiple')).toHaveAttribute('max', '12')
  })

  // The wallet times the multiple, stated compactly with the exact figure on hover.
  it('states what the leverage buys and the bracket cap beside it', () => {
    render(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={10}
        maxLeverage={125}
        maxNotionalValue="5000000"
        availableUsdt="258426.31"
        anchor={anchor}
      />,
    )
    expect(screen.getByTitle('2584263.10 USDT')).toHaveTextContent('2.6M')
    expect(screen.getByTitle('5000000.00 USDT at this leverage')).toHaveTextContent('5.0M')
  })

  // Raising leverage on a position already open moves the price the exchange closes
  // it at, and the operator is looking at that price on the chart.
  it('warns that an open position’s liquidation price moves with the change', () => {
    render(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={10}
        maxLeverage={125}
        openPosition={{ symbol: 'BTCUSDT', quantity: '-0.5' }}
        anchor={anchor}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('changing leverage moves the liquidation price')
    fireEvent.click(screen.getByRole('button', { name: '50×' }))
    expect(screen.getByRole('status')).toHaveTextContent('at 50× the same position stands behind less margin')
    expect(screen.getByRole('status').className).toContain('is-riskier')
  })

  // The panel closing is the only confirmation this control has, so a command that
  // never left the renderer must not be able to close it.
  it('stays open and says so when the change never reached the backend', () => {
    const onClose = vi.fn()
    render(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={10}
        maxLeverage={125}
        anchor={anchor}
        onSubmit={() => false}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '20×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set 20×' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('the leverage was not changed')
  })

  it('reports an unreported leverage as absent rather than as 1×', () => {
    render(<FuturesLeverageEditor symbol="BTCUSDT" leverage={null} anchor={anchor} />)
    const [now] = screen.getAllByRole('definition')
    expect(now).toHaveTextContent('—')
    // With nothing to compare against, any choice is a change worth applying.
    expect(screen.getByRole('button', { name: 'Set 1×' })).toBeEnabled()
  })

  // `maxLeverage` arrives with the contract read, which can land after the panel
  // is already open and already picked on.
  it('lowers a pick made under a placeholder ceiling when the real one arrives', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <FuturesLeverageEditor
        symbol="TUTUSDT"
        leverage={1}
        maxLeverage={null}
        anchor={anchor}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText('Leverage multiple'), { target: { value: '100' } })
    expect(screen.getByLabelText('Leverage multiple')).toHaveValue('100')

    rerender(
      <FuturesLeverageEditor
        symbol="TUTUSDT"
        leverage={1}
        maxLeverage={20}
        anchor={anchor}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByLabelText('Leverage multiple')).toHaveValue('20')
    fireEvent.click(screen.getByRole('button', { name: 'Set 20×' }))
    expect(onSubmit).toHaveBeenCalledWith({ symbol: 'TUTUSDT', leverage: 20 })
  })

})
