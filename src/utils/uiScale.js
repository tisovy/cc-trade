// Trading surfaces are dense by design, but density is not a licence for 7px
// type. The base scale is the readable default; this control lets a trader tune
// it to their display without touching every stylesheet.

export const UI_SCALE_STORAGE_KEY = 'cc-trade:ui-scale:v1'
export const UI_SCALE_MIN = 0.85
export const UI_SCALE_MAX = 1.6
export const UI_SCALE_STEP = 0.05
export const UI_SCALE_DEFAULT = 1

const round = value => Math.round(value * 100) / 100

export const clampUiScale = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return UI_SCALE_DEFAULT
  return round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, parsed)))
}

export const readUiScale = (storage = globalThis.localStorage) => {
  try {
    const stored = storage?.getItem?.(UI_SCALE_STORAGE_KEY)
    return stored === null || stored === undefined
      ? UI_SCALE_DEFAULT
      : clampUiScale(stored)
  } catch {
    return UI_SCALE_DEFAULT
  }
}

export const writeUiScale = (value, storage = globalThis.localStorage) => {
  try {
    storage?.setItem?.(UI_SCALE_STORAGE_KEY, String(clampUiScale(value)))
    return true
  } catch {
    return false
  }
}

export const stepUiScale = (value, direction) => (
  clampUiScale(clampUiScale(value) + Math.sign(direction) * UI_SCALE_STEP)
)
