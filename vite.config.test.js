// @vitest-environment node

import { describe, expect, it } from 'vitest'
import config, { selectFuturesWorkstationCompositionAliases } from './vite.config.js'

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

  it('keeps E2E on its explicit main-process runtime injection', () => {
    const aliases = selectFuturesWorkstationCompositionAliases({ buildMode: 'e2e' })

    expect(aliases).toHaveLength(1)
    expect(aliases[0].replacement)
      .toContain('futures-production-workstation-verification-composition.js')
  })

  it('does not let ambient Vitest inject execution into a nominal normal build', () => {
    const aliases = selectFuturesWorkstationCompositionAliases({ isVitest: true })

    expect(aliases).toHaveLength(1)
    expect(aliases[0].replacement)
      .toContain('futures-production-workstation-verification-composition.js')
    expect(config.resolve.alias).toHaveLength(1)
  })
})
