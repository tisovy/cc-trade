import { describe, expect, it, vi } from 'vitest'
import { RENDERER_ENTRY_URL } from './renderer-protocol.js'
import {
  createRendererNavigationGuard,
  createSecureRendererWebPreferences,
  installRendererContentSecurityPolicyHeader,
  installRendererSecurityGuards,
} from './renderer-security.js'

describe('renderer security guards', () => {
  it('creates a sandboxed, isolated renderer without webview or mixed-content access', () => {
    const argumentsList = ['--cc-trade-runtime=value']
    const preferences = createSecureRendererWebPreferences({
      preload: '/trusted/preload.cjs',
      additionalArguments: argumentsList,
    })

    argumentsList.push('--changed-after-creation')

    expect(preferences).toEqual({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: '/trusted/preload.cjs',
      additionalArguments: ['--cc-trade-runtime=value'],
    })
  })

  it('allows only the configured development origin or exact local renderer entry', () => {
    const developmentGuard = createRendererNavigationGuard({
      devServerUrl: 'http://localhost:5174/',
      rendererUrl: RENDERER_ENTRY_URL,
    })
    const packagedGuard = createRendererNavigationGuard({ rendererUrl: RENDERER_ENTRY_URL })

    expect(developmentGuard('http://localhost:5174/')).toBe(true)
    expect(developmentGuard('http://localhost:5174/settings')).toBe(true)
    expect(developmentGuard('http://localhost:5175/')).toBe(false)
    expect(developmentGuard('https://example.com/')).toBe(false)
    expect(packagedGuard('cc-trade://renderer/index.html')).toBe(true)
    expect(packagedGuard('cc-trade://renderer/index.html#chart')).toBe(true)
    expect(packagedGuard('cc-trade://renderer/other.html')).toBe(false)
    expect(packagedGuard('cc-trade://other/index.html')).toBe(false)
    expect(packagedGuard('file:///app/dist/index.html')).toBe(false)
    expect(packagedGuard('data:text/html,unsafe')).toBe(false)
  })

  it('adds a CSP header only to the trusted development renderer document', () => {
    let headerHandler
    const electronSession = {
      webRequest: {
        onHeadersReceived: vi.fn((handler) => {
          headerHandler = handler
        }),
      },
    }
    const policy = "default-src 'self'; script-src 'self'"

    installRendererContentSecurityPolicyHeader(electronSession, {
      rendererUrl: 'http://localhost:5174/',
      contentSecurityPolicy: policy,
    })

    const trustedCallback = vi.fn()
    headerHandler({
      resourceType: 'mainFrame',
      url: 'http://localhost:5174/',
      responseHeaders: {
        'content-security-policy': ['old-policy'],
        'X-Existing': ['kept'],
      },
    }, trustedCallback)
    expect(trustedCallback).toHaveBeenCalledWith({
      responseHeaders: {
        'X-Existing': ['kept'],
        'Content-Security-Policy': [policy],
      },
    })

    const unrelatedCallback = vi.fn()
    headerHandler({
      resourceType: 'mainFrame',
      url: 'https://example.com/',
      responseHeaders: {},
    }, unrelatedCallback)
    expect(unrelatedCallback).toHaveBeenCalledWith({})
  })

  it('blocks unapproved main-frame and subframe navigation, redirects, webviews, and all renderer-created windows', () => {
    const handlers = new Map()
    const windowOpenHandler = vi.fn()
    const webContents = {
      on: vi.fn((event, handler) => handlers.set(event, handler)),
      setWindowOpenHandler: windowOpenHandler,
    }
    const allow = createRendererNavigationGuard({ rendererUrl: RENDERER_ENTRY_URL })

    installRendererSecurityGuards(webContents, allow)

    const allowedEvent = { preventDefault: vi.fn() }
    handlers.get('will-navigate')(allowedEvent, RENDERER_ENTRY_URL)
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()

    const blockedNavigation = { preventDefault: vi.fn() }
    handlers.get('will-navigate')(blockedNavigation, 'https://example.com/')
    expect(blockedNavigation.preventDefault).toHaveBeenCalledTimes(1)

    const blockedSubframe = { preventDefault: vi.fn() }
    handlers.get('will-frame-navigate')(blockedSubframe, 'https://example.com/')
    expect(blockedSubframe.preventDefault).toHaveBeenCalledTimes(1)

    const blockedRedirect = { preventDefault: vi.fn() }
    handlers.get('will-redirect')(blockedRedirect, 'https://example.com/')
    expect(blockedRedirect.preventDefault).toHaveBeenCalledTimes(1)

    const blockedWebview = { preventDefault: vi.fn() }
    handlers.get('will-attach-webview')(blockedWebview)
    expect(blockedWebview.preventDefault).toHaveBeenCalledTimes(1)
    expect(windowOpenHandler.mock.calls[0][0]({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  })
})
