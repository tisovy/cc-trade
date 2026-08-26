import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFuturesSymbolHistory } from '../../../utils/futuresSymbolHistory.js'
import { FUTURES_COMMAND_OUTCOME } from '../../../utils/futuresCommandOutcome.js'
import { createFuturesPositionMarkStore } from '../../../utils/futuresPositionMarks.js'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'

const productionWorkstationMocks = vi.hoisted(() => ({
  viewRender: vi.fn(),
  orderEditorRender: vi.fn(),
  // What the workstation says it is carrying. Left null by every test that does
  // not care, so the default below stays the one shape they were written
  // against.
  carrying: null,
}))

// The container is the only surface that knows which contract is on screen.
// Everything it renders is mocked away: what is under test is the one read it
// performs, not the desk it performs it for.
vi.mock('../../../hooks/useFuturesProductionWorkstation.js', () => ({
  default: () => ({
    status: 'live',
    revision: 1,
    resources: { catalog: { contracts: [], state: 'live' } },
    candleHistory: { symbol: null, interval: null, rows: [], exhausted: false },
    loadCandleHistory: vi.fn(),
    retry: vi.fn(),
    configureTape: vi.fn(),
    ...(productionWorkstationMocks.carrying ?? {}),
  }),
}))
vi.mock('./FuturesWorkstationView.jsx', () => ({
  default: properties => {
    productionWorkstationMocks.viewRender(properties)
    return <div data-testid="view" />
  },
}))
vi.mock('./FuturesPortfolioDock.jsx', () => ({ default: () => <div /> }))
vi.mock('./FuturesTradingTicket.jsx', () => ({
  default: () => <div />,
}))
vi.mock('./FuturesOrderEditor.jsx', () => ({
  default: properties => {
    productionWorkstationMocks.orderEditorRender(properties)
    return <div data-testid="order-editor" />
  },
}))

const executionState = (overrides = {}) => ({
  connected: true,
  openOrders: [],
  positions: [],
  accountResources: {},
  loadHistory: vi.fn(() => true),
  loadSymbolConfig: vi.fn(),
  ...overrides,
})

afterEach(() => {
  vi.clearAllMocks()
  productionWorkstationMocks.carrying = null
  localStorage.clear()
})

describe('FuturesProductionWorkstation account review', () => {
  it('seeds a fresh recent list with the active starting contract', () => {
    localStorage.clear()
    render(
      <FuturesProductionWorkstation enabled executionState={executionState()} />,
    )

    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].symbolHistory)
      .toMatchObject({ recent: ['BTCUSDT'], lastSymbol: 'BTCUSDT' })
    expect(readFuturesSymbolHistory())
      .toMatchObject({ recent: ['BTCUSDT'], lastSymbol: 'BTCUSDT' })
  })

  it('gives the trading rail the normal workstation symbol-selection path', () => {
    render(
      <FuturesProductionWorkstation enabled executionState={executionState()} />,
    )
    const tradingRail = productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail
    expect(tradingRail.props.onSymbolChange).toEqual(expect.any(Function))

    act(() => tradingRail.props.onSymbolChange('TUTUSDT'))

    expect(productionWorkstationMocks.viewRender.mock.lastCall[0])
      .toMatchObject({ selectedSymbol: 'TUTUSDT' })
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].symbolHistory.recent[0])
      .toBe('TUTUSDT')
  })

  // Display coordinates are a chart concern. The container must keep the
  // exchange order intact so a later action never inherits a trigger or spawned
  // display price as its ordinary price.
  it('keeps an algo ordinary price intact while carrying its display inputs to the chart', () => {
    const algo = {
      symbol: 'BTCUSDT',
      orderKind: 'ALGO',
      algoType: 'CONDITIONAL',
      orderId: 42,
      algoId: 42,
      side: 'SELL',
      status: 'NEW',
      price: '0',
      triggerPrice: '57000.00',
      origQty: '0.01',
    }
    const { rerender } = render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          openOrders: [{ ...algo, actualOrderId: '990281234', actualPrice: '56980.10' }],
        })}
      />,
    )
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].ownedOrders[0])
      .toMatchObject({
        orderKind: 'ALGO',
        price: '0',
        triggerPrice: '57000.00',
        actualPrice: '56980.10',
      })

    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          openOrders: [{ ...algo, actualOrderId: '', actualPrice: '' }],
        })}
      />,
    )
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].ownedOrders[0])
      .toMatchObject({ orderKind: 'ALGO', price: '0', triggerPrice: '57000.00' })
  })

  // Nothing is read for the review from here any more. A read issued before a
  // history view is open pays for both of its endpoints — a fan-out of twelve
  // contracts each — for a panel the operator may never open, so the dock, which
  // is what knows which view is on screen, reads the one that was opened.
  // `FuturesPortfolioDock.test.jsx` holds what replaced these.
  it('reads no account history of its own, whatever the review holds', () => {
    const unread = executionState({ historyStoreReady: true, history: { readAt: null } })
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={unread} />,
    )
    expect(unread.loadHistory).not.toHaveBeenCalled()

    const restored = {
      ...unread,
      history: { readAt: 1_784_000_000_000 },
    }
    rerender(<FuturesProductionWorkstation enabled executionState={restored} />)
    expect(restored.loadHistory).not.toHaveBeenCalled()
  })

  it('passes account synchronization only for connected idle or loading resources', () => {
    const synchronizing = executionState({
      accountResources: {
        balances: { status: 'ready' },
        positions: { status: 'loading' },
      },
    })
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={synchronizing} />,
    )
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].accountSynchronizing).toBe(true)

    const settled = executionState({
      accountResources: {
        balances: { status: 'ready' },
        positions: { status: 'ready' },
      },
    })
    rerender(<FuturesProductionWorkstation enabled executionState={settled} />)
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].accountSynchronizing).toBe(false)

    const disconnected = executionState({
      connected: false,
      accountResources: { balances: { status: 'idle' } },
    })
    rerender(<FuturesProductionWorkstation enabled executionState={disconnected} />)
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].accountSynchronizing).toBe(false)
  })

  it('withholds a stale exit-position reference from the working-order editor', () => {
    const position = { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2' }
    const exitOrder = {
      symbol: 'BTCUSDT', orderId: 11, side: 'SELL', positionSide: 'LONG', reduceOnly: true,
    }
    const stale = executionState({
      positions: [position],
      accountResources: {
        positions: { status: 'stale', data: [position], lastSuccessfulAt: 100, error: null },
      },
    })
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={stale} />,
    )
    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0]
        .onOrderEdit(exitOrder, { x: 100, y: 100 })
    })
    expect(productionWorkstationMocks.orderEditorRender.mock.lastCall[0].positionQuantity)
      .toBeNull()

    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={{
          ...stale,
          accountResources: {
            positions: { status: 'loading', data: [position], lastSuccessfulAt: 100, error: null },
          },
        }}
      />,
    )
    expect(productionWorkstationMocks.orderEditorRender.mock.lastCall[0].positionQuantity)
      .toBe('2')
  })

  it('keeps an open close panel bound to the latest matching position row', () => {
    const closePosition = vi.fn()
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '58000', updatedAt: 1_784_000_000_000 },
    })
    const openingPosition = {
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      quantity: '0.5',
      entryPrice: '57000',
      markPrice: '58000',
      unrealizedPnl: '500',
    }
    const { rerender } = render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [openingPosition],
          closePosition,
          positionMarkStore,
        })}
      />,
    )

    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail.props
        .onPositionClose(openingPosition, { x: 200, y: 150 })
    })

    const livePosition = {
      ...openingPosition,
      markPrice: '58900',
      unrealizedPnl: '950',
    }
    act(() => positionMarkStore.replace({
      BTCUSDT: { markPrice: '58900', updatedAt: 1_784_000_000_100 },
    }))
    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({ positions: [livePosition], closePosition, positionMarkStore })}
      />,
    )

    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toHaveTextContent('29450.00')
    fireEvent.click(screen.getByRole('button', { name: 'Close at market' }))
    expect(closePosition).toHaveBeenCalledExactlyOnceWith(livePosition, { quantity: '0.5' })
    expect(closePosition.mock.calls[0][0]).not.toHaveProperty('valuationSource')
  })

  it('discards a close draft after a confirmed empty read and does not revive it on reopen', () => {
    const closePosition = vi.fn(() => true)
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '62000', updatedAt: 100 },
    })
    const openingPosition = {
      symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5', entryPrice: '57000',
      markPrice: '58000', unrealizedPnl: '500',
    }
    const ready = (data, at) => ({
      status: 'ready', data, updatedAt: at, lastSuccessfulAt: at, error: null,
    })
    const { rerender } = render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [openingPosition], closePosition, positionMarkStore,
          accountResources: { positions: ready([openingPosition], 100) },
        })}
      />,
    )

    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail.props
        .onPositionClose(openingPosition, { x: 200, y: 150 })
    })
    fireEvent.change(screen.getByLabelText('Close size'), { target: { value: '0.25' } })

    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [], closePosition, positionMarkStore,
          accountResources: { positions: ready([], 200) },
        })}
      />,
    )
    expect(screen.queryByLabelText('Close BTCUSDT LONG position')).not.toBeInTheDocument()
    expect(closePosition).not.toHaveBeenCalled()

    const reopenedPosition = { ...openingPosition, quantity: '0.8' }
    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [reopenedPosition], closePosition, positionMarkStore,
          accountResources: { positions: ready([reopenedPosition], 300) },
        })}
      />,
    )
    expect(screen.queryByLabelText('Close BTCUSDT LONG position')).not.toBeInTheDocument()

    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail.props
        .onPositionClose(reopenedPosition, { x: 200, y: 150 })
    })
    expect(screen.getByLabelText('Close size')).toHaveValue('0.8')
  })

  it('treats a one-way BOTH reversal as a different semantic leg', () => {
    const longPosition = {
      symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5', entryPrice: '57000',
      markPrice: '58000', unrealizedPnl: '500',
    }
    const resource = (data, at) => ({
      status: 'ready', data, updatedAt: at, lastSuccessfulAt: at, error: null,
    })
    const { rerender } = render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [longPosition],
          accountResources: { positions: resource([longPosition], 100) },
        })}
      />,
    )
    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail.props
        .onPositionClose(longPosition, { x: 200, y: 150 })
    })
    expect(screen.getByLabelText('Close BTCUSDT LONG position')).toBeInTheDocument()

    const shortPosition = {
      ...longPosition, quantity: '-0.7', unrealizedPnl: '-700',
    }
    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [shortPosition],
          accountResources: { positions: resource([shortPosition], 200) },
        })}
      />,
    )
    expect(screen.queryByLabelText('Close BTCUSDT LONG position')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Close BTCUSDT SHORT position')).not.toBeInTheDocument()
  })

  it.each([
    ['LONG', '0.5', 'SELL', 'LONG'],
    ['SHORT', '0.5', 'BUY', 'SHORT'],
    ['BOTH', '-0.5', 'BUY', 'BOTH'],
  ])('carries the raw %s leg on a LIMIT close', (
    positionSide, quantity, side, expectedPositionSide,
  ) => {
    const placeOrder = vi.fn(() => true)
    const position = {
      symbol: 'BTCUSDT', positionSide, quantity, entryPrice: '57000',
      markPrice: '58000', unrealizedPnl: '500',
    }
    const { unmount } = render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          positions: [position], placeOrder,
          accountResources: {
            positions: {
              status: 'ready', data: [position], updatedAt: 100,
              lastSuccessfulAt: 100, error: null,
            },
          },
        })}
      />,
    )
    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail.props
        .onPositionClose(position, { x: 200, y: 150 })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Place close limit' }))

    expect(placeOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT', side, positionSide: expectedPositionSide,
      orderType: 'LIMIT', price: '58000', quantity: '0.5', reduceOnly: true,
    })
    unmount()
  })

  it('updates the live close preview only when the mark value changes', () => {
    const entryPriceRead = vi.fn(() => '100')
    const position = {
      symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1',
      get entryPrice() { return entryPriceRead() },
      markPrice: '105', unrealizedPnl: '5',
    }
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '110', updatedAt: 100, lastPrice: '90', lastPriceAt: 100,
      },
    })
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({ positions: [position], positionMarkStore })}
      />,
    )
    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail.props
        .onPositionClose(position, { x: 200, y: 150 })
    })
    const panel = screen.getByLabelText('Close BTCUSDT LONG position')
    expect(panel).toHaveTextContent('+10.00')

    entryPriceRead.mockClear()
    act(() => positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '110.0', updatedAt: 200, lastPrice: '90.0', lastPriceAt: 200,
      },
    }))
    expect(entryPriceRead).not.toHaveBeenCalled()
    expect(panel).toHaveTextContent('+10.00')

    act(() => positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '110', updatedAt: 300, lastPrice: '95', lastPriceAt: 300,
      },
    }))
    expect(entryPriceRead).not.toHaveBeenCalled()

    act(() => positionMarkStore.replace({
      BTCUSDT: {
        markPrice: '120', updatedAt: 400, lastPrice: '95', lastPriceAt: 400,
      },
    }))
    expect(entryPriceRead).toHaveBeenCalled()
    expect(panel).toHaveTextContent('+20.00')
  })

  it('opens margin actions on the coherent raw risk snapshot and clears their draft on absence', () => {
    const adjustPositionMargin = vi.fn(() => true)
    const positionMarkStore = createFuturesPositionMarkStore()
    positionMarkStore.replace({
      BTCUSDT: { markPrice: '59000', updatedAt: 100 },
    })
    const position = {
      symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5', entryPrice: '57000',
      markPrice: '58445', unrealizedPnl: '-300', isolatedWallet: '1200',
      maintenanceMargin: '40', liquidationPrice: '54680', marginType: 'ISOLATED',
    }
    const balances = { USDT: { available: '5000', total: '5000' } }
    const resources = (positions, at) => ({
      balances: {
        status: 'ready', data: balances, updatedAt: at, lastSuccessfulAt: at, error: null,
      },
      positions: {
        status: 'ready', data: positions, updatedAt: at, lastSuccessfulAt: at, error: null,
      },
    })
    const { rerender } = render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          balances, positions: [position], positionMarkStore, adjustPositionMargin,
          accountResources: resources([position], 100),
        })}
      />,
    )
    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].portfolioDock.props
        .onMarginEdit(position, { x: 200, y: 150 })
    })
    expect(screen.getByRole('img', {
      name: 'Margin 900.00 USDT: 40.00 held as maintenance, 860.00 spare above liquidation',
    })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Margin amount in USDT'), { target: { value: '250' } })
    expect(screen.getByRole('button', { name: 'Add margin' })).toBeEnabled()

    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          balances, positions: [], positionMarkStore, adjustPositionMargin,
          accountResources: resources([], 200),
        })}
      />,
    )
    expect(screen.queryByLabelText('Adjust BTCUSDT LONG position margin'))
      .not.toBeInTheDocument()
    expect(adjustPositionMargin).not.toHaveBeenCalled()

    const reopened = { ...position, quantity: '0.8' }
    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          balances, positions: [reopened], positionMarkStore, adjustPositionMargin,
          accountResources: resources([reopened], 300),
        })}
      />,
    )
    expect(screen.queryByLabelText('Adjust BTCUSDT LONG position margin'))
      .not.toBeInTheDocument()
    act(() => {
      productionWorkstationMocks.viewRender.mock.lastCall[0].portfolioDock.props
        .onMarginEdit(reopened, { x: 200, y: 150 })
    })
    expect(screen.getByLabelText('Margin amount in USDT')).toHaveValue('')
  })
})

// The chart names the order every drop is for, and the hook discharges the
// obligation made for that order. Between them sits this container, which took
// the price and the direction off the payload and left the name on the floor.
// Both sides were green the whole time: the chart's tests assert what it hands
// over, the hook's tests call it directly, and nothing joined them up. With two
// drags in the air the first drop placed the second order's size at the first
// order's price, and the second drop found nothing left to place — the operator
// moved three orders and two came back.
describe('FuturesProductionWorkstation order drags', () => {
  const dragged = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    orderKind: 'REGULAR',
    status: 'NEW',
    side: 'BUY',
    orderId: 11,
    clientOrderId: 'first',
    price: '58445.00',
    origQty: '0.004',
    ...overrides,
  })

  it('places every order that was dropped, with two drags in the air at once', async () => {
    const cancelOrderAndConfirm = vi.fn(async () => ({ outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED }))
    const placeOrderAndConfirm = vi.fn(async () => ({ outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED }))
    const first = dragged()
    const second = dragged({ orderId: 12, clientOrderId: 'second', price: '58200.00', origQty: '0.007' })
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          openOrders: [first, second],
          cancelOrderAndConfirm,
          placeOrderAndConfirm,
        })}
      />,
    )
    const view = () => productionWorkstationMocks.viewRender.mock.lastCall[0]

    // Both gestures end inside their cancellation round trips, which is how the
    // operator works: they flick an order across and let go.
    await act(async () => { await view().onOrderLift(first) })
    await act(async () => { await view().onOrderLift(second) })
    await act(async () => {
      await view().onOrderDrop({ order: first, price: '58500', restored: false })
    })
    await act(async () => {
      await view().onOrderDrop({ order: second, price: '58300', restored: false })
    })

    expect(cancelOrderAndConfirm).toHaveBeenCalledTimes(2)
    // Two orders came off the book, so two go back on it — each at its own
    // price, in its own size.
    expect(placeOrderAndConfirm).toHaveBeenCalledTimes(2)
    expect(placeOrderAndConfirm.mock.calls.map(([command]) => [command.price, command.quantity]))
      .toEqual([['58500', '0.004'], ['58300', '0.007']])
  })
})

// What the contract is set to and what stands behind it: two fields, one read,
// and under the operator's rule — nothing retuned in Binance's own app while
// the desk runs — that read is the only reading of them the session gets.
describe('FuturesProductionWorkstation contract configuration', () => {
  const config = (overrides = {}) => ({
    BTCUSDT: {
      symbol: 'BTCUSDT',
      leverage: 20,
      maxLeverage: 125,
      marginType: 'CROSSED',
      maxNotionalValue: '5000000',
      ...overrides,
    },
  })

  // The desk can mount before the local backend socket is open. A command sent
  // then never leaves — it is remembered as unsent, and nothing automatic sends
  // it again. It used to land anyway, by accident: `sendCommand` is rebuilt when
  // the socket changes, which rebuilt `loadSymbolConfig`, which re-ran the
  // effect. Here the identity is deliberately held still, so only the connection
  // opening can produce the second read.
  it('reads the contract configuration again when the backend connection opens', () => {
    const loadSymbolConfig = vi.fn(() => false)
    const closed = executionState({ connected: false, loadSymbolConfig })
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={closed} />,
    )
    expect(loadSymbolConfig).toHaveBeenCalledTimes(1)
    expect(loadSymbolConfig).toHaveBeenCalledWith('BTCUSDT')

    // Same function, same contract: nothing about the read changed except that
    // there is now somewhere to send it.
    loadSymbolConfig.mockReturnValue(true)
    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={{ ...closed, connected: true }}
      />,
    )
    expect(loadSymbolConfig).toHaveBeenCalledTimes(2)
    expect(loadSymbolConfig).toHaveBeenLastCalledWith('BTCUSDT')
  })

  // The operator's own case: cross ×1 set in Binance's app, and the desk wrote
  // ISOLATED back over it on the next start. Nothing automatic may reach that
  // command any more — the multiple is still brought down.
  it('lowers an inherited multiple to 1x and sends no margin mode at all', () => {
    const setLeverage = vi.fn(() => true)
    const setMarginType = vi.fn(() => true)
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          symbolConfigs: config(),
          accountResources: { positions: { status: 'ready', data: [], lastSuccessfulAt: 1 } },
          setLeverage,
          setMarginType,
        })}
      />,
    )

    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'BTCUSDT', leverage: 1 })
    expect(setMarginType).not.toHaveBeenCalled()
  })

  it('sends nothing for a contract already at the default, in either mode', () => {
    for (const marginType of ['CROSSED', 'ISOLATED']) {
      const setLeverage = vi.fn(() => true)
      const setMarginType = vi.fn(() => true)
      const { unmount } = render(
        <FuturesProductionWorkstation
          enabled
          executionState={executionState({
            symbolConfigs: config({ leverage: 1, marginType }),
            accountResources: { positions: { status: 'ready', data: [], lastSuccessfulAt: 1 } },
            setLeverage,
            setMarginType,
          })}
        />,
      )
      expect(setLeverage, marginType).not.toHaveBeenCalled()
      expect(setMarginType, marginType).not.toHaveBeenCalled()
      unmount()
    }
  })

  // Stated where the size is chosen, and it is the control that changes it —
  // the desk had no way to switch the mode at all, on either surface.
  it('gives the ticket the contract mode and the command that changes it', () => {
    const setMarginType = vi.fn(() => true)
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({ symbolConfigs: config(), setMarginType })}
      />,
    )
    const { props } = productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail
    expect(props.marginMode).toBe('CROSSED')
    expect(props.leverage).toBe(20)
    expect(props.onMarginModeChange).toBe(setMarginType)
  })

  // The mode decides which leverage changes the exchange will take at all, so
  // the panel that offers them has to be given it. Without it the desk offered
  // the operator a 1× it knew Binance would refuse, and spent a signed request
  // finding out — which is what happened on 2026-08-21.
  it('gives the leverage panel the mode, so it refuses what the exchange would', () => {
    const setLeverage = vi.fn(() => true)
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          symbolConfigs: config({ leverage: 2, marginType: 'ISOLATED' }),
          positions: [{ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.5' }],
          accountResources: { positions: { status: 'ready', data: [], lastSuccessfulAt: 1 } },
          setLeverage,
        })}
      />,
    )
    const { props } = productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail
    act(() => props.onLeverageEdit('BTCUSDT', { x: 400, y: 300 }))

    fireEvent.click(screen.getByRole('button', { name: '1×' }))
    expect(screen.getByRole('status'))
      .toHaveTextContent('Binance will not lower the multiple while a position is open')
    expect(screen.getByRole('button', { name: 'Held at 2×' })).toBeDisabled()
    expect(setLeverage).not.toHaveBeenCalled()
  })

  // A contract nothing has been read for states no mode, rather than the mode
  // of whichever contract was on screen before it.
  it('states no mode for a contract the desk holds no configuration for', () => {
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({ symbolConfigs: {} })}
      />,
    )
    const { props } = productionWorkstationMocks.viewRender.mock.lastCall[0].tradingRail
    expect(props.marginMode).toBeNull()
    expect(props.leverage).toBeNull()
  })
})

// The container is where the chart's tape and the account's marks are both in
// scope, and it is the only place on the desk where that is true.
describe('the tape behind the position on screen', () => {
  const carrying = (symbol, header) => {
    productionWorkstationMocks.carrying = {
      symbol,
      resources: { catalog: { contracts: [], state: 'live' }, header },
    }
  }

  it('feeds the chart\'s own last price to the position mark store', () => {
    const store = createFuturesPositionMarkStore()
    store.replace({ BTCUSDT: { markPrice: '60000', updatedAt: 1000 } })
    carrying('BTCUSDT', { lastPrice: '60250', eventTime: 1400 })

    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({ positionMarkStore: store })}
      />,
    )

    expect(store.get('BTCUSDT')).toEqual({
      markPrice: '60000',
      updatedAt: 1000,
      lastPrice: '60250',
      lastPriceAt: 1400,
    })
  })

  it('reads no tape for a contract the workstation is not carrying yet', () => {
    const store = createFuturesPositionMarkStore()
    store.replace({
      BTCUSDT: { markPrice: '60000', updatedAt: 1000 },
      ETHUSDT: { markPrice: '2500', updatedAt: 1000 },
    })
    carrying('BTCUSDT', { lastPrice: '60250', eventTime: 1400 })
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({ positionMarkStore: store })}
      />,
    )
    expect(store.get('BTCUSDT').lastPrice).toBe('60250')

    // The selection moves first and the stream follows: for a moment the header
    // still belongs to the contract just left. A print read as the new
    // contract's would be a price from another market sitting beside its mark,
    // and nothing on the row would say so.
    act(() => productionWorkstationMocks.viewRender.mock.lastCall[0]
      .onSymbolChange('ETHUSDT'))

    expect(store.get('BTCUSDT').lastPrice).toBeNull()
    expect(store.get('ETHUSDT').lastPrice).toBeNull()
    expect(store.get('BTCUSDT').markPrice).toBe('60000')
  })
})
