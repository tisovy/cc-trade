import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect } from 'vitest'
import { installFuturesProductionNetworkEscapeGuard } from '../../electron/futures-production-network-guard.js'
import { installDeterministicWebStorage } from './webStorage.js'

const futuresProductionNetworkEscapeGuard = installFuturesProductionNetworkEscapeGuard()

installDeterministicWebStorage()

beforeEach(() => {
  installDeterministicWebStorage()
})

afterEach(() => {
  expect(futuresProductionNetworkEscapeGuard.getAttempts()).toEqual([])
})
