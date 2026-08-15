const parseUrl = (value) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const hasSameEndpoint = (candidate, allowed) => {
  return candidate.protocol === allowed.protocol && candidate.host === allowed.host
}

const removeHeader = (headers, headerName) => {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([name]) => name.toLowerCase() !== headerName),
  )
}

export const createSecureRendererWebPreferences = ({ preload, additionalArguments = [] } = {}) => ({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  preload,
  additionalArguments: Array.isArray(additionalArguments) ? [...additionalArguments] : [],
})

export const createRendererNavigationGuard = ({ devServerUrl, rendererUrl } = {}) => {
  const devServer = parseUrl(devServerUrl)
  const renderer = parseUrl(rendererUrl)

  return (navigationUrl) => {
    const candidate = parseUrl(navigationUrl)
    if (!candidate) return false

    if (devServer && candidate.origin === devServer.origin) {
      return true
    }

    return Boolean(
      renderer &&
      hasSameEndpoint(candidate, renderer) &&
      candidate.pathname === renderer.pathname,
    )
  }
}

export const installRendererContentSecurityPolicyHeader = (
  electronSession,
  { rendererUrl, contentSecurityPolicy } = {},
) => {
  const renderer = parseUrl(rendererUrl)
  if (!renderer || !contentSecurityPolicy) return

  electronSession.webRequest.onHeadersReceived((details, callback) => {
    const candidate = parseUrl(details.url)
    const isRendererDocument = details.resourceType === 'mainFrame' && candidate && candidate.origin === renderer.origin
    if (!isRendererDocument) {
      callback({})
      return
    }

    callback({
      responseHeaders: {
        ...removeHeader(details.responseHeaders, 'content-security-policy'),
        'Content-Security-Policy': [contentSecurityPolicy],
      },
    })
  })
}

export const installRendererSecurityGuards = (webContents, isAllowedNavigation) => {
  const preventUnexpectedNavigation = (event, navigationUrl) => {
    if (!isAllowedNavigation(navigationUrl)) {
      event.preventDefault()
    }
  }

  webContents.on('will-navigate', preventUnexpectedNavigation)
  webContents.on('will-frame-navigate', preventUnexpectedNavigation)
  webContents.on('will-redirect', preventUnexpectedNavigation)
  webContents.on('will-attach-webview', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
