// The chart interval the operator last chose, kept beside the contract history
// so a mount or a reload comes back on it. The contract was restored and the
// interval fell back to 15m; the reload of 2026-09-02 at 21:40:55Z brought the
// operator back on a fifteen-minute chart in the middle of a one-minute scalp.
import { FUTURES_WORKSTATION_INTERVALS } from './futuresWorkstationProtocolShared.js'

export const FUTURES_INTERVAL_HISTORY_STORAGE_KEY = 'cc-trade:futures-interval:v1'

const normalizeInterval = value => (
  typeof value === 'string' && FUTURES_WORKSTATION_INTERVALS.includes(value) ? value : null
)

export const readFuturesLastInterval = (storage = globalThis.localStorage) => {
  try {
    return normalizeInterval(storage?.getItem?.(FUTURES_INTERVAL_HISTORY_STORAGE_KEY))
  } catch {
    return null
  }
}

export const writeFuturesLastInterval = (interval, storage = globalThis.localStorage) => {
  const normalized = normalizeInterval(interval)
  if (normalized === null) return false
  try {
    storage?.setItem?.(FUTURES_INTERVAL_HISTORY_STORAGE_KEY, normalized)
    return true
  } catch {
    return false
  }
}
