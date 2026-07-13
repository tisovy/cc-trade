import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FuturesTestnetExecutionTicket from './FuturesTestnetExecutionTicket.jsx'

const REQUEST_ID = '0123456789abcdef0123456789abcdef'

const createState = (overrides = {}) => ({
  connected: true,
  subscribed: true,
  submissionLocked: false,
  revision: '1',
  symbol: 'BTCUSDT',
  capability: {
    enabled: true,
    code: 'FUTURES_EXECUTION_ENABLED',
  },
  intent: null,
  attempt: null,
  ...overrides,
})

const intent = {
  requestId: REQUEST_ID,
  clientOrderId: `cc6-${REQUEST_ID}`,
  symbol: 'BTCUSDT',
  side: 'SELL',
  leverage: 2,
  expiresAt: 1_783_857_630_000,
}

const createAttempt = (overrides = {}) => ({
  acknowledgement: 'pending',
  state: 'queued',
  code: 'FUTURES_EXECUTION_PENDING',
  message: 'Testnet reduce-only order is pending.',
  order: null,
  ...overrides,
})

afterEach(() => cleanup())

describe('FuturesTestnetExecutionTicket', () => {
  it('is unmistakably testnet reduce-only and exposes no unsupported controls', () => {
    render(
      <FuturesTestnetExecutionTicket
        state={createState()}
        onPrepareIntent={() => true}
        onPlaceOrder={() => true}
      />
    )

    expect(screen.getByText('USDⓈ-M TESTNET · REDUCE ONLY')).toBeInTheDocument()
    expect(screen.getByText('Execution enabled')).toBeInTheDocument()
    expect(screen.getByText('LIMIT / GTC')).toBeInTheDocument()
    expect(screen.getByText('ONE-WAY / BOTH')).toBeInTheDocument()
    expect(screen.getByText('ISOLATED')).toBeInTheDocument()
    expect(screen.getByText('REDUCE ONLY')).toBeInTheDocument()
    expect(screen.getByText('NOT APPLICABLE')).toBeInTheDocument()
    expect(screen.getByText('OFF')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel|modify|transfer|leverage|margin/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('shows only the backend disabled capability and cannot prepare', () => {
    const onPrepareIntent = vi.fn(() => true)
    render(
      <FuturesTestnetExecutionTicket
        state={createState({
          capability: {
            enabled: false,
            code: 'FUTURES_EXECUTION_CREDENTIALS_REJECTED',
          },
        })}
        onPrepareIntent={onPrepareIntent}
        onPlaceOrder={() => true}
      />
    )

    expect(screen.getByText('Execution disabled')).toBeInTheDocument()
    expect(screen.getByText('FUTURES_EXECUTION_CREDENTIALS_REJECTED')).toBeInTheDocument()
    const prepare = screen.getByRole('button', { name: 'Prepare one-use intent' })
    expect(prepare).toBeDisabled()
    fireEvent.click(prepare)
    expect(onPrepareIntent).not.toHaveBeenCalled()
  })

  it('does not synthesize enabled or disabled capability before backend status', () => {
    render(
      <FuturesTestnetExecutionTicket
        state={{
          connected: true,
          subscribed: true,
          revision: null,
          symbol: null,
          capability: null,
          intent: null,
          attempt: null,
        }}
        onPrepareIntent={() => true}
        onPlaceOrder={() => true}
      />
    )

    expect(screen.getByText('Awaiting backend capability')).toBeInTheDocument()
    expect(screen.queryByText('Execution enabled')).not.toBeInTheDocument()
    expect(screen.queryByText('Execution disabled')).not.toBeInTheDocument()
  })

  it('synchronously blocks duplicate prepare clicks until backend revision changes', () => {
    const onPrepareIntent = vi.fn(() => true)
    const { rerender } = render(
      <FuturesTestnetExecutionTicket
        state={createState()}
        onPrepareIntent={onPrepareIntent}
        onPlaceOrder={() => true}
      />
    )
    const prepare = screen.getByRole('button', { name: 'Prepare one-use intent' })

    fireEvent.click(prepare)
    fireEvent.click(prepare)
    expect(onPrepareIntent).toHaveBeenCalledTimes(1)

    rerender(
      <FuturesTestnetExecutionTicket
        state={createState({ revision: '2' })}
        onPrepareIntent={onPrepareIntent}
        onPlaceOrder={() => true}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Prepare one-use intent' }))
    expect(onPrepareIntent).toHaveBeenCalledTimes(2)
  })

  it('preserves exact input strings, ignores Enter, and blocks duplicate place clicks', () => {
    const onPlaceOrder = vi.fn(() => true)
    render(
      <FuturesTestnetExecutionTicket
        state={createState({ intent })}
        onPrepareIntent={() => true}
        onPlaceOrder={onPlaceOrder}
      />
    )
    const quantity = screen.getByRole('textbox', { name: 'Exact quantity' })
    const price = screen.getByRole('textbox', { name: 'Exact limit price' })
    const place = screen.getByRole('button', { name: 'Place testnet reduce-only order' })
    expect(screen.getByText('SELL')).toBeInTheDocument()
    expect(screen.getByText('2×')).toBeInTheDocument()

    fireEvent.change(quantity, { target: { value: '0.0100' } })
    fireEvent.change(price, { target: { value: '60000.1200' } })
    fireEvent.keyDown(quantity, { key: 'Enter', bubbles: true })
    fireEvent.keyDown(place, { key: 'Enter', bubbles: true })
    expect(onPlaceOrder).not.toHaveBeenCalled()

    fireEvent.click(place)
    fireEvent.click(place)
    expect(onPlaceOrder).toHaveBeenCalledTimes(1)
    expect(onPlaceOrder).toHaveBeenCalledWith({
      quantity: '0.0100',
      price: '60000.1200',
    })
  })

  it.each([
    ['pending', 'queued', 'Testnet reduce-only order is pending.'],
    ['accepted', 'confirmed_filled', 'Testnet reduce-only order is confirmed.'],
    ['rejected', 'locally_rejected', 'Testnet futures execution risk data was rejected.'],
    ['unknown', 'result_unknown', 'Testnet reduce-only order result is unknown.'],
  ])('displays the backend-owned %s attempt without inferring another result', (
    acknowledgement,
    state,
    message,
  ) => {
    render(
      <FuturesTestnetExecutionTicket
        state={createState({
          capability: { enabled: false, code: 'FUTURES_EXECUTION_BUSY' },
          attempt: createAttempt({ acknowledgement, state, message }),
        })}
        onPrepareIntent={() => true}
        onPlaceOrder={() => true}
      />
    )

    const backendResult = screen.getByLabelText('Backend execution result')
    expect(backendResult).toHaveTextContent(acknowledgement.toUpperCase())
    expect(backendResult).toHaveTextContent(state)
    expect(backendResult).toHaveTextContent(message)
    if (acknowledgement !== 'accepted') {
      expect(backendResult).not.toHaveTextContent('Order confirmed open')
    }
  })

  it('keeps unknown prominent and identifies backend recovery as the owner', () => {
    render(
      <FuturesTestnetExecutionTicket
        state={createState({
          capability: { enabled: false, code: 'FUTURES_EXECUTION_RESULT_UNKNOWN' },
          attempt: createAttempt({
            acknowledgement: 'unknown',
            state: 'result_unknown',
            code: 'FUTURES_EXECUTION_RESULT_UNKNOWN',
            message: 'Testnet reduce-only order result is unknown.',
          }),
        })}
        onPrepareIntent={() => true}
        onPlaceOrder={() => true}
      />
    )

    expect(screen.getByText('Result unknown. Backend recovery remains active.')).toBeInTheDocument()
    expect(screen.getByText('Unknown is not success or rejection. Backend recovery owns the result.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare one-use intent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Place testnet reduce-only order' })).toBeDisabled()
  })

  it('offers no app cancellation for a backend-confirmed open order', () => {
    render(
      <FuturesTestnetExecutionTicket
        state={createState({
          capability: { enabled: false, code: 'FUTURES_EXECUTION_BUSY' },
          attempt: createAttempt({
            acknowledgement: 'accepted',
            state: 'confirmed_open',
            code: 'FUTURES_EXECUTION_CONFIRMED',
            message: 'Testnet reduce-only order is confirmed.',
            order: { orderId: '9223372036854775807', status: 'NEW' },
          }),
        })}
        onPrepareIntent={() => true}
        onPlaceOrder={() => true}
      />
    )

    expect(screen.getByText(/Cancellation is available only in the external Binance Futures Testnet interface/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('does not touch browser storage, analytics transport, or clipboard', () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const clipboardWrite = vi.fn()
    const previousClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })
    const onPrepareIntent = vi.fn(() => false)

    render(
      <FuturesTestnetExecutionTicket
        state={createState()}
        onPrepareIntent={onPrepareIntent}
        onPlaceOrder={() => false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Prepare one-use intent' }))

    expect(localStorageSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(clipboardWrite).not.toHaveBeenCalled()

    localStorageSpy.mockRestore()
    fetchSpy.mockRestore()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: previousClipboard,
    })
  })
})
