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
  // Handed in on purpose, though the hook no longer takes it: a hook that has
  // stopped deciding the margin mode cannot send one even when the means to is
  // put in front of it.
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
  it('sets a flat contract to 1x when its configuration arrives', () => {
    const { setLeverage, setMarginType } = renderDefaults()
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 1 })
    expect(setMarginType).not.toHaveBeenCalled()
  })

  // The operator's own case, and the reason "once per contract per session" was
  // never enough to make it safe: a restart re-arms the guard, so a contract set
  // to cross in Binance's own app was written back to isolated the next morning
  // — and the exchange announces no margin mode on any stream, so the desk could
  // not even show what it had overwritten.
  it('leaves a contract the operator set to cross in cross, restart after restart', () => {
    for (const session of [1, 2, 3]) {
      const { setLeverage, setMarginType, unmount } = renderDefaults({
        config: config({ leverage: 1, marginType: 'CROSSED' }),
      })
      expect(setMarginType, `session ${session}`).not.toHaveBeenCalled()
      expect(setLeverage, `session ${session}`).not.toHaveBeenCalled()
      unmount()
    }
  })

  // Lowering an inherited 20x is still the desk's business. What stands behind
  // that multiple is not.
  it('lowers the multiple of a cross contract without touching its mode', () => {
    const { setLeverage, setMarginType } = renderDefaults({
      config: config({ leverage: 20, marginType: 'CROSSED' }),
    })
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 1 })
    expect(setMarginType).not.toHaveBeenCalled()
  })

  // The five below guard rules this change did not touch: they pass against the
  // code as it was, and are kept as guards rather than presented as evidence
  // that anything here now works differently.
  it('sends nothing while the workspace is inactive', () => {
    const { setLeverage, setMarginType } = renderDefaults({ enabled: false })
    expect(setLeverage).not.toHaveBeenCalled()
    expect(setMarginType).not.toHaveBeenCalled()
  })

  // A paused desk refuses the change at the backend, so an automatic default
  // would land as a red card the operator never asked for — on the one surface
  // where a refusal is supposed to mean something. It waits.
  it('waits for the resume while trading is paused', () => {
    const { rerender, props, setLeverage } = renderDefaults({ paused: true })
    expect(setLeverage).not.toHaveBeenCalled()

    rerender({ ...props, paused: false })
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 1 })
  })

  // Binance refuses a margin-mode change while an order rests; it allows a
  // leverage change. The desk sends only the second, so a resting order is no
  // longer a reason to hold anything back.
  it('lowers the multiple of a contract with a working order', () => {
    const { setLeverage, setMarginType } = renderDefaults({
      openOrders: [{ symbol: 'EPICUSDT', orderId: 7 }],
    })
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 1 })
    expect(setLeverage).toHaveBeenCalledTimes(1)
    expect(setMarginType).not.toHaveBeenCalled()
  })

  // The account refresh that follows the change re-broadcasts the contract, and
  // the marks re-render the desk several times a second. One contract, one
  // attempt: anything else is a stream of writes to the exchange.
  it('acts once per contract however often the account is re-read', () => {
    const { rerender, props, setLeverage } = renderDefaults()
    rerender({ ...props, positions: [] })
    rerender({ ...props, config: config({ leverage: 1, marginType: 'ISOLATED' }) })
    rerender({ ...props, config: config() })
    expect(setLeverage).toHaveBeenCalledTimes(1)
  })

  // Raising it back is a decision. A desk that undid it on the next contract
  // switch would be arguing with the operator about their own money.
  it('leaves a multiple the operator set afterwards alone', () => {
    const { rerender, props, setLeverage } = renderDefaults()
    expect(setLeverage).toHaveBeenCalledTimes(1)

    rerender({ ...props, symbol: 'BTCUSDT', config: config({ symbol: 'BTCUSDT', leverage: 1, marginType: 'ISOLATED' }) })
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
    expect(setLeverage).toHaveBeenCalledWith({ symbol: 'EPICUSDT', leverage: 1 })
  })
})
