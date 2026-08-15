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

  it('lists orders at the contract tick with what became of them', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        history={history}
        tickSizes={ticks}
      />,
    )
    const table = screen.getByRole('table', { name: 'Order history' })
    // It filled away from the price it named, so the price cell states what it
    // got; both readings stay on the element.
    expect(table).toHaveTextContent('≈57999.9')
    expect(table).not.toHaveTextContent('58000.123456')
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    expect(cells[5]).toHaveAttribute('title', 'Placed at 58000.1, filled at 57999.9')
    expect(cells[0]).toHaveTextContent('Filled')
  })

  // The status column was 62.7px wide at the width the dock leaves this panel,
  // and PARTIALLY_FILLED needs 125px. It ellipsized with no title behind it, so
  // the exchange's own word was not merely cut — it could not be recovered.
  it('states the outcome in its own words and keeps the exchange word on the element', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          orders: [
            { orderId: 21, symbol: 'BICOUSDT', side: 'BUY', type: 'LIMIT', status: 'PARTIALLY_FILLED', price: '2.5', averagePrice: '2.5', origQty: '1000', executedQty: '380', reduceOnly: false, time: 1_784_000_000_003 },
            { orderId: 22, symbol: 'BICOUSDT', side: 'SELL', type: 'LIMIT', status: 'EXPIRED_IN_MATCH', price: '2.5', averagePrice: '0', origQty: '1000', executedQty: '0', reduceOnly: false, time: 1_784_000_000_002 },
            { orderId: 23, symbol: 'BICOUSDT', side: 'BUY', type: 'LIMIT', status: 'NEW', price: '2.5', averagePrice: '0', origQty: '1000', executedQty: '0', reduceOnly: false, time: 1_784_000_000_001 },
            { orderId: 24, symbol: 'BICOUSDT', side: 'BUY', type: 'LIMIT', status: 'FILLED', price: '2.5', averagePrice: '2.5', origQty: '1000', executedQty: '1000', reduceOnly: false, time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    const rows = screen.getAllByRole('row')
    const outcome = index => within(rows[index]).getAllByRole('cell')[0]

    // A partial fill states its proportion, which is the reading `0 / 9080`
    // could never give at a glance.
    expect(outcome(1)).toHaveTextContent('Part 38%')
    expect(within(outcome(1)).getByTitle('PARTIALLY_FILLED')).toBeInTheDocument()
    expect(outcome(2)).toHaveTextContent('Expired')
    expect(within(outcome(2)).getByTitle('EXPIRED_IN_MATCH')).toBeInTheDocument()
    expect(outcome(3)).toHaveTextContent('Open')
    expect(outcome(4)).toHaveTextContent('Filled')

    // An order that executed nothing is quieter than one that did, and is still
    // present and readable.
    expect(rows[2].className).toContain('is-idle')
    expect(rows[3].className).toContain('is-idle')
    expect(rows[1].className).not.toContain('is-idle')
    expect(rows[4].className).not.toContain('is-idle')
  })

  // `· RO` was two letters the row never expanded, and the exchange's order
  // types run to eighteen characters in a track of eighty pixels.
  it('shortens the order type and says reduce-only in words', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          orders: [
            { orderId: 31, symbol: 'BICOUSDT', side: 'SELL', type: 'TAKE_PROFIT_MARKET', status: 'NEW', price: '0', averagePrice: '0', origQty: '100', executedQty: '0', reduceOnly: true, time: 1_784_000_000_001 },
            { orderId: 32, symbol: 'BICOUSDT', side: 'BUY', type: 'LIMIT', status: 'NEW', price: '2.5', averagePrice: '0', origQty: '100', executedQty: '0', reduceOnly: false, time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    const rows = screen.getAllByRole('row')
    const reduceOnly = within(rows[1]).getAllByRole('cell')[3]
    expect(reduceOnly).toHaveTextContent('TP MKT')
    expect(reduceOnly).toHaveTextContent('exit')
    expect(reduceOnly).not.toHaveTextContent('RO')
    expect(reduceOnly.getAttribute('title'))
      .toBe('TAKE_PROFIT_MARKET · reduce-only — this order can only close a position')

    const plain = within(rows[2]).getAllByRole('cell')[3]
    expect(plain).toHaveTextContent('LIMIT')
    expect(plain).not.toHaveTextContent('exit')
    expect(plain.getAttribute('title')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Type' }).getAttribute('title'))
      .toContain('reduce-only')
  })

  it('states reported or derived filled notional in USDT and keeps quantities secondary', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          orders: [
            { orderId: 11, symbol: 'BICOUSDT', side: 'BUY', type: 'LIMIT', status: 'FILLED', price: '0.20', averagePrice: '0.19822', origQty: '16441', executedQty: '16441', quoteQty: '3259000.25', reduceOnly: false, time: 1_784_000_000_000 },
            { orderId: 12, symbol: 'BICOUSDT', side: 'BUY', type: 'MARKET', status: 'FILLED', price: '0', averagePrice: '0.01962', origQty: '5000', executedQty: '5000', quoteQty: '0', reduceOnly: false, time: 1_784_000_000_001 },
            { orderId: 13, symbol: 'BICOUSDT', side: 'SELL', type: 'LIMIT', status: 'NEW', price: '0.020', averagePrice: '0', origQty: '10000', executedQty: '0', quoteQty: '0', reduceOnly: false, time: 1_784_000_000_002 },
          ],
        }}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Filled USDT' }))
      .toHaveAttribute('title', 'Filled notional in USDT')
    const rows = screen.getAllByRole('row')
    const reported = within(rows[1]).getAllByRole('cell')[4]
    const derived = within(rows[2]).getAllByRole('cell')[4]
    const absent = within(rows[3]).getAllByRole('cell')[4]

    expect(reported).toHaveTextContent('3.26M')
    expect(reported).toHaveAttribute(
      'title',
      '3259000.25 USDT · reported by the exchange · 16441 / 16441 contracts · placed for 3288.20 USDT',
    )
    expect(derived).toHaveTextContent('98.10')
    expect(derived.getAttribute('title')).toContain(
      '98.1 USDT · derived from executed quantity × average fill price · 5000 / 5000 contracts',
    )
    // An order that executed nothing still had a size, and the column states
    // what happened rather than what was asked for — so what it was placed for
    // rides on the element.
    expect(absent).toHaveTextContent('—')
    expect(absent).toHaveAttribute(
      'title',
      '0 / 10000 contracts · executed USDT unavailable · placed for 200.00 USDT',
    )
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
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(2)
    // The outcome cell, not the `Filled USDT` header beside it.
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('Filled')
    expect(table).not.toHaveTextContent('Cancelled')
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
    // One price cell rather than two columns: an order that named no price is
    // read for what it got, and one that has not filled for what it names.
    const rows = screen.getAllByRole('row')
    const market = within(rows[1]).getAllByRole('cell')[5]
    expect(market).toHaveTextContent('≈2.630')
    expect(market.getAttribute('title'))
      .toBe('No price was named — this is the average of 3135 contracts filled')
    const working = within(rows[2]).getAllByRole('cell')[5]
    expect(working).toHaveTextContent('8.120')
    expect(working).not.toHaveTextContent('≈')
    expect(working.getAttribute('title')).toBeNull()
    expect(screen.getByRole('table', { name: 'Order history' })).not.toHaveTextContent('0.000')
  })

  // The row's own format used to carry the day — a time for today, a date for
  // anything older — so `20:42:12` and `09.08` sat one above the other in one
  // undivided list with nothing saying they were different kinds of stamp. The
  // day is a heading now, and every row shows the time within it.
  it('groups rows under the day they belong to and times every row', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          orders: [
            // Now, not a minute ago: in the first minute after midnight a
            // minute ago is yesterday.
            { ...history.orders[0], orderId: 7, time: Date.now() },
            { ...history.orders[0], orderId: 8, time: 1_784_000_000_000 },
          ],
        }}
      />,
    )
    const days = screen.getAllByRole('rowgroup')
    expect(days).toHaveLength(2)
    expect(days[0]).toHaveAccessibleName('Today')
    expect(days[1]).toHaveAccessibleName(/^\d{2}\.\d{2}$/)

    const rows = screen.getAllByRole('row')
    const today = within(rows[1]).getAllByRole('cell')[2]
    const older = within(rows[2]).getAllByRole('cell')[2]
    expect(today).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/)
    expect(older).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/)
    expect(today.getAttribute('title')).toBeTruthy()
    expect(older.getAttribute('title')).toBeTruthy()
  })

  // Narrowing reads the reading already held. The panel issues no read of its
  // own, and the line beneath the table describes the read rather than what a
  // filter left of it.
  it('narrows the held reading without changing what the read covered', () => {
    const onSymbolChange = vi.fn()
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        onSymbolChange={onSymbolChange}
        tickSizes={ticks}
        history={{
          ...history,
          symbols: ['BTCUSDT', 'BICOUSDT'],
          discovered: 2,
          orders: [
            { orderId: 41, symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', status: 'FILLED', price: '58000.1', averagePrice: '58000.1', origQty: '1', executedQty: '1', reduceOnly: false, time: 1_784_000_000_002 },
            { orderId: 42, symbol: 'BICOUSDT', side: 'SELL', type: 'LIMIT', status: 'EXPIRED', price: '2.5', averagePrice: '0', origQty: '100', executedQty: '0', reduceOnly: false, time: 1_784_000_000_001 },
          ],
        }}
      />,
    )
    const scope = '2 contracts read'
    expect(screen.getByText(new RegExp(scope))).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Filled' }))
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('table', { name: 'Order history' })).toHaveTextContent('BTCUSDT')
    expect(screen.getByText(new RegExp(scope))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unfilled' }))
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('table', { name: 'Order history' })).toHaveTextContent('BICOUSDT')

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('button', { name: 'This contract' }))
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('table', { name: 'Order history' })).toHaveTextContent('BTCUSDT')
    // The read was never asked to happen again, and the statement of what it
    // covered is untouched by the narrowing.
    expect(screen.getByText(new RegExp(scope))).toBeInTheDocument()
    expect(onSymbolChange).not.toHaveBeenCalled()
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
    expect(screen.getByRole('table', { name: 'Order history' })).toHaveTextContent('≈57999.9')
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
