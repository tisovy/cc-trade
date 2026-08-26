import { useEffect, useRef } from 'react'

// The chart's own tape, joined to the position mark store for the contract on
// screen — and for that contract only.
//
// The exchange publishes a mark once a second and no faster: measured
// 2026-08-26 against `@markPrice@1s` through the operator's proxy, 239 frames
// in 240 seconds on each of three contracts, gap p50 1000ms, p95 1012ms, worst
// 1141ms. Transit adds 220ms (p95 232ms). So the number a position is valued at
// is, at worst, well over a second old, while the chart beside it redraws on
// every print — ETHUSDT printed 8.3 times a second in that same window. That
// difference is what the operator sees during a fast move.
//
// The tape for the contract on screen is already in this renderer: the
// workstation subscribes to `@aggTrade` for its header, and the header's
// `lastPrice` *is* the price the chart is drawn from. This costs no socket, no
// subscription and no request weight — it joins two things the desk already
// has. The mark feed dropped its own `@aggTrade` subscription for exactly that
// reason and the join was never made.
export const FUTURES_WATCHED_TAPE_MIN_INTERVAL_MS = 100

/**
 * Feeds the watched contract's last traded price into the position mark store,
 * coalesced, and withdraws it when that contract is left.
 *
 * Coalesced because the tape's rate is the market's business and the redraw
 * rate has to be the desk's. A print rate is unbounded — a burst on a liquid
 * contract prints far faster than anything can usefully be read — and every
 * note re-renders the rows subscribed to that symbol. Ten a second is an order
 * of magnitude faster than the mark it sits beside, which is the whole point,
 * and bounded no matter how hard the market prints, which is the other half.
 *
 * Trailing-edge: the last print of a burst is always the one that lands, so the
 * reading settles on what the market actually did rather than on wherever the
 * window happened to close.
 *
 * `carried` is the workstation's own answer about whether it is still carrying
 * this contract's tape. A reading is withdrawn the moment it stops — a price
 * drawn from a chart that is no longer on screen may never stand beside a live
 * mark, because nothing on the row would say it came from somewhere else.
 */
export const useFuturesWatchedTape = ({
  store = null,
  symbol = null,
  lastPrice = null,
  lastPriceAt = null,
  carried = false,
  intervalMs = FUTURES_WATCHED_TAPE_MIN_INTERVAL_MS,
} = {}) => {
  // `store` is held here rather than closed over, because withdrawal on unmount
  // has to reach the store that was actually fed — not whichever one happens to
  // be in scope when React tears the tree down — and a ref may not be written
  // during a render.
  const held = useRef({ symbol: null, timer: null, notedAt: 0, store: null })

  useEffect(() => {
    const state = held.current
    state.store = store
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    // Withdraw before anything else: whatever comes next, the reading standing
    // beside the previous contract's mark stops being true here.
    if (state.symbol !== null && (state.symbol !== symbol || !carried)) {
      store?.noteTape?.(state.symbol, null)
      state.symbol = null
    }
    if (!carried
      || store === null
      || typeof store.noteTape !== 'function'
      || symbol === null
      || lastPrice === null) return undefined
    const note = () => {
      state.symbol = symbol
      state.notedAt = Date.now()
      store.noteTape(symbol, { lastPrice, lastPriceAt })
    }
    const since = Date.now() - state.notedAt
    if (since >= intervalMs) {
      note()
      return undefined
    }
    state.timer = setTimeout(() => {
      state.timer = null
      note()
    }, intervalMs - since)
    return () => {
      if (state.timer === null) return
      clearTimeout(state.timer)
      state.timer = null
    }
  }, [carried, intervalMs, lastPrice, lastPriceAt, store, symbol])

  useEffect(() => () => {
    const state = held.current
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.symbol === null) return
    state.store?.noteTape?.(state.symbol, null)
    state.symbol = null
  }, [])
}

export default useFuturesWatchedTape
