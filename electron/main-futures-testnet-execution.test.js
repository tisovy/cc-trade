import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = path.dirname(fileURLToPath(import.meta.url))
const productionMain = fs.readFileSync(path.join(directory, 'main.js'), 'utf8')
const e2eMain = fs.readFileSync(path.join(directory, 'main.e2e.js'), 'utf8')
const e2eEnvironment = fs.readFileSync(path.join(directory, 'env-setup.js'), 'utf8')

describe('Electron futures testnet execution composition boundaries', () => {
  it('captures credentials, installs redaction, and takes exclusive ownership before any window', () => {
    const capture = productionMain.indexOf('captureFuturesTestnetExecutionConfig({')
    const sanitizer = productionMain.indexOf('installFuturesTestnetExecutionLogSanitizer({')
    const ownership = productionMain.indexOf('app.requestSingleInstanceLock()')
    const crashHandler = productionMain.indexOf("process.on('uncaughtException'")
    const window = productionMain.indexOf('new BrowserWindow({')

    expect(capture).toBeGreaterThan(-1)
    expect(capture).toBeLessThan(sanitizer)
    expect(sanitizer).toBeLessThan(crashHandler)
    expect(ownership).toBeLessThan(window)
  })

  it('opens isolated testnet storage and awaits the backend before creating the renderer', () => {
    const setup = productionMain.indexOf('binanceController = setupBinanceConnection({')
    const safeStorageProtection = productionMain.indexOf(
      'createElectronSafeStorageIntegrityKeyProtection({ safeStorage })',
    )
    const storage = productionMain.indexOf("'futures-testnet-execution'")
    const ready = productionMain.indexOf('await binanceController.executionReady')
    const createWindow = productionMain.indexOf('  createWindow()', ready)

    expect(setup).toBeGreaterThan(-1)
    expect(safeStorageProtection).toBeGreaterThan(-1)
    expect(safeStorageProtection).toBeLessThan(setup)
    expect(storage).toBeGreaterThan(setup)
    expect(ready).toBeGreaterThan(storage)
    expect(createWindow).toBeGreaterThan(ready)
    expect(productionMain).toContain("app.on('before-quit'")
    expect(productionMain).toContain("futuresReadMode: process.env.FUTURES_READ_MODE || 'mock'")
  })

  it('forces E2E execution disabled and scrubs all inherited execution inputs', () => {
    expect(e2eMain.trimStart().startsWith("import './env-setup.js'")).toBe(true)
    expect(e2eMain).toContain('forceDisabled: true')
    expect(e2eMain).not.toContain('futuresExecutionStorageDirectory')
    expect(e2eEnvironment).toContain("key.startsWith('FUTURES_TESTNET_EXECUTION_')")
    expect(e2eEnvironment).toContain('delete process.env.FUTURES_TESTNET_API_KEY')
    expect(e2eEnvironment).toContain('delete process.env.FUTURES_TESTNET_API_SECRET')
  })
})
