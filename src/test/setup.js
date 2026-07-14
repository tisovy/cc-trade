import '@testing-library/jest-dom'
import { afterEach, expect } from 'vitest'
import { installFuturesProductionNetworkEscapeGuard } from '../../electron/futures-production-network-guard.js'

const futuresProductionNetworkEscapeGuard = installFuturesProductionNetworkEscapeGuard()

afterEach(() => {
  expect(futuresProductionNetworkEscapeGuard.getAttempts()).toEqual([])
})
