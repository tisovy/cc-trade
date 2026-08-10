// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import {
  ZOOM_LEVEL_DEFAULT,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  applyZoomCommand,
  clampZoomLevel,
  installRendererZoomControls,
  readStoredZoomLevel,
  resolveZoomCommand,
  writeStoredZoomLevel,
} from './renderer-zoom.js'

const createWebContents = () => {
  const handlers = new Map()
  return {
    handlers,
    setZoomLevel: vi.fn(),
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, ...args) => handlers.get(event)?.(...args),
  }
}

describe('renderer zoom', () => {
  it('recognizes the platform variants of the zoom shortcuts only', () => {
    for (const key of ['=', '+', 'Add']) {
      expect(resolveZoomCommand({ type: 'keyDown', control: true, key })).toBe('in')
    }
    for (const key of ['-', '_', 'Subtract']) {
      expect(resolveZoomCommand({ type: 'keyDown', meta: true, key })).toBe('out')
    }
    expect(resolveZoomCommand({ type: 'keyDown', control: true, key: '0' })).toBe('reset')
    expect(resolveZoomCommand({ type: 'keyUp', control: true, key: '=' })).toBeNull()
    expect(resolveZoomCommand({ type: 'keyDown', key: '=' })).toBeNull()
    expect(resolveZoomCommand({ type: 'keyDown', control: true, alt: true, key: '=' })).toBeNull()
  })

  it('clamps to a usable range and resets to the default', () => {
    expect(clampZoomLevel(99)).toBe(ZOOM_LEVEL_MAX)
    expect(clampZoomLevel(-99)).toBe(ZOOM_LEVEL_MIN)
    expect(clampZoomLevel('nope')).toBe(ZOOM_LEVEL_DEFAULT)
    expect(applyZoomCommand(ZOOM_LEVEL_MAX, 'in')).toBe(ZOOM_LEVEL_MAX)
    expect(applyZoomCommand(3, 'reset')).toBe(ZOOM_LEVEL_DEFAULT)
  })

  it('survives a missing or corrupt settings file', () => {
    const fileSystem = {
      readFileSync: () => { throw new Error('missing') },
      writeFileSync: () => { throw new Error('read-only') },
    }
    expect(readStoredZoomLevel('/tmp', fileSystem)).toBe(ZOOM_LEVEL_DEFAULT)
    expect(writeStoredZoomLevel('/tmp', 2, fileSystem)).toBe(false)
  })

  it('applies the stored level on load and persists every change', () => {
    const stored = { value: '{"zoomLevel":2}' }
    const fileSystem = {
      readFileSync: () => stored.value,
      writeFileSync: (_file, contents) => { stored.value = contents },
    }
    expect(readStoredZoomLevel('/tmp', fileSystem)).toBe(2)

    const webContents = createWebContents()
    installRendererZoomControls(webContents, {})
    webContents.emit('did-finish-load')
    expect(webContents.setZoomLevel).toHaveBeenLastCalledWith(ZOOM_LEVEL_DEFAULT)

    const event = { preventDefault: vi.fn() }
    webContents.emit('before-input-event', event, {
      type: 'keyDown', control: true, key: '=',
    })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(webContents.setZoomLevel).toHaveBeenLastCalledWith(1)

    const ignored = { preventDefault: vi.fn() }
    webContents.emit('before-input-event', ignored, { type: 'keyDown', key: 'a' })
    expect(ignored.preventDefault).not.toHaveBeenCalled()
  })
})
