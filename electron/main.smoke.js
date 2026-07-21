import './env-setup.js'

const SAFE_SMOKE_DEADLINE_MS = 15_000
const SAFE_SMOKE_RENDER_ATTEMPTS = 40
const SAFE_SMOKE_RENDER_POLL_MS = 250

const { app } = await import('electron')
let hasAuthenticatedRuntime = false
let hasRenderedRoot = false
let hasReadyFutures = false
let hasEnabledFuturesSlider = false
let hasExternalFuturesOrder = false
let hasCompleted = false

const failSmoke = (reason) => {
  if (hasCompleted) return
  hasCompleted = true
  console.error('SAFE_SMOKE_FAILED', reason)
  process.exitCode = 87
  app.quit()
}

const completeSmokeIfReady = () => {
  if (hasCompleted
    || !hasAuthenticatedRuntime
    || !hasRenderedRoot
    || !hasReadyFutures
    || !hasEnabledFuturesSlider
    || !hasExternalFuturesOrder) return
  hasCompleted = true
  console.log('SAFE_SMOKE_READY', {
    authenticatedLoopback: true,
    reactRootRendered: true,
    futuresReady: true,
    futuresSliderEnabled: true,
    externalFuturesOrderVisible: true,
  })
  app.quit()
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    const probeRenderer = async (attempt = 0) => {
      if (hasCompleted) return
      try {
        const result = await window.webContents.executeJavaScript(
          `(() => {
            const root = document.getElementById('root')
            let rail = document.querySelector(
              '[aria-label="Futures trading ticket"]'
            )
            if (!rail) {
              document.querySelector('[data-testid="market-mode-futures-live"]')?.click()
              rail = document.querySelector(
                '[aria-label="Futures trading ticket"]'
              )
            }
            const ordersTab = [...(rail?.querySelectorAll('[role="tab"]') ?? [])]
              .find(tab => /^Orders 1$/.test(tab.textContent?.trim() ?? ''))
            const sizeSlider = rail?.querySelector('[aria-label="Order size percent"]')
            const ordersPanelText = rail
              ?.querySelector('[aria-label="Current Futures orders"]')
              ?.textContent ?? ''
            const externalFuturesOrderVisible = [
              'BTCUSDT', 'BUY · LONG', '58445.00', '0.004', 'NEW',
            ].every(fragment => ordersPanelText.includes(fragment))
            if (!externalFuturesOrderVisible && sizeSlider?.disabled === false) {
              ordersTab?.click()
            }
            return {
              authenticatedLoopback:
                typeof globalThis.ccTradeRuntime?.localWebSocketAccess?.token === 'string'
                && globalThis.ccTradeRuntime.localWebSocketAccess.token.length > 0,
              reactRootRendered: Boolean(root?.childElementCount),
              futuresReady: rail?.querySelector('.futures-production-readiness')
                ?.textContent?.includes('READY') === true,
              futuresSliderEnabled: sizeSlider?.disabled === false,
              externalFuturesOrderVisible,
            }
          })()`,
        )
        hasAuthenticatedRuntime ||= result?.authenticatedLoopback === true
        hasRenderedRoot ||= result?.reactRootRendered === true
        hasReadyFutures ||= result?.futuresReady === true
        hasEnabledFuturesSlider ||= result?.futuresSliderEnabled === true
        hasExternalFuturesOrder ||= result?.externalFuturesOrderVisible === true
      } catch {
        // Preserve already-proven gates while the next bounded probe retries.
      }
      if (hasAuthenticatedRuntime
        && hasRenderedRoot
        && hasReadyFutures
        && hasEnabledFuturesSlider
        && hasExternalFuturesOrder) {
        completeSmokeIfReady()
        return
      }
      if (attempt + 1 >= SAFE_SMOKE_RENDER_ATTEMPTS) {
        failSmoke('authenticated renderer and ready mocked Futures execution were not all available')
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
