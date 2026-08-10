import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MARKET_WORKSPACES } from '../utils/marketWorkspaceStorage.js'
import { NotificationProvider } from './NotificationProvider.jsx'
import { GatewayProvider, useGatewayContext } from './GatewayContext.jsx'

const mocks = vi.hoisted(() => ({
  connection: { readyState: 1 },
  handleMessage: null,
  sendMessage: vi.fn(() => true),
  failure: null,
}))

vi.mock('../hooks/useWebSocket.js', () => ({
  default: vi.fn((_url, _detailSubscription, handleMessage) => {
    mocks.handleMessage = handleMessage
    return {
      connection: mocks.connection,
      failure: mocks.failure ?? null,
      reconnect: vi.fn(),
      sendMessage: mocks.sendMessage,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    }
  }),
}))

const Observer = () => {
  const { startupStatus } = useGatewayContext()
  return <span data-testid="startup-state">{startupStatus.state}</span>
}

describe('GatewayContext', () => {
  beforeEach(() => {
    mocks.sendMessage.mockClear()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('owns startup preflight and activates only the selected market mode', async () => {
    const { rerender } = render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.UNSELECTED}>
          <Observer />
        </GatewayProvider>
      </NotificationProvider>,
    )

    expect(mocks.sendMessage).toHaveBeenCalledWith({ action: 'get_startup_status' })
    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'startup_status',
        version: 1,
        state: 'READY',
        code: 'READY',
        ready: true,
        missingFields: [],
        retiredFields: [],
      }),
    }, mocks.connection, null))

    expect(screen.getByTestId('startup-state')).toHaveTextContent('READY')
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'activate_market',
      marketMode: MARKET_WORKSPACES.UNSELECTED,
    }))

    rerender(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.FUTURES_LIVE}>
          <Observer />
        </GatewayProvider>
      </NotificationProvider>,
    )
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      action: 'activate_market',
      marketMode: MARKET_WORKSPACES.FUTURES_LIVE,
    }))
  })

  // A workspace's children issue refreshes and subscriptions from their own
  // effects. Whether those reached the backend before their parent's activation
  // used to depend on effect scheduling and nothing else.
  it('reports no activated market until the backend acknowledges one', async () => {
    const ActivationObserver = () => {
      const { marketActivation } = useGatewayContext()
      return (
        <span data-testid="activated">
          {marketActivation ? `${marketActivation.marketMode}:${marketActivation.generation}` : 'none'}
        </span>
      )
    }
    render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.FUTURES_LIVE}>
          <ActivationObserver />
        </GatewayProvider>
      </NotificationProvider>,
    )

    expect(screen.getByTestId('activated')).toHaveTextContent('none')

    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'market_activation',
        version: 1,
        marketMode: 'futures-live',
        generation: 1,
      }),
    }, mocks.connection, null))

    expect(screen.getByTestId('activated')).toHaveTextContent('futures-live:1')

    // A switch is acknowledged in its own right; the previous generation never
    // reads as permission for the new market.
    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'market_activation',
        version: 1,
        marketMode: 'spot',
        generation: 2,
      }),
    }, mocks.connection, null))

    expect(screen.getByTestId('activated')).toHaveTextContent('spot:2')
  })

  it('surfaces a transport failure the retry loop cannot resolve', async () => {
    const FailureObserver = () => {
      const { transportFailure } = useGatewayContext()
      return <span data-testid="failure">{transportFailure?.code ?? 'none'}</span>
    }
    mocks.failure = { code: 'AUTHENTICATION_REJECTED', message: 'refused' }

    render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <FailureObserver />
        </GatewayProvider>
      </NotificationProvider>,
    )

    expect(screen.getByTestId('failure')).toHaveTextContent('AUTHENTICATION_REJECTED')
    mocks.failure = null
  })
})
