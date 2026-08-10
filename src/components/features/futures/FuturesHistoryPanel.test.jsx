import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FuturesHistoryPanel from './FuturesHistoryPanel.jsx'

const history = Object.freeze({
  symbol: 'BTCUSDT',
  status: 'ready',
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
  it('lists trades with signed realized PnL and the fee paid', () => {
    render(<FuturesHistoryPanel view="tradeHistory" symbol="BTCUSDT" history={history} />)
    const table = screen.getByRole('table', { name: 'Trade history' })
    expect(table).toHaveTextContent('SELL')
    expect(table).toHaveTextContent('−96.74')
    expect(table).toHaveTextContent('0.0234')
  })

  it('lists orders at the contract tick with their status', () => {
    render(
      <FuturesHistoryPanel
        view="orderHistory"
        symbol="BTCUSDT"
        history={history}
        tickSize="0.1"
      />,
    )
    const table = screen.getByRole('table', { name: 'Order history' })
    expect(table).toHaveTextContent('58000.1')
    expect(table).not.toHaveTextContent('58000.123456')
    expect(table).toHaveTextContent('FILLED')
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

  it('never shows another contract history under the selected one', () => {
    render(<FuturesHistoryPanel view="tradeHistory" symbol="ETHUSDT" history={history} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Open history to load ETHUSDT.')
  })
})
