import { describe, expect, it } from 'vitest'
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampUiScale,
  readUiScale,
  stepUiScale,
  writeUiScale,
} from './uiScale.js'

describe('ui scale', () => {
  it('clamps to a legible range and falls back to the default', () => {
    expect(clampUiScale(5)).toBe(UI_SCALE_MAX)
    expect(clampUiScale(0.1)).toBe(UI_SCALE_MIN)
    expect(clampUiScale('nope')).toBe(UI_SCALE_DEFAULT)
    expect(clampUiScale('1.25')).toBe(1.25)
  })

  it('steps by a fixed increment without drifting past the bounds', () => {
    expect(stepUiScale(1, 1)).toBe(1.05)
    expect(stepUiScale(1, -1)).toBe(0.95)
    expect(stepUiScale(UI_SCALE_MAX, 1)).toBe(UI_SCALE_MAX)
    expect(stepUiScale(UI_SCALE_MIN, -1)).toBe(UI_SCALE_MIN)
  })

  it('round-trips through storage and survives failures', () => {
    const entries = new Map()
    const storage = {
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    }
    expect(readUiScale(storage)).toBe(UI_SCALE_DEFAULT)
    writeUiScale(1.3, storage)
    expect(readUiScale(storage)).toBe(1.3)
    expect(writeUiScale(1.1, { setItem: () => { throw new Error('denied') } })).toBe(false)
    expect(readUiScale({ getItem: () => { throw new Error('denied') } })).toBe(UI_SCALE_DEFAULT)
  })
})
