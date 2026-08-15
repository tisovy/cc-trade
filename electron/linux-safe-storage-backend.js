const GNOME_LIBSECRET_SWITCH_VALUE = 'gnome-libsecret'
const PASSWORD_STORE_SWITCH = 'password-store'

const isHyprlandDesktop = (desktop) => (
  typeof desktop === 'string'
  && desktop.length <= 256
  && desktop.split(':').some(value => value.trim().toLowerCase() === 'hyprland')
)

export const configureLinuxSafeStorageBackend = ({
  app,
  platform = process.platform,
  desktop = process.env.XDG_CURRENT_DESKTOP,
} = {}) => {
  if (platform !== 'linux' || !isHyprlandDesktop(desktop)) return false
  if (!app?.commandLine
    || typeof app.commandLine.hasSwitch !== 'function'
    || typeof app.commandLine.appendSwitch !== 'function') {
    throw new TypeError('Electron commandLine is required for Linux safeStorage selection')
  }
  if (app.commandLine.hasSwitch(PASSWORD_STORE_SWITCH)) return false
  app.commandLine.appendSwitch(PASSWORD_STORE_SWITCH, GNOME_LIBSECRET_SWITCH_VALUE)
  return true
}
