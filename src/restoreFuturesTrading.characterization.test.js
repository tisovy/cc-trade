// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = relativePath => readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  'utf8',
)

describe('restore-futures-trading production contracts', () => {
  const connectionSource = readSource('electron/services/binance-connection.js')
  const spotAdapterSource = readSource('electron/services/spot-trading-adapter.js')
  const futuresAdapterSource = readSource('electron/services/futures-trading-adapter.js')
  const dataProviderSource = readSource('src/context/DataContext.jsx')
  const appSource = readSource('src/App.jsx')
  const futuresHookSource = readSource('src/hooks/useFuturesTrading.js')
  const chartSource = readSource('src/components/features/futures/FuturesWorkstationChart.jsx')
  const protocolSource = readSource('src/utils/futuresProductionWorkstationProtocol.js')
  const serviceSource = readSource('electron/services/futures-production-workstation-service.js')

  it('contains no production runtime synthetic exchange or execution layer', () => {
    const productionRuntime = [
      connectionSource,
      spotAdapterSource,
      futuresAdapterSource,
      dataProviderSource,
    ].join('\n')

    expect(productionRuntime).not.toMatch(/\bUSE_MOCK\b/)
    expect(productionRuntime).not.toMatch(/build(?:Spot|Futures)MockOrderPlacementExecutionReport/)
    expect(productionRuntime).not.toMatch(/\b(?:generateTrade|generateTicker|generateDepth|buildMockChartPayload|futuresMockState|mockFilters|initialChartData)\b/)
  })

  it('fails startup closed through a bounded credential preflight envelope', () => {
    expect(connectionSource).toContain('evaluateBinanceCredentialPreflight')
    expect(connectionSource).toContain('startup_status')
    expect(connectionSource).toContain('EXECUTION_NOT_CONFIGURED')
  })

  it('does not fall back to Spot or initialize Spot before explicit activation', () => {
    expect(appSource).not.toContain('useState(MARKET_MODES.SPOT)')
    expect(appSource).toContain('UNSELECTED')
    expect(dataProviderSource).toContain('spotEnabled')
    expect(dataProviderSource).toContain('startupStatus')
  })

  it('propagates account resource failures instead of logging them only in Electron', () => {
    expect(connectionSource).toContain('futures_account_state')
    expect(futuresHookSource).toContain('accountResources')
    expect(futuresHookSource).toContain('lastSuccessfulAt')
  })

  it('uses account-wide source-qualified regular and ALGO order snapshots', () => {
    expect(futuresAdapterSource).toContain("'/fapi/v1/openAlgoOrders'")
    expect(futuresAdapterSource).toContain("orderKind: 'ALGO'")
    expect(futuresAdapterSource).toContain('regularOrders: 40')
    expect(futuresAdapterSource).toContain('algoOrders: 40')
    expect(futuresAdapterSource).not.toContain('getAccountRefreshOperations(symbol)')
  })

  it('does not render a MARK history series or horizontal MARK price line', () => {
    expect(chartSource).not.toMatch(/\bmarkSeries\b/)
    expect(chartSource).not.toContain("title: 'MARK'")
    expect(chartSource).not.toMatch(/\bmarkCandles\b/)
  })

  it('configures tape filtering and coalescing upstream of the renderer', () => {
    expect(protocolSource).toContain('CONFIGURE_TAPE')
    expect(serviceSource).toContain('minNotionalUsdt')
    expect(serviceSource).toContain('timeoutMs')
    expect(serviceSource).toContain('pendingTapeTimer')
  })
})
