import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  RENDERER_RUNTIME_IPC_CHANNEL,
  createRendererRuntime,
  createRendererRuntimeRegistry,
} from './renderer-runtime.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

const runPreload = (runtime) => {
  const exposed = {}
  const channels = []
  vm.runInNewContext(preloadSource, {
    require: (moduleName) => {
      if (moduleName !== 'electron') {
        throw new Error(`Unexpected preload dependency: ${moduleName}`)
      }
      return {
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            exposed[name] = value
          },
        },
        ipcRenderer: {
          sendSync: (channel) => {
            channels.push(channel)
            return runtime
          },
        },
      }
    },
  })
  return { exposed, channels }
}

describe('renderer runtime preload boundary', () => {
  it('creates only the reviewed renderer runtime data', () => {
    const runtime = createRendererRuntime({
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14477,
        token: 'sessionToken_123',
        tokenParam: 'unexpected',
      },
      analyticsConfig: {
        baseUrl: 'https://analytics.example.test',
        key: 'public-key',
        pollInterval: 6000,
        limit: 20,
        enabled: true,
        authMode: 'none',
        secret: 'must-not-cross-the-bridge',
      },
    })

    expect(runtime).toEqual({
      version: 1,
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14477,
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      analyticsConfig: {
        baseUrl: 'https://analytics.example.test',
        key: 'public-key',
        pollInterval: 6000,
        limit: 20,
        enabled: true,
        authMode: 'none',
      },
    })
    expect(JSON.stringify(runtime)).not.toContain('must-not-cross-the-bridge')
  })

  it('exposes one immutable data object and fails closed on malformed main data', () => {
    const runtime = createRendererRuntime({
      localWebSocketAccess: { host: 'localhost', port: 54321, token: 'abc123' },
    })

    const { exposed, channels } = runPreload(runtime)
    expect(Object.keys(exposed)).toEqual(['ccTradeRuntime'])
    expect(exposed.ccTradeRuntime.localWebSocketAccess).toEqual({
      host: 'localhost',
      port: 54321,
      token: 'abc123',
      tokenParam: 'token',
    })
    expect(Object.isFrozen(exposed.ccTradeRuntime)).toBe(true)
    expect(Object.isFrozen(exposed.ccTradeRuntime.localWebSocketAccess)).toBe(true)
    expect(channels).toEqual([RENDERER_RUNTIME_IPC_CHANNEL])

    const malformed = runPreload({}).exposed
    expect(malformed.ccTradeRuntime).toEqual({
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14477,
        token: '',
        tokenParam: 'token',
      },
      analyticsConfig: null,
    })
  })

  it('contains no generic IPC or Node module bridge', () => {
    expect(preloadSource).toContain("require('electron')")
    expect(preloadSource).toContain(`ipcRenderer.sendSync(RUNTIME_IPC_CHANNEL)`)
    expect(preloadSource).not.toMatch(/ipcRenderer\.(?:send\(|invoke\(|on\(|once\()|child_process|node:fs|require\(['"](?:fs|path|crypto)['"]\)/)
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^,]+,\s*\{[^}]*send/)
  })

  it('returns runtime data only to registered webContents', () => {
    const handlers = new Map()
    const ipcMain = {
      on: (channel, handler) => handlers.set(channel, handler),
    }
    const registry = createRendererRuntimeRegistry(ipcMain)
    const registeredMainFrame = {}
    const registeredSender = { mainFrame: registeredMainFrame }
    const unregisteredSender = {}
    const runtime = createRendererRuntime({
      localWebSocketAccess: { port: 14477, token: 'abc123' },
    })

    registry.register(registeredSender, runtime)

    const registeredEvent = {
      sender: registeredSender,
      senderFrame: registeredMainFrame,
      returnValue: undefined,
    }
    handlers.get(RENDERER_RUNTIME_IPC_CHANNEL)(registeredEvent)
    expect(registeredEvent.returnValue).toBe(runtime)

    const unregisteredEvent = {
      sender: unregisteredSender,
      senderFrame: {},
      returnValue: undefined,
    }
    handlers.get(RENDERER_RUNTIME_IPC_CHANNEL)(unregisteredEvent)
    expect(unregisteredEvent.returnValue).toBeNull()

    const subframeEvent = {
      sender: registeredSender,
      senderFrame: {},
      returnValue: undefined,
    }
    handlers.get(RENDERER_RUNTIME_IPC_CHANNEL)(subframeEvent)
    expect(subframeEvent.returnValue).toBeNull()
  })
})
