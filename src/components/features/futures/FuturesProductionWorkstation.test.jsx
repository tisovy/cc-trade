import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFuturesSymbolHistory } from '../../../utils/futuresSymbolHistory.js'
import { FUTURES_COMMAND_OUTCOME } from '../../../utils/futuresCommandOutcome.js'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'

const productionWorkstationMocks = vi.hoisted(() => ({
  viewRender: vi.fn(),
  orderEditorRender: vi.fn(),
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

  // The chart marker, the dock row and the rail row have to price one order the
  // same way. A parent that has fired is priced where it fired; one still
  // resting is priced at its trigger, as it always was.
  it('draws an algo that has fired at the price it fired at, not at its trigger', () => {
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
      .toMatchObject({ orderKind: 'ALGO', price: '56980.10', triggerPrice: '57000.00' })

    rerender(
      <FuturesProductionWorkstation
        enabled
        executionState={executionState({
          openOrders: [{ ...algo, actualOrderId: '', actualPrice: '' }],
        })}
      />,
    )
    expect(productionWorkstationMocks.viewRender.mock.lastCall[0].ownedOrders[0])
      .toMatchObject({ orderKind: 'ALGO', price: '57000.00' })
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
