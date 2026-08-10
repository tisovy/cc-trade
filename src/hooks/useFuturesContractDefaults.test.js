import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useFuturesContractDefaults from './useFuturesContractDefaults.js'

const config = (overrides = {}) => ({
  symbol: 'EPICUSDT',
  leverage: 20,
  maxLeverage: 75,
  marginType: 'CROSSED',
  maxNotionalValue: '500000',
  ...overrides,
})

const renderDefaults = (overrides = {}) => {
  const setLeverage = vi.fn(() => true)
  const setMarginType = vi.fn(() => true)
  const props = {
    enabled: true,
    paused: false,
    symbol: 'EPICUSDT',
    config: config(),
    positions: [],
    openOrders: [],
    positionsRead: true,
    setLeverage,
    setMarginType,
    ...overrides,
  }
  const view = renderHook(next => useFuturesContractDefaults(next), { initialProps: props })
  return { ...view, props, setLeverage, setMarginType }
}

describe('holding a contract at the desk default', () => {
  it('sets a flat contract to 2x isolated when its configuration arrives', () => {
    const { setLeverage, setMarginType } = renderDefaults()
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 2 })
    expect(setMarginType).toHaveBeenCalledWith({ symbol: 'EPICUSDT', marginType: 'ISOLATED' })
  })

  it('sends nothing while the workspace is inactive', () => {
    const { setLeverage, setMarginType } = renderDefaults({ enabled: false })
    expect(setLeverage).not.toHaveBeenCalled()
    expect(setMarginType).not.toHaveBeenCalled()
  })

  // A paused desk refuses both changes at the backend, so an automatic default
  // would land as a pair of red cards the operator never asked for — on the one
  // surface where a refusal is supposed to mean something. It waits.
  it('waits for the resume while trading is paused', () => {
    const { rerender, props, setLeverage, setMarginType } = renderDefaults({ paused: true })
    expect(setLeverage).not.toHaveBeenCalled()
    expect(setMarginType).not.toHaveBeenCalled()

    rerender({ ...props, paused: false })
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 2 })
    expect(setMarginType).toHaveBeenCalledWith({ symbol: 'EPICUSDT', marginType: 'ISOLATED' })
  })

  // The mode is refused while an order rests; the multiple is not. Once the
  // order is gone the mode follows, without the contract having to be reopened.
  it('applies the mode once the working order that blocked it is gone', () => {
    const { rerender, props, setLeverage, setMarginType } = renderDefaults({
      openOrders: [{ symbol: 'EPICUSDT', orderId: 7 }],
    })
    expect(setLeverage).toHaveBeenCalledTimes(1)
    expect(setMarginType).not.toHaveBeenCalled()

    rerender({ ...props, openOrders: [] })
    expect(setLeverage).toHaveBeenCalledTimes(1)
    expect(setMarginType).toHaveBeenCalledWith({ symbol: 'EPICUSDT', marginType: 'ISOLATED' })
  })

  // The account refresh that follows the change re-broadcasts the contract, and
  // the marks re-render the desk several times a second. One contract, one
  // attempt: anything else is a stream of writes to the exchange.
  it('acts once per contract however often the account is re-read', () => {
    const { rerender, props, setLeverage, setMarginType } = renderDefaults()
    rerender({ ...props, positions: [] })
    rerender({ ...props, config: config({ leverage: 2, marginType: 'ISOLATED' }) })
    rerender({ ...props, config: config() })
    expect(setLeverage).toHaveBeenCalledTimes(1)
    expect(setMarginType).toHaveBeenCalledTimes(1)
  })

  // Raising it back is a decision. A desk that undid it on the next contract
  // switch would be arguing with the operator about their own money.
  it('leaves a multiple the operator set afterwards alone', () => {
    const { rerender, props, setLeverage } = renderDefaults()
    expect(setLeverage).toHaveBeenCalledTimes(1)

    rerender({ ...props, symbol: 'BTCUSDT', config: config({ symbol: 'BTCUSDT', leverage: 2, marginType: 'ISOLATED' }) })
    rerender({ ...props, config: config({ leverage: 10, marginType: 'ISOLATED' }) })
    expect(setLeverage).toHaveBeenCalledTimes(1)
  })

  // A send refused by a closed socket never reached the exchange, so the
  // contract is still at 20x and the default still has work to do.
  it('tries again when the send did not leave the desk', () => {
    const setLeverage = vi.fn(() => false)
    const props = {
      enabled: true,
      symbol: 'EPICUSDT',
      config: config({ marginType: 'ISOLATED' }),
      positions: [],
      positionsRead: true,
      setLeverage,
      setMarginType: vi.fn(() => true),
    }
    const { rerender } = renderHook(next => useFuturesContractDefaults(next), { initialProps: props })
    rerender({ ...props, positions: [] })
    expect(setLeverage).toHaveBeenCalledTimes(2)

    setLeverage.mockReturnValue(true)
    rerender({ ...props, positions: [] })
    rerender({ ...props, positions: [] })
    expect(setLeverage).toHaveBeenCalledTimes(3)
  })

  it('sends nothing for a contract that carries a position', () => {
    const { setLeverage, setMarginType } = renderDefaults({
      positions: [{ symbol: 'EPICUSDT', quantity: '400', positionSide: 'LONG' }],
    })
    expect(setLeverage).not.toHaveBeenCalled()
    expect(setMarginType).not.toHaveBeenCalled()
  })

  it('waits for the positions to be read before it acts', () => {
    const { rerender, props, setLeverage } = renderDefaults({ positionsRead: false })
    expect(setLeverage).not.toHaveBeenCalled()

    rerender({ ...props, positionsRead: true })
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 2 })
  })
})
