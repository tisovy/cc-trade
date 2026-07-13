import { describe, expect, it } from 'vitest'
import {
  captureE2eMockWebSocketAccess,
  resolveE2eMockWebSocketAccess,
} from './e2e-websocket-route.js'

describe('E2E-only renderer WebSocket route', () => {
  it('projects only an exact loopback ws endpoint and never projects a token', () => {
    expect(resolveE2eMockWebSocketAccess('ws://localhost:54321')).toEqual({
      host: 'localhost',
      port: 54321,
      token: '',
      tokenParam: 'token',
    })
    expect(resolveE2eMockWebSocketAccess('ws://127.0.0.1:54322/')).toEqual({
      host: '127.0.0.1',
      port: 54322,
      token: '',
      tokenParam: 'token',
    })
  })

  it.each([
    'wss://localhost:54321',
    'ws://example.com:54321',
    'ws://localhost',
    'ws://user:secret@localhost:54321',
    'ws://localhost:54321/path',
    'ws://localhost:54321/?token=forged',
    'not-a-url',
  ])('rejects an unreviewed E2E route: %s', (value) => {
    expect(resolveE2eMockWebSocketAccess(value)).toBeNull()
  })

  it('captures and deletes the E2E-only environment value', () => {
    const environment = { E2E_MOCK_WS_URL: 'ws://localhost:54323' }

    expect(captureE2eMockWebSocketAccess(environment)).toEqual({
      host: 'localhost',
      port: 54323,
      token: '',
      tokenParam: 'token',
    })
    expect(environment).not.toHaveProperty('E2E_MOCK_WS_URL')
  })
})
