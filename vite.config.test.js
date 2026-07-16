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

  it.each(['safe-dev', 'smoke', 'e2e'])(
    'pins %s to separately named deterministic workstation compositions',
    (buildMode) => {
      const aliases = selectFuturesWorkstationCompositionAliases({ buildMode })

      expect(aliases).toHaveLength(1)
      expect(aliases[0].replacement)
        .toContain('futures-production-workstation-verification-composition.js')
    },
  )

  it('pins Vitest to deterministic workstations without a runtime mode option', () => {
    const aliases = selectFuturesWorkstationCompositionAliases({ isVitest: true })

    expect(aliases).toHaveLength(1)
    expect(config.resolve.alias).toHaveLength(1)
  })
})
