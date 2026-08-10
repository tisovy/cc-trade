// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readProjectFile = relativePath => readFileSync(
  new URL(relativePath, import.meta.url),
  'utf8',
)
const packageManifest = JSON.parse(readProjectFile('./package.json'))
const packageLock = JSON.parse(readProjectFile('./package-lock.json'))

describe('Electron launch contracts', () => {
  it('keeps the normal operator launch on the default persistent main entry', () => {
    const script = packageManifest.scripts.e

    expect(script).toContain('VITE_DEV_SERVER_URL=http://localhost:5174')
    expect(script).toMatch(/\bvite\b/)
    expect(script).not.toMatch(/\bBUILD_MODE\s*=/)
  })

  it('keeps persistent fake-only verification explicit and pre-main guarded', () => {
    const script = packageManifest.scripts['e:safe']
    const entry = readProjectFile('./electron/main.safe-dev.js')

    expect(script).toMatch(/\bBUILD_MODE=safe-dev\b/)
    expect(entry).toMatch(
      /^import '\.\/env-setup\.js'\s+await import\('\.\/main\.js'\)\s*$/,
    )
    expect(entry).not.toMatch(/\b(?:SAFE_SMOKE|app\.quit)\b/)
  })

  it('keeps bounded smoke verification separate from interactive launches', () => {
    const script = packageManifest.scripts['e:smoke']
    const entry = readProjectFile('./electron/main.smoke.js')

    expect(script).toMatch(/\bBUILD_MODE=smoke\b/)
    expect(entry.trimStart()).toMatch(/^import '\.\/env-setup\.js'/)
    expect(entry).toContain('SAFE_SMOKE_READY')
    expect(entry).toContain('app.quit()')
  })

  it('aggregates only the retained non-browser verification gates', () => {
    expect(packageManifest.scripts['test:all'].split(' && ')).toEqual([
      'npm run test',
      'npm run lint',
      'npm run build',
      'npm run check:circular',
      'npm run check:runtime-mock',
      'npm run check:futures-production',
      'npm run check:command-path',
    ])
    expect(packageManifest.scripts.postbuild)
      .toBe('npm run check:electron-build-artifacts')
  })

  it('keeps the retired browser-automation surface absent', () => {
    for (const scriptName of [
      'prebuild:e2e',
      'build:e2e',
      'postbuild:e2e',
      'test:e2e',
    ]) {
      expect(packageManifest.scripts).not.toHaveProperty(scriptName)
    }

    for (const dependencyName of ['@playwright/test', 'playwright']) {
      expect(packageManifest.dependencies).not.toHaveProperty(dependencyName)
      expect(packageManifest.devDependencies).not.toHaveProperty(dependencyName)
    }

    for (const packagePath of [
      'node_modules/@playwright/test',
      'node_modules/playwright',
      'node_modules/playwright-core',
    ]) {
      expect(packageLock.packages[packagePath]).toBeUndefined()
    }

    for (const retiredPath of [
      './playwright.config.js',
      './electron/main.e2e.js',
      './electron/e2e-websocket-route.js',
      './tests',
    ]) {
      expect(existsSync(new URL(retiredPath, import.meta.url))).toBe(false)
    }
  })
})
