import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(directory, '..')
const productionMain = fs.readFileSync(path.join(directory, 'main.js'), 'utf8')
const e2eMain = fs.readFileSync(path.join(directory, 'main.e2e.js'), 'utf8')
const e2eEnvironment = fs.readFileSync(path.join(directory, 'env-setup.js'), 'utf8')
const composition = fs.readFileSync(
  path.join(directory, 'services/futures-production-execution-composition.js'),
  'utf8',
)
const rendererRuntime = fs.readFileSync(path.join(directory, 'renderer-runtime.js'), 'utf8')
const preload = fs.readFileSync(path.join(directory, 'preload.cjs'), 'utf8')

describe('Electron futures production execution composition boundaries', () => {
  it('captures and redacts production secrets before crash handlers and every BrowserWindow', () => {
    const secretCapture = productionMain.indexOf('const futuresProductionSecretValues = [')
    const configCapture = productionMain.indexOf('captureFuturesProductionExecutionConfig({')
    const sanitizer = productionMain.indexOf('installFuturesProductionExecutionLogSanitizer({')
    const crashHandler = productionMain.indexOf("process.on('uncaughtException'")
    const window = productionMain.indexOf('new BrowserWindow({')
    expect(secretCapture).toBeGreaterThan(-1)
    expect(secretCapture).toBeLessThan(configCapture)
    expect(configCapture).toBeLessThan(sanitizer)
    expect(sanitizer).toBeLessThan(crashHandler)
    expect(crashHandler).toBeLessThan(window)
  })

  it('keeps the non-environment live interlock false and production storage separate', () => {
    expect(composition).toContain('FUTURES_PRODUCTION_LIVE_AUTHORIZED = false')
    expect(composition).not.toContain('fetchImpl = globalThis.fetch')
    expect(productionMain).toContain("'futures-production-execution'")
    expect(productionMain).toContain("'futures-testnet-execution'")
    expect(productionMain).toContain('await binanceController.productionExecutionReady')
    expect(productionMain.indexOf('await binanceController.productionExecutionReady'))
      .toBeLessThan(productionMain.indexOf('  createWindow()'))
  })

  it('scrubs and force-disables E2E production while blocking exact production sockets', () => {
    expect(e2eMain).toContain('captureFuturesProductionExecutionConfig({')
    expect(e2eMain).toContain('forceDisabled: true')
    expect(e2eMain).toContain("'https://fapi.binance.com/*'")
    expect(e2eMain).toContain("'wss://fstream.binance.com/*'")
    expect(e2eMain).toContain('app.exit(86)')
    expect(e2eEnvironment).toContain("key.startsWith('FUTURES_PRODUCTION_')")
    expect(e2eMain).not.toContain('futuresProductionExecutionStorageDirectory')
  })

  it('keeps production credentials and configuration out of renderer runtime and preload state', () => {
    const joined = `${rendererRuntime}\n${preload}`
    expect(joined).not.toMatch(/FUTURES_PRODUCTION|futuresProductionExecution/i)
    const bundleConfig = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8')
    expect(bundleConfig).not.toMatch(/FUTURES_PRODUCTION_(?:API_KEY|API_SECRET)/)
  })
})
