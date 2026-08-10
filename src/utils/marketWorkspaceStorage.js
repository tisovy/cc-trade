export const MARKET_WORKSPACE_STORAGE_KEY = 'cc-trade:last-market-workspace:v1'

export const MARKET_WORKSPACES = Object.freeze({
  UNSELECTED: 'unselected',
  SPOT: 'spot',
  FUTURES_LIVE: 'futures-live',
})

const ACTIVATABLE_MARKET_WORKSPACES = new Set([
  MARKET_WORKSPACES.SPOT,
  MARKET_WORKSPACES.FUTURES_LIVE,
])

export const isActivatableMarketWorkspace = value => (
  ACTIVATABLE_MARKET_WORKSPACES.has(value)
)

export const readLastMarketWorkspace = (storage = globalThis.localStorage) => {
  try {
    const storedValue = storage?.getItem?.(MARKET_WORKSPACE_STORAGE_KEY)
    return isActivatableMarketWorkspace(storedValue)
      ? storedValue
      : MARKET_WORKSPACES.UNSELECTED
  } catch {
    return MARKET_WORKSPACES.UNSELECTED
  }
}

export const writeLastMarketWorkspace = (
  workspace,
  storage = globalThis.localStorage,
) => {
  if (!isActivatableMarketWorkspace(workspace)) return false

  try {
    storage?.setItem?.(MARKET_WORKSPACE_STORAGE_KEY, workspace)
    return true
  } catch {
    return false
  }
}
