import { describe, expect, it } from 'vitest'
import {
  describeFuturesPriceReading,
  describeFuturesReadingAgeNotice,
  formatFuturesReadingAge,
  isFuturesReadingObservedAt,
} from './futuresPriceReading.js'

const AT = 1_784_000_000_000

describe('futures price readings', () => {
  it('names the surface a price was taken off', () => {
    expect(describeFuturesPriceReading({ surface: 'chart', state: 'live', observedAt: AT }))
      .toEqual({
        surface: 'chart',
        surfaceLabel: 'chart',
        state: 'live',
        live: true,
        observedAt: AT,
      })
    expect(describeFuturesPriceReading({ surface: 'order-book', state: 'live', observedAt: AT }).surfaceLabel)
      .toBe('order book')
  })

  it('refuses a surface it does not know', () => {
    expect(describeFuturesPriceReading({ surface: 'tape', state: 'live', observedAt: AT })).toBeNull()
    expect(describeFuturesPriceReading()).toBeNull()
  })

  // The whole point of the distinction: nothing failed on a quiet market, and
  // colouring it as a failure teaches the operator to ignore the one that is.
  it('calls a silent stream quiet only while the transport is proven live', () => {
    expect(describeFuturesPriceReading({
      surface: 'chart', state: 'stale', observedAt: AT, connected: true,
    })).toMatchObject({ state: 'quiet', live: false })
    expect(describeFuturesPriceReading({
      surface: 'chart', state: 'stale', observedAt: AT, connected: false,
    })).toMatchObject({ state: 'stale', live: false })
  })

  it('never renames a state the transport itself gave', () => {
    for (const state of ['disconnected', 'unavailable', 'resynchronizing', 'loading']) {
      expect(describeFuturesPriceReading({
        surface: 'chart', state, observedAt: AT, connected: true,
      }).state).toBe(state)
    }
  })

  it('treats a missing state as not yet loaded rather than as live', () => {
    const reading = describeFuturesPriceReading({ surface: 'chart', observedAt: AT })
    expect(reading.state).toBe('loading')
    expect(reading.live).toBe(false)
  })

  it('keeps only a usable observation time', () => {
    expect(isFuturesReadingObservedAt(AT)).toBe(true)
    for (const value of [0, -1, null, undefined, Number.NaN, '1784000000000']) {
      expect(isFuturesReadingObservedAt(value)).toBe(false)
      expect(describeFuturesPriceReading({ surface: 'chart', state: 'stale', observedAt: value }).observedAt)
        .toBeNull()
    }
  })
})

describe('reading age', () => {
  it('reads coarser as it grows', () => {
    expect(formatFuturesReadingAge(AT, AT)).toBe('0s')
    expect(formatFuturesReadingAge(AT, AT + 47_000)).toBe('47s')
    expect(formatFuturesReadingAge(AT, AT + 59_999)).toBe('59s')
    expect(formatFuturesReadingAge(AT, AT + 60_000)).toBe('1m 0s')
    expect(formatFuturesReadingAge(AT, AT + 125_000)).toBe('2m 5s')
    expect(formatFuturesReadingAge(AT, AT + 3_600_000)).toBe('1h 0m')
    expect(formatFuturesReadingAge(AT, AT + 7_500_000)).toBe('2h 5m')
    expect(formatFuturesReadingAge(AT, AT + 90_000_000)).toBe('1d 1h')
  })

  // A second is truncated, never rounded up into freshness: a reading 1900 ms
  // old reads "1s", and a clock that stepped backwards reads "0s" rather than a
  // negative age that would be read as the future.
  it('never states an age younger than the reading is', () => {
    expect(formatFuturesReadingAge(AT, AT + 1_900)).toBe('1s')
    expect(formatFuturesReadingAge(AT, AT - 5_000)).toBe('0s')
  })

  it('has no age without an observation time', () => {
    expect(formatFuturesReadingAge(null, AT)).toBeNull()
    expect(formatFuturesReadingAge(AT, Number.NaN)).toBeNull()
  })
})

describe('the notice a reading produces', () => {
  it('says nothing about a live reading or a typed price', () => {
    expect(describeFuturesReadingAgeNotice(
      describeFuturesPriceReading({ surface: 'chart', state: 'live', observedAt: AT }),
      AT + 5_000,
    )).toBeNull()
    expect(describeFuturesReadingAgeNotice(null, AT)).toBeNull()
  })

  it('names the state, the surface and the age', () => {
    expect(describeFuturesReadingAgeNotice(
      describeFuturesPriceReading({
        surface: 'order-book', state: 'stale', observedAt: AT, connected: true,
      }),
      AT + 47_000,
    )).toBe('QUIET order book · 47s old')
  })

  // An unknown age is stated as unknown. A reading with no observation time must
  // not read as a fresh one by omitting the part the operator is there to read.
  it('admits when it cannot date the reading', () => {
    expect(describeFuturesReadingAgeNotice(
      describeFuturesPriceReading({ surface: 'chart', state: 'disconnected', observedAt: null }),
      AT,
    )).toBe('DISCONNECTED chart — age unknown')
  })
})
