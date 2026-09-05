import { describe, expect, it } from 'vitest'
import { shouldOpenDevTools } from './devtools.js'

describe('shouldOpenDevTools', () => {
  it('keeps DevTools closed for packaged builds by default', () => {
    expect(shouldOpenDevTools({ env: {} })).toBe(false)
  })

  it('keeps DevTools closed during dev-server runs by default', () => {
    expect(shouldOpenDevTools({
      env: { VITE_DEV_SERVER_URL: 'http://localhost:5174' },
    })).toBe(false)
  })

  it('honors explicit false during dev-server runs', () => {
    expect(shouldOpenDevTools({
      env: {
        ELECTRON_OPEN_DEVTOOLS: 'false',
        VITE_DEV_SERVER_URL: 'http://localhost:5174',
      },
    })).toBe(false)
  })

  it.each(['', 'false', '0', 'off', 'no', 'unexpected'])('keeps DevTools closed for %j', value => {
    expect(shouldOpenDevTools({
      env: { VITE_DEV_SERVER_URL: 'http://localhost:5174', ELECTRON_OPEN_DEVTOOLS: value },
    })).toBe(false)
  })

  it.each(['1', 'true', 'yes', 'on', ' TRUE '])('allows explicit DevTools opt-in with %j', value => {
    expect(shouldOpenDevTools({
      env: { ELECTRON_OPEN_DEVTOOLS: value },
    })).toBe(true)
  })
})
