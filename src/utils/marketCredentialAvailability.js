import { MARKET_WORKSPACES } from './marketWorkspaceStorage.js'

export const MARKET_CREDENTIAL_FIELDS = Object.freeze({
  spot: Object.freeze(['BK', 'BS']),
  futures: Object.freeze(['BFK', 'BFS']),
})

const WORKSPACE_CREDENTIAL_MARKET = Object.freeze({
  [MARKET_WORKSPACES.SPOT]: 'spot',
  [MARKET_WORKSPACES.FUTURES_LIVE]: 'futures',
})

export const marketWorkspaceStatus = (startupStatus, workspace) => {
  const market = WORKSPACE_CREDENTIAL_MARKET[workspace]
  return market ? startupStatus?.markets?.[market] ?? null : null
}

// An envelope without a per-market section predates split credentials. Falling
// back to the aggregate keeps a correctly configured market usable instead of
// reading `undefined` as "not ready" and blocking it.
export const isMarketWorkspaceAvailable = (startupStatus, workspace) => {
  if (workspace === MARKET_WORKSPACES.UNSELECTED) return true
  const status = marketWorkspaceStatus(startupStatus, workspace)
  return status ? status.ready === true : startupStatus?.ready === true
}

export const formatMarketConfigurationError = marketStatus => {
  const missing = marketStatus.missingFields.length
    ? ` Missing: ${marketStatus.missingFields.join(', ')}.`
    : ''
  return `${marketStatus.label} is unavailable (${marketStatus.code}).${missing}`
    + ` Set ${MARKET_CREDENTIAL_FIELDS[marketStatus.market].join(' and ')}, then restart.`
}

export const describeUnavailableMarketWorkspace = (startupStatus, workspace) => {
  const status = marketWorkspaceStatus(startupStatus, workspace)
  if (!status || status.ready) return null
  const market = WORKSPACE_CREDENTIAL_MARKET[workspace]
  return `Set ${MARKET_CREDENTIAL_FIELDS[market].join(' and ')} and restart to enable ${status.label}.`
}
