import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  readFuturesPositionValuation,
  readFuturesPositionValuationAggregate,
} from '../utils/futuresPositionMarks.js'

const normalizedSymbol = value => (
  typeof value === 'string' ? value.toUpperCase() : ''
)

export const useFuturesPositionValuation = (
  position,
  store,
  { snapshotAt = null, snapshotConfirmed = true, snapshotCoherent = false } = {},
) => {
  const symbol = normalizedSymbol(position?.symbol)
  const subscribe = useCallback(
    callback => store?.subscribe?.(symbol, callback) ?? (() => {}),
    [store, symbol],
  )
  const getSnapshot = useCallback(
    () => store?.get?.(symbol) ?? null,
    [store, symbol],
  )
  const mark = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => readFuturesPositionValuation(position, mark, {
    snapshotAt,
    snapshotConfirmed,
    snapshotCoherent,
  }), [mark, position, snapshotAt, snapshotCoherent, snapshotConfirmed])
}

export const useFuturesPositionValuationAggregate = ({
  positions,
  positionsKnown,
  snapshotAt = null,
  snapshotCoherent = false,
  store,
}) => {
  const symbols = useMemo(() => [...new Set(
    (Array.isArray(positions) ? positions : [])
      .map(position => normalizedSymbol(position?.symbol))
      .filter(Boolean),
  )].sort(), [positions])
  const subscribe = useCallback((callback) => {
    const subscribeValuation = store?.subscribeValuation ?? store?.subscribe
    if (typeof subscribeValuation !== 'function') return () => {}
    const releases = symbols.map(symbol => subscribeValuation.call(store, symbol, callback))
    return () => releases.forEach(release => release())
  }, [store, symbols])
  const getSnapshot = useCallback(
    () => store?.version?.(symbols) ?? '',
    [store, symbols],
  )
  const version = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => {
    // Reading the primitive subscription snapshot is what makes this memo follow
    // store notifications even though the mutable store identity is stable.
    void version
    return readFuturesPositionValuationAggregate(positions, store, {
      positionsKnown,
      snapshotAt,
      snapshotCoherent,
    })
  }, [positions, positionsKnown, snapshotAt, snapshotCoherent, store, version])
}
