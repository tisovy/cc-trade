// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { assertNormalElectronBuildSources } from './electron-build-artifact-contract.mjs'

const reviewedMain = [
  'mode: reviewed-public-read',
  'kind: reviewed-production-public-read',
].join('\n')

describe('normal Electron build artifact contract', () => {
  it('accepts a bundle carrying both reviewed production markers', () => {
    expect(() => assertNormalElectronBuildSources({
      mainSource: reviewedMain,
      preloadSource: 'bounded preload',
    })).not.toThrow()
  })

  it('rejects the deterministic verification composition', () => {
    expect(() => assertNormalElectronBuildSources({
      mainSource: `${reviewedMain}\nmode: deterministic-fake`,
      preloadSource: 'bounded preload',
    })).toThrow('verification-only Futures implementation leaked')
  })

  it('rejects a bundle missing either reviewed production marker', () => {
    expect(() => assertNormalElectronBuildSources({
      mainSource: 'mode: reviewed-public-read',
      preloadSource: 'bounded preload',
    })).toThrow('reviewed-production-public-read')
  })

  it('checks the preload for retired implementation signatures too', () => {
    expect(() => assertNormalElectronBuildSources({
      mainSource: reviewedMain,
      preloadSource: 'FUTURES_TESTNET_EXECUTION_ACTION',
    })).toThrow('Retired or verification-only Futures implementation leaked')
  })
})
