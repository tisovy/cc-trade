import { readFileSync } from 'node:fs'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesPortfolioDock from './FuturesPortfolioDock.jsx'
import { describeFuturesPosition } from '../../../utils/futuresOrderPresentation.js'

vi.mock('../../../utils/futuresOrderPresentation.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, describeFuturesPosition: vi.fn(actual.describeFuturesPosition) }
})

const position = Object.freeze({
  symbol: 'BTCUSDT',
  positionSide: 'BOTH',
  quantity: '-0.5',
  entryPrice: '60000',
  markPrice: '60600',
  liquidationPrice: '71000',
  leverage: '10',
  marginType: 'CROSSED',
  unrealizedPnl: '-300',
})

const order = Object.freeze({
  symbol: 'BTCUSDT',
  orderKind: 'REGULAR',
  orderId: 11,
  side: 'BUY',
  positionSide: 'BOTH',
  type: 'LIMIT',
  status: 'NEW',
  price: '58445.00',
  origQty: '0.004',
  z: '0',
})

describe('FuturesPortfolioDock', () => {
  it('shows the direction and signed PnL of every position without opening a tab', () => {
    render(<FuturesPortfolioDock selectedSymbol="BTCUSDT" positions={[position]} />)
    const table = screen.getByRole('table', { name: 'Open positions' })
    expect(table).toHaveTextContent('SHORT')
    expect(table).toHaveTextContent('−300.00')
    expect(table).toHaveTextContent('−10.00%')
    expect(screen.getByLabelText('Futures positions and working orders'))
      .toHaveTextContent('−300.00 USDT')
  })

  it('states position size as a plain USDT amount, leaving direction to the side badge', () => {
    render(<FuturesPortfolioDock selectedSymbol="ETHUSDT" positions={[position]} />)
    // -0.5 contracts at a 60600 mark is a 30300 USDT short.
    const size = screen.getByTitle('-0.5 contracts')
    expect(size).toHaveTextContent('30300.00')
    expect(size.textContent).not.toContain('−')
    expect(screen.getByRole('table', { name: 'Open positions' }))
      .toHaveTextContent('Size (USDT)')
  })

  // Between two marks the figure is the desk's arithmetic on the last traded
  // price, not the exchange's on its own mark. The operator never has to wonder
  // which of the two they are reading — and the liquidation price, which is the
  // mark's by definition, is not marked and does not move with it.
  it('says when the PnL is the last trade rather than the confirmed mark', () => {
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{
          ...position,
          unrealizedPnl: '-450',
          markUnrealizedPnl: '-300',
          valuationPrice: '60900',
          valuationEstimated: true,
        }]}
      />,
    )
    const pnl = () => screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-pnl')
    expect(pnl()).toHaveClass('is-estimated')
    expect(pnl().getAttribute('title')).toContain('last traded price')
    expect(pnl()).toHaveTextContent('−450.00')
    // What it is an estimate of, exactly, without leaving the row: the number
    // Binance itself is showing at the same moment.
    expect(pnl().getAttribute('title')).toContain('mark −300.00 USDT')
    expect(screen.getByRole('table', { name: 'Open positions' })).toHaveTextContent('71000')

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{ ...position, valuationPrice: '60600', valuationEstimated: false }]}
      />,
    )
    expect(pnl()).not.toHaveClass('is-estimated')
    expect(pnl().getAttribute('title')).not.toContain('last traded price')
  })

  // The estimate ticks five times a second. What it may cost is the position
  // rows: a tick that changes nothing about the positions must not re-describe
  // them, and one that does must describe only them.
  it('re-describes the position rows a tick moves, and nothing when none moved', () => {
    const positions = [position]
    const { rerender } = render(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" positions={positions} />,
    )
    describeFuturesPosition.mockClear()
    // The same positions, a different unrelated prop.
    rerender(
      <FuturesPortfolioDock selectedSymbol="ETHUSDT" positions={positions} />,
    )
    expect(describeFuturesPosition).not.toHaveBeenCalled()

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[{ ...position, unrealizedPnl: '-450', valuationEstimated: true }]}
      />,
    )
    expect(describeFuturesPosition).toHaveBeenCalledTimes(1)
  })

  it('re-values the row when a fresher mark arrives without an account event', () => {
    const { rerender } = render(
      <FuturesPortfolioDock selectedSymbol="ETHUSDT" positions={[position]} />,
    )
    rerender(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[{ ...position, markPrice: '61200', unrealizedPnl: '-600' }]}
      />,
    )
    const table = screen.getByRole('table', { name: 'Open positions' })
    expect(table).toHaveTextContent('30600.00')
    expect(table).toHaveTextContent('−600.00')
    expect(screen.getByLabelText('Futures positions and working orders'))
      .toHaveTextContent('−600.00 USDT')
  })

  it('sizes the ticket for the whole position when its size is activated', () => {
    const onSizePick = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        onSizePick={onSizePick}
      />,
    )
    fireEvent.click(screen.getByRole('button', {
      name: 'Size the ticket for the whole BTCUSDT position',
    }))
    expect(onSizePick).toHaveBeenCalledWith(0.5)
  })

  it('offers no size shortcut for a position on another contract', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[position]}
        onSizePick={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', {
      name: 'Size the ticket for the whole BTCUSDT position',
    })).not.toBeInTheDocument()
  })

  // ROE had no visible denominator: the dock divided by the committed margin
  // and then showed only the quotient.
  it('states the margin behind each position beside the ROE measured against it', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{ ...position, isolatedWallet: '3000', unrealizedPnl: '-300' }]}
      />,
    )
    const table = screen.getByRole('table', { name: 'Open positions' })
    expect(table).toHaveTextContent('Margin')
    expect(table).toHaveTextContent('3000.00')
    expect(table).toHaveTextContent('−10.00%')
    // The amount and the percentage together outgrew the column, which clips its
    // overflow: the percent sign was being sliced off. Both readings stay exact in
    // the cell's title whatever the dock's width does to the text.
    expect(within(table).getByTitle('−300.00 USDT · −10.00% on margin'))
      .toHaveTextContent('−300.00')
  })

  it('opens the margin panel at the cursor for the position that was clicked', () => {
    const onMarginEdit = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[{ ...position, isolatedWallet: '3000' }]}
        onMarginEdit={onMarginEdit}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Adjust margin on the BTCUSDT SHORT position' }),
      { clientX: 240, clientY: 310 },
    )
    expect(onMarginEdit).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTCUSDT', positionSide: 'BOTH' }),
      { x: 240, y: 310 },
    )
  })

  // A cross row still opens the panel: that is where the reason it cannot be
  // adjusted is stated, which a dead cell would never say.
  it('marks a shared-margin position as cross rather than hiding its figure', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        onMarginEdit={vi.fn()}
      />,
    )
    const marginCell = screen.getByRole('button', {
      name: 'Adjust margin on the BTCUSDT SHORT position',
    })
    expect(marginCell).toHaveClass('is-cross')
    expect(marginCell).toHaveTextContent('CROSS')
    expect(marginCell).toHaveAttribute('title', 'Cross margin — backed by the whole account')
  })

  // Only one of the two modes can be adjusted at all, so the difference cannot
  // rest on an underline style the operator has to already know about.
  it('names the margin mode on the row rather than only styling it', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{ ...position, marginType: undefined, isolatedWallet: '3000' }]}
        onMarginEdit={vi.fn()}
      />,
    )
    const marginCell = screen.getByRole('button', {
      name: 'Adjust margin on the BTCUSDT SHORT position',
    })
    expect(marginCell).toHaveTextContent('3000.00')
    // Ahead of the digits, not after them: trailing the amount it read as part
    // of the number — a stray fraction of a cent rather than a mode.
    expect(marginCell).toHaveTextContent(/^ISO\s*3000\.00$/)
  })

  it('shows no margin at all when the account read carried none', () => {
    const unmargined = { ...position, leverage: undefined, marginType: undefined }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[unmargined]}
        onMarginEdit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', {
      name: 'Adjust margin on the BTCUSDT SHORT position',
    })).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Open positions' })).toHaveTextContent('—')
  })

  it('labels a one-way BUY order as a long instead of a bare BOTH', () => {
    render(<FuturesPortfolioDock selectedSymbol="BTCUSDT" openOrders={[order]} />)
    const table = screen.getByRole('table', { name: 'Working orders' })
    expect(within(table).getByText('BUY')).toHaveClass('is-buy')
    expect(table).toHaveTextContent('LONG')
    expect(table).not.toHaveTextContent('BOTH')
  })

  // The desk sizes in USDT everywhere else — the ticket, the editor, the chart
  // label. A working order printed in contracts was the one place the operator
  // had to do the multiplication by eye.
  it('states working-order size in USDT and keeps the contract count exact on hover', () => {
    render(<FuturesPortfolioDock selectedSymbol="BTCUSDT" openOrders={[order]} />)
    const table = screen.getByRole('table', { name: 'Working orders' })
    expect(table).toHaveTextContent('Size (USDT)')
    expect(table).not.toHaveTextContent('Qty')
    // 0.004 contracts at 58445 is a 234 USDT order.
    expect(screen.getByTitle('0.004 contracts')).toHaveTextContent('234')
  })

  // A stop carries its size against the price it triggers at; `price` is 0 on a
  // stop-market, so sizing from it would print every algo order as worth nothing.
  it('sizes an algo order from the price it triggers at', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[{
          ...order,
          orderKind: 'ALGO',
          price: '0',
          triggerPrice: '57000.00',
          origQty: '0.01',
        }]}
      />,
    )
    expect(screen.getByTitle('0.01 contracts')).toHaveTextContent('570')
  })

  // The operator watched a stop sit on the dock at its trigger price after the
  // market had gone through it. A row that reads like a working order is one
  // they can act on, and there is nothing there to act on.
  it('states an algo order that has fired rather than listing it as working', () => {
    const onOrderEdit = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[{
          ...order,
          orderId: 42,
          orderKind: 'ALGO',
          algoType: 'CONDITIONAL',
          price: '0',
          triggerPrice: '57000.00',
          actualOrderId: '990281234',
          actualPrice: '56980.10',
        }]}
        onOrderEdit={onOrderEdit}
      />,
    )
    const row = screen.getAllByRole('row').find(entry => (
      entry.classList.contains('is-orders') && !entry.classList.contains('is-head')
    ))

    expect(row).toHaveTextContent('triggered')
    expect(row).toHaveTextContent('fired')
    // Priced where it fired, not where it was waiting to; the trigger it was
    // placed against stays reachable rather than being replaced silently.
    expect(row).toHaveTextContent('56980.10')
    expect(within(row).getByTitle('fired from a trigger at 57000.00')).toBeInTheDocument()
    expect(within(row).getByTitle(/no longer working, so it cannot be moved or cancelled/))
      .toBeInTheDocument()

    // Nothing on a fired parent may open the editor: the exchange has acted.
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onOrderEdit).not.toHaveBeenCalled()
    expect(row).not.toHaveAttribute('tabindex')
    expect(row).not.toHaveAttribute('aria-label')
    expect(within(row).queryByRole('button', { name: /^Cancel/ })).toBeNull()
  })

  // An algo that has not fired is what the exchange reports with an empty
  // string, and it is still an order resting at its trigger.
  it('leaves an algo order that has not fired reading as working', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[{
          ...order,
          orderId: 42,
          orderKind: 'ALGO',
          algoType: 'CONDITIONAL',
          price: '0',
          triggerPrice: '57000.00',
          actualOrderId: '',
          actualPrice: '',
        }]}
      />,
    )
    const row = screen.getAllByRole('row').find(entry => (
      entry.classList.contains('is-orders') && !entry.classList.contains('is-head')
    ))
    expect(row).toHaveTextContent('57000.00')
    expect(row).toHaveTextContent('on Binance')
    expect(row).not.toHaveTextContent('triggered')
    expect(row.classList.contains('is-triggered')).toBe(false)
  })

  it('closes positions and cancels orders straight from the dock', () => {
    const onClosePosition = vi.fn()
    const onCancelOrder = vi.fn()
    const onSymbolChange = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[position]}
        openOrders={[order]}
        onClosePosition={onClosePosition}
        onCancelOrder={onCancelOrder}
        onSymbolChange={onSymbolChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close BTCUSDT position' }))
    expect(onClosePosition).toHaveBeenCalledWith(position, expect.any(Object))

    fireEvent.click(screen.getByRole('button', {
      name: 'Cancel BTCUSDT BUY order at 58445.00',
    }))
    expect(onCancelOrder).toHaveBeenCalledWith({ symbol: 'BTCUSDT', orderId: 11 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Show BTCUSDT' })[0])
    expect(onSymbolChange).toHaveBeenCalledWith('BTCUSDT')

    const orderRow = screen.getAllByRole('row').find(row => (
      row.classList.contains('is-orders') && !row.classList.contains('is-head')
    ))
    expect(orderRow).not.toHaveAttribute('tabindex')
    expect(orderRow).not.toHaveAttribute('aria-label')
    expect(orderRow).not.toHaveClass('is-editable')
  })

  it('opens the shared order editor once from Enter and Space at the row centre', () => {
    const onOrderEdit = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[order]}
        onOrderEdit={onOrderEdit}
        onCancelOrder={vi.fn()}
        onSymbolChange={vi.fn()}
      />,
    )
    const row = screen.getByRole('row', {
      name: 'Edit BTCUSDT BUY order at 58445.00',
    })
    expect(row).toHaveAttribute('tabindex', '0')
    expect(row).toHaveClass('is-editable')
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      left: 40,
      top: 60,
      width: 200,
      height: 30,
      right: 240,
      bottom: 90,
      x: 40,
      y: 60,
      toJSON: () => ({}),
    })

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(order, { x: 140, y: 75 })

    onOrderEdit.mockClear()
    const space = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, space)
    expect(space.defaultPrevented).toBe(true)
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(order, { x: 140, y: 75 })

    onOrderEdit.mockClear()
    fireEvent.keyDown(row, { key: 'ArrowDown' })
    expect(onOrderEdit).not.toHaveBeenCalled()

    // Keys from nested controls stay their controls' events, not row actions.
    fireEvent.keyDown(within(row).getByRole('button', { name: 'Show BTCUSDT' }), {
      key: 'Enter',
    })
    fireEvent.keyDown(within(row).getByRole('button', {
      name: 'Cancel BTCUSDT BUY order at 58445.00',
    }), { key: ' ' })
    expect(onOrderEdit).not.toHaveBeenCalled()
  })

  it('preserves click coordinates and isolates nested controls and ALGO rows', () => {
    const onOrderEdit = vi.fn()
    const onCancelOrder = vi.fn()
    const onSymbolChange = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[order, { ...order, orderId: 12, orderKind: 'ALGO' }]}
        onOrderEdit={onOrderEdit}
        onCancelOrder={onCancelOrder}
        onSymbolChange={onSymbolChange}
      />,
    )
    const rows = screen.getAllByRole('row').filter(row => row.classList.contains('is-orders'))
    fireEvent.click(rows[1], { clientX: 120, clientY: 240 })
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(order, { x: 120, y: 240 })

    // An exchange-managed row stays display-only, and nested controls never
    // open the row editor through their pointer events.
    fireEvent.click(rows[2])
    expect(onOrderEdit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel BTCUSDT BUY order at 58445.00' }))
    expect(onCancelOrder).toHaveBeenCalledTimes(1)
    expect(onOrderEdit).toHaveBeenCalledTimes(1)
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Show BTCUSDT' }))
    expect(onSymbolChange).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
    expect(onOrderEdit).toHaveBeenCalledTimes(1)
    expect(rows[2]).not.toHaveAttribute('tabindex')
    expect(rows[2]).not.toHaveAttribute('aria-label')
  })

  // The multiple a position is carried at is the difference between a position
  // that survives a 3% move and one that does not, and nothing on the desk said it.
  it('states the leverage each position is carried at and opens the control from it', () => {
    const onLeverageEdit = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[
          { ...position, leverage: 20 },
          { ...position, symbol: 'BICOUSDT', quantity: '3000', leverage: undefined },
        ]}
        onLeverageEdit={onLeverageEdit}
      />,
    )
    const [btc, bico] = screen.getAllByRole('button', { name: /leverage$/ })
    expect(btc).toHaveTextContent('20×')
    expect(btc).toHaveAttribute('title', '20× leverage — click to change it')
    // Not reported yet is not 1×: the badge says nothing about the multiple and
    // still offers to set it.
    expect(bico).toHaveTextContent('Lev')
    expect(bico).toHaveAttribute('title', 'Leverage not reported yet — click to set it')

    fireEvent.click(btc, { clientX: 480, clientY: 260 })
    expect(onLeverageEdit).toHaveBeenCalledWith('BTCUSDT', { x: 480, y: 260 })
  })

  it('renders account prices at the contract tick instead of raw exchange floats', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BEATUSDT"
        positions={[{
          ...position,
          symbol: 'BEATUSDT',
          quantity: '-2873',
          entryPrice: '3.3449999999999998',
          markPrice: '3.37867363',
          liquidationPrice: '4.71896804',
          leverage: undefined,
          marginType: undefined,
          initialMargin: '960.5',
          unrealizedPnl: '-96.74',
        }]}
        tickSizes={{ BEATUSDT: '0.0001' }}
      />,
    )
    const table = screen.getByRole('table', { name: 'Open positions' })
    expect(table).toHaveTextContent('3.3450')
    expect(table).toHaveTextContent('3.3787')
    expect(table).not.toHaveTextContent('3.344999')
    // ROE now comes from the reported margin, not from a leverage v3 dropped.
    expect(table).toHaveTextContent('−10.07%')
    expect(table).not.toHaveTextContent('×')
  })

  // Selecting a view renders the reading the desk holds. Every click here used
  // to cost an account-wide fan-out — about twenty-five requests through one
  // 150ms-spaced queue — for a past that had not changed.
  it('renders the held reading from the dock tabs and reads nothing to do it', () => {
    const onLoadHistory = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[order]}
        onLoadHistory={onLoadHistory}
        history={{
          symbol: 'BTCUSDT',
          status: 'ready',
          readAt: 1_784_000_100_000,
          orders: [],
          trades: [{ id: 4, side: 'SELL', price: '58500', quantity: '0.004', commission: '0.02', realizedPnl: '12.5', time: 1 }],
          error: null,
        }}
      />,
    )
    // The tab lists positions now, not executions: fills are folded into the
    // round trips they belong to before anything is drawn.
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    expect(screen.getByRole('table', { name: 'Position history' })).toHaveTextContent('+12.50')
    expect(screen.queryByRole('table', { name: 'Working orders' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Working/ }))
    expect(screen.getByRole('table', { name: 'Working orders' })).toBeInTheDocument()

    // Counted, not merely spied on: every one of these clicks used to send one.
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    expect(onLoadHistory).toHaveBeenCalledTimes(0)

    // The ordinary refresh is incremental; the wider read is a separate,
    // explicit operator choice.
    fireEvent.click(screen.getByRole('button', { name: 'Re-read account history' }))
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
    fireEvent.click(screen.getByRole('button', { name: 'Read full account history' }))
    expect(onLoadHistory).toHaveBeenNthCalledWith(2, 'BTCUSDT', { full: true })
  })

  it('states how old the reading is and refuses a second read while one is in flight', () => {
    const onLoadHistory = vi.fn()
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={{
          symbol: 'BTCUSDT', status: 'ready', readAt: 1_784_000_100_000, orders: [], trades: [], error: null,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    // Today's readings are read for their time of day, older ones for their day.
    expect(screen.getByText(/^read /)).toBeInTheDocument()

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={{
          symbol: 'BTCUSDT', status: 'refreshing', readAt: 1_784_000_100_000, orders: [], trades: [], error: null,
        }}
      />,
    )
    expect(screen.getByText('reading…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-read account history' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Read full account history' })).toBeDisabled()
  })

  it('collapses to a live truthful summary and expands back to the full dock', () => {
    const read = { status: 'ready', data: [], lastSuccessfulAt: 1000, error: null }
    const accountResources = { positions: read, regularOrders: read, algoOrders: read }
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        openOrders={[order]}
        accountResources={accountResources}
      />,
    )

    const collapse = screen.getByRole('button', { name: 'Collapse portfolio dock' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByLabelText('Collapsed portfolio dock summary')).toBeNull()
    fireEvent.click(collapse)

    let summary = screen.getByLabelText('Collapsed portfolio dock summary')
    expect(summary).toHaveTextContent(/Positions\s*1/)
    expect(summary).toHaveTextContent(/Working\s*1/)
    expect(summary).toHaveTextContent('−300.00 USDT')
    expect(screen.queryByRole('table', { name: 'Open positions' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Working orders' })).toBeNull()

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{ ...position, unrealizedPnl: '-450' }]}
        openOrders={[]}
        accountResources={accountResources}
      />,
    )
    summary = screen.getByLabelText('Collapsed portfolio dock summary')
    expect(summary).toHaveTextContent(/Working\s*0/)
    expect(summary).toHaveTextContent('−450.00 USDT')

    fireEvent.click(screen.getByRole('button', { name: 'Expand portfolio dock' }))
    expect(screen.getByRole('table', { name: 'Open positions' })).toBeInTheDocument()
    expect(screen.getByText('No working orders.')).toBeInTheDocument()
  })

  it('keeps the selected order view across collapse and does not invent unread counts', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        history={{
          symbol: 'BTCUSDT', status: 'ready', readAt: 1000, orders: [], trades: [], error: null,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    expect(screen.getByRole('tab', { name: 'Order history' }))
      .toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse portfolio dock' }))
    const summary = screen.getByLabelText('Collapsed portfolio dock summary')
    expect(within(summary).getAllByText('—')).toHaveLength(2)
    expect(within(summary).getByText('— USDT')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand portfolio dock' }))
    expect(screen.getByRole('tab', { name: 'Order history' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  // A contract change re-reads nothing: the review spans the account, not the
  // contract on screen.
  it('keeps the held reading when the selected contract changes', () => {
    const onLoadHistory = vi.fn()
    const history = {
      symbol: 'BTCUSDT',
      status: 'ready',
      readAt: 1_784_000_100_000,
      orders: [],
      trades: [{ id: 4, side: 'SELL', price: '58500', quantity: '0.004', commission: '0.02', realizedPnl: '12.5', time: 1 }],
      error: null,
    }
    const { rerender } = render(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" onLoadHistory={onLoadHistory} history={history} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    rerender(
      <FuturesPortfolioDock selectedSymbol="ETHUSDT" onLoadHistory={onLoadHistory} history={history} />,
    )

    expect(screen.getByRole('table', { name: 'Position history' })).toHaveTextContent('+12.50')
    expect(onLoadHistory).not.toHaveBeenCalled()
  })

  // Both readings are stated out loud; which one is stated depends on whether
  // the account has been read. A dock with no account state behind it knows
  // nothing, and said "nothing is open".
  it('states emptiness explicitly instead of rendering a blank strip', () => {
    const read = { status: 'ready', data: [], lastSuccessfulAt: 1_760_000_000_000, error: null }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        accountResources={{ positions: read, regularOrders: read, algoOrders: read }}
      />,
    )
    expect(screen.getByText('No open positions.')).toBeInTheDocument()
    expect(screen.getByText('No working orders.')).toBeInTheDocument()
  })

  it('says it has not read the account when nothing tells it that it has', () => {
    render(<FuturesPortfolioDock selectedSymbol="BTCUSDT" />)
    expect(screen.getAllByText('Not read yet.')).toHaveLength(2)
    expect(screen.queryByText('No open positions.')).toBeNull()
    expect(screen.queryByText('No working orders.')).toBeNull()
  })

  // An unstyled control does not fail loudly: it renders as a browser button
  // face — a white rectangle in a dark row — and only the selected contract's
  // row is affected, so the same datum looks like two different things.
  it('styles every class it renders, so no cell falls back to a browser control', () => {
    const here = 'src/components/features/futures'
    const component = readFileSync(`${here}/FuturesPortfolioDock.jsx`, 'utf8')
    const stylesheet = readFileSync(`${here}/FuturesWorkstation.css`, 'utf8')
    const rendered = [...component.matchAll(/className=(?:"([^"{}]+)"|\{`([^`${}]+)`)/g)]
      .flatMap(match => (match[1] ?? match[2]).split(/\s+/))
      .filter(name => name.startsWith('futures-'))
    expect(rendered.length).toBeGreaterThan(0)
    for (const name of new Set(rendered)) {
      expect(stylesheet, `${name} has no rule`).toContain(`.${name}`)
    }
  })

  it('uses calm structural colors while retaining semantic gain and loss colors', () => {
    const stylesheet = readFileSync(
      'src/components/features/futures/FuturesWorkstation.css',
      'utf8',
    )
    const workstationRules = [...stylesheet.matchAll(
      /\.futures-production-workstation\s*\{(?<declarations>[^}]*)\}/g,
    )]
    const preview = workstationRules.at(-1)?.groups?.declarations

    expect(preview).toContain('--futures-accent: #4f8fc7;')
    expect(preview).toContain('--futures-accent-soft: rgba(79, 143, 199, 0.16);')
    expect(preview).toContain('--futures-border: rgba(105, 122, 140, 0.32);')
    expect(preview).toContain('--futures-shell: #0b1118;')
    expect(preview).not.toContain('#e34f5e')

    const positiveRule = stylesheet.match(
      /\.futures-workstation-dock-total\.is-positive\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations
    const negativeRule = stylesheet.match(
      /\.futures-workstation-dock-total\.is-negative\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations
    expect(positiveRule).toContain('rgba(43, 196, 138, 0.45)')
    expect(negativeRule).toContain('rgba(239, 91, 105, 0.45)')
  })

  it('gives every deliberate workstation scroll owner compact chrome', () => {
    const stylesheet = readFileSync(
      'src/components/features/futures/FuturesWorkstation.css',
      'utf8',
    )
    const owners = ':is(.futures-workstation-recent-contracts, .futures-workstation-contract-list, .futures-production-execution-body, .futures-workstation-trade-rows, .futures-workstation-dock-table)'
    const declarationsFor = selector => {
      const ruleStart = stylesheet.indexOf(`${selector} {`)
      expect(ruleStart, `${selector} rule exists`).toBeGreaterThan(-1)
      const bodyStart = stylesheet.indexOf('{', ruleStart) + 1
      return stylesheet.slice(bodyStart, stylesheet.indexOf('}', bodyStart))
    }

    const fallback = declarationsFor(owners)
    expect(fallback).toContain('scrollbar-width: thin;')
    expect(fallback).toContain('scrollbar-color:')

    const axes = declarationsFor(`${owners}::-webkit-scrollbar`)
    expect(axes).toContain('width: 6px;')
    expect(axes).toContain('height: 6px;')
    expect(declarationsFor(`${owners}::-webkit-scrollbar-track`))
      .toContain('background: transparent;')
    expect(declarationsFor(`${owners}::-webkit-scrollbar-corner`))
      .toContain('background: transparent;')
    expect(declarationsFor(`${owners}::-webkit-scrollbar-button`))
      .toContain('display: none;')

    const thumb = declarationsFor(`${owners}::-webkit-scrollbar-thumb`)
    expect(thumb).toContain('border-radius: 999px;')
    expect(thumb).toContain('background: rgba(126, 143, 166, 0.5);')
    expect(declarationsFor(`${owners}::-webkit-scrollbar-thumb:hover`))
      .toContain('background: rgba(126, 143, 166, 0.78);')
  })

  // "No open positions" and "not read yet" call for opposite actions, and the
  // dock used to give the first reading for both.
  it('does not report an empty account before the first read answers', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[]}
        openOrders={[]}
        accountResources={{
          positions: { status: 'loading', data: [], lastSuccessfulAt: null, error: null },
          regularOrders: { status: 'loading', data: [], lastSuccessfulAt: null, error: null },
          algoOrders: { status: 'loading', data: [], lastSuccessfulAt: null, error: null },
        }}
      />,
    )

    // Both panels say it: positions and working orders are read separately.
    expect(screen.getAllByText('Not read yet.')).toHaveLength(2)
    expect(screen.queryByText('No open positions.')).toBeNull()
    expect(screen.queryByText('No working orders.')).toBeNull()
    expect(screen.getByText('— open')).toBeInTheDocument()
  })

  it('says the read failed rather than reporting nothing open', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[]}
        openOrders={[]}
        accountResources={{
          positions: {
            status: 'error',
            data: [],
            lastSuccessfulAt: null,
            error: { code: 'READ_FAILED', message: 'Positions read failed.' },
          },
        }}
      />,
    )

    expect(screen.getByText('Not read — the account read failed.')).toBeInTheDocument()
  })

  it('reports an account that really is flat once the read has answered', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[]}
        openOrders={[]}
        accountResources={{
          positions: { status: 'ready', data: [], lastSuccessfulAt: 1000, error: null },
          regularOrders: { status: 'ready', data: [], lastSuccessfulAt: 1000, error: null },
          algoOrders: { status: 'ready', data: [], lastSuccessfulAt: 1000, error: null },
        }}
      />,
    )

    expect(screen.getByText('No open positions.')).toBeInTheDocument()
    expect(screen.getByText('0 open')).toBeInTheDocument()
  })

})
