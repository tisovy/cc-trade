import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRendererAppProtocolHandler,
  createRendererContentSecurityPolicy,
  getTrustedAnalyticsOrigin,
  RENDERER_ENTRY_URL,
  RENDERER_PROTOCOL,
  registerRendererAppProtocolScheme,
  resolveRendererAssetPath,
  resolveTrustedRendererDevServerUrl,
} from './renderer-protocol.js'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )))
})

describe('renderer application protocol', () => {
  it('registers a standard, secure local scheme without CSP bypass privileges', () => {
    const protocol = { registerSchemesAsPrivileged: vi.fn() }

    registerRendererAppProtocolScheme(protocol)

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: RENDERER_PROTOCOL,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
        },
      },
    ])
  })

  it('creates a restrictive CSP with only loopback and the exact configured analytics origin', () => {
    const policy = createRendererContentSecurityPolicy({
      analyticsBaseUrl: 'https://analytics.example.test/v1',
    })

    expect(getTrustedAnalyticsOrigin('https://analytics.example.test/v1')).toBe('https://analytics.example.test')
    expect(getTrustedAnalyticsOrigin('file:///tmp/analytics')).toBeNull()
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain('connect-src')
    expect(policy).toContain('https://analytics.example.test')
    expect(policy).not.toContain('connect-src https:')
    expect(policy).not.toContain("script-src 'unsafe-inline'")
  })

  it('accepts a development server only when it is a non-packaged loopback URL', () => {
    expect(resolveTrustedRendererDevServerUrl({
      value: 'http://localhost:5174/',
      isPackaged: false,
    })).toBe('http://localhost:5174/')
    expect(resolveTrustedRendererDevServerUrl({
      value: 'https://127.0.0.1:5174/app',
      isPackaged: false,
    })).toBe('https://127.0.0.1:5174/app')
    expect(resolveTrustedRendererDevServerUrl({
      value: 'https://example.com/',
      isPackaged: false,
    })).toBeNull()
    expect(resolveTrustedRendererDevServerUrl({
      value: 'http://localhost:5174/',
      isPackaged: true,
    })).toBeNull()
  })

  it('resolves only local scheme assets inside the renderer root', () => {
    const rootDirectory = '/app/dist'

    expect(resolveRendererAssetPath({
      requestUrl: RENDERER_ENTRY_URL,
      rootDirectory,
    })).toBe(path.join(rootDirectory, 'index.html'))
    expect(resolveRendererAssetPath({
      requestUrl: 'cc-trade://renderer/assets/app.js',
      rootDirectory,
    })).toBe(path.join(rootDirectory, 'assets/app.js'))
    expect(resolveRendererAssetPath({
      requestUrl: 'cc-trade://renderer/%2e%2e%2fsecret.txt',
      rootDirectory,
    })).toBeNull()
    expect(resolveRendererAssetPath({
      requestUrl: 'cc-trade://other/index.html',
      rootDirectory,
    })).toBeNull()
    expect(resolveRendererAssetPath({
      requestUrl: 'file:///app/dist/index.html',
      rootDirectory,
    })).toBeNull()
  })

  it('serves only root-confined assets with CSP and nosniff headers', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-renderer-'))
    temporaryDirectories.push(temporaryDirectory)
    const rootDirectory = path.join(temporaryDirectory, 'dist')
    const outsideFile = path.join(temporaryDirectory, 'outside.js')
    await fs.mkdir(path.join(rootDirectory, 'assets'), { recursive: true })
    await fs.writeFile(path.join(rootDirectory, 'index.html'), '<!doctype html>')
    await fs.writeFile(path.join(rootDirectory, 'assets', 'app.js'), 'export {}')
    await fs.writeFile(outsideFile, 'outside')
    await fs.symlink(outsideFile, path.join(rootDirectory, 'assets', 'escape.js'))

    const policy = createRendererContentSecurityPolicy()
    const handler = createRendererAppProtocolHandler({ rootDirectory, contentSecurityPolicy: policy })

    const document = await handler({ method: 'GET', url: RENDERER_ENTRY_URL })
    expect(document.status).toBe(200)
    expect(document.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(document.headers.get('content-security-policy')).toBe(policy)
    expect(document.headers.get('x-content-type-options')).toBe('nosniff')
    await expect(document.text()).resolves.toBe('<!doctype html>')

    const escapedSymlink = await handler({
      method: 'GET',
      url: 'cc-trade://renderer/assets/escape.js',
    })
    expect(escapedSymlink.status).toBe(404)

    const traversal = await handler({
      method: 'GET',
      url: 'cc-trade://renderer/%2e%2e%2foutside.js',
    })
    expect(traversal.status).toBe(400)
  })
})
