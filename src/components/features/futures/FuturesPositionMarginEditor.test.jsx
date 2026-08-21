import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesPositionMarginEditor from './FuturesPositionMarginEditor.jsx'

const contract = Object.freeze({
  symbol: 'BTCUSDT',
  filters: Object.freeze({
    price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
    quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
  }),
})

const isolatedPosition = Object.freeze({
  symbol: 'BTCUSDT',
  positionSide: 'BOTH',
  quantity: '0.500',
  entryPrice: '57000',
  markPrice: '58445.07',
  // 1160 spare over half a bitcoin is 2320 of price: the exchange's own
  // liquidation price for this margin, so the projections are measured against a
  // number Binance would agree with.
  liquidationPrice: '54680',
  isolatedWallet: '1200',
  unrealizedPnl: '722.53',
  maintenanceMargin: '40',
})

const renderEditor = (overrides = {}) => {
  const handlers = { onSubmit: vi.fn(), onClose: vi.fn() }
  render(
    <FuturesPositionMarginEditor
      position={isolatedPosition}
      contract={contract}
      availableUsdt="5000"
      riskSnapshotCoherent
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
    expect(panel).toHaveTextContent('1200.00')
    expect(panel).toHaveTextContent('5000.00')
    expect(panel).toHaveTextContent('ISOLATED')
    expect(panel).toHaveTextContent('margin is this position’s own')
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeDisabled()
  })

  // The number that matters while moving margin is not what the wallet holds —
  // it is how much of this position's margin is still spare.
  it('draws the maintenance floor and the margin standing above it', () => {
    renderEditor()
    expect(screen.getByRole('img', {
      name: 'Margin 1200.00 USDT: 40.00 held as maintenance, 1160.00 spare above liquidation',
    })).toBeInTheDocument()
    const panel = screen.getByLabelText('Adjust BTCUSDT LONG position margin')
    // The bar carries the proportion; the line under it carries the price the
    // exchange would close at, quoted at the contract's tick.
    expect(panel).toHaveTextContent('Liq. price 54680.0')
    // The maintenance requirement is an amount of margin, not a price. Titled
    // "Liq. floor" beside a price scale it read as one.
    expect(panel).not.toHaveTextContent('Liq. floor')
  })

  // An unrealized loss has already been taken out of the margin behind the
  // position; an unrealized profit is not in the wallet and buys no headroom.
  it('measures the spare margin after the loss the position is already carrying', () => {
    renderEditor({ position: { ...isolatedPosition, unrealizedPnl: '-300' } })
    expect(screen.getByRole('img', {
      name: 'Margin 900.00 USDT: 40.00 held as maintenance, 860.00 spare above liquidation',
    })).toBeInTheDocument()
  })

  // The notional does not change, so neither does the requirement under it: the
  // buffer moves by exactly the amount transferred, and the liquidation price by
  // that amount spread over the position's size.
  it('shows where the requested amount would leave the position', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '250' } })
    const panel = screen.getByLabelText('Adjust BTCUSDT LONG position margin')
    expect(panel).toHaveTextContent('Margin after')
    expect(panel).toHaveTextContent('1450.00')
    // 250 more margin over half a bitcoin buys 500 of price, away from the entry.
    expect(panel).toHaveTextContent('Liq. price 54680.0 → 54180.0')
  })

  // Taking margin out moves the same price the other way. This is the reading the
  // operator said they could not see move at all: the panel showed a percentage
  // and a maintenance amount, and never the price they watch on the chart.
  it('pulls the liquidation price in when margin is taken out', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '200' } })
    expect(screen.getByLabelText('Adjust BTCUSDT LONG position margin'))
      .toHaveTextContent('Liq. price 54680.0 → 55080.0')
  })

  // A short is liquidated above itself, so margin moves its price the other way.
  it('pushes a short position’s liquidation price up when margin is added', () => {
    renderEditor({
      position: {
        ...isolatedPosition,
        quantity: '-0.500',
        liquidationPrice: '59320',
      },
    })
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '250' } })
    expect(screen.getByLabelText('Adjust BTCUSDT SHORT position margin'))
      .toHaveTextContent('Liq. price 59320.0 → 59820.0')
  })

  // Binance reports 0 for a position it has no liquidation price for, and 0 is not
  // a price to do arithmetic on. The spare margin is the reading that survives.
  it('falls back to the spare margin when no liquidation price is reported', () => {
    renderEditor({ position: { ...isolatedPosition, liquidationPrice: '0' } })
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '250' } })
    const panel = screen.getByLabelText('Adjust BTCUSDT LONG position margin')
    expect(panel).not.toHaveTextContent('Liq. price')
    expect(panel).toHaveTextContent('Spare 1160.00 → 1410.00')
  })

  // A few hundred USDT against a few thousand moves the drawing by a sliver,
  // which is the truth — so the panel also states the reading that does move.
  it('states the liquidation risk before and after the adjustment', () => {
    renderEditor()
    const panel = screen.getByLabelText('Adjust BTCUSDT LONG position margin')
    expect(panel).toHaveTextContent('Liq. risk')
    // 40 maintenance against a 1200 balance, the profit not counted into it.
    expect(panel).toHaveTextContent('3.33%')
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '600' } })
    expect(panel).toHaveTextContent('3.33% → 2.22%')
  })

  // The same gesture as the order ticket's size control: dragging is what makes
  // the effect on the drawing visible at all.
  it('ranges the add slider on the wallet, and names the bound it is showing', () => {
    renderEditor()
    const slider = screen.getByLabelText('Margin amount to add, USDT')
    // Adding used to be capped at the margin already committed, which on a wallet
    // this size offered the same ceiling as taking margin out — and read as a
    // refusal to add more.
    expect(slider).toHaveAttribute('max', '5000')
    expect(screen.getByLabelText('Adjust BTCUSDT LONG position margin'))
      .toHaveTextContent('of 5000 available')
    fireEvent.change(slider, { target: { value: '300' } })
    expect(screen.getByLabelText('Margin amount in USDT')).toHaveValue('300')
    expect(screen.getByLabelText('Adjust BTCUSDT LONG position margin'))
      .toHaveTextContent('Liq. price 54680.0 → 54080.0')
  })

  it('ranges the slider to the removable margin when taking margin out', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByLabelText('Margin amount to remove, USDT')).toHaveAttribute('max', '1160')
    expect(screen.getByLabelText('Adjust BTCUSDT LONG position margin'))
      .toHaveTextContent('of 1160 removable')
  })

  it('stretches the slider rather than contradicting an amount typed past it', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '6000' } })
    const slider = screen.getByLabelText('Margin amount to add, USDT')
    expect(slider).toHaveAttribute('max', '6000')
    expect(slider).toHaveValue('6000')
    // Stretching the control is not permission: the wallet still refuses it.
    expect(screen.getByRole('status')).toHaveTextContent('Only 5000.00 USDT is available to add')
  })

  // Removing the whole buffer is not a transfer, it is a liquidation. Binance's
  // own limit is stricter still, and that refusal remains Binance's to give.
  it('refuses a removal that would cross the liquidation floor', () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1180' } })
    expect(screen.getByRole('status'))
      .toHaveTextContent('Only 1160.00 USDT stands above the liquidation floor')
    expect(screen.getByRole('button', { name: 'Remove margin' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says so plainly when a position is already at its floor', () => {
    renderEditor({ position: { ...isolatedPosition, unrealizedPnl: '-1180' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '10' } })
    expect(screen.getByRole('status')).toHaveTextContent('already at its liquidation floor')
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

  it.each([
    ['unknown', null],
    ['negative', '-1'],
  ])('fails ADD closed when the available balance is %s', (_label, availableUsdt) => {
    const { onSubmit } = renderEditor({ availableUsdt })
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1' } })

    expect(screen.getByRole('status'))
      .toHaveTextContent('Available USDT has not been confirmed')
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('treats zero available as a known zero bound, never as permission to add', () => {
    const { onSubmit } = renderEditor({ availableUsdt: '0' })
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1' } })

    expect(screen.getByRole('status')).toHaveTextContent('Only 0.00 USDT is available')
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

  it.each([
    ['omitted', undefined],
    ['incoherent', false],
  ])('fails REMOVE closed when risk coherence is %s', (_label, riskSnapshotCoherent) => {
    const { onSubmit } = renderEditor({ riskSnapshotCoherent })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1' } })

    expect(screen.getByRole('status')).toHaveTextContent('risk reading is incomplete or mixes generations')
    expect(screen.getByRole('button', { name: 'Remove margin' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', undefined])(
    'fails REMOVE closed when maintenance margin is %s',
    (maintenanceMargin) => {
      const { onSubmit } = renderEditor({
        position: { ...isolatedPosition, maintenanceMargin },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1' } })

      expect(screen.getByRole('status'))
        .toHaveTextContent('risk reading is incomplete or mixes generations')
      expect(screen.getByRole('button', { name: 'Remove margin' })).toBeDisabled()
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it('fails REMOVE closed when no account uPnL can establish the removable bound', () => {
    const { onSubmit } = renderEditor({
      position: { ...isolatedPosition, unrealizedPnl: undefined },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '1' } })

    expect(screen.getByRole('status')).toHaveTextContent('risk reading is incomplete')
    expect(screen.getByRole('button', { name: 'Remove margin' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // The panel exists on a cross row precisely to say this. Binance would refuse
  // the transfer anyway; being told why here costs no round trip.
  it('explains why a cross position cannot have margin moved into it', () => {
    const { onSubmit } = renderEditor({
      position: { ...isolatedPosition, isolatedWallet: '0', initialMargin: '2850' },
    })
    const panel = screen.getByLabelText('Adjust BTCUSDT LONG position margin')
    expect(panel).toHaveTextContent('2850.00')
    expect(panel).toHaveTextContent('CROSS')
    expect(panel).toHaveTextContent('margin is shared with the whole account')
    // A per-row buffer would be a claim about money that is the account's.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('backed by the whole account')
    expect(screen.getByLabelText('Margin amount in USDT')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add margin' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // The close button sits on the drag handle. Capturing the pointer for a drag
  // redirects the click that follows to the handle, and the button goes dead.
  it('closes on its own close button', () => {
    const { onSubmit, onClose } = renderEditor()
    const close = screen.getByRole('button', { name: 'Close margin panel' })
    fireEvent.pointerDown(close, { button: 0, pointerId: 1 })
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('closes on an outside click without submitting anything', () => {
    const { onSubmit, onClose } = renderEditor()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('stays open and states the failure when the margin move could not be sent', () => {
    const { onClose } = renderEditor({ onSubmit: vi.fn(() => false) })
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add margin' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('the margin was not moved')
  })

})
