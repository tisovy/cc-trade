import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MARKET_WORKSPACES } from '../utils/marketWorkspaceStorage.js'
import { NotificationProvider } from './NotificationProvider.jsx'
import { GatewayProvider, useGatewayContext } from './GatewayContext.jsx'

// `sendMessage` records the frame as it reaches the socket — after the
// decorator the provider hands the transport. The real hook's channel helpers
// write through that same point, so `unsubscribeChannel` here stands for every
// frame the provider never sees.
const mocks = vi.hoisted(() => {
  const state = {
    connection: { readyState: 1 },
    handleMessage: null,
    sendMessage: vi.fn(() => true),
    frameMessage: null,
    failure: null,
  }
  // One identity for the lifetime of the test file: the transport's send is a
  // dependency of the effect that activates the market, and a send rebuilt on
  // every render would re-activate on every render.
  state.send = message => state.sendMessage(
    state.frameMessage ? state.frameMessage(message, state.connection) : message,
  )
  state.subscribeChannel = vi.fn(config => state.send({ action: 'subscribe', ...config }))
  state.unsubscribeChannel = vi.fn(channelId => state.send({ action: 'unsubscribe', channelId }))
  return state
})

vi.mock('../hooks/useWebSocket.js', () => ({
  default: vi.fn((_url, _detailSubscription, handleMessage, frameMessage) => {
    mocks.handleMessage = handleMessage
    mocks.frameMessage = frameMessage ?? null
    return {
      connection: mocks.connection,
      failure: mocks.failure ?? null,
      reconnect: vi.fn(),
      sendMessage: mocks.send,
      subscribe: mocks.subscribeChannel,
      unsubscribe: mocks.unsubscribeChannel,
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

  // Every market-scoped frame carries the activation it was issued under. The
  // market name alone does not separate a stale frame from a current one:
  // Spot → Futures → Spot leaves the name equal to what the stale frame holds.
  it('stamps market-scoped frames with the activation that is current', async () => {
    const Sender = () => {
      const { sendMessage } = useGatewayContext()
      return (
        <button type="button" onClick={() => sendMessage({ action: 'unsubscribe', channelId: 'c1' })}>
          send
        </button>
      )
    }
    render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <Sender />
        </GatewayProvider>
      </NotificationProvider>,
    )

    // Before an acknowledgement there is no activation to stamp with.
    act(() => screen.getByRole('button', { name: 'send' }).click())
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ action: 'unsubscribe', channelId: 'c1' })

    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'market_activation', version: 1, marketMode: 'spot', generation: 4,
      }),
    }, mocks.connection, null))

    act(() => screen.getByRole('button', { name: 'send' }).click())
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      action: 'unsubscribe',
      channelId: 'c1',
      generation: 4,
    })

    // The activation frame itself is never stamped: it is what mints the next
    // generation.
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'activate_market',
      generation: expect.anything(),
    }))
  })

  // The channel helpers build and send their own frames. A stamp applied at the
  // provider's `sendMessage` never touched them, so every Spot subscription and
  // unsubscription reached the backend with nothing to compare against — the
  // one frame class that revives a market's stream.
  it('stamps the frames the channel helpers send themselves', () => {
    const Subscriber = () => {
      const { subscribe, unsubscribe } = useGatewayContext()
      return (
        <>
          <button
            type="button"
            onClick={() => subscribe({ channelId: 'detail-BTCUSDT-1h', symbol: 'BTCUSDT', interval: '1h' })}
          >
            subscribe
          </button>
          <button type="button" onClick={() => unsubscribe('detail-BTCUSDT-1h')}>unsubscribe</button>
        </>
      )
    }
    render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <Subscriber />
        </GatewayProvider>
      </NotificationProvider>,
    )

    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'market_activation', version: 1, marketMode: 'spot', generation: 7,
      }),
    }, mocks.connection, null))

    act(() => screen.getByRole('button', { name: 'subscribe' }).click())
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'subscribe',
      channelId: 'detail-BTCUSDT-1h',
      generation: 7,
    }))

    act(() => screen.getByRole('button', { name: 'unsubscribe' }).click())
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      action: 'unsubscribe',
      channelId: 'detail-BTCUSDT-1h',
      generation: 7,
    })
  })

  // An acknowledgement belongs to the socket it arrived on. A frame written to a
  // socket that was never told anything carries no activation, whatever the
  // previous socket was told.
  it('does not stamp a frame written to a socket that acknowledged nothing', () => {
    const Sender = () => {
      const { sendMessage } = useGatewayContext()
      return (
        <button type="button" onClick={() => sendMessage({ action: 'unsubscribe', channelId: 'c1' })}>
          send
        </button>
      )
    }
    const { rerender } = render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <Sender />
        </GatewayProvider>
      </NotificationProvider>,
    )

    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'market_activation', version: 1, marketMode: 'spot', generation: 9,
      }),
    }, mocks.connection, null))

    mocks.connection = { readyState: 1 }
    rerender(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <Sender />
        </GatewayProvider>
      </NotificationProvider>,
    )

    act(() => screen.getByRole('button', { name: 'send' }).click())
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ action: 'unsubscribe', channelId: 'c1' })
  })

  it('treats a reconnected transport as having no activated market', () => {
    const ActivationObserver = () => {
      const { marketActivation } = useGatewayContext()
      return (
        <span data-testid="activated">
          {marketActivation ? `${marketActivation.marketMode}:${marketActivation.generation}` : 'none'}
        </span>
      )
    }
    const { rerender } = render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <ActivationObserver />
        </GatewayProvider>
      </NotificationProvider>,
    )

    act(() => mocks.handleMessage({
      data: JSON.stringify({
        type: 'market_activation', version: 1, marketMode: 'spot', generation: 1,
      }),
    }, mocks.connection, null))
    expect(screen.getByTestId('activated')).toHaveTextContent('spot:1')

    // A reconnect hands out a new socket; the backend it reaches has activated
    // nothing yet.
    mocks.connection = { readyState: 1 }
    rerender(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.SPOT}>
          <ActivationObserver />
        </GatewayProvider>
      </NotificationProvider>,
    )
    expect(screen.getByTestId('activated')).toHaveTextContent('none')
  })


  // The acknowledgement changes the generation, and the generation used to be
  // closed over by `sendMessage` — a dependency of the effect that sends
  // `activate_market`. Each acknowledgement therefore activated the market
  // again: the backend minted generation after generation and refused every
  // frame issued behind the last one.
  it('does not re-activate the market when an acknowledgement arrives', async () => {
    render(
      <NotificationProvider>
        <GatewayProvider activeMarketMode={MARKET_WORKSPACES.FUTURES_LIVE}>
          <Observer />
        </GatewayProvider>
      </NotificationProvider>,
    )

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

    const activations = () => mocks.sendMessage.mock.calls
      .filter(([message]) => message?.action === 'activate_market')
    await waitFor(() => expect(activations()).toHaveLength(1))

    for (const generation of [1, 2, 3]) {
      act(() => mocks.handleMessage({
        data: JSON.stringify({
          type: 'market_activation', version: 1, marketMode: 'futures-live', generation,
        }),
      }, mocks.connection, null))
    }

    await waitFor(() => expect(activations()).toHaveLength(1))
  })

})
