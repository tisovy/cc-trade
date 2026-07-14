import './env-setup.js'

const SAFE_SMOKE_DEADLINE_MS = 15_000
const SAFE_SMOKE_RENDER_ATTEMPTS = 20
const SAFE_SMOKE_RENDER_POLL_MS = 250

const { app } = await import('electron')
let hasAuthenticatedRuntime = false
let hasRenderedRoot = false
let hasCompleted = false

const failSmoke = (reason) => {
  if (hasCompleted) return
  hasCompleted = true
  console.error('SAFE_SMOKE_FAILED', reason)
  process.exitCode = 87
  app.quit()
}

const completeSmokeIfReady = () => {
  if (hasCompleted || !hasAuthenticatedRuntime || !hasRenderedRoot) return
  hasCompleted = true
  console.log('SAFE_SMOKE_READY', {
    authenticatedLoopback: true,
    reactRootRendered: true,
  })
  app.quit()
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    const probeRenderer = async (attempt = 0) => {
      if (hasCompleted) return
      try {
        const result = await window.webContents.executeJavaScript(
          `({
            authenticatedLoopback:
              typeof globalThis.ccTradeRuntime?.localWebSocketAccess?.token === 'string'
              && globalThis.ccTradeRuntime.localWebSocketAccess.token.length > 0,
            reactRootRendered: Boolean(document.getElementById('root')?.childElementCount),
          })`,
        )
        hasAuthenticatedRuntime = result?.authenticatedLoopback === true
        hasRenderedRoot = result?.reactRootRendered === true
      } catch {
        hasAuthenticatedRuntime = false
        hasRenderedRoot = false
      }
      if (hasAuthenticatedRuntime && hasRenderedRoot) {
        completeSmokeIfReady()
        return
      }
      if (attempt + 1 >= SAFE_SMOKE_RENDER_ATTEMPTS) {
        failSmoke('authenticated renderer runtime and React root were not both ready')
        return
      }
      setTimeout(() => {
        void probeRenderer(attempt + 1)
      }, SAFE_SMOKE_RENDER_POLL_MS)
    }
    void probeRenderer()
  })
})

const smokeDeadline = setTimeout(() => {
  failSmoke('deadline exceeded')
}, SAFE_SMOKE_DEADLINE_MS)
smokeDeadline.unref()

await import('./main.js')
