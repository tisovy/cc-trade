import { useEffect, useRef } from 'react'
import { planFuturesContractDefaults } from '../utils/futuresContractDefaults.js'

// Holds the contract in hand at the desk's own default instead of at whatever
// the exchange account was left on.
//
// The configuration read answers with Binance's account-wide setting for a
// contract this desk may never have traded: opening EPICUSDT and finding it at
// 20× is not a decision anybody made. `planFuturesContractDefaults` decides what
// — if anything — that is worth sending; this decides *when*, which comes down
// to one rule: at most once per contract per session.
//
// That rule is what keeps the desk from arguing with the operator. Raising the
// multiple back to 10× is a decision, and a desk that reset it on the next
// contract switch would quietly undo it. It is also why an applied default is
// recorded only when the command actually left the desk: a send refused by a
// closed socket has to be attempted again, not remembered as done.
//
// A paused desk sends nothing at all. Pausing stops leverage and margin changes
// at the backend, so an automatic default would arrive as a pair of refusals the
// operator never asked for — on the one surface where a red card is supposed to
// mean something. The default waits for the resume instead.
export const useFuturesContractDefaults = ({
  enabled = false,
  paused = false,
  symbol = null,
  config = null,
  positions = null,
  openOrders = null,
  positionsRead = false,
  setLeverage = null,
  setMarginType = null,
} = {}) => {
  const appliedRef = useRef(new Map())

  useEffect(() => {
    if (!enabled || paused || !symbol) return
    const plan = planFuturesContractDefaults({
      symbol,
      config,
      positions,
      openOrders,
      positionsRead,
    })
    if (plan.leverage === null && plan.marginType === null) return

    const applied = appliedRef.current.get(symbol) ?? new Set()
    if (plan.leverage !== null
      && !applied.has('leverage')
      && setLeverage?.({ symbol, leverage: plan.leverage })) {
      applied.add('leverage')
    }
    if (plan.marginType !== null
      && !applied.has('marginType')
      && setMarginType?.({ symbol, marginType: plan.marginType })) {
      applied.add('marginType')
    }
    if (applied.size > 0) appliedRef.current.set(symbol, applied)
  }, [
    config,
    enabled,
    openOrders,
    paused,
    positions,
    positionsRead,
    setLeverage,
    setMarginType,
    symbol,
  ])
}

export default useFuturesContractDefaults
