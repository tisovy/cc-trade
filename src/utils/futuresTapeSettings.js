import {
  FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS,
  FUTURES_WORKSTATION_TAPE_LIMITS,
} from './futuresWorkstationProtocolShared.js'
import { readStorage, writeStorage } from './storage.js'

export const FUTURES_TAPE_SETTINGS_STORAGE_KEY = 'futures.tapeSettings'

const TAPE_NOTIONAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

export const normalizeTapeNotional = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!TAPE_NOTIONAL_PATTERN.test(trimmed) || !Number.isFinite(Number(trimmed))) return null
  const [whole, fraction = ''] = trimmed.split('.')
  const normalizedFraction = fraction.replace(/0+$/, '')
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole
}

const isTapeTimeoutInRange = timeoutMs => (
  Number.isSafeInteger(timeoutMs)
  && timeoutMs >= FUTURES_WORKSTATION_TAPE_LIMITS.MIN_TIMEOUT_MS
  && timeoutMs <= FUTURES_WORKSTATION_TAPE_LIMITS.MAX_TIMEOUT_MS
)

// Restored settings are operator input that outlived a restart, so they are
// validated exactly like fresh input: a hand-edited or stale entry can never
// widen the tape past what the protocol accepts, it simply falls back to the
// defaults.
export const parseStoredTapeSettings = (stored) => {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null
  const { throttleEnabled, timeoutMs, minNotionalUsdt } = stored
  if (typeof throttleEnabled !== 'boolean' || !isTapeTimeoutInRange(timeoutMs)) return null
  const normalizedNotional = normalizeTapeNotional(minNotionalUsdt)
  if (normalizedNotional === null) return null
  return Object.freeze({ throttleEnabled, timeoutMs, minNotionalUsdt: normalizedNotional })
}

export const readStoredTapeSettings = () => (
  parseStoredTapeSettings(readStorage(FUTURES_TAPE_SETTINGS_STORAGE_KEY, null))
  ?? FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS
)

export const writeStoredTapeSettings = (settings) => {
  const validated = parseStoredTapeSettings(settings)
  if (validated === null) return false
  writeStorage(FUTURES_TAPE_SETTINGS_STORAGE_KEY, validated)
  return true
}
