import fs from 'node:fs'
import path from 'node:path'

// Browser-style zoom for the whole app. The futures workstation has its own
// type scale, but every other panel is plain px, so a window-level zoom is the
// only control that enlarges all of them coherently — chart canvas included.

export const ZOOM_LEVEL_MIN = -3
export const ZOOM_LEVEL_MAX = 5
export const ZOOM_LEVEL_DEFAULT = 0
export const ZOOM_SETTINGS_FILE = 'window-zoom.json'

export const clampZoomLevel = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ZOOM_LEVEL_DEFAULT
  return Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, Math.round(parsed)))
}

// Ctrl/Cmd +, Ctrl/Cmd -, Ctrl/Cmd 0 — including the shifted '+' and the
// numpad keys, which report different key values on Linux and Windows.
export const resolveZoomCommand = (input = {}) => {
  if (input.type !== 'keyDown') return null
  if (!(input.control || input.meta) || input.alt) return null
  const key = String(input.key ?? '')
  if (key === '=' || key === '+' || key === 'Add') return 'in'
  if (key === '-' || key === '_' || key === 'Subtract') return 'out'
  if (key === '0') return 'reset'
  return null
}

export const applyZoomCommand = (level, command) => {
  if (command === 'in') return clampZoomLevel(level + 1)
  if (command === 'out') return clampZoomLevel(level - 1)
  if (command === 'reset') return ZOOM_LEVEL_DEFAULT
  return clampZoomLevel(level)
}

export const readStoredZoomLevel = (directory, fileSystem = fs) => {
  try {
    const raw = fileSystem.readFileSync(path.join(directory, ZOOM_SETTINGS_FILE), 'utf8')
    return clampZoomLevel(JSON.parse(raw)?.zoomLevel)
  } catch {
    return ZOOM_LEVEL_DEFAULT
  }
}

export const writeStoredZoomLevel = (directory, level, fileSystem = fs) => {
  try {
    fileSystem.writeFileSync(
      path.join(directory, ZOOM_SETTINGS_FILE),
      JSON.stringify({ zoomLevel: clampZoomLevel(level) }),
    )
    return true
  } catch {
    return false
  }
}

export const installRendererZoomControls = (webContents, { settingsDirectory } = {}) => {
  if (!webContents) return
  let level = settingsDirectory ? readStoredZoomLevel(settingsDirectory) : ZOOM_LEVEL_DEFAULT

  const applyLevel = () => {
    webContents.setZoomLevel(level)
  }

  webContents.on('did-finish-load', applyLevel)
  webContents.on('before-input-event', (event, input) => {
    const command = resolveZoomCommand(input)
    if (!command) return
    const nextLevel = applyZoomCommand(level, command)
    event.preventDefault()
    if (nextLevel === level) return
    level = nextLevel
    applyLevel()
    if (settingsDirectory) writeStoredZoomLevel(settingsDirectory, level)
  })
}
