import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFuturesSymbolHistory } from '../../../utils/futuresSymbolHistory.js'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'

const productionWorkstationMocks = vi.hoisted(() => ({
  viewRender: vi.fn(),
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
vi.mock('./FuturesTradingTicket.jsx', () => ({ default: () => <div /> }))

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

  // Read once, when the workspace opens on a contract it can name. The hook
  // above it is mounted by the workspace and never told the symbol, so a read
  // issued there arrives without one and the backend completes it from the
  // panel's own selection — a different contract entirely.
  it('reads the account history once, naming the contract on screen', () => {
    const state = executionState()
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={state} />,
    )

    expect(state.loadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT')

    rerender(<FuturesProductionWorkstation enabled executionState={state} />)
    expect(state.loadHistory).toHaveBeenCalledOnce()
  })

  it('waits for a connection to read on, and does not read without one', () => {
    const disconnected = executionState({ connected: false })
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={disconnected} />,
    )
    expect(disconnected.loadHistory).not.toHaveBeenCalled()

    const connected = { ...disconnected, connected: true }
    rerender(<FuturesProductionWorkstation enabled executionState={connected} />)
    expect(connected.loadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
  })

  // A frame that never left is not a read. The attempt stays armed so the next
  // usable connection performs it, rather than the desk holding an empty review
  // for the rest of the session.
  it('tries again when the read could not be sent', () => {
    const state = executionState({ loadHistory: vi.fn(() => false) })
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={state} />,
    )
    expect(state.loadHistory).toHaveBeenCalledOnce()

    const recovered = { ...state, loadHistory: vi.fn(() => true) }
    rerender(<FuturesProductionWorkstation enabled executionState={recovered} />)
    expect(recovered.loadHistory).toHaveBeenCalledExactlyOnceWith('BTCUSDT')
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
})
