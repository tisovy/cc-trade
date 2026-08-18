import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FuturesWorkspace from './FuturesWorkspace.jsx'

const mocks = vi.hoisted(() => ({
  notifyError: vi.fn(),
  state: null,
  workstationProps: null,
}))

vi.mock('../context/GatewayContext.jsx', () => ({
  useGatewayContext: () => ({
    notifyError: mocks.notifyError,
    sendMessage: vi.fn(),
    startupStatus: { ready: true },
    wsConnection: { readyState: 1 },
  }),
}))

vi.mock('../hooks/useFuturesTrading.js', () => ({
  default: () => mocks.state,
}))

vi.mock('../components/features/futures/FuturesProductionWorkstation.jsx', () => ({
  default: properties => {
    mocks.workstationProps = properties
    return <div data-testid="futures-workstation-stub" />
  },
}))

const state = overrides => ({
  accountResources: {},
  lastError: null,
  ...overrides,
})

describe('FuturesWorkspace operational alerts', () => {
  beforeEach(() => {
    mocks.notifyError.mockClear()
    mocks.state = state()
    mocks.workstationProps = null
  })

  it('forwards the app-owned market clock into the production workstation', () => {
    const marketClock = <time>Tue 18 Aug 12:25:56</time>
    render(<FuturesWorkspace marketClock={marketClock} />)

    expect(mocks.workstationProps.marketClock).toBe(marketClock)
  })

  it('deduplicates a resource error and re-arms the same code after recovery', () => {
    const { rerender } = render(<FuturesWorkspace />)
    mocks.state = state({
      accountResources: {
        balances: {
          status: 'error',
          error: { code: 'FUTURES_PERMISSION_DENIED', message: 'Verify Futures permission.' },
        },
      },
    })
    rerender(<FuturesWorkspace />)
    expect(mocks.notifyError).toHaveBeenCalledOnce()
    expect(mocks.notifyError).toHaveBeenLastCalledWith(
      'Futures balances: Verify Futures permission.',
    )

    rerender(<FuturesWorkspace />)
    expect(mocks.notifyError).toHaveBeenCalledOnce()

    mocks.state = state({
      accountResources: { balances: { status: 'ready', error: null } },
    })
    rerender(<FuturesWorkspace />)
    mocks.state = state({
      accountResources: {
        balances: {
          status: 'error',
          error: { code: 'FUTURES_PERMISSION_DENIED', message: 'Verify Futures permission.' },
        },
      },
    })
    rerender(<FuturesWorkspace />)
    expect(mocks.notifyError).toHaveBeenCalledTimes(2)
  })

  it('alerts once for a command rejection until the command state recovers', () => {
    const { rerender } = render(<FuturesWorkspace />)
    mocks.state = state({
      lastError: {
        request: 'trade.placeOrder',
        code: 'FUTURES_ORDER_CAP_EXCEEDED',
        message: 'Order exceeds the local cap.',
      },
    })
    rerender(<FuturesWorkspace />)
    rerender(<FuturesWorkspace />)
    expect(mocks.notifyError).toHaveBeenCalledOnce()
    expect(mocks.notifyError).toHaveBeenCalledWith(
      'Futures command rejected: Order exceeds the local cap.',
    )

    mocks.state = state()
    rerender(<FuturesWorkspace />)
    mocks.state = state({
      lastError: {
        request: 'trade.placeOrder',
        code: 'FUTURES_ORDER_CAP_EXCEEDED',
        message: 'Order exceeds the local cap.',
      },
    })
    rerender(<FuturesWorkspace />)
    expect(mocks.notifyError).toHaveBeenCalledTimes(2)
  })
})
