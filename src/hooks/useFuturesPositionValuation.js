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
  {
    snapshotAt = null,
    snapshotConfirmed = true,
    snapshotCoherent = false,
    valueOnly = false,
    presentationOnly = false,
  } = {},
) => {
  const symbol = normalizedSymbol(position?.symbol)
  const hasPresentationChannel = presentationOnly
    && typeof store?.subscribePresentation === 'function'
    && typeof store?.presentationVersion === 'function'
    && typeof store?.get === 'function'
  const hasValueChannel = !hasPresentationChannel && valueOnly
    && typeof store?.subscribeValue === 'function'
    && typeof store?.valueVersion === 'function'
    && typeof store?.get === 'function'
  const subscribe = useCallback(
    callback => (
      hasPresentationChannel
        ? store.subscribePresentation(symbol, callback)
        : hasValueChannel
        ? store.subscribeValue(symbol, callback)
        : store?.subscribe?.(symbol, callback) ?? (() => {})
    ),
    [hasPresentationChannel, hasValueChannel, store, symbol],
  )
  const getSnapshot = useCallback(
    () => (hasPresentationChannel
      ? store.presentationVersion([symbol])
      : hasValueChannel
        ? store.valueVersion([symbol])
        : store?.get?.(symbol) ?? null),
    [hasPresentationChannel, hasValueChannel, store, symbol],
  )
  const subscriptionSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => {
    const mark = hasPresentationChannel || hasValueChannel
      ? store.get(symbol)
      : subscriptionSnapshot
    return readFuturesPositionValuation(position, mark, {
      snapshotAt,
      snapshotConfirmed,
      snapshotCoherent,
    })
  }, [hasPresentationChannel, hasValueChannel, position, snapshotAt, snapshotCoherent,
    snapshotConfirmed, store, subscriptionSnapshot, symbol])
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
    const subscribeValuation = store?.subscribeValue
      ?? store?.subscribeValuation
      ?? store?.subscribe
    if (typeof subscribeValuation !== 'function') return () => {}
    const releases = symbols.map(symbol => subscribeValuation.call(store, symbol, callback))
    return () => releases.forEach(release => release())
  }, [store, symbols])
  const getSnapshot = useCallback(
    () => store?.valueVersion?.(symbols) ?? store?.version?.(symbols) ?? '',
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
