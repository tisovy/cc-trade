import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesHistoryPanel, {
  FUTURES_CLOSED_POSITION_WINDOW_SIZE,
  FUTURES_CLOSED_POSITION_WINDOW_STEP,
} from './FuturesHistoryPanel.jsx'
import FuturesPortfolioDock from './FuturesPortfolioDock.jsx'
import { NotificationContext } from '../../../context/NotificationContext.js'
import { buildFuturesTradeRounds } from '../../../utils/futuresTradeRounds.js'

const ticks = Object.freeze({
  BTCUSDT: '0.1', BTCUSDC: '0.1', BICOUSDT: '0.001', ETHUSDT: '0.01',
})

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
    marginAsset: 'USDT',
    realizedPnl: '-96.74',
    time: 1_784_000_000_000,
  })]),
  error: null,
})

const indexedClosedRound = (overrides = {}) => ({
  key: 'wallet-round-1',
  symbol: 'BTCUSDT',
  positionSide: 'LONG',
  quantity: '1',
  fills: 2,
  notional: 60_000,
  entryPrice: 60_000,
  exitPrice: 60_100,
  realizedPnl: 10,
  settlementAsset: 'USDT',
  netPnl: 9,
  netExact: true,
  wallet: {
    walletNet: { asset: 'USDT', amount: '9' },
    visibleNet: [{ asset: 'USDT', amount: '9' }],
    qualifications: [],
  },
  feesByAsset: [],
  openTime: 1_784_000_000_000,
  closeTime: 1_784_000_002_000,
  open: false,
  ...overrides,
})

const canonicalFixtureIndex = historyValue => ({
  closed: buildFuturesTradeRounds(historyValue?.trades?.map(trade => ({
    marginAsset: 'USDT',
    ...trade,
  })))
    .filter(round => !round.open && round.exitPrice !== null)
    .map((round) => {
      const visibleNet = [{
        asset: round.settlementAsset,
        amount: Number(round.netPnl).toFixed(2),
      }]
      for (const fee of round.feesByAsset ?? []) {
        if (fee.asset === round.settlementAsset) continue
        visibleNet.push({
          asset: fee.asset,
          amount: `-${fee.amountExact ?? fee.amount}`,
        })
      }
      const qualifications = [visibleNet.length > 1
        ? 'MULTI_ASSET'
        : 'OWNERSHIP_NOT_ADDITIVE']
      return {
        ...round,
        netExact: false,
        wallet: {
          walletNet: null,
          visibleNet,
          qualifications,
        },
      }
    }),
  unresolved: [],
  sharedAdjustments: [],
})

const CanonicalHistoryPanelFixture = props => (
  <FuturesHistoryPanel
    {...props}
    tradeRoundIndex={props.tradeRoundIndex
      ?? canonicalFixtureIndex(props.history)}
  />
)

describe('FuturesHistoryPanel', () => {
  // The exchange reports executions; the operator trades positions. One close of
  // one position arrives as five fills in the same second, and five rows carrying
  // a fifth of the PnL each is not the number a session is reviewed with.
  it('reports one row per position rather than one per execution', () => {
    render(
      <CanonicalHistoryPanelFixture
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
    // The whole round's exchange PnL, not a fill's slice of it.
    expect(table).toHaveTextContent('+234.00')
    // The fee is a component of the result, not a column of its own: it was
    // crowding the only reading this panel exists for off the right edge.
    expect(table).not.toHaveTextContent('0.0621')
    // The wallet subtotal and its qualification ride the PnL cell's element
    // rather than taking a second money column of their own.
    const money = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[6]
    expect(money.getAttribute('title')).toContain(
      'Visible net: +233.94 USDT · Exact ownership is not established',
    )
    expect(table).not.toHaveTextContent('Exact ownership is not established')
  })

  it('shows the complete reconstructed round after a break-even edge close and add', () => {
    render(
      <CanonicalHistoryPanelFixture
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbol: 'BICOUSDT',
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'SELL', price: '100', quantity: '4', commission: '1', realizedPnl: '0', time: 1000 },
            { id: 2, symbol: 'BICOUSDT', side: 'BUY', price: '90', quantity: '2', commission: '2', realizedPnl: '0', time: 2000 },
            { id: 3, symbol: 'BICOUSDT', side: 'SELL', price: '120', quantity: '8', commission: '3', realizedPnl: '190', time: 3000 },
          ],
        }}
      />,
    )

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(2)
    const cells = within(rows[1]).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('LONG')
    expect(cells[3]).toHaveAttribute('title', 'Closed volume: 12 contracts · 3 fills')
    expect(cells[4]).toHaveTextContent('97.500')
    expect(cells[4]).toHaveAttribute(
      'title',
      'Opened before this window of trades — entry recovered from the realized PnL',
    )
    const recovered = within(cells[4]).getByRole('note', {
      name: 'Recovered entry price from exchange realized PnL',
    })
    expect(recovered).toHaveTextContent('Recovered')
    expect(recovered).toHaveAttribute('tabindex', '0')
    recovered.focus()
    expect(recovered).toHaveFocus()
    expect(cells[5]).toHaveTextContent('113.333')
    // One money column: the figure Binance reports and its app shows, at cents.
    // The fill subtotal the wallet ledger has not yet proven exact is a
    // different quantity, so it rides the element under its own name.
    expect(cells).toHaveLength(7)
    expect(cells[6]).toHaveTextContent('+190.00 USDT')
    expect(cells[6].getAttribute('title')).toContain(
      'Visible net: +184.00 USDT · Exact ownership is not established',
    )
    expect(screen.queryByText('SHORT')).not.toBeInTheDocument()
  })

  it('keeps the exact Wallet Net on the PnL element instead of a second money column', () => {
    const exactAmount = '116.4000000000000000001'
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: [indexedClosedRound({
            netPnl: 116.4,
            wallet: {
              walletNet: { asset: 'USDT', amount: exactAmount },
              visibleNet: [{ asset: 'USDT', amount: exactAmount }],
              qualifications: [],
            },
          })],
          unresolved: [],
          sharedAdjustments: [],
        }}
      />,
    )

    const cells = within(screen.getByRole('row', { name: /BTCUSDT/ }))
      .getAllByRole('cell')
    expect(cells).toHaveLength(7)
    const result = cells[6]
    // The cell shows the exchange figure; the wallet result is named, exact
    // to its last digit, on the element.
    expect(result).toHaveTextContent('+10.00 USDT')
    expect(result).not.toHaveTextContent('Wallet Net')
    expect(result).not.toHaveTextContent('Partial')
    expect(result.getAttribute('title')).toContain(`Wallet Net: +${exactAmount} USDT`)
  })

  it('rounds the PnL cell to cents and keeps the exact figure lossless on the element', () => {
    const exactGross = [
      {
        // Rounded for the glance; the exact string survives on the element.
        key: 'gross-rounded-down',
        realizedPnl: 86.70158975,
        realizedPnlExact: '86.70158975',
        expected: '+86.70 USDT',
        expectedExact: 'Exact +86.70158975 USDT',
      },
      {
        // Half away from zero on the third decimal.
        key: 'gross-rounded-up',
        realizedPnl: 92.577,
        realizedPnlExact: '92.577',
        expected: '+92.58 USDT',
        expectedExact: 'Exact +92.577 USDT',
      },
      {
        // Cents that would print a non-zero amount as 0.00 keep the exact text.
        key: 'gross-positive-sub-cent',
        realizedPnl: 0.0049,
        realizedPnlExact: '0.0049',
        expected: '+0.0049 USDT',
        expectedExact: null,
      },
      {
        key: 'gross-negative-sub-cent',
        realizedPnl: -0.0049,
        realizedPnlExact: '-0.0049',
        expected: '−0.0049 USDT',
        expectedExact: null,
      },
      {
        // Rounding is done on the string: past 2^53 a Number round-trip would
        // state a different figure.
        key: 'gross-beyond-safe-integer',
        realizedPnl: Number('9007199254740993.12'),
        realizedPnlExact: '9007199254740993.12',
        expected: '+9007199254740993.12 USDT',
        expectedExact: null,
      },
      {
        key: 'gross-canonical-negative-zero',
        realizedPnl: -0,
        realizedPnlExact: '-0.0000',
        expected: '0.00 USDT',
        expectedExact: null,
      },
    ]
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: exactGross.map((reading, index) => indexedClosedRound({
            key: reading.key,
            closeTime: 1_784_000_002_000 + index,
            realizedPnl: reading.realizedPnl,
            realizedPnlExact: reading.realizedPnlExact,
          })),
          unresolved: [],
          sharedAdjustments: [],
        }}
      />,
    )

    const table = screen.getByRole('table', { name: 'Position history' })
    for (const reading of exactGross) {
      const gross = within(table.querySelector(`[data-round-key="${reading.key}"]`))
        .getAllByRole('cell')[6]
      expect(gross.textContent).toBe(reading.expected)
      if (reading.expectedExact !== null) {
        expect(gross.getAttribute('title')).toContain(reading.expectedExact)
      }
    }
  })

  it('renders a USDC round gross and exact wallet net in USDC', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDC"
        tickSizes={ticks}
        history={{ ...history, symbol: 'BTCUSDC', trades: [] }}
        tradeRoundIndex={{
          closed: [indexedClosedRound({
            key: 'usdc-round',
            symbol: 'BTCUSDC',
            settlementAsset: 'USDC',
            realizedPnl: 10,
            netPnl: 7,
            wallet: {
              walletNet: { asset: 'USDC', amount: '7' },
              visibleNet: [{ asset: 'USDC', amount: '7' }],
              qualifications: [],
            },
          })],
          unresolved: [],
          sharedAdjustments: [],
        }}
      />,
    )

    const cells = within(screen.getByRole('row', { name: /BTCUSDC/ }))
      .getAllByRole('cell')
    expect(cells).toHaveLength(7)
    expect(cells[6]).toHaveTextContent('+10.00 USDC')
    expect(cells[6]).not.toHaveTextContent('USDT')
    expect(cells[6].getAttribute('title')).toContain('Wallet Net: +7 USDC')
    expect(cells[6].getAttribute('title')).not.toContain('USDT')
  })

  it('names a qualified wallet reading and its reason on the element, not as a row badge', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: [indexedClosedRound({
            netExact: false,
            wallet: {
              walletNet: null,
              visibleNet: [{ asset: 'USDT', amount: '116' }],
              qualifications: ['COMMISSION_COVERAGE_INCOMPLETE'],
            },
          })],
          unresolved: [],
          sharedAdjustments: [],
        }}
      />,
    )

    const row = screen.getByRole('row', { name: /BTCUSDT/ })
    const result = within(row).getAllByRole('cell')[6]
    // The row shows the exchange figure only; the qualified subtotal is named
    // as what it is — a visible net, not a Wallet Net — on the element.
    expect(result.getAttribute('title')).toContain(
      'Visible net: +116 USDT · Commission history is incomplete',
    )
    expect(result.getAttribute('title')).not.toContain('Wallet Net')
    expect(row).not.toHaveTextContent('Visible net')
    expect(within(row).queryByRole('note')).not.toBeInTheDocument()
  })

  // The window of trades the exchange returns is bounded: its oldest rows can be
  // the closing fills of a position opened before it. That position was still
  // entered at a knowable price — the realized PnL states it — so the row reports
  // it rather than showing a dash where the entry belongs.
  it('recovers the entry price of a position opened before the window', () => {
    render(
      <CanonicalHistoryPanelFixture
        view="tradeHistory"
        symbol="BTCUSDT"
        history={history}
        tickSizes={ticks}
      />,
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
    // −96.74 realized, which is Binance's own figure and owns the one money
    // column; less the commission on the fill, which is the wallet result the
    // element names.
    expect(cells).toHaveLength(7)
    expect(cells[6]).toHaveTextContent('−96.74')
    expect(cells[6].getAttribute('title')).toContain('Visible net: −96.76 USDT')
  })

  // Binance charges commission in BNB whenever the account holds it — the
  // default, since it discounts the fee for doing so. Summed as one number a BNB
  // quantity was subtracted from a USDT result: 0.0085 BNB read as 0.0085 USDT
  // on a round that actually paid about five.
  it('states a commission charged in BNB in BNB, and keeps it out of the result', () => {
    render(
      <CanonicalHistoryPanelFixture
        view="tradeHistory"
        symbol="BICOUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbol: 'BICOUSDT',
          trades: [
            { id: 1, symbol: 'BICOUSDT', side: 'BUY', price: '100', quantity: '10', commission: '0.004', commissionAsset: 'BNB', realizedPnl: '0', time: 1_000 },
            { id: 2, symbol: 'BICOUSDT', side: 'SELL', price: '112', quantity: '10', commission: '0.0045', commissionAsset: 'BNB', realizedPnl: '120', time: 5_000 },
          ],
        }}
        settledIncome={{ from: 500, readAt: 9_000, complete: true, rows: [] }}
      />,
    )
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    // The BNB fee is not subtracted from a USDT result — there is no rate here
    // to subtract it by. Both settle-assets are named apart on the element.
    expect(cells).toHaveLength(7)
    expect(cells[6]).toHaveTextContent('+120.00 USDT')
    expect(cells[6].getAttribute('title')).toContain('−0.0085 BNB')
    expect(cells[6].getAttribute('title')).toContain('Amounts settle in multiple assets')
  })

  it('renders BNB-only and multi-asset ledger readings without converting or hiding them', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: [
            indexedClosedRound({
              key: 'bnb-only',
              netPnl: 0,
              wallet: {
                walletNet: { asset: 'BNB', amount: '-0.003' },
                visibleNet: [{ asset: 'BNB', amount: '-0.003' }],
                qualifications: [],
              },
            }),
            indexedClosedRound({
              key: 'multi-asset',
              closeTime: 1_784_000_001_000,
              netExact: false,
              netPnl: 120,
              wallet: {
                walletNet: null,
                visibleNet: [
                  { asset: 'USDT', amount: '120' },
                  { asset: 'BNB', amount: '-0.0045' },
                ],
                qualifications: ['MULTI_ASSET'],
              },
            }),
          ],
          unresolved: [],
          sharedAdjustments: [],
        }}
      />,
    )

    const table = screen.getByRole('table', { name: 'Position history' })
    const bnbResult = within(table.querySelector('[data-round-key="bnb-only"]'))
      .getAllByRole('cell')[6]
    expect(bnbResult.getAttribute('title')).toContain('Wallet Net: −0.003 BNB')

    const multiResult = within(table.querySelector('[data-round-key="multi-asset"]'))
      .getAllByRole('cell')[6]
    expect(multiResult.getAttribute('title')).toContain(
      'Visible net: +120 USDT · −0.0045 BNB · Amounts settle in multiple assets',
    )
  })

  // A position still running has no exit and no result. It belongs to the live
  // positions table, and among closed rows it read as noise.
  it('lists closed positions only, never one that is still open', () => {
    render(
      <CanonicalHistoryPanelFixture
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

  // This is cumulative turnover, not peak position size, and the name must not
  // silently turn one into the other.
  it('names cumulative closed turnover Closed volume and keeps its contract count', () => {
    render(
      <CanonicalHistoryPanelFixture
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
    expect(size).toHaveAttribute('title', 'Closed volume: 4000 contracts · 2 fills')
    expect(screen.getByRole('columnheader', { name: 'Closed volume' })).toBeInTheDocument()
    // One money column named for the quantity it holds — the exchange's own
    // realized PnL. The NET column was ruled noise by the operator (2026-08-23).
    expect(screen.getByRole('columnheader', { name: 'PnL' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Gross' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'NET' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Realized' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Net result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Size' })).not.toBeInTheDocument()
  })

  // The read is bounded on both axes — how many contracts, and how far back the
  // fills reach. An operator who cannot find two days of losses must be able to
  // tell "there were none" from "this list does not go there".
  it('states how many contracts were read and how far back the fills reach', () => {
    render(
      <CanonicalHistoryPanelFixture
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
      <CanonicalHistoryPanelFixture
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
      <CanonicalHistoryPanelFixture
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
      <CanonicalHistoryPanelFixture
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

  it('renders the closed-scoped shared adjustment once and ignores broader open-only money', () => {
    const closedShared = {
      ownerId: 'BTCUSDT',
      symbol: 'BTCUSDT',
      components: ['funding'],
      entryIds: ['income:closed-funding'],
      walletNet: null,
      visibleNet: [{ asset: 'USDT', amount: '-3' }],
      qualifications: [],
    }
    const openOnly = {
      ownerId: 'ETHUSDT',
      symbol: 'ETHUSDT',
      components: ['funding'],
      entryIds: ['income:open-funding'],
      walletNet: null,
      visibleNet: [{ asset: 'USDT', amount: '-9' }],
      qualifications: [],
    }
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: [
            indexedClosedRound(),
            indexedClosedRound({
              key: 'wallet-round-2',
              openTime: 1_783_999_996_000,
              closeTime: 1_783_999_998_000,
            }),
          ],
          unresolved: [],
          // This is the closed-scoped ledger subset consumed by the panel.
          sharedAdjustments: [closedShared],
          // Kept deliberately broader to prove the panel does not reach around
          // its presentation contract and render open-only account money.
          walletLedger: { ownership: { contractShared: [closedShared, openOnly] } },
        }}
      />,
    )

    const shared = screen.getByRole('region', { name: 'Shared wallet adjustments' })
    expect(within(shared).getByText('BTCUSDT shared funding')).toBeInTheDocument()
    expect(within(shared).getAllByText('−3 USDT')).toHaveLength(1)
    expect(within(shared).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('ETHUSDT shared funding')).not.toBeInTheDocument()
    expect(screen.queryByText('−9 USDT')).not.toBeInTheDocument()
  })

  it('labels a delayed global commission credit as unattributed and renders it once', () => {
    const forbiddenMemberEntries = new Proxy(new Array(24_000), {
      get() {
        throw new Error('shared member entries were scanned during render')
      },
    })
    const delayedCredit = {
      kind: 'unattributedShared',
      ownerId: 'BTCUSDT',
      symbol: 'BTCUSDT',
      components: ['commissionCredit'],
      entries: forbiddenMemberEntries,
      entryIds: ['income:post-close-rebate'],
      walletNet: null,
      visibleNet: [{ asset: 'USDT', amount: '0.4' }],
      qualifications: ['IDENTITY_UNRELIABLE'],
    }
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: [indexedClosedRound()],
          unresolved: [],
          sharedAdjustments: [delayedCredit],
        }}
      />,
    )

    const shared = screen.getByRole('region', { name: 'Shared wallet adjustments' })
    expect(within(shared).getByText('BTCUSDT unattributed commission credit'))
      .toBeInTheDocument()
    expect(within(shared).getAllByText('+0.4 USDT')).toHaveLength(1)
    expect(within(shared).getByText('An income identity is not reliable'))
      .toBeInTheDocument()
    expect(within(shared).getByRole('listitem')).toHaveAccessibleName(
      expect.stringContaining('An income identity is not reliable'),
    )
    expect(within(shared).getAllByRole('listitem')).toHaveLength(1)
  })

  it('presents a reliable-identity shared representative as conflicted, not ordinary Shared', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, trades: [] }}
        tradeRoundIndex={{
          closed: [indexedClosedRound()],
          unresolved: [],
          sharedAdjustments: [{
            kind: 'contractShared',
            ownerId: 'BTCUSDT',
            symbol: 'BTCUSDT',
            leg: null,
            components: ['funding'],
            entryIds: ['income:shared-conflict'],
            walletNet: null,
            visibleNet: [{ asset: 'USDT', amount: '-3' }],
            identityConflict: true,
            qualifications: ['IDENTITY_CONFLICT'],
          }],
        }}
      />,
    )

    const adjustment = screen.getByRole('listitem', {
      name: /BTCUSDT conflicted funding/,
    })
    expect(adjustment).toHaveTextContent('Conflict')
    expect(adjustment).toHaveTextContent('Conflicting payloads reuse one income identity')
    expect(adjustment).not.toHaveTextContent('Shared')
    expect(adjustment).toHaveAccessibleName(
      expect.stringContaining('conflicted representative, counted once and not exact'),
    )
  })

  it('keeps Closed values qualified through every settled state and moves failure to the popup', () => {
    const notifyError = vi.fn()
    const resource = (status, overrides = {}) => ({
      version: 2,
      status,
      successfulAt: null,
      error: null,
      ...overrides,
    })
    const panel = settledIncome => (
      <NotificationContext.Provider value={{ notifyError }}>
        <FuturesHistoryPanel
          view="tradeHistory"
          symbol="BTCUSDT"
          tickSizes={ticks}
          history={history}
          settledIncome={settledIncome}
          tradeRoundIndex={{
            closed: [indexedClosedRound()],
            unresolved: [],
            sharedAdjustments: [],
          }}
        />
      </NotificationContext.Provider>
    )
    const walletResult = () => within(screen.getByRole('row', { name: /BTCUSDT/ }))
      .getAllByRole('cell')[6]
    const expectQualifiedRetainedValue = () => {
      const result = walletResult()
      expect(result).toHaveTextContent('+10.00 USDT')
      expect(result.getAttribute('title')).toContain('Visible net: +9 USDT')
      expect(result.getAttribute('title')).toContain(
        'Settled-income verification is not ready',
      )
      expect(result.getAttribute('title')).not.toContain('Wallet Net')
    }

    // No settled state takes a banner into the panel any more: the operator
    // ruled the inline narration noise, so the rows qualify themselves and a
    // failed refresh is announced once in the popup channel instead.
    const { rerender } = render(panel(resource('loading')))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expectQualifiedRetainedValue()
    expect(notifyError).not.toHaveBeenCalled()

    rerender(panel(resource('ready', { successfulAt: 1_784_000_100_000 })))
    expect(walletResult().getAttribute('title')).toContain('Wallet Net: +9 USDT')
    expect(walletResult().getAttribute('title')).not.toContain('Visible net')
    expect(notifyError).not.toHaveBeenCalled()

    const failed = () => resource('stale', {
      successfulAt: 1_784_000_100_000,
      error: { code: 'FUTURES_API_ERROR', message: 'Funding verification failed.' },
    })
    rerender(panel(failed()))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry wallet adjustments' }))
      .not.toBeInTheDocument()
    expectQualifiedRetainedValue()
    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(notifyError.mock.calls[0][0]).toContain('Funding verification failed.')
    expect(notifyError.mock.calls[0][0]).toContain('confirmed reading from')
    expect(notifyError.mock.calls[0][0]).toContain('Press \u21bb to retry.')

    // Still failed on a later render: one failure is one announcement.
    rerender(panel(failed()))
    expect(notifyError).toHaveBeenCalledTimes(1)

    // Recovered, then failed anew: that is a new episode and is announced.
    rerender(panel(resource('ready', { successfulAt: 1_784_000_200_000 })))
    rerender(panel(resource('error', {
      error: { code: 'FUTURES_API_ERROR', message: 'Wallet history is unavailable.' },
    })))
    expectQualifiedRetainedValue()
    expect(notifyError).toHaveBeenCalledTimes(2)
    expect(notifyError.mock.calls[1][0]).toContain('Wallet history is unavailable.')

    // Never-read is not a failure and says nothing anywhere.
    rerender(panel(resource('idle')))
    expectQualifiedRetainedValue()
    expect(notifyError).toHaveBeenCalledTimes(2)
  })

  it('keeps closed shared-adjustment DOM identity when reconciliation reorders and extends it', () => {
    const laneSizedEntryIds = Array.from({ length: 24_000 }, (unused, index) => (
      `income:btc-funding-${index}`
    ))
    const forbiddenMemberEntries = new Proxy(new Array(24_000), {
      get() {
        throw new Error('shared member entries were scanned during rerender')
      },
    })
    const btc = {
      kind: 'contractShared',
      ownerId: 'BTCUSDT',
      symbol: 'BTCUSDT',
      components: ['funding'],
      entries: forbiddenMemberEntries,
      entryIds: laneSizedEntryIds,
      visibleNet: [{ asset: 'USDT', amount: '-3' }],
      qualifications: [],
    }
    const eth = {
      kind: 'contractShared',
      ownerId: 'ETHUSDT',
      symbol: 'ETHUSDT',
      components: ['insurance'],
      entries: forbiddenMemberEntries,
      entryIds: ['income:eth-insurance'],
      visibleNet: [{ asset: 'USDT', amount: '4' }],
      qualifications: [],
    }
    const panel = adjustments => (
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        history={history}
        tradeRoundIndex={{
          closed: [indexedClosedRound()],
          unresolved: [],
          sharedAdjustments: adjustments,
        }}
      />
    )
    const { rerender } = render(panel([btc, eth]))
    const btcRow = screen.getByRole('listitem', { name: /BTCUSDT shared funding/ })
    const ethRow = screen.getByRole('listitem', { name: /ETHUSDT shared insurance/ })
    btcRow.focus()

    rerender(panel([eth, {
      ...btc,
      entryIds: [...laneSizedEntryIds, 'income:btc-funding-new'],
    }]))

    expect(screen.getByRole('listitem', { name: /BTCUSDT shared funding/ })).toBe(btcRow)
    expect(screen.getByRole('listitem', { name: /ETHUSDT shared insurance/ })).toBe(ethRow)
    expect(btcRow).toHaveFocus()
  })

  it('refuses the no-closed-positions claim for unresolved scope without hanging a banner', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          symbols: ['BTCUSDT'],
          discoveryComplete: true,
          trades: [],
        }}
        tradeRoundIndex={{
          closed: [],
          sharedAdjustments: [],
          unresolved: [{
            key: 'unresolved:BTCUSDT:LONG',
            positionKey: 'BTCUSDT:LONG',
            symbol: 'BTCUSDT',
            leg: 'LONG',
            open: false,
            reasons: ['trade-coverage-incomplete'],
          }],
        }}
      />,
    )

    // The banner that used to narrate each unresolved scope was ruled noise by
    // the operator (2026-08-23): the position it described is on screen in the
    // live table. What must survive is the claim discipline — an unresolved
    // scope forbids "No closed positions".
    expect(screen.queryByRole('region', { name: 'Closed-position scope is partial' }))
      .not.toBeInTheDocument()
    expect(screen.queryByText(/Closed-position scope is partial/))
      .not.toBeInTheDocument()
    expect(screen.queryByText(/^No closed positions/)).not.toBeInTheDocument()
    expect(screen.getByText(/No resolved closed positions/))
      .toHaveTextContent('This partial review cannot prove that none exist')
    expect(screen.queryByRole('table', { name: 'Position history' })).not.toBeInTheDocument()
  })

  it('shows resolved rows without a scope banner while another scope is unresolved', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{ ...history, discoveryComplete: false, trades: [] }}
        tradeRoundIndex={{
          closed: [indexedClosedRound()],
          sharedAdjustments: [],
          // The very case the banner used to narrate: an open position whose
          // opening boundary the read has not reached. The operator sees that
          // position in the live table above; here it is only a claim guard.
          unresolved: [{
            key: 'unresolved:ONGUSDT:BOTH',
            positionKey: 'ONGUSDT:BOTH',
            symbol: 'ONGUSDT',
            leg: 'BOTH',
            open: true,
            reasons: ['left-boundary-unproven'],
          }],
        }}
      />,
    )

    expect(screen.getByRole('table', { name: 'Position history' })).toBeInTheDocument()
    expect(screen.queryByText(/Closed-position scope is partial/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No numeric position row was inferred/)).not.toBeInTheDocument()
    expect(screen.queryByText(/more positions may exist/)).not.toBeInTheDocument()
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
    const olderAt = 1_784_000_000_000
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
            { ...history.orders[0], orderId: 8, time: olderAt },
          ],
        }}
      />,
    )
    const days = screen.getAllByRole('rowgroup')
    expect(days).toHaveLength(2)
    expect(days[0]).toHaveAccessibleName('Today')
    expect(days[1]).toHaveAccessibleName(
      new Date(olderAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' }),
    )

    const rows = screen.getAllByRole('row')
    const today = within(rows[1]).getAllByRole('cell')[2]
    const older = within(rows[2]).getAllByRole('cell')[2]
    expect(today).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/)
    expect(older).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/)
    expect(today.getAttribute('title')).toBeTruthy()
    expect(older.getAttribute('title')).toBeTruthy()
  })

  it.each(['07/14', '14.07'])(
    'keeps the localized %s day label as an accessible row-group heading',
    (localizedDay) => {
      const dateFormat = vi.spyOn(Date.prototype, 'toLocaleDateString')
        .mockReturnValue(localizedDay)
      try {
        render(
          <FuturesHistoryPanel
            view="orderHistory"
            symbol="BTCUSDT"
            tickSizes={ticks}
            history={{
              ...history,
              orders: [{ ...history.orders[0], time: 1_784_000_000_000 }],
            }}
          />,
        )
        expect(screen.getByRole('rowgroup', { name: localizedDay })).toBeInTheDocument()
      } finally {
        dateFormat.mockRestore()
      }
    },
  )

  it('keeps two thousand closed positions in a bounded local window and reaches both edges', () => {
    const roundCount = 2_000
    const newestClose = Date.UTC(2026, 6, 14, 12, 0, 0)
    const noFees = Object.freeze([])
    const closed = Object.freeze(Array.from({ length: roundCount }, (_, index) => {
      const closeTime = newestClose - index * 1_000
      return Object.freeze({
        key: `round-${index}`,
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        quantity: '1',
        fills: 2,
        notional: 60_000,
        entryPrice: 60_000,
        exitPrice: 60_001,
        realizedPnl: 1,
        netPnl: 1,
        feesByAsset: noFees,
        funding: null,
        fundingComplete: true,
        insuranceClear: null,
        openTime: closeTime - 500,
        closeTime,
        open: false,
      })
    }))
    const tradeRoundIndex = Object.freeze({
      open: Object.freeze([]),
      closed,
    })
    const onLoadHistory = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          trades: [],
          readViews: { orders: null, trades: history.readAt },
        }}
        tradeRoundIndex={tradeRoundIndex}
        onLoadHistory={onLoadHistory}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    expect(onLoadHistory).not.toHaveBeenCalled()

    const table = screen.getByRole('table', { name: 'Position history' })
    const roundRows = () => within(table).getAllByRole('row')
      .filter(row => row.hasAttribute('data-round-key'))
    const firstRound = () => roundRows()[0]
    const lastRound = () => roundRows().at(-1)

    expect(FUTURES_CLOSED_POSITION_WINDOW_SIZE).toBe(100)
    expect(table).toHaveAttribute('aria-rowcount', String(roundCount + 1))
    expect(roundRows()).toHaveLength(FUTURES_CLOSED_POSITION_WINDOW_SIZE)
    expect(screen.getByText(`Showing 1–${FUTURES_CLOSED_POSITION_WINDOW_SIZE} of ${roundCount}`))
      .toBeInTheDocument()
    expect(firstRound()).toHaveAttribute('data-round-key', 'round-0')
    expect(firstRound()).toHaveAttribute('aria-rowindex', '2')
    expect(lastRound()).toHaveAttribute(
      'data-round-key',
      `round-${FUTURES_CLOSED_POSITION_WINDOW_SIZE - 1}`,
    )

    const overlapKey = `round-${FUTURES_CLOSED_POSITION_WINDOW_SIZE - 1}`
    const overlap = table.querySelector(`[data-round-key="${overlapKey}"]`)
    const older = screen.getByRole('button', { name: 'Older' })
    const newer = screen.getByRole('button', { name: 'Newer' })
    older.focus()
    fireEvent.click(older)

    expect(older).toHaveFocus()
    expect(screen.getByText(
      `Showing ${FUTURES_CLOSED_POSITION_WINDOW_STEP + 1}–${
        FUTURES_CLOSED_POSITION_WINDOW_STEP + FUTURES_CLOSED_POSITION_WINDOW_SIZE
      } of ${roundCount}`,
    )).toBeInTheDocument()
    expect(firstRound()).toHaveAttribute(
      'data-round-key',
      `round-${FUTURES_CLOSED_POSITION_WINDOW_STEP}`,
    )
    expect(table.querySelector(`[data-round-key="${overlapKey}"]`)).toBe(overlap)
    expect(roundRows()).toHaveLength(FUTURES_CLOSED_POSITION_WINDOW_SIZE)

    let olderMoves = 1
    while (!older.disabled) {
      fireEvent.click(older)
      olderMoves += 1
    }
    expect(olderMoves).toBe(Math.ceil(
      (roundCount - FUTURES_CLOSED_POSITION_WINDOW_SIZE)
        / FUTURES_CLOSED_POSITION_WINDOW_STEP,
    ))
    expect(screen.getByText(
      `Showing ${roundCount - FUTURES_CLOSED_POSITION_WINDOW_SIZE + 1}–${roundCount} of ${roundCount}`,
    )).toBeInTheDocument()
    expect(firstRound()).toHaveAttribute(
      'data-round-key',
      `round-${roundCount - FUTURES_CLOSED_POSITION_WINDOW_SIZE}`,
    )
    expect(lastRound()).toHaveAttribute('data-round-key', `round-${roundCount - 1}`)
    expect(roundRows()).toHaveLength(FUTURES_CLOSED_POSITION_WINDOW_SIZE)
    expect(older).toBeDisabled()
    expect(newer).toHaveFocus()

    let newerMoves = 0
    while (!newer.disabled) {
      fireEvent.click(newer)
      newerMoves += 1
    }
    expect(newerMoves).toBe(olderMoves)
    expect(screen.getByText(`Showing 1–${FUTURES_CLOSED_POSITION_WINDOW_SIZE} of ${roundCount}`))
      .toBeInTheDocument()
    expect(firstRound()).toHaveAttribute('data-round-key', 'round-0')
    expect(lastRound()).toHaveAttribute(
      'data-round-key',
      `round-${FUTURES_CLOSED_POSITION_WINDOW_SIZE - 1}`,
    )
    expect(newer).toBeDisabled()
    expect(older).toHaveFocus()
    expect(onLoadHistory).not.toHaveBeenCalled()
  })

  it('anchors an older closed-position window by surviving round identity', () => {
    const newestClose = Date.UTC(2026, 6, 14, 12, 0, 0)
    const makeRound = index => indexedClosedRound({
      key: `round-${index}`,
      closeTime: newestClose - index * 1_000,
      openTime: newestClose - index * 1_000 - 500,
    })
    const closed = Array.from({ length: 240 }, (_, index) => makeRound(index))
    const heldHistory = {
      ...history,
      trades: [],
      readViews: { orders: null, trades: history.readAt },
    }
    const { rerender } = render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        history={heldHistory}
        tradeRoundIndex={{ closed, unresolved: [], sharedAdjustments: [] }}
      />,
    )
    const firstRoundKey = () => screen.getByRole('table', { name: 'Position history' })
      .querySelector('[data-round-key]')
      ?.getAttribute('data-round-key')

    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    expect(firstRoundKey()).toBe(`round-${FUTURES_CLOSED_POSITION_WINDOW_STEP}`)

    const prepended = [indexedClosedRound({
      key: 'round-new',
      closeTime: newestClose + 1_000,
      openTime: newestClose + 500,
    }), ...closed]
    rerender(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        history={heldHistory}
        tradeRoundIndex={{ closed: prepended, unresolved: [], sharedAdjustments: [] }}
      />,
    )
    expect(firstRoundKey()).toBe(`round-${FUTURES_CLOSED_POSITION_WINDOW_STEP}`)

    const replacement = closed.slice(190)
    rerender(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        history={heldHistory}
        tradeRoundIndex={{ closed: replacement, unresolved: [], sharedAdjustments: [] }}
      />,
    )
    expect(firstRoundKey()).toBe('round-190')
    expect(screen.queryByRole('button', { name: 'Older' })).not.toBeInTheDocument()

    const regrown = closed.slice(100)
    rerender(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        history={heldHistory}
        tradeRoundIndex={{ closed: regrown, unresolved: [], sharedAdjustments: [] }}
      />,
    )
    expect(firstRoundKey()).toBe('round-100')
    expect(screen.getByText(`Showing 1–${FUTURES_CLOSED_POSITION_WINDOW_SIZE} of 140`))
      .toBeInTheDocument()
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

    // Narrowing that leaves nothing is not an empty review, and rendering a bare
    // header with the scope line beneath it reads as the first.
    fireEvent.click(screen.getByRole('button', { name: 'This contract' }))
    expect(screen.queryByRole('table', { name: 'Order history' })).toBeNull()
    expect(screen.getByText(/Nothing here matches/))
      .toHaveTextContent('The review holds 2 orders')
    expect(screen.getByText(new RegExp(scope))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
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

  // A read covers the endpoint the view that asked needs, so the other view can
  // be genuinely unread while the account carries a reading. "No closed
  // positions across the 2 contracts read" would then be a claim about a read
  // that never looked at a single fill.
  it('does not call a view empty when no read has covered it', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          trades: [],
          symbols: ['BTCUSDT', 'BICOUSDT'],
          readViews: { orders: 1_784_000_100_000, trades: null },
        }}
      />,
    )
    expect(screen.queryByText(/No closed positions/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Open history to load it.')
  })

  // The account holds a reading, so its status is `refreshing` rather than
  // `loading` while this view is read for the first time. It is still the first
  // read of what is on screen, and saying "open history to load it" of a read
  // already in flight reads as a control the operator has to press again.
  it('says the first read of this view is in flight, whatever the other view holds', () => {
    render(
      <FuturesHistoryPanel
        view="tradeHistory"
        symbol="BTCUSDT"
        tickSizes={ticks}
        history={{
          ...history,
          status: 'refreshing',
          trades: [],
          readViews: { orders: 1_784_000_100_000, trades: null },
        }}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading account history…')
  })

  // A session is reviewed whole: half of it was on contracts the operator has
  // since switched away from, and scoping the tab to the chart hid exactly those.
  it('reports every contract the account traded, each at its own tick', () => {
    const onSymbolChange = vi.fn()
    render(
      <CanonicalHistoryPanelFixture
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
