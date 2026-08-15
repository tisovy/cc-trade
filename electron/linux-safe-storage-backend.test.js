import { describe, expect, it, vi } from 'vitest'
import { configureLinuxSafeStorageBackend } from './linux-safe-storage-backend.js'

const makeApp = ({ hasPasswordStore = false } = {}) => ({
  commandLine: {
    hasSwitch: vi.fn(() => hasPasswordStore),
    appendSwitch: vi.fn(),
  },
})

describe('Linux safeStorage backend selection', () => {
  it.each([
    ['linux', 'Hyprland'],
    ['linux', 'wlroots:Hyprland'],
    ['linux', 'HYPRLAND'],
  ])('pins %s %s to gnome-libsecret before Electron ready', (platform, desktop) => {
    const app = makeApp()

    expect(configureLinuxSafeStorageBackend({ app, platform, desktop })).toBe(true)
    expect(app.commandLine.hasSwitch).toHaveBeenCalledWith('password-store')
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      'password-store',
      'gnome-libsecret',
    )
  })

  it.each([
    ['darwin', 'Hyprland'],
    ['win32', 'Hyprland'],
    ['linux', 'GNOME'],
    ['linux', 'Hyprland-compatible'],
    ['linux', ''],
  ])('does not override platform %s desktop %s', (platform, desktop) => {
    const app = makeApp()

    expect(configureLinuxSafeStorageBackend({ app, platform, desktop })).toBe(false)
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled()
  })

  it('preserves an explicit operator password-store selection', () => {
    const app = makeApp({ hasPasswordStore: true })

    expect(configureLinuxSafeStorageBackend({
      app,
      platform: 'linux',
      desktop: 'Hyprland',
    })).toBe(false)
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled()
  })

  it('fails fast if Electron commandLine is unavailable on Hyprland', () => {
    expect(() => configureLinuxSafeStorageBackend({
      app: {},
      platform: 'linux',
      desktop: 'Hyprland',
    })).toThrow('Electron commandLine is required for Linux safeStorage selection')
  })
})
