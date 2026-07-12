import fs from 'node:fs/promises'
import path from 'node:path'

export const RENDERER_PROTOCOL = 'cc-trade'
export const RENDERER_PROTOCOL_HOST = 'renderer'
export const RENDERER_ORIGIN = `${RENDERER_PROTOCOL}://${RENDERER_PROTOCOL_HOST}`
export const RENDERER_ENTRY_URL = `${RENDERER_ORIGIN}/index.html`

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const parseUrl = (value) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const isPathWithin = (rootDirectory, candidatePath) => {
  const relativePath = path.relative(rootDirectory, candidatePath)
  return Boolean(relativePath) && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath)
}

const createResponse = (body, options) => new Response(body, options)

const createErrorResponse = (status) => createResponse(null, { status })

const getContentType = (filePath) => MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'

export const getTrustedAnalyticsOrigin = (analyticsBaseUrl) => {
  const url = parseUrl(analyticsBaseUrl)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
  return url.origin
}

export const createRendererContentSecurityPolicy = ({ analyticsBaseUrl } = {}) => {
  const connectSources = [
    "'self'",
    'http://localhost:*',
    'ws://localhost:*',
    'http://127.0.0.1:*',
    'ws://127.0.0.1:*',
  ]
  const analyticsOrigin = getTrustedAnalyticsOrigin(analyticsBaseUrl)
  if (analyticsOrigin && !connectSources.includes(analyticsOrigin)) {
    connectSources.push(analyticsOrigin)
  }

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ')
}

export const resolveTrustedRendererDevServerUrl = ({ value, isPackaged } = {}) => {
  if (isPackaged || typeof value !== 'string' || !value.trim()) return null

  const url = parseUrl(value)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
  if (url.username || url.password || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null

  return url.toString()
}

export const resolveRendererAssetPath = ({ requestUrl, rootDirectory } = {}) => {
  const request = parseUrl(requestUrl)
  if (!request || request.protocol !== `${RENDERER_PROTOCOL}:` || request.host !== RENDERER_PROTOCOL_HOST) {
    return null
  }

  let requestPath
  try {
    requestPath = decodeURIComponent(request.pathname === '/' ? '/index.html' : request.pathname)
  } catch {
    return null
  }
  if (requestPath.includes('\0')) return null

  const rootPath = typeof rootDirectory === 'string' && rootDirectory ? path.resolve(rootDirectory) : null
  if (!rootPath) return null

  const assetPath = path.resolve(rootPath, `.${requestPath}`)
  return isPathWithin(rootPath, assetPath) ? assetPath : null
}

export const registerRendererAppProtocolScheme = (protocol) => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ])
}

export const createRendererAppProtocolHandler = ({
  rootDirectory,
  contentSecurityPolicy,
  fsModule = fs,
} = {}) => {
  return async (request) => {
    if (!request || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return createErrorResponse(405)
    }

    const requestedPath = resolveRendererAssetPath({ requestUrl: request.url, rootDirectory })
    if (!requestedPath) return createErrorResponse(400)

    try {
      const rootPath = await fsModule.realpath(rootDirectory)
      const realAssetPath = await fsModule.realpath(requestedPath)
      if (!isPathWithin(rootPath, realAssetPath)) return createErrorResponse(404)

      const body = request.method === 'HEAD' ? null : await fsModule.readFile(realAssetPath)
      return createResponse(body, {
        headers: {
          'content-security-policy': contentSecurityPolicy,
          'content-type': getContentType(realAssetPath),
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return createErrorResponse(404)
    }
  }
}

export const installRendererAppProtocol = ({ protocol, ...options } = {}) => {
  const handler = createRendererAppProtocolHandler(options)
  protocol.handle(RENDERER_PROTOCOL, handler)
  return handler
}
