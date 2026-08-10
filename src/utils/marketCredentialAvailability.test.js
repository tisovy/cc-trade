import { describe, expect, it } from 'vitest'
import {
  describeUnavailableMarketWorkspace,
  isMarketWorkspaceAvailable,
  marketWorkspaceStatus,
} from './marketCredentialAvailability.js'
import { MARKET_WORKSPACES } from './marketWorkspaceStorage.js'

const startupStatus = ({ spot, futures }) => Object.freeze({
  ready: spot || futures,
  markets: {
    spot: {
      market: 'spot',
      label: 'Spot',
      ready: spot,
      code: spot ? 'READY' : 'MISSING_CREDENTIALS',
      missingFields: spot ? [] : ['BK', 'BS'],
    },
    futures: {
      market: 'futures',
      label: 'Futures',
      ready: futures,
      code: futures ? 'READY' : 'MISSING_CREDENTIALS',
      missingFields: futures ? [] : ['BFK', 'BFS'],
    },
  },
})

describe('market credential availability', () => {
  it('resolves availability per market', () => {
    const status = startupStatus({ spot: true, futures: false })

    expect(isMarketWorkspaceAvailable(status, MARKET_WORKSPACES.SPOT)).toBe(true)
    expect(isMarketWorkspaceAvailable(status, MARKET_WORKSPACES.FUTURES_LIVE)).toBe(false)
  })

  it('treats the neutral workspace as always available', () => {
    const status = startupStatus({ spot: false, futures: false })

    expect(isMarketWorkspaceAvailable(status, MARKET_WORKSPACES.UNSELECTED)).toBe(true)
  })

  it('falls back to the aggregate when an envelope carries no per-market section', () => {
    const legacy = Object.freeze({ ready: true })

    expect(isMarketWorkspaceAvailable(legacy, MARKET_WORKSPACES.SPOT)).toBe(true)
    expect(isMarketWorkspaceAvailable(legacy, MARKET_WORKSPACES.FUTURES_LIVE)).toBe(true)
    expect(isMarketWorkspaceAvailable({ ready: false }, MARKET_WORKSPACES.SPOT)).toBe(false)
    expect(marketWorkspaceStatus(legacy, MARKET_WORKSPACES.SPOT)).toBeNull()
  })

  it('treats a missing status as unavailable rather than throwing', () => {
    expect(isMarketWorkspaceAvailable(undefined, MARKET_WORKSPACES.SPOT)).toBe(false)
    expect(isMarketWorkspaceAvailable(null, MARKET_WORKSPACES.FUTURES_LIVE)).toBe(false)
  })

  it('describes only unavailable markets and names their variables', () => {
    const status = startupStatus({ spot: true, futures: false })

    expect(describeUnavailableMarketWorkspace(status, MARKET_WORKSPACES.SPOT)).toBeNull()
    expect(describeUnavailableMarketWorkspace(status, MARKET_WORKSPACES.FUTURES_LIVE))
      .toBe('Set BFK and BFS and restart to enable Futures.')
    expect(describeUnavailableMarketWorkspace(
      startupStatus({ spot: false, futures: true }),
      MARKET_WORKSPACES.SPOT,
    )).toBe('Set BK and BS and restart to enable Spot.')
  })

  it('never exposes credential values in a description', () => {
    const status = startupStatus({ spot: false, futures: true })
    const description = describeUnavailableMarketWorkspace(status, MARKET_WORKSPACES.SPOT)

    expect(description).not.toMatch(/[A-Za-z0-9]{32,}/)
  })
})
