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

  // What this panel used to promise, and what the desk's own arithmetic says.
  // The liquidation price the desk draws — and reconciles against the exchange's
  // own figure, to 0 bps on this operator's contract on 2026-08-21 — is computed
  // from the margin behind the position, the contract's maintenance rate and, in
  // cross, the whole wallet. The multiple is in none of those terms. The panel
  // said "its liquidation price moves closer to the mark", the operator raised
  // 1× to 2× on a position they were holding, and nothing moved.
  it('does not promise that the multiple moves an open position’s liquidation', () => {
    const { rerender } = render(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={10}
        maxLeverage={125}
        marginMode="ISOLATED"
        openPosition={{ symbol: 'BTCUSDT', quantity: '-0.5' }}
        anchor={anchor}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('its liquidation price stays where it is')

    fireEvent.click(screen.getByRole('button', { name: '50×' }))
    expect(screen.getByRole('status')).toHaveTextContent('does not move with it')
    expect(screen.getByRole('status').textContent).not.toMatch(/moves closer|stands behind less margin/)

    // The whole wallet stands behind a cross position, so its liquidation is not
    // the multiple's to move either.
    rerender(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={10}
        maxLeverage={125}
        marginMode="CROSSED"
        openPosition={{ symbol: 'BTCUSDT', quantity: '-0.5' }}
        anchor={anchor}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('frees or commits wallet margin')
    expect(screen.getByRole('status')).toHaveTextContent('does not move with it')

    // And a mode the exchange has not reported is not a mode to reason from.
    rerender(
      <FuturesLeverageEditor
        symbol="BTCUSDT"
        leverage={10}
        maxLeverage={125}
        marginMode={null}
        openPosition={{ symbol: 'BTCUSDT', quantity: '-0.5' }}
        anchor={anchor}
      />,
    )
    expect(screen.getByRole('status'))
      .toHaveTextContent('does not move the liquidation price of a position already open')
  })

  // The operator's own case, 2026-08-21: 2× lowered to 1× on an isolated contract
  // they were holding, answered by a signed request with `-4161
  // ISOLATED_LEVERAGE_REJECT_WITH_POSITION`. Every input that rule names was on
  // the desk before the request went out.
  it('refuses a lower multiple on an open isolated contract, and sends nothing', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(
      <FuturesLeverageEditor
        symbol="ONGUSDT"
        leverage={2}
        maxLeverage={75}
        marginMode="ISOLATED"
        openPosition={{ symbol: 'ONGUSDT', quantity: '1200' }}
        anchor={anchor}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '1×' }))
    expect(screen.getByRole('status'))
      .toHaveTextContent('Binance will not lower the multiple while a position is open')

    const apply = screen.getByRole('button', { name: 'Held at 2×' })
    expect(apply).toBeDisabled()
    fireEvent.click(apply)
    fireEvent.submit(apply)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  // The rule is a reduction on an isolated contract, and nothing wider: raising
  // it there is allowed, and so is either direction in cross.
  //
  // This and the one below it are guards, not evidence: they pass against the
  // code as it was, because code that refuses nothing locally cannot over-refuse.
  // What they hold is the width of the rule, against the version of it that
  // would stop the desk lowering a contract it is allowed to lower.
  it('sends every change the exchange does take on an open contract', () => {
    const onSubmit = vi.fn(() => true)
    const { rerender } = render(
      <FuturesLeverageEditor
        symbol="ONGUSDT"
        leverage={2}
        maxLeverage={75}
        marginMode="ISOLATED"
        openPosition={{ symbol: 'ONGUSDT', quantity: '1200' }}
        anchor={anchor}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '5×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set 5×' }))
    expect(onSubmit).toHaveBeenCalledWith({ symbol: 'ONGUSDT', leverage: 5 })

    rerender(
      <FuturesLeverageEditor
        symbol="ONGUSDT"
        leverage={2}
        maxLeverage={75}
        marginMode="CROSSED"
        openPosition={{ symbol: 'ONGUSDT', quantity: '1200' }}
        anchor={anchor}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '1×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set 1×' }))
    expect(onSubmit).toHaveBeenLastCalledWith({ symbol: 'ONGUSDT', leverage: 1 })
  })

  // A contract holding nothing is the one the desk lowers to 1× by itself, so a
  // refusal that reached this case would refuse the desk's own default.
  it('lowers a flat isolated contract', () => {
    const onSubmit = vi.fn(() => true)
    render(
      <FuturesLeverageEditor
        symbol="ONGUSDT"
        leverage={2}
        maxLeverage={75}
        marginMode="ISOLATED"
        openPosition={null}
        anchor={anchor}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '1×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set 1×' }))
    expect(onSubmit).toHaveBeenCalledWith({ symbol: 'ONGUSDT', leverage: 1 })
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
