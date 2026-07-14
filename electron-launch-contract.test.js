// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readProjectFile = relativePath => readFileSync(
  new URL(relativePath, import.meta.url),
  'utf8',
)
const packageManifest = JSON.parse(readProjectFile('./package.json'))

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
})
