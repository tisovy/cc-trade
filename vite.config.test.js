// @vitest-environment node

import { describe, expect, it } from 'vitest'
import config, {
  selectElectronMainEntry,
  selectFuturesWorkstationCompositionAliases,
} from './vite.config.js'

describe('Vite Electron development configuration', () => {
  it('keeps React Fast Refresh disabled under the strict renderer CSP', () => {
    expect(config.server).toMatchObject({
      port: 5174,
      hmr: false,
    })
  })

  it('keeps the normal operator build on reviewed workstation compositions', () => {
    expect(selectFuturesWorkstationCompositionAliases({})).toEqual([])
  })

  it.each(['safe-dev', 'smoke'])(
    'pins %s to the deterministic public workstation composition',
    (buildMode) => {
      const aliases = selectFuturesWorkstationCompositionAliases({ buildMode })

      expect(aliases).toHaveLength(1)
      expect(aliases[0].replacement)
        .toContain('futures-production-workstation-verification-composition.js')
    },
  )

  it('does not let ambient Vitest inject execution into a nominal normal build', () => {
    const aliases = selectFuturesWorkstationCompositionAliases({ isVitest: true })

    expect(aliases).toHaveLength(1)
    expect(aliases[0].replacement)
      .toContain('futures-production-workstation-verification-composition.js')
    expect(config.resolve.alias).toHaveLength(1)
  })

  it.each([
    [undefined, 'electron/main.js'],
    ['', 'electron/main.js'],
    ['safe-dev', 'electron/main.safe-dev.js'],
    ['smoke', 'electron/main.smoke.js'],
  ])('selects the retained %s Electron entry', (buildMode, expectedEntry) => {
    expect(selectElectronMainEntry({ buildMode })).toBe(expectedEntry)
  })

  it('fails closed for an unsupported Electron build mode', () => {
    expect(() => selectElectronMainEntry({ buildMode: 'unsupported' }))
      .toThrow('Unsupported Electron build mode: unsupported')
  })

  it('keeps the retired e2e Electron build mode unavailable', () => {
    expect(() => selectElectronMainEntry({ buildMode: 'e2e' }))
      .toThrow('Unsupported Electron build mode: e2e')
  })
})
