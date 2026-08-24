import { readFileSync } from 'node:fs'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FuturesPortfolioDock from './FuturesPortfolioDock.jsx'
import { describeFuturesPosition } from '../../../utils/futuresOrderPresentation.js'
import { createFuturesPositionMarkStore } from '../../../utils/futuresPositionMarks.js'

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
  // The liquidation price beside a position is the desk's own reckoning of how
  // far away the edge is. A margin call is Binance saying the position's risk
  // ratio is too high, and the operator has to be able to tell the two apart
  // without reading the number twice.
  it('marks the position the exchange itself warned about, and only that one', () => {
    const other = { ...position, symbol: 'ETHUSDT', liquidationPrice: '1200' }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position, other]}
        marginCalls={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionSide: 'BOTH',
            at: 1_700_000_000_000,
            quantity: 0.5,
            isolatedWallet: null,
            maintenanceMargin: 1.614445,
            markPrice: 60600,
          },
        }}
      />,
    )

    expect(screen.getByLabelText('BTCUSDT margin call')).toBeInTheDocument()
    expect(screen.queryByLabelText('ETHUSDT margin call')).toBeNull()
    expect(screen.getByLabelText('BTCUSDT margin call').closest('span[role="cell"]'))
      .toHaveClass('is-margin-call')
  })

  // Guard against the marker leaking onto every row: with nothing sent, nothing
  // is marked.
  it('marks nothing when the exchange has warned about nothing', () => {
    render(<FuturesPortfolioDock selectedSymbol="BTCUSDT" positions={[position]} />)

    expect(screen.queryByLabelText('BTCUSDT margin call')).toBeNull()
  })

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

  // Tape is useful context, but it is not an exchange valuation. A print between
  // marks may update that context without moving the primary row or its total.
  it('keeps primary PnL on the exchange mark when only the tape changes', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '60600',
        updatedAt: 1_784_000_000_000,
        lastPrice: '60900',
        lastPriceAt: 1_784_000_000_100,
      },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{ ...position, unrealizedPnl: '-999' }]}
        positionMarkStore={positionMarkStore}
      />,
    )
    const pnl = () => screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-pnl')
    expect(pnl().closest('[data-position-key]')).toHaveAttribute('data-valuation-source', 'live-mark')
    expect(pnl()).toHaveTextContent('−300.00')
    expect(pnl().getAttribute('title')).toContain('live exchange mark')
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('−300.00 USDT')
    expect(screen.getByRole('table', { name: 'Open positions' })).toHaveTextContent('71000')

    act(() => positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '60600',
        updatedAt: 1_784_000_000_000,
        lastPrice: '61200',
        lastPriceAt: 1_784_000_000_200,
      },
    }))
    expect(pnl()).toHaveTextContent('−300.00')
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('−300.00 USDT')
    expect(pnl().getAttribute('title')).not.toContain('carried forward')
  })

  // The row is valued on the mark and the chart is drawn from the tape, and on
  // a fast move the two sit on opposite sides of the entry: the operator sees
  // price past their own ENTRY line while the row states a loss. Both figures
  // are right, and a row that says the opposite of the chart without saying why
  // reads as broken arithmetic — which is exactly how it was reported.
  it('says when the tape has crossed the entry and the mark has not', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '61200',
        updatedAt: 1_784_000_000_000,
        lastPrice: '60800',
        lastPriceAt: 1_784_000_000_100,
      },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        tickSizes={{ BTCUSDT: '0.1' }}
        positionMarkStore={positionMarkStore}
        positions={[{
          ...position,
          // Short, so a price below the entry is a profit.
          quantity: '-0.5',
          entryPrice: '61000',
          unrealizedPnl: '-999',
        }]}
      />,
    )
    const row = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('[data-position-key="BTCUSDT:BOTH"]')
    const title = row.querySelector('.futures-workstation-dock-pnl').getAttribute('title')
    expect(row).toHaveAttribute('data-valuation-source', 'live-mark')
    expect(row).toHaveTextContent('−100.00')
    expect(title).toContain('the contract last traded at 60800.0')
    expect(title).toContain('the other side of your entry')
    // What the position would be worth there, so the operator can see the size
    // of the disagreement rather than only that there is one.
    expect(title).toContain('+100.00 USDT there')
    expect(title).toContain('the mark is what settles')
  })

  it('says nothing about the tape when it agrees with the mark', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '61200',
        updatedAt: 1_784_000_000_000,
        lastPrice: '61150',
        lastPriceAt: 1_784_000_000_100,
      },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        tickSizes={{ BTCUSDT: '0.1' }}
        positionMarkStore={positionMarkStore}
        positions={[{
          ...position,
          quantity: '-0.5',
          entryPrice: '61000',
          unrealizedPnl: '-999',
        }]}
      />,
    )
    expect(screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-pnl')
      .getAttribute('title')).not.toContain('the other side of your entry')
  })

  it('marks the aggregate incomplete instead of summing only rows it can value', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_000 },
    })
    const unknown = {
      ...position,
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      quantity: '1',
      entryPrice: '3000',
      markPrice: undefined,
      unrealizedPnl: undefined,
    }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position, unknown]}
        positionMarkStore={positionMarkStore}
        accountResources={{
          positions: {
            status: 'ready',
            data: [position, unknown],
            updatedAt: 1_784_000_000_000,
            lastSuccessfulAt: 1_784_000_000_000,
            error: null,
          },
        }}
      />,
    )

    const total = screen.getByTestId('futures-upnl-total')
    expect(total).toHaveAttribute('data-complete', 'false')
    expect(total).toHaveTextContent('— USDT')
    expect(total).toHaveTextContent('1 position missing')
    expect(total).toHaveAttribute('title', expect.stringContaining('known rows sum to −300.00 USDT'))
    expect(screen.getByRole('table', { name: 'Open positions' })
      .querySelector('[data-position-key="ETHUSDT:LONG"]'))
      .toHaveAttribute('data-valuation-source', 'unknown')
  })

  // Unrealized PnL says what the position would produce if it were closed now.
  // This says what it has produced already — and the two are never added
  // together, because only one of them is in the wallet.
  it('states the money a position has already settled beside what it has not', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: 120.5,
            funding: -7.1,
            commission: -4.2,
            insuranceClear: null,
            total: 109.2,
            settlementAsset: 'USDT',
            otherAssets: [],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )
    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveTextContent('+109.20')
    expect(settled).toHaveClass('is-positive')
    expect(settled).not.toHaveClass('is-partial')
    // Decomposable, because a single net number cannot be checked against the
    // exchange and checking it against the exchange is what it is for.
    const title = settled.getAttribute('title')
    expect(title).toContain('+120.50 realized')
    expect(title).toContain('−7.10 funding')
    expect(title).toContain('−4.20 commission')
    // Never stated as a zero: this position has never been part-liquidated.
    expect(title).not.toContain('insurance')
  })

  it('rounds beyond-safe-integer settled money to cents while retaining the exact amount', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: '9007199254740993.12',
            funding: '0.0049',
            commission: '-0.12',
            insuranceClear: null,
            total: '9007199254740993.0049',
            settlementAsset: 'USDT',
            otherAssets: [],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )

    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveTextContent('+9007199254740993.00 USDT')
    expect(settled).not.toHaveTextContent('+9007199254740993.0049 USDT')
    expect(settled).toHaveClass('is-positive')
    expect(settled.getAttribute('title')).toContain('+9007199254740993.0049 USDT settled')
    expect(settled.getAttribute('title')).toContain('+9007199254740993.12 realized')
    expect(settled.getAttribute('title')).toContain('+0.0049 funding')
    expect(settled.getAttribute('title')).toContain('−0.12 commission')
  })

  it('looks up settled money by contract leg and ignores a legacy symbol payload', () => {
    const reading = (positionSide, total) => ({
      symbol: 'BTCUSDT',
      positionKey: `BTCUSDT:${positionSide}`,
      realizedPnl: total,
      funding: null,
      commission: null,
      insuranceClear: null,
      total,
      settlementAsset: 'USDT',
      otherAssets: [],
      from: 1_000,
      complete: true,
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[
          { ...position, positionSide: 'LONG', quantity: '0.1' },
          { ...position, positionSide: 'SHORT', quantity: '0.2' },
        ]}
        settledMoney={{
          'BTCUSDT:LONG': reading('LONG', 11),
          'BTCUSDT:SHORT': reading('SHORT', -7),
          // A legacy contract-wide amount must not leak into either hedge leg.
          BTCUSDT: reading('BOTH', 999),
        }}
      />,
    )

    const table = screen.getByRole('table', { name: 'Open positions' })
    const longSettled = table.querySelector('[data-position-key="BTCUSDT:LONG"]')
      .querySelector('.futures-workstation-dock-settled')
    const shortSettled = table.querySelector('[data-position-key="BTCUSDT:SHORT"]')
      .querySelector('.futures-workstation-dock-settled')
    expect(longSettled).toHaveTextContent('+11.00')
    expect(shortSettled).toHaveTextContent('−7.00')
    expect(table).not.toHaveTextContent('999.00')
  })

  it('says a settled figure is missing what the read did not reach', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: 40,
            funding: null,
            commission: null,
            insuranceClear: null,
            total: 40,
            settlementAsset: 'USDT',
            otherAssets: [],
            // The position's start is known; the read simply has not walked back
            // to it yet. That is a qualified figure, not an unattributable one.
            from: 1_699_000_000_000,
            complete: false,
          },
        }}
        settledWindow={{ from: 1_700_000_000_000, readAt: 1_700_000_600_000, complete: true }}
      />,
    )
    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveClass('is-partial')
    expect(settled.getAttribute('title')).toContain('not the whole life of the position')
    // The number and nothing else. The one-word Partial badge that stood under
    // the figure was ruled off the row by the operator (2026-08-23): the dotted
    // underline marks the reading and the element carries the sentences.
    expect(settled).toHaveTextContent('+40.00 USDT')
    expect(settled).not.toHaveTextContent('Partial')
    expect(within(settled).queryByRole('note')).not.toBeInTheDocument()
  })

  // The failure of 2026-08-20. With no start for the position, every amount the
  // contract settled anywhere in the read's window was summed into the column —
  // rounds closed days before the position was opened included — and printed as
  // what this position had settled. The operator read it as a lie because it was
  // one. A dash that explains itself is the only honest answer here.
  it('states no settled figure at all when it cannot tell whose money it is', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: null,
            funding: null,
            commission: null,
            insuranceClear: null,
            total: null,
            settlementAsset: 'USDT',
            otherAssets: [],
            from: null,
            complete: false,
          },
        }}
        settledWindow={{ from: 1_700_000_000_000, readAt: 1_700_000_600_000, complete: true }}
      />,
    )
    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled.textContent).not.toMatch(/\d/)
    const title = settled.getAttribute('title')
    expect(title).toContain('unknown')
    expect(title).toContain('does not reach back')
    // And it must not read as "this position has settled nothing", which is a
    // different answer the same dash is used for.
    expect(title).not.toContain('Nothing settled')
  })

  // A BNB fee added into a USDT total is not a quantity of anything, and the
  // desk holds no rate to convert it at.
  it('states a fee charged in another asset apart from the total', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: 10,
            funding: null,
            commission: null,
            insuranceClear: null,
            total: 10,
            settlementAsset: 'USDT',
            otherAssets: [{
              asset: 'BNB',
              amount: '-0.003',
              realizedPnl: null,
              funding: null,
              commission: -0.003,
              insuranceClear: null,
              total: -0.003,
            }],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )
    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    // The face is one settlement-asset number — the operator ruled the BNB
    // second line off the row (2026-08-24); the quantity lives in the title.
    expect(settled).toHaveTextContent('+10.00 USDT')
    expect(settled).not.toHaveTextContent('BNB')
    expect(settled.getAttribute('title')).toContain('−0.003 BNB settled')
    expect(settled.getAttribute('title')).toContain('not converted')
  })

  it('keeps a BNB-only open-position reading off the face and states it in the title', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: null,
            funding: null,
            commission: null,
            insuranceClear: null,
            total: null,
            settlementAsset: 'USDT',
            otherAssets: [{
              asset: 'BNB',
              amount: '-0.003',
              realizedPnl: null,
              funding: null,
              commission: -0.003,
              insuranceClear: null,
              total: -0.003,
            }],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )

    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    // No settlement-asset figure and no visible BNB line: the face stays a
    // dash and the element carries the whole statement.
    expect(settled).toHaveTextContent('—')
    expect(settled).not.toHaveTextContent('BNB')
    expect(settled.getAttribute('title')).toContain('−0.003 BNB settled')
    expect(settled.getAttribute('title')).toContain('not converted')
  })

  it('renders an exactly cancelling auxiliary asset as a flat zero, never null', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: null,
            funding: null,
            commission: null,
            insuranceClear: null,
            total: null,
            settlementAsset: 'USDT',
            otherAssets: [{
              asset: 'BNB',
              amount: '0',
              realizedPnl: null,
              funding: null,
              commission: '0',
              insuranceClear: null,
              total: '0',
            }],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )

    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    // Off the face like every foreign-asset line; the title still states the
    // flat zero rather than null.
    expect(settled).not.toHaveTextContent('BNB')
    expect(settled).not.toHaveTextContent('null')
    expect(settled.getAttribute('title')).toContain('0.00 BNB settled')
    expect(settled.getAttribute('title')).not.toContain('null')
  })

  // Since 2026-08-24 every fee on this account is charged in BNB. When the
  // fold valued it at its charge's own minute, the face's one number includes
  // it and the title decomposes both quantities with the price used.
  it('folds a valued BNB fee into the settled face number and titles both quantities', () => {
    const valuation = {
      asset: 'BNB',
      pair: 'BNBUSDT',
      amount: 0.003,
      amountExact: '0.003',
      valuedAmount: '1.83702',
      complete: true,
      prices: [{ price: '612.34', minute: 1_756_000_020_000 }],
      missingMinutes: [],
    }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: '10',
            funding: null,
            commission: null,
            insuranceClear: null,
            total: '10',
            settlementAsset: 'USDT',
            otherAssets: [{
              asset: 'BNB',
              amount: '-0.003',
              realizedPnl: null,
              funding: null,
              commission: '-0.003',
              insuranceClear: null,
              total: '-0.003',
            }],
            valuation: {
              amount: '8.16298',
              settlementAsset: 'USDT',
              settlementAmount: '10',
              valuations: [valuation],
            },
            feeValuations: [valuation],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )

    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveTextContent('+8.16 USDT')
    expect(settled).not.toHaveTextContent('BNB')
    expect(settled).toHaveClass('is-positive')
    const title = settled.getAttribute('title')
    expect(title).toContain('+8.16298 USDT settled')
    expect(title).toContain('fee 0.003 BNB valued −1.83702 USDT')
    expect(title).toContain('BNBUSDT 612.34')
    expect(title).not.toContain('not converted')
  })

  it('states an unpriced BNB fee as not included instead of a wrong number', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'BTCUSDT:BOTH': {
            symbol: 'BTCUSDT',
            positionKey: 'BTCUSDT:BOTH',
            realizedPnl: '10',
            funding: null,
            commission: null,
            insuranceClear: null,
            total: '10',
            settlementAsset: 'USDT',
            otherAssets: [{
              asset: 'BNB',
              amount: '-0.003',
              realizedPnl: null,
              funding: null,
              commission: '-0.003',
              insuranceClear: null,
              total: '-0.003',
            }],
            valuation: null,
            feeValuations: [{
              asset: 'BNB',
              pair: 'BNBUSDT',
              amount: 0.003,
              amountExact: '0.003',
              valuedAmount: null,
              complete: false,
              prices: [],
              missingMinutes: [1_756_000_020_000],
            }],
            from: 1_000,
            complete: true,
          },
        }}
      />,
    )

    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveTextContent('+10.00 USDT')
    expect(settled).not.toHaveTextContent('BNB')
    const title = settled.getAttribute('title')
    expect(title).toContain('fee 0.003 BNB not included')
    expect(title).toContain('no readable BNBUSDT price')
    expect(title).not.toContain('valued')
  })

  // One global readout for the remaining fee reserve — the operator ruled it
  // off the rows — warning ahead of Binance's silent revert to USDT fees.
  it('shows the BNB fee reserve globally and marks it low under its bound', () => {
    const minute = 1_756_000_020_000
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        feeReserve={{
          state: 'ok', asset: 'BNB', pair: 'BNBUSDT', lowBoundUsdt: 50,
          amount: '1.0', worth: 612.34, price: '612.34', priceMinute: minute,
          low: false, requestMinute: minute,
        }}
      />,
    )
    const readout = screen.getByTestId('futures-fee-reserve')
    expect(readout).toHaveTextContent('BNB fee reserve')
    // Both quantities on the face: the amount the operator watches and the
    // worth the low bound is measured in.
    expect(readout).toHaveTextContent('1 BNB ≈612.34 USDT')
    expect(readout).not.toHaveTextContent('low')
    expect(readout.getAttribute('title')).toContain('1.0 BNB')
    expect(readout.getAttribute('title')).toContain('BNBUSDT 612.34')
    expect(readout.getAttribute('title')).toContain('silently')

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        feeReserve={{
          state: 'low', asset: 'BNB', pair: 'BNBUSDT', lowBoundUsdt: 50,
          amount: '0.07', worth: 42.86, price: '612.34', priceMinute: minute,
          low: true, requestMinute: minute,
        }}
      />,
    )
    const low = screen.getByTestId('futures-fee-reserve')
    expect(low).toHaveTextContent('0.07 BNB ≈42.86 USDT')
    expect(low).toHaveTextContent('low')
    expect(low).toHaveClass('is-negative')
  })

  it('states an absent or unpriced fee reserve instead of a zero that looks read', () => {
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        feeReserve={{
          state: 'absent', asset: 'BNB', pair: 'BNBUSDT', lowBoundUsdt: 50,
          amount: null, worth: null, price: null, priceMinute: null,
          low: false, requestMinute: 1_756_000_020_000,
        }}
      />,
    )
    const absent = screen.getByTestId('futures-fee-reserve')
    expect(absent).toHaveTextContent('none')
    expect(absent).toHaveTextContent('low')
    expect(absent.getAttribute('title')).toContain('No BNB in the Futures wallet')

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        feeReserve={{
          state: 'unpriced', asset: 'BNB', pair: 'BNBUSDT', lowBoundUsdt: 50,
          amount: '1.0', worth: null, price: null, priceMinute: null,
          low: false, requestMinute: 1_756_000_020_000,
        }}
      />,
    )
    const unpriced = screen.getByTestId('futures-fee-reserve')
    expect(unpriced).toHaveTextContent('1.0 BNB')
    expect(unpriced.getAttribute('title')).toContain('worth is unknown')

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        feeReserve={{
          state: 'unread', asset: 'BNB', pair: 'BNBUSDT', lowBoundUsdt: 50,
          amount: null, worth: null, price: null, priceMinute: null,
          low: false, requestMinute: null,
        }}
      />,
    )
    expect(screen.getByTestId('futures-fee-reserve'))
      .toHaveTextContent('—')
  })

  it('renders open contract and account adjustments once outside leg rows', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[
          { ...position, positionSide: 'LONG', quantity: '0.1' },
          { ...position, positionSide: 'SHORT', quantity: '-0.2' },
        ]}
        tradeRoundIndex={{
          openSharedAdjustments: [
            {
              ownerId: 'BTCUSDT',
              kind: 'contractShared',
              symbol: 'BTCUSDT',
              leg: null,
              components: ['funding'],
              visibleNet: [{ asset: 'USDT', amount: '-3' }],
            },
            {
              ownerId: 'account',
              kind: 'accountShared',
              symbol: null,
              leg: null,
              components: ['commissionCredit'],
              visibleNet: [{ asset: 'BNB', amount: '0.4' }],
            },
          ],
        }}
      />,
    )

    const table = screen.getByRole('table', { name: 'Open positions' })
    const shared = screen.getByRole('region', {
      name: 'Shared open-position wallet adjustments',
    })
    const adjustments = within(shared).getAllByRole('listitem')

    expect(adjustments).toHaveLength(2)
    for (const adjustment of adjustments) {
      expect(adjustment).toHaveAttribute('tabindex', '0')
      expect(adjustment).toHaveTextContent('Shared · not assigned to a single position leg')
      expect(adjustment).toHaveAccessibleName(expect.stringContaining('Counted once'))
    }
    expect(within(shared).getAllByText('−3.00 USDT')).toHaveLength(1)
    expect(within(shared).getAllByText('+0.40 BNB')).toHaveLength(1)
    expect(within(shared).getByText('Movements: funding')).toBeInTheDocument()
    expect(within(shared).getByText('Movements: commission credit')).toBeInTheDocument()
    expect(within(table).queryByText('−3 USDT')).not.toBeInTheDocument()
    expect(within(table).queryByText('+0.4 BNB')).not.toBeInTheDocument()
  })

  it('shows unattributed component and identity qualification without scanning members', () => {
    const forbiddenMemberEntries = new Proxy(new Array(24_000), {
      get() {
        throw new Error('shared member entries were scanned during render')
      },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        tradeRoundIndex={{
          openSharedAdjustments: [{
            ownerId: 'BTCUSDT',
            kind: 'unattributedShared',
            symbol: 'BTCUSDT',
            leg: null,
            components: ['commissionCredit'],
            entries: forbiddenMemberEntries,
            entryIds: Array.from({ length: 24_000 }, (unused, index) => `credit-${index}`),
            visibleNet: [{ asset: 'USDT', amount: '0.4' }],
            qualifications: ['IDENTITY_UNRELIABLE'],
          }],
        }}
      />,
    )

    const adjustment = screen.getByRole('listitem', {
      name: /BTCUSDT unattributed adjustment/,
    })
    expect(adjustment).toHaveTextContent('Unattributed · not assigned to a known position scope')
    expect(adjustment).toHaveTextContent('Movements: commission credit')
    expect(adjustment).toHaveTextContent(
      'Qualifications: An income identity is not reliable',
    )
    expect(adjustment).toHaveAccessibleName(
      expect.stringContaining('An income identity is not reliable'),
    )
  })

  it('presents a reliable-identity shared representative as conflicted, not ordinary Shared', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        tradeRoundIndex={{
          openSharedAdjustments: [{
            ownerId: 'BTCUSDT',
            kind: 'contractShared',
            symbol: 'BTCUSDT',
            leg: null,
            components: ['funding'],
            visibleNet: [{ asset: 'USDT', amount: '-3' }],
            identityConflict: true,
            qualifications: ['IDENTITY_CONFLICT'],
          }],
        }}
      />,
    )

    const adjustment = screen.getByRole('listitem', {
      name: /BTCUSDT conflict adjustment/,
    })
    expect(adjustment).toHaveTextContent('Conflict · selected representative is not exact')
    expect(adjustment).toHaveTextContent(
      'Qualifications: Conflicting payloads reuse one income identity',
    )
    expect(adjustment).not.toHaveTextContent('Shared ·')
    expect(adjustment).toHaveAccessibleName(
      expect.stringContaining('Conflicting payloads reuse one income identity'),
    )
  })

  it('keeps open shared-adjustment DOM identity when reconciliation reorders and extends it', () => {
    const laneSizedEntryIds = Array.from({ length: 24_000 }, (unused, index) => (
      `income:btc-funding-${index}`
    ))
    const forbiddenMemberEntries = new Proxy(new Array(24_000), {
      get() {
        throw new Error('shared member entries were scanned during rerender')
      },
    })
    const contract = {
      kind: 'contractShared',
      ownerId: 'BTCUSDT',
      symbol: 'BTCUSDT',
      leg: null,
      components: ['funding'],
      entries: forbiddenMemberEntries,
      entryIds: laneSizedEntryIds,
      visibleNet: [{ asset: 'USDT', amount: '-3' }],
    }
    const account = {
      kind: 'accountShared',
      ownerId: 'account',
      symbol: null,
      leg: null,
      components: ['commissionCredit'],
      entries: forbiddenMemberEntries,
      entryIds: ['income:account-credit'],
      visibleNet: [{ asset: 'BNB', amount: '0.4' }],
    }
    const dock = adjustments => (
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        tradeRoundIndex={{ openSharedAdjustments: adjustments }}
      />
    )
    const { rerender } = render(dock([contract, account]))
    const contractRow = screen.getByRole('listitem', {
      name: /BTCUSDT shared adjustment/,
    })
    const accountRow = screen.getByRole('listitem', {
      name: /Account shared adjustment/,
    })
    accountRow.focus()

    rerender(dock([account, {
      ...contract,
      entryIds: [...laneSizedEntryIds, 'income:btc-funding-new'],
    }]))

    expect(screen.getByRole('listitem', { name: /BTCUSDT shared adjustment/ }))
      .toBe(contractRow)
    expect(screen.getByRole('listitem', { name: /Account shared adjustment/ }))
      .toBe(accountRow)
    expect(accountRow).toHaveFocus()
  })

  it('names hedge-row actions with the position leg', () => {
    const onClosePosition = vi.fn()
    const onSizePick = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[
          { ...position, positionSide: 'LONG', quantity: '0.1' },
          { ...position, positionSide: 'SHORT', quantity: '-0.2' },
        ]}
        onClosePosition={onClosePosition}
        onSizePick={onSizePick}
      />,
    )

    expect(screen.getByRole('button', { name: 'Close BTCUSDT LONG position' }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close BTCUSDT SHORT position' }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'Size the ticket for the whole BTCUSDT LONG position',
    })).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'Size the ticket for the whole BTCUSDT SHORT position',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close BTCUSDT position' }))
      .not.toBeInTheDocument()
  })

  // An income read that has not answered and an account that has settled nothing
  // are different states, and a zero would state the wrong one.
  it('does not report a position as having settled nothing before the read answers', () => {
    render(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" positions={[position]} />,
    )
    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveTextContent('—')
    expect(settled).toHaveClass('is-absent')
    expect(settled.getAttribute('title')).toContain('not read yet')
  })

  // The absence that cost the operator an afternoon on 2026-08-20. A read that
  // answered and named other contracts leaves the same `—` as a read that never
  // arrived, and while both said "not read yet" the row could not be asked which
  // half of the path had failed.
  it('separates a read that named other contracts from one that never answered', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        settledMoney={{
          'ETHUSDT:BOTH': {
            symbol: 'ETHUSDT',
            positionKey: 'ETHUSDT:BOTH',
            realizedPnl: null,
            funding: -1.5,
            commission: null,
            insuranceClear: null,
            total: -1.5,
            settlementAsset: 'USDT',
            otherAssets: [],
            from: 1,
            complete: true,
          },
        }}
        settledWindow={{ from: 1, readAt: Date.parse('2026-08-20T14:20:31.482Z'), complete: true }}
      />,
    )
    const settled = screen.getByRole('table', { name: 'Open positions' })
      .querySelector('.futures-workstation-dock-settled')
    expect(settled).toHaveTextContent('—')
    const title = settled.getAttribute('title')
    expect(title).toContain('1 other contract')
    expect(title).toContain('nothing against this one')
    expect(title).not.toContain('not read yet')
  })

  it('counts hedge readings as one contract and explains an unassigned same-contract leg', () => {
    const contractReading = positionKey => ({
      symbol: 'BTCUSDT',
      positionKey,
      realizedPnl: null,
      funding: -1,
      commission: null,
      insuranceClear: null,
      total: -1,
      settlementAsset: 'USDT',
      otherAssets: [],
      from: 1,
      complete: true,
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[
          { ...position, positionSide: 'SHORT' },
          { ...position, symbol: 'ETHUSDT', positionSide: 'LONG' },
        ]}
        settledMoney={{
          'BTCUSDT:LONG': contractReading('BTCUSDT:LONG'),
          'BTCUSDT:BOTH': contractReading('BTCUSDT:BOTH'),
        }}
        settledWindow={{ from: 1, readAt: Date.parse('2026-08-20T14:20:31.482Z'), complete: true }}
      />,
    )

    const table = screen.getByRole('table', { name: 'Open positions' })
    const shortTitle = table.querySelector('[data-position-key="BTCUSDT:SHORT"]')
      .querySelector('.futures-workstation-dock-settled').getAttribute('title')
    const ethTitle = table.querySelector('[data-position-key="ETHUSDT:LONG"]')
      .querySelector('.futures-workstation-dock-settled').getAttribute('title')
    expect(shortTitle).toContain('income read reached this contract')
    expect(shortTitle).toContain('no amount was assigned to the SHORT leg')
    expect(shortTitle).not.toContain('other contract')
    expect(ethTitle).toContain('1 other contract')
    expect(ethTitle).not.toContain('2 other contracts')
  })

  // Mark notifications stay below the dock boundary. The aggregate subscribes
  // to both open symbols, while each memoized row subscribes only to its own.
  it('updates the BTC row and aggregate on a BTC mark without rendering ETH or history', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_000 },
      ETHUSDT: { markPrice: '3100', updatedAt: 1_784_000_000_000 },
    })
    const ethPosition = {
      ...position,
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      quantity: '1',
      entryPrice: '3000',
      markPrice: '3100',
      unrealizedPnl: '100',
    }
    const historySymbolRead = vi.fn(() => 'SOLUSDT')
    const closedRound = {
      key: 'SOLUSDT:LONG:1',
      get symbol() { return historySymbolRead() },
      positionSide: 'LONG',
      quantity: '1',
      fills: 2,
      notional: 100,
      entryPrice: 90,
      exitPrice: 100,
      openTime: 1_783_999_900_000,
      closeTime: 1_784_000_000_000,
      realizedPnl: 10,
      netPnl: 9.9,
      feesByAsset: [{ asset: 'USDT', amount: 0.1 }],
      funding: null,
      insuranceClear: null,
      fundingComplete: true,
      partial: false,
      entryImplied: false,
      open: false,
    }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position, ethPosition]}
        positionMarkStore={positionMarkStore}
        history={{
          status: 'ready',
          readAt: 1_784_000_000_000,
          readViews: { trades: 1_784_000_000_000 },
          trades: [],
          orders: [],
          symbols: ['SOLUSDT'],
          discovered: 1,
          error: null,
        }}
        tradeRoundIndex={{ closed: [closedRound] }}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    const openPositions = screen.getByRole('table', { name: 'Open positions' })
    const btcRow = openPositions.querySelector('[data-position-key="BTCUSDT:BOTH"]')
    const ethRow = openPositions.querySelector('[data-position-key="ETHUSDT:LONG"]')
    const historyTable = screen.getByRole('table', { name: 'Position history' })
    describeFuturesPosition.mockClear()
    historySymbolRead.mockClear()

    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '60800', updatedAt: 1_784_000_000_100 },
      ETHUSDT: { markPrice: '3100', updatedAt: 1_784_000_000_000 },
    }))

    expect(describeFuturesPosition.mock.calls.map(([row]) => row.symbol)).toEqual(['BTCUSDT'])
    expect(historySymbolRead).not.toHaveBeenCalled()
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('−300.00 USDT')
    expect(openPositions.querySelector('[data-position-key="BTCUSDT:BOTH"]')).toBe(btcRow)
    expect(btcRow).toHaveTextContent('−400.00')
    expect(openPositions.querySelector('[data-position-key="ETHUSDT:LONG"]')).toBe(ethRow)
    expect(ethRow).toHaveTextContent('+100.00')
    expect(screen.getByRole('table', { name: 'Position history' })).toBe(historyTable)
  })

  it('updates both hedge legs when their shared symbol mark changes', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60500', updatedAt: 1_784_000_000_000 },
    })
    const longPosition = {
      ...position,
      positionSide: 'LONG',
      quantity: '0.1',
      entryPrice: '60000',
      unrealizedPnl: '999',
    }
    const shortPosition = {
      ...position,
      positionSide: 'SHORT',
      quantity: '0.2',
      entryPrice: '61000',
      unrealizedPnl: '999',
    }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[longPosition, shortPosition]}
        positionMarkStore={positionMarkStore}
      />,
    )
    const table = screen.getByRole('table', { name: 'Open positions' })
    const longRow = table.querySelector('[data-position-key="BTCUSDT:LONG"]')
    const shortRow = table.querySelector('[data-position-key="BTCUSDT:SHORT"]')
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('+150.00 USDT')
    describeFuturesPosition.mockClear()

    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '60800', updatedAt: 1_784_000_000_100 },
    }))

    expect(describeFuturesPosition.mock.calls.map(([row]) => row.positionSide).sort())
      .toEqual(['LONG', 'SHORT'])
    expect(table.querySelector('[data-position-key="BTCUSDT:LONG"]')).toBe(longRow)
    expect(longRow).toHaveTextContent('+80.00')
    expect(table.querySelector('[data-position-key="BTCUSDT:SHORT"]')).toBe(shortRow)
    expect(shortRow).toHaveTextContent('+40.00')
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('+120.00 USDT')
  })

  it('does not recompute the collapsed numeric aggregate when only mark time advances', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_000 },
    })
    const entryRead = vi.fn(() => '60000')
    const trackedPosition = { ...position }
    Object.defineProperty(trackedPosition, 'entryPrice', {
      configurable: true,
      enumerable: true,
      get: entryRead,
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[trackedPosition]}
        positionMarkStore={positionMarkStore}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse portfolio dock' }))
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('−300.00 USDT')
    entryRead.mockClear()

    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_100 },
    }))
    expect(entryRead).not.toHaveBeenCalled()
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('−300.00 USDT')

    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '61200', updatedAt: 1_784_000_000_200 },
    }))
    expect(entryRead).toHaveBeenCalled()
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('−600.00 USDT')
  })

  it('re-values the row when a fresher mark arrives without an account event', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_000 },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[position]}
        positionMarkStore={positionMarkStore}
      />,
    )
    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '61200', updatedAt: 1_784_000_000_100 },
    }))
    const table = screen.getByRole('table', { name: 'Open positions' })
    expect(table).toHaveTextContent('30600.00')
    expect(table).toHaveTextContent('−600.00')
    expect(table.querySelector('[data-position-key="BTCUSDT:BOTH"]'))
      .toHaveAttribute('data-valuation-source', 'live-mark')
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
      name: 'Size the ticket for the whole BTCUSDT SHORT position',
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
      name: 'Size the ticket for the whole BTCUSDT SHORT position',
    })).not.toBeInTheDocument()
  })

  // ROE had no visible denominator: the dock divided by the committed margin
  // and then showed only the quotient.
  it('states the margin behind each position beside the ROE measured against it', () => {
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_000 },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[{ ...position, isolatedWallet: '3000', unrealizedPnl: '-300' }]}
        positionMarkStore={positionMarkStore}
      />,
    )
    const table = screen.getByRole('table', { name: 'Open positions' })
    expect(table).toHaveTextContent('Margin')
    // Cross margin follows the same live valuation generation as uPnL: the
    // live +30 move turns the account snapshot's 3000 into a 3030 denominator.
    expect(table).toHaveTextContent('3030.00')
    expect(table).toHaveTextContent('−9.90%')
    // The amount and the percentage together outgrew the column, which clips its
    // overflow: the percent sign was being sliced off. Both readings stay exact in
    // the cell's title whatever the dock's width does to the text.
    expect(within(table).getByTitle(/−300\.00 USDT · −9\.90% on margin · live exchange mark/))
      .toHaveTextContent('−300.00')
  })

  it('opens the margin panel at the cursor for the position that was clicked', () => {
    const onMarginEdit = vi.fn()
    const rawPosition = { ...position, isolatedWallet: '3000' }
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '61200', updatedAt: 1_784_000_000_000 },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[rawPosition]}
        positionMarkStore={positionMarkStore}
        onMarginEdit={onMarginEdit}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Adjust margin on the BTCUSDT SHORT position' }),
      { clientX: 240, clientY: 310 },
    )
    const [clickedPosition, anchor] = onMarginEdit.mock.lastCall
    expect(clickedPosition).toBe(rawPosition)
    expect(clickedPosition).toMatchObject({
      symbol: 'BTCUSDT', positionSide: 'BOTH', markPrice: '60600', unrealizedPnl: '-300',
    })
    expect(clickedPosition).not.toHaveProperty('valuationSource')
    expect(anchor).toEqual({ x: 240, y: 310 })
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

  it('states the filled portion in USDT and keeps executed contracts exact on hover', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[{ ...order, price: '100', origQty: '10', z: '2' }]}
      />,
    )
    const table = screen.getByRole('table', { name: 'Working orders' })
    expect(table).toHaveTextContent('Filled (USDT)')
    expect(screen.getByTitle('2 contracts')).toHaveTextContent('200')
  })

  // A stop-limit that fills through a gap executes at the market's price. The
  // column states what actually filled, from the exchange's avgPrice, not what
  // the resting price would have bought.
  it('values the filled portion at the fill price, not the resting price', () => {
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[{ ...order, price: '58000', origQty: '0.5', z: '0.1', avgPrice: '58120' }]}
      />,
    )
    expect(screen.getByTitle('0.1 contracts')).toHaveTextContent('5812')
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
    expect(row).toHaveTextContent('56980.1')
    expect(within(row).getByTitle('fired from a trigger at 57000')).toBeInTheDocument()
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
    expect(row).toHaveTextContent('57000')
    expect(row).toHaveTextContent('on Binance')
    expect(row).not.toHaveTextContent('triggered')
    expect(row.classList.contains('is-triggered')).toBe(false)
  })

  it('closes positions and cancels orders straight from the dock', () => {
    const onClosePosition = vi.fn()
    const onCancelOrder = vi.fn()
    const onSymbolChange = vi.fn()
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '61200', updatedAt: 1_784_000_000_000 },
    })
    render(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        positions={[position]}
        positionMarkStore={positionMarkStore}
        openOrders={[order]}
        onClosePosition={onClosePosition}
        onCancelOrder={onCancelOrder}
        onSymbolChange={onSymbolChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close BTCUSDT SHORT position' }))
    const [clickedPosition, anchor] = onClosePosition.mock.lastCall
    expect(clickedPosition).toBe(position)
    expect(clickedPosition).toMatchObject({
      symbol: 'BTCUSDT', markPrice: '60600', unrealizedPnl: '-300',
    })
    expect(clickedPosition).not.toHaveProperty('valuationSource')
    expect(anchor).toEqual(expect.any(Object))

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
    fireEvent.keyDown(row, { key: 'Enter', repeat: true })
    const repeatedSpace = createEvent.keyDown(row, { key: ' ', repeat: true })
    fireEvent(row, repeatedSpace)
    expect(repeatedSpace.defaultPrevented).toBe(true)
    expect(onOrderEdit).not.toHaveBeenCalled()

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

  // The editor's submit is Binance's amend endpoint, which re-states a LIMIT
  // order. A stop-market resting at price 0 and a stop-limit guarding a
  // trigger are orders that endpoint always refuses — offered anyway, the
  // doorway read "Edit … order at 0" and the refusal arrived only after the
  // operator had filled the form in. The chart's grip follows the same rule.
  it('offers no editor doorway on an order the amend endpoint would refuse', () => {
    const onOrderEdit = vi.fn()
    const stopMarket = {
      ...order, orderId: 12, side: 'SELL', type: 'STOP_MARKET', price: '0', triggerPrice: '59000.00',
    }
    const stopLimit = {
      ...order, orderId: 13, side: 'SELL', type: 'STOP', price: '59900.00', triggerPrice: '59800.00',
    }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        openOrders={[stopMarket, stopLimit]}
        onOrderEdit={onOrderEdit}
        onCancelOrder={vi.fn()}
        onSymbolChange={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('row').filter(row => (
      row.classList.contains('is-orders') && !row.classList.contains('is-head')
    ))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).not.toHaveClass('is-editable')
      expect(row).not.toHaveAttribute('tabindex')
      expect(row).not.toHaveAttribute('aria-label')
      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'Enter' })
    }
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

  // Selecting a view renders the reading the desk holds, and reads nothing to do
  // it where a read already covers that view. Every click here used to cost an
  // account-wide fan-out — about twenty-five requests through one 150ms-spaced
  // queue — for a past that had not changed.
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
          trades: [{ id: 4, symbol: 'BTCUSDT', side: 'SELL', price: '58500', quantity: '0.004', commission: '0.02', realizedPnl: '12.5', time: 1 }],
          error: null,
          readViews: { orders: 1_784_000_100_000, trades: 1_784_000_100_000 },
        }}
        tradeRoundIndex={{
          closed: [{
            key: 'BTCUSDT:BOTH:round-1',
            symbol: 'BTCUSDT',
            positionSide: 'SHORT',
            openTime: 1,
            closeTime: 2,
            quantity: '0.004',
            fills: 1,
            notional: 234,
            entryPrice: 61620,
            entryImplied: false,
            exitPrice: 58500,
            realizedPnl: 12.5,
            settlementAsset: 'USDT',
            netPnl: 12.48,
            partial: false,
            wallet: {
              walletNet: { asset: 'USDT', amount: '12.48' },
              visibleNet: [{ asset: 'USDT', amount: '12.48' }],
              qualifications: [],
            },
          }],
          unresolved: [],
          sharedAdjustments: [],
        }}
      />,
    )
    // The tab lists positions now, not executions: fills are folded into the
    // round trips they belong to before anything is drawn.
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    // The exchange's own figure leads the row; the +12.48 that reached the
    // wallet is named on the cell's element.
    const rounds = screen.getByRole('table', { name: 'Position history' })
    expect(rounds).toHaveTextContent('+12.50')
    expect(within(rounds).getAllByRole('cell')[6].getAttribute('title'))
      .toContain('Wallet Net: +12.48 USDT')
    expect(screen.queryByRole('table', { name: 'Working orders' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Working/ }))
    expect(screen.getByRole('table', { name: 'Working orders' })).toBeInTheDocument()

    // Counted, not merely spied on: every one of these clicks used to send one.
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    expect(onLoadHistory).toHaveBeenCalledTimes(0)

    // One incremental refresh control, reading the view that is open and not
    // the one beside it. The Full button that stood beside it was removed on
    // the operator's word (2026-08-23); the wide discovery read still runs
    // where the coverage machinery asks for it.
    fireEvent.click(screen.getByRole('button', { name: 'Re-read account history' }))
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT', { views: ['trades'] })
    expect(screen.queryByRole('button', { name: 'Read full account history' }))
      .not.toBeInTheDocument()
  })

  // The refusal chain of 2026-08-23: a v2 store re-key emptied the persisted
  // coverage, discovery never re-ran because one covered contract short-circuits
  // it, and the review self-sustained at one contract. While the held reading
  // itself says discovery did not finish, the one refresh control must run the
  // full discovery read — an incremental press cannot widen the account.
  it('escalates the re-read to full while the held discovery is incomplete', () => {
    const onLoadHistory = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={{
          symbol: 'BTCUSDT',
          status: 'ready',
          readAt: 1_784_000_100_000,
          orders: [],
          trades: [],
          error: null,
          discoveryComplete: false,
          readViews: { orders: 1_784_000_100_000, trades: 1_784_000_100_000 },
        }}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Re-read account history' }))
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith(
      'BTCUSDT',
      { full: true, views: ['trades'] },
    )
  })

  // The popup announcing a failed wallet-adjustment reading says "press \u21bb to
  // retry", so the one control must be the way back: while the settled resource
  // reports a failure, the same press also asks the account to refresh. While
  // it reports ready, the press stays a history read alone.
  it('retries a failed wallet-adjustment reading with the same re-read press', () => {
    const onLoadHistory = vi.fn()
    const onRefreshAccount = vi.fn()
    const dock = settledIncome => (
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        onRefreshAccount={onRefreshAccount}
        settledIncome={settledIncome}
        history={{
          symbol: 'BTCUSDT',
          status: 'ready',
          readAt: 1_784_000_100_000,
          orders: [],
          trades: [],
          error: null,
          discoveryComplete: true,
          readViews: { orders: 1_784_000_100_000, trades: 1_784_000_100_000 },
        }}
      />
    )
    const { rerender } = render(dock({
      version: 2,
      status: 'ready',
      successfulAt: 1_784_000_100_000,
      error: null,
    }))
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Re-read account history' }))
    expect(onLoadHistory).toHaveBeenCalledTimes(1)
    expect(onRefreshAccount).not.toHaveBeenCalled()

    rerender(dock({
      version: 2,
      status: 'stale',
      successfulAt: 1_784_000_100_000,
      error: { code: 'FUTURES_API_ERROR', message: 'Funding verification failed.' },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Re-read account history' }))
    expect(onLoadHistory).toHaveBeenCalledTimes(2)
    expect(onRefreshAccount).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
  })

  // Every USDⓈ-M history endpoint is read per contract, so a review that reads
  // both endpoints pays a whole fan-out — twelve contracts, 150ms apart — for a
  // panel that shows one of them at a time.
  it('reads the endpoint the opened view is made of, and only that one', () => {
    const onLoadHistory = vi.fn(() => true)
    const unread = {
      symbol: 'BTCUSDT',
      status: 'idle',
      readAt: null,
      orders: [],
      trades: [],
      error: null,
      readViews: { orders: null, trades: null },
    }
    const { rerender } = render(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" onLoadHistory={onLoadHistory} history={unread} />,
    )
    // Nothing is open on the review, so nothing is read for it.
    expect(onLoadHistory).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT', { views: ['trades'] })

    // The read answered for the view that asked. Opening the other view reads
    // the other endpoint — once — and going back reads nothing.
    const readTrades = { ...unread, status: 'ready', readAt: 1_784_000_100_000, readViews: { orders: null, trades: 1_784_000_100_000 } }
    rerender(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" onLoadHistory={onLoadHistory} history={readTrades} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    expect(onLoadHistory).toHaveBeenNthCalledWith(2, 'BTCUSDT', { views: ['orders'] })

    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    expect(onLoadHistory).toHaveBeenCalledTimes(2)
  })

  it('re-arms the selected history view after its successful read identity is cleared', () => {
    const onLoadHistory = vi.fn(() => true)
    const unread = {
      symbol: 'BTCUSDT',
      status: 'idle',
      readAt: null,
      orders: [],
      trades: [],
      error: null,
      readViews: { orders: null, trades: null },
    }
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={unread}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT', { views: ['trades'] })

    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={{
          ...unread,
          status: 'ready',
          readAt: 1_784_000_100_000,
          readViews: { orders: null, trades: 1_784_000_100_000 },
        }}
      />,
    )
    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={unread}
      />,
    )

    expect(onLoadHistory).toHaveBeenCalledTimes(2)
    expect(onLoadHistory).toHaveBeenNthCalledWith(2, 'BTCUSDT', { views: ['trades'] })
  })

  // A frame that never left is not a read. The attempt stays armed so the next
  // usable connection performs it, rather than the desk holding an empty review
  // for the rest of the session. `onLoadHistory` is rebuilt whenever what it
  // depends on moves — the store opening, the socket returning — which is
  // exactly when it is worth trying again.
  it('tries the opened view again when the read could not be sent', () => {
    const unsendable = vi.fn(() => false)
    const unread = {
      symbol: 'BTCUSDT',
      status: 'idle',
      readAt: null,
      orders: [],
      trades: [],
      error: null,
      readViews: { orders: null, trades: null },
    }
    const { rerender } = render(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" onLoadHistory={unsendable} history={unread} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Order history' }))
    expect(unsendable).toHaveBeenCalledExactlyOnceWith('BTCUSDT', { views: ['orders'] })

    const sendable = vi.fn(() => true)
    rerender(
      <FuturesPortfolioDock selectedSymbol="BTCUSDT" onLoadHistory={sendable} history={unread} />,
    )
    expect(sendable).toHaveBeenCalledExactlyOnceWith('BTCUSDT', { views: ['orders'] })
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
  })

  // The dock's height belongs to the operator: a review of forty orders wants
  // rows. The handle on the dock's top edge drags a height that both panels
  // share, arrow keys move it, a double-click hands it back to the stylesheet,
  // and the choice survives a restart the way the RSI pane's height does.
  it('resizes from its top-edge handle, persists the height, and resets on double-click', () => {
    window.localStorage.removeItem('futuresDockPanelHeight')
    render(<FuturesPortfolioDock selectedSymbol="BTCUSDT" openOrders={[order]} />)
    const dock = screen.getByRole('region', { name: 'Futures positions and working orders' })
    const handle = screen.getByRole('separator', { name: 'Resize the portfolio dock' })
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('')

    // jsdom measures nothing, so the drag starts from the 260px default:
    // 80px of upward drag is 340.
    fireEvent.pointerDown(handle, { pointerId: 7, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientY: 420 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientY: 420 })
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('340px')
    expect(window.localStorage.getItem('futuresDockPanelHeight')).toBe('340')

    // A move that belongs to no held pointer moves nothing.
    fireEvent.pointerMove(handle, { pointerId: 7, clientY: 300 })
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('340px')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('372px')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('340px')

    // The floor holds: no drag can take the rows away entirely.
    fireEvent.pointerDown(handle, { pointerId: 8, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 8, clientY: 9_000 })
    fireEvent.pointerUp(handle, { pointerId: 8, clientY: 9_000 })
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('120px')

    // Two quick drags land as a double-click; a reset the operator did not ask
    // for must not throw away the height they just set.
    fireEvent.doubleClick(handle)
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('120px')

    // A deliberate double-click, past the disarm beat, hands the height back.
    const realNow = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(realNow + 600)
    fireEvent.doubleClick(handle)
    now.mockRestore()
    expect(dock.style.getPropertyValue('--fx-dock-panel-height')).toBe('')
    expect(window.localStorage.getItem('futuresDockPanelHeight')).toBeNull()
  })

  it('collapses to a live truthful summary and expands back to the full dock', () => {
    const read = { status: 'ready', data: [], lastSuccessfulAt: 1000, error: null }
    const accountResources = { positions: read, regularOrders: read, algoOrders: read }
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '60600', updatedAt: 1_784_000_000_000 },
    })
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        openOrders={[order]}
        accountResources={accountResources}
        positionMarkStore={positionMarkStore}
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

    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '60900', updatedAt: 1_784_000_000_100 },
    }))
    rerender(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[position]}
        openOrders={[]}
        accountResources={accountResources}
        positionMarkStore={positionMarkStore}
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
      trades: [{ id: 4, symbol: 'BTCUSDT', side: 'SELL', price: '58500', quantity: '0.004', commission: '0.02', realizedPnl: '12.5', time: 1 }],
      error: null,
      readViews: { orders: 1_784_000_100_000, trades: 1_784_000_100_000 },
    }
    const tradeRoundIndex = {
      closed: [{
        key: 'BTCUSDT:BOTH:round-1',
        symbol: 'BTCUSDT',
        positionSide: 'SHORT',
        openTime: 1,
        closeTime: 2,
        quantity: '0.004',
        fills: 1,
        notional: 234,
        entryPrice: 61620,
        entryImplied: false,
        exitPrice: 58500,
        realizedPnl: 12.5,
        settlementAsset: 'USDT',
        netPnl: 12.48,
        partial: false,
        wallet: {
          walletNet: { asset: 'USDT', amount: '12.48' },
          visibleNet: [{ asset: 'USDT', amount: '12.48' }],
          qualifications: [],
        },
      }],
      unresolved: [],
      sharedAdjustments: [],
    }
    const { rerender } = render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        onLoadHistory={onLoadHistory}
        history={history}
        tradeRoundIndex={tradeRoundIndex}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Closed positions' }))
    rerender(
      <FuturesPortfolioDock
        selectedSymbol="ETHUSDT"
        onLoadHistory={onLoadHistory}
        history={history}
        tradeRoundIndex={tradeRoundIndex}
      />,
    )

    // The exchange's figure leads the row; the wallet result stays on the element.
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
    const expandedTotal = screen.getByTestId('futures-upnl-total')
    expect(expandedTotal).toHaveAttribute('data-complete', 'false')
    expect(expandedTotal).toHaveTextContent('— USDT')
    expect(expandedTotal).toHaveTextContent('positions not read')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse portfolio dock' }))
    const collapsedTotal = screen.getByTestId('futures-upnl-total')
    expect(collapsedTotal).toHaveAttribute('data-complete', 'false')
    expect(collapsedTotal).toHaveTextContent('— USDT')
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

  // The guard above reads static class names and simple templates, so it never
  // saw the conditional modifiers — the ones spliced in by `${cond ? ' is-x' :
  // ''}`. `.futures-workstation-dock-pnl.is-partial` was therefore set on every
  // closed round whose funding the income read had not covered, and styled by
  // nothing: only the settled column's twin rule existed. A round the desk knew
  // was missing funding was drawn exactly like a whole one, and the operator
  // compared four of them against the Binance app on 2026-08-20 with the screen
  // saying nothing. The class assertions beside it passed the whole time — they
  // asserted the class, never that it renders as anything.
  it('styles every conditional modifier against the class it is spliced onto', () => {
    const here = 'src/components/features/futures'
    const stylesheet = readFileSync(`${here}/FuturesWorkstation.css`, 'utf8')
    const pairs = []
    for (const file of ['FuturesPortfolioDock.jsx', 'FuturesHistoryPanel.jsx']) {
      const source = readFileSync(`${here}/${file}`, 'utf8')
      for (const template of source.matchAll(/className=\{`([^`]*)`\}/g)) {
        const body = template[1]
        const base = body.match(/^(futures-[a-z0-9-]+)/)?.[1]
        if (base === undefined) continue
        for (const modifier of body.matchAll(/'\s+(is-[a-z0-9-]+)'/g)) {
          pairs.push([file, base, modifier[1]])
        }
      }
    }
    expect(pairs.length).toBeGreaterThan(0)
    for (const [file, base, modifier] of pairs) {
      expect(stylesheet, `${file}: .${base}.${modifier} has no rule`)
        .toContain(`.${base}.${modifier}`)
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

    // Both panels say it: positions and working orders are read separately. And
    // a read in flight is not a read that has not started — the first says wait,
    // the second says nothing has been asked for yet.
    expect(screen.getAllByText('Reading the account…')).toHaveLength(2)
    expect(screen.queryByText('Not read yet.')).toBeNull()
    expect(screen.queryByText('No open positions.')).toBeNull()
    expect(screen.queryByText('No working orders.')).toBeNull()
    expect(screen.getByText('— open')).toBeInTheDocument()
  })

  // A snapshot the desk holds and nothing has confirmed is a third case again:
  // the rows are still the rows to read, and taking them away is worse — but
  // "these are your working orders" and "these were your working orders when the
  // connection dropped" are different claims, and the dock made the first for
  // both.
  it('keeps a stale reading on screen and says what it is, with the way back', () => {
    const onRefreshAccount = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[]}
        openOrders={[{ symbol: 'BTCUSDT', orderId: 7, side: 'BUY', price: '58000', origQty: '1', z: '0' }]}
        onRefreshAccount={onRefreshAccount}
        accountResources={{
          positions: { status: 'ready', data: [], lastSuccessfulAt: 100, error: null },
          regularOrders: {
            status: 'stale',
            data: [],
            lastSuccessfulAt: 100,
            error: {
              code: 'TRANSPORT_LOST',
              message: 'Not confirmed since the connection dropped — retry account synchronization.',
            },
          },
          algoOrders: { status: 'ready', data: [], lastSuccessfulAt: 100, error: null },
        }}
      />,
    )

    const notice = screen.getByLabelText('Working orders synchronization')
    expect(notice).toHaveTextContent('showing the last reading')
    expect(notice).toHaveTextContent('Not confirmed since the connection dropped')
    // The row it is about is still there to be read.
    expect(screen.getByRole('table', { name: 'Working orders' })).toHaveTextContent('BTCUSDT')
    // The positions panel read fine and says nothing.
    expect(screen.queryByLabelText('Positions synchronization')).toBeNull()
    expect(screen.getByText('No open positions.')).toBeInTheDocument()

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    expect(onRefreshAccount).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
  })

  // The leg says which position an order belongs to. It never said whether the
  // order opens that position or closes it — that was left to be worked out from
  // the side colour, which is true and only if you already know the rule.
  it('says on a working order whether it opens or closes the position', () => {
    const read = { status: 'ready', data: [], lastSuccessfulAt: 100, error: null }
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[]}
        accountResources={{ positions: read, regularOrders: read, algoOrders: read }}
        openOrders={[
          // One-way account: a reduce-only sell closes a long.
          { symbol: 'BTCUSDT', orderId: 1, side: 'SELL', positionSide: 'BOTH', reduceOnly: true, price: '59900', origQty: '1', z: '0' },
          // And a plain buy opens one.
          { symbol: 'BTCUSDT', orderId: 2, side: 'BUY', positionSide: 'BOTH', price: '58000', origQty: '1', z: '0' },
        ]}
      />,
    )

    const rows = within(screen.getByRole('table', { name: 'Working orders' })).getAllByRole('row')
    const closing = within(rows[1]).getAllByRole('cell')[2]
    expect(closing).toHaveTextContent('LONG')
    expect(within(closing).getByTitle(/^Exit — reduce-only/)).toHaveTextContent('exit')

    const opening = within(rows[2]).getAllByRole('cell')[2]
    expect(opening).toHaveTextContent('LONG')
    expect(opening).not.toHaveTextContent('exit')
  })

  it('never renders a failed order resource as an empty book of working orders', () => {
    const onRefreshAccount = vi.fn()
    render(
      <FuturesPortfolioDock
        selectedSymbol="BTCUSDT"
        positions={[]}
        openOrders={[]}
        onRefreshAccount={onRefreshAccount}
        accountResources={{
          positions: { status: 'ready', data: [], lastSuccessfulAt: 100, error: null },
          regularOrders: {
            status: 'error',
            data: [],
            lastSuccessfulAt: null,
            error: { code: 'READ_FAILED', message: 'Open orders read failed.' },
          },
          algoOrders: { status: 'error', data: [], lastSuccessfulAt: null, error: null },
        }}
      />,
    )

    expect(screen.queryByText('No working orders.')).toBeNull()
    const notice = screen.getByLabelText('Working orders synchronization')
    expect(notice).toHaveTextContent('Not read — the account read failed.')
    expect(notice).toHaveTextContent('Open orders read failed.')
    expect(notice).toHaveAttribute('role', 'alert')
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    expect(onRefreshAccount).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
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
    expect(screen.getByTestId('futures-upnl-total')).toHaveAttribute('data-complete', 'true')
    expect(screen.getByTestId('futures-upnl-total')).toHaveTextContent('0.00 USDT')
  })

})
