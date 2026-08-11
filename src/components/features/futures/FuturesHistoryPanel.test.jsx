import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesHistoryPanel from './FuturesHistoryPanel.jsx'

const ticks = Object.freeze({ BTCUSDT: '0.1', BICOUSDT: '0.001', ETHUSDT: '0.01' })

const history = Object.freeze({
  symbol: 'BTCUSDT',
  status: 'ready',
  // A reading exists: the panel renders rows from what was read, and `readAt`
  // is what says a reading was ever taken.
  readAt: 1_784_000_100_000,
  orders: Object.freeze([Object.freeze({
    orderId: 3,
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    status: 'FILLED',
    price: '58000.123456',
    averagePrice: '57999.9',
    origQty: '0.004',
    executedQty: '0.004',
    reduceOnly: false,
    time: 1_784_000_000_000,
  })]),
  trades: Object.freeze([Object.freeze({
    id: 9,
    orderId: 3,
    symbol: 'BTCUSDT',
    side: 'SELL',
    price: '58500',
    quantity: '0.004',
    commission: '0.0234',
    realizedPnl: '-96.74',
    time: 1_784_000_000_000,
  })]),
  error: null,
})

describe('FuturesHistoryPanel', () => {
  // The exchange reports executions; the operator trades positions. One close of
  // one position arrives as five fills in the same second, and five rows carrying
  // a fifth of the PnL each is not the number a session is reviewed with.
  it('reports one row per position rather than one per execution', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbol: 'BICOUSDT',
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2.554', quantity: '3000', commission: '0.0306', realizedPnl: '0', time: 1_784_000_000_000 },
            { id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '2.632', quantity: '1000', commission: '0.0105', realizedPnl: '78', time: 1_784_000_002_000 },
            { id: 3, symbol: 'BICOUSDT', side: 'SELL', price: '2.632', quantity: '2000', commission: '0.0210', realizedPnl: '156', time: 1_784_000_002_000 },
          ],
        }}
      />,
    )
    const table = screen.getByRole('table', { name: 'Position history' })
    // One data row under the heading row, for three fills.
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(table).toHaveTextContent('LONG')
    expect(table).toHaveTextContent('2.554')
    expect(table).toHaveTextContent('2.632')
    // 3 000 contracts entered at 2.554 is 7 662 USDT — the size the desk sizes in.
    expect(table).toHaveTextContent('7662')
    // The whole round's PnL, not a fill's slice of it.
    expect(table).toHaveTextContent('+234.00')
    // The fee is a component of the result, not a column of its own: it was
    // crowding the only reading this panel exists for off the right edge.
    expect(table).not.toHaveTextContent('0.0621')
    // Realized PnL is reported before commission, so the net is stated apart.
    expect(within(table).getByTitle(/\+234\.00 realized less 0\.0621 in fees is \+233\.94 net/))
      .toBeInTheDocument()
  })

  // The window of trades the exchange returns is bounded: its oldest rows can be
  // the closing fills of a position opened before it. That position was still
  // entered at a knowable price — the realized PnL states it — so the row reports
  // it rather than showing a dash where the entry belongs.
  it('recovers the entry price of a position opened before the window', () => {
    render(
      <FuturesHistoryPanel view="tradeHistory" symbol="BTCUSDT" history={history} tickSizes={ticks} />,
    )
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('BTCUSDT')
    // A SELL that realizes PnL closed a long, whatever the side of the fill says.
    expect(cells[2]).toHaveTextContent('LONG')
    // 0.004 sold at 58500 for a loss of 96.74 was entered at 82685.
    expect(cells[4]).toHaveTextContent('82685.0')
    expect(cells[4]).toHaveAttribute(
      'title',
      'Opened before this window of trades — entry recovered from the realized PnL',
    )
    expect(cells[5]).toHaveTextContent('58500.0')
    expect(cells[6]).toHaveTextContent('−96.74')
  })

  // A position still running has no exit and no result. It belongs to the live
  // positions table, and among closed rows it read as noise.
  it('lists closed positions only, never one that is still open', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2.554', quantity: '3000', commission: '0.03', realizedPnl: '0', time: 1_784_000_000_000 },
            { id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '2.632', quantity: '3000', commission: '0.03', realizedPnl: '234', time: 1_784_000_002_000 },
            // Opened after it and never closed: no exit, no result, not history.
            { id: 3, symbol: 'BICOUSDT', side: 'BUY', price: '2.600', quantity: '1000', commission: '0.01', realizedPnl: '0', time: 1_784_000_004_000 },
          ],
        }}
      />,
    )
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(within(rows[1]).getAllByRole('cell')[3]).toHaveTextContent('7662')
    expect(screen.getByRole('table')).not.toHaveTextContent('open')
  })

  // A contract count is a size only next to the price of the contract. 237 518 BMT
  // and 5 210 BEAT are the same column of digits and nothing like the same money.
  it('sizes a closed position in USDT and keeps the contract count on the row', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2.500', quantity: '4000', commission: '0.03', realizedPnl: '0', time: 1_784_000_000_000 },
            { id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '2.600', quantity: '4000', commission: '0.03', realizedPnl: '400', time: 1_784_000_002_000 },
          ],
        }}
      />,
    )
    const size = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[3]
    // 4 000 at 2.5 is 10 000 USDT, which the narrow column abbreviates.
    expect(size).toHaveTextContent('10.0k')
    expect(size).toHaveAttribute('title', '4000 contracts · 2 fills')
  })

  // The read is bounded on both axes — how many contracts, and how far back the
  // fills reach. An operator who cannot find two days of losses must be able to
  // tell "there were none" from "this list does not go there".
  it('states how many contracts were read and how far back the fills reach', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbols: ['BICOUSDT', 'BTCUSDT'],
          discovered: 17,
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2.500', quantity: '4000', commission: '0.03', realizedPnl: '0', time: 1_784_000_000_000 },
            { id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '2.600', quantity: '4000', commission: '0.03', realizedPnl: '400', time: 1_784_000_002_000 },
          ],
        }}
      />,
    )
    expect(screen.getByText(/2 of 17 contracts read/))
      .toHaveTextContent(new Date(1_784_000_000_000).toLocaleString())
  })

  // The count of contracts is itself a read that can fail or run out of pages.
  // Stated flatly it reads as a total, which is the same fault one level up.
  it('says when it does not know how many contracts were traded', () => {
    const trades = [
      { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2.500', quantity: '4000', commission: '0.03', realizedPnl: '0', time: 1_784_000_000_000 },
      { id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '2.600', quantity: '4000', commission: '0.03', realizedPnl: '400', time: 1_784_000_002_000 },
    ]
    const { rerender } = render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history, symbols: ['BICOUSDT'], discovered: 1, discoveryComplete: false, trades,
        }}
      />,
    )
    expect(screen.getByText(/more may have been traded/)).toBeInTheDocument()

    rerender(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history, symbols: ['BICOUSDT'], discovered: 1, discoveryComplete: true, trades,
        }}
      />,
    )
    expect(screen.queryByText(/more may have been traded/)).not.toBeInTheDocument()
  })

  it('says so plainly when the window holds no closed position at all', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbols: ['BTCUSDT', 'BICOUSDT'],
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '2.554', quantity: '3000', commission: '0.03', realizedPnl: '0', time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // An empty table is only informative if the operator knows how wide the read
    // was: the backend reads a bounded set of contracts.
    expect(screen.getByText('No closed positions across the 2 contracts read.')).toBeInTheDocument()
  })

  it('lists orders at the contract tick with their status', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        history={history}
        tickSizes={ticks}
      />,
    )
    const table = screen.getByRole('table', { name: 'Order history' })
    expect(table).toHaveTextContent('58000.1')
    expect(table).not.toHaveTextContent('58000.123456')
    expect(table).toHaveTextContent('FILLED')
  })

  it('hides both cancelled spellings without changing the held order reading', () => {
    const heldOrders = [
      { ...history.orders[0], orderId: 4, status: 'CANCELED' },
      { ...history.orders[0], orderId: 5, status: 'CANCELLED' },
      { ...history.orders[0], orderId: 6, status: 'FILLED' },
    ]
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        history={{ ...history, orders: heldOrders }}
        tickSizes={ticks}
      />,
    )

    const table = screen.getByRole('table', { name: 'Order history' })
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(table).toHaveTextContent('FILLED')
    expect(table).not.toHaveTextContent('CANCELED')
    expect(table).not.toHaveTextContent('CANCELLED')
    expect(heldOrders.map(order => order.status)).toEqual(['CANCELED', 'CANCELLED', 'FILLED'])
  })

  // A market order carries no limit price and an order that has not filled carries
  // no average: Binance reports 0 for both, and `0.000` in a price column reads as
  // a level the market could reach rather than as an absence.
  it('reports a price the order does not have as absent, not as zero', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          orders: [
            { orderId: 5, symbol: 'BICOUSDT', side: 'SELL', type: 'MARKET', status: 'FILLED', price: '0', averagePrice: '2.630', origQty: '3135', executedQty: '3135', reduceOnly: true, time: 1_784_000_000_000 },
            { orderId: 6, symbol: 'BICOUSDT', side: 'SELL', type: 'LIMIT', status: 'NEW', price: '8.120', averagePrice: '0', origQty: '1623', executedQty: '0', reduceOnly: false, time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    const rows = screen.getAllByRole('row')
    const market = within(rows[1]).getAllByRole('cell')
    expect(market[4]).toHaveTextContent('—')
    expect(market[6]).toHaveTextContent('2.630')
    const working = within(rows[2]).getAllByRole('cell')
    expect(working[4]).toHaveTextContent('8.120')
    expect(working[6]).toHaveTextContent('—')
    expect(screen.getByRole('table', { name: 'Order history' })).not.toHaveTextContent('0.000')
  })

  // The column carried both halves of the stamp and ellipsized the one that
  // mattered: `10.08 11:21:…`. Today is read for its time of day, any other day
  // for the day, and the whole stamp stays in the title.
  it('shows the time for today’s rows and the date for older ones', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          orders: [
            { ...history.orders[0], orderId: 7, time: Date.now() - 60_000 },
            { ...history.orders[0], orderId: 8, time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    const rows = screen.getAllByRole('row')
    const today = within(rows[1]).getAllByRole('cell')[1]
    const older = within(rows[2]).getAllByRole('cell')[1]
    expect(today).toHaveTextContent(/\d{1,2}:\d{2}/)
    expect(older).not.toHaveTextContent(/\d{1,2}:\d{2}/)
    expect(today.getAttribute('title')).toBeTruthy()
    expect(older.getAttribute('title')).toBeTruthy()
  })

  it('reports a failed history read without pretending the account is empty', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        history={{ ...history, status: 'error', trades: [], error: { code: 'FUTURES_API_ERROR', message: 'key refused' } }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('key refused')
  })

  it('waits for a load rather than presenting an unloaded account as empty', () => {
    render(<FuturesHistoryPanel view="tradeHistory" symbol="ETHUSDT" history={null} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Open history to load it.')
  })

  // A session is reviewed whole: half of it was on contracts the operator has
  // since switched away from, and scoping the tab to the chart hid exactly those.
  it('reports every contract the account traded, each at its own tick', () => {
    const onSymbolChange = vi.fn()
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        onSymbolChange={onSymbolChange}
        history={{
          ...history,
          trades: [
            { id: 9, symbol: 'BTCUSDT', side: 'SELL', price: '58500.16', quantity: '0.004', commission: '0.02', realizedPnl: '-96.74', time: 1_784_000_002_000 },
            { id: 4, symbol: 'BICOUSDT', side: 'SELL', price: '2.6329', quantity: '1000', commission: '0.01', realizedPnl: '78', time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)
    // Newest first, whichever contract it is on, and each price at its own tick.
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('BTCUSDT')
    expect(within(rows[1]).getAllByRole('cell')[5]).toHaveTextContent('58500.2')
    expect(within(rows[2]).getAllByRole('cell')[0]).toHaveTextContent('BICOUSDT')
    expect(within(rows[2]).getAllByRole('cell')[5]).toHaveTextContent('2.633')
    // The selected contract's rows are marked, not the only ones shown.
    expect(rows[1].className).toContain('is-current-symbol')
    expect(rows[2].className).not.toContain('is-current-symbol')
    // Reviewing a contract is usually the reason to go back to it.
    fireEvent.click(screen.getByRole('button', { name: 'Show BICOUSDT' }))
    expect(onSymbolChange).toHaveBeenCalledWith('BICOUSDT')
  })
  // A refresh used to blank the table: the operator watched rows they were
  // reading disappear and waited for them again.
  it('keeps the rows on screen while a re-read is in flight', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, status: 'refreshing' }}
      />,
    )
    expect(screen.getByRole('table', { name: 'Order history' })).toHaveTextContent('58000.1')
    expect(screen.getByRole('status')).toHaveTextContent('Re-reading the account…')
  })

  it('states a failed re-read beside the reading it could not replace', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          status: 'ready',
          error: { code: 'FUTURES_API_ERROR', message: 'Binance refused the read.' },
        }}
      />,
    )
    expect(screen.getByRole('table', { name: 'Order history' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Binance refused the read.')
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the reading taken')
  })

  it('says nothing has been read rather than showing an empty review', () => {
    render(<FuturesHistoryPanel view="orderHistory" symbol="BTCUSDT" history={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Open history to load it.')
  })

  // The count describes the read. Rows the stream added are not a read, and
  // saying otherwise would claim coverage nobody paid for.
  it('counts what the stream added apart from what was read', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbols: ['BTCUSDT'],
          discovered: 1,
          foldedOrders: ['BTCUSDT:9'],
        }}
      />,
    )
    expect(screen.getByText(/1 contract read/)).toHaveTextContent('1 added since')
  })
})
