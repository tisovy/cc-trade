import { describe, expect, it } from 'vitest'
import { shouldOpenDevTools } from './devtools.js'

describe('shouldOpenDevTools', () => {
  it('keeps DevTools closed for packaged builds by default', () => {
    expect(shouldOpenDevTools({ env: {} })).toBe(false)
  })

  it('opens DevTools during dev-server runs by default', () => {
    expect(shouldOpenDevTools({
      env: { VITE_DEV_SERVER_URL: 'http://localhost:5174' },
    })).toBe(true)
  })

  it('lets an explicit flag override the dev-server default', () => {
    expect(shouldOpenDevTools({
      env: {
        ELECTRON_OPEN_DEVTOOLS: 'false',
        VITE_DEV_SERVER_URL: 'http://localhost:5174',
      },
    })).toBe(false)
  })

  it('keeps E2E builds closed by default even if a dev-server URL exists', () => {
    expect(shouldOpenDevTools({
      env: { VITE_DEV_SERVER_URL: 'http://localhost:5174' },
      allowDevServerDefault: false,
    })).toBe(false)
  })

  it('allows explicit DevTools opt-in for E2E diagnostics', () => {
    expect(shouldOpenDevTools({
      env: { ELECTRON_OPEN_DEVTOOLS: 'true' },
      allowDevServerDefault: false,
    })).toBe(true)
  })
})
