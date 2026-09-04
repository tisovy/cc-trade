import { useEffect } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FuturesWorkspace from './FuturesWorkspace.jsx'

const mocks = vi.hoisted(() => ({
  notifyError: vi.fn(),
  state: null,
  workstationProps: null,
  failView: false,
  ownerMounts: 0,
  ownerUnmounts: 0,
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
  default: function useTradingOwnerStub() {
    useEffect(() => {
      mocks.ownerMounts += 1
      return () => { mocks.ownerUnmounts += 1 }
    }, [])
    return mocks.state
  },
}))

vi.mock('../components/features/futures/FuturesProductionWorkstation.jsx', () => ({
  default: properties => {
    mocks.workstationProps = properties
    if (mocks.failView) throw new Error('fixture-sensitive-view-error')
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
    mocks.failView = false
    mocks.ownerMounts = 0
    mocks.ownerUnmounts = 0
  })

  it('forwards the app-owned market clock into the production workstation', () => {
    const marketClock = <time>Tue 18 Aug 12:25:56</time>
    render(<FuturesWorkspace marketClock={marketClock} />)

    expect(mocks.workstationProps.marketClock).toBe(marketClock)
  })

  it('retries presentation without remounting the trading owner or losing its unresolved outcome', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const held = { code: 'UNCONFIRMED', details: { clientOrderId: 'held-command' } }
      mocks.state = state({ unresolvedOutcome: held })
      const view = render(<FuturesWorkspace />)
      mocks.failView = true
      view.rerender(<FuturesWorkspace />)
      expect(screen.getByText('Futures view unavailable')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Local connection: connected')
      expect(screen.getByRole('status')).toHaveTextContent('Market activation: unconfirmed')
      expect(screen.queryByText('fixture-sensitive-view-error')).not.toBeInTheDocument()
      expect(mocks.ownerMounts).toBe(1)
      expect(mocks.ownerUnmounts).toBe(0)
      mocks.failView = false
      fireEvent.click(screen.getByRole('button', { name: 'Retry view' }))
      expect(screen.getByTestId('futures-workstation-stub')).toBeInTheDocument()
      expect(mocks.workstationProps.executionState.unresolvedOutcome).toBe(held)
      expect(mocks.ownerMounts).toBe(1)
      expect(mocks.ownerUnmounts).toBe(0)
    } finally { errorLog.mockRestore() }
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
