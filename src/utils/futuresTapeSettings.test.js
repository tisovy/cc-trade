import { afterEach, describe, expect, it } from 'vitest'
import { FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS } from './futuresWorkstationProtocolShared.js'
import {
  FUTURES_TAPE_SETTINGS_STORAGE_KEY,
  parseStoredTapeSettings,
  readStoredTapeSettings,
  writeStoredTapeSettings,
} from './futuresTapeSettings.js'

afterEach(() => {
  localStorage.clear()
})

describe('futures tape settings persistence', () => {
  it('restores a written configuration verbatim', () => {
    const settings = { throttleEnabled: false, timeoutMs: 750, minNotionalUsdt: '300' }
    expect(writeStoredTapeSettings(settings)).toBe(true)
    expect(readStoredTapeSettings()).toEqual(settings)
  })

  it('normalizes the stored notional the way live input is normalized', () => {
    writeStoredTapeSettings({ throttleEnabled: true, timeoutMs: 250, minNotionalUsdt: '100.500' })
    expect(readStoredTapeSettings().minNotionalUsdt).toBe('100.5')
  })

  it('falls back to defaults rather than trusting an out-of-range stored timeout', () => {
    localStorage.setItem(FUTURES_TAPE_SETTINGS_STORAGE_KEY, JSON.stringify({
      throttleEnabled: true,
      timeoutMs: 5_001,
      minNotionalUsdt: '100',
    }))
    expect(readStoredTapeSettings()).toEqual(FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS)
  })

  it.each([
    null,
    'throttled',
    [],
    { throttleEnabled: 'yes', timeoutMs: 250, minNotionalUsdt: '100' },
    { throttleEnabled: true, timeoutMs: 15, minNotionalUsdt: '100' },
    { throttleEnabled: true, timeoutMs: 250.5, minNotionalUsdt: '100' },
    { throttleEnabled: true, timeoutMs: 250, minNotionalUsdt: '-5' },
    { throttleEnabled: true, timeoutMs: 250, minNotionalUsdt: 100 },
    { throttleEnabled: true, timeoutMs: 250 },
  ])('rejects the unusable stored value %j', (stored) => {
    expect(parseStoredTapeSettings(stored)).toBeNull()
    expect(writeStoredTapeSettings(stored)).toBe(false)
  })

  it('reads defaults when nothing was ever stored', () => {
    expect(readStoredTapeSettings()).toEqual(FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS)
  })
})
