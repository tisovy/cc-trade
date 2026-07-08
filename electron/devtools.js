const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

const isEnabledFlag = (value) => TRUE_ENV_VALUES.has(String(value).trim().toLowerCase())

export const shouldOpenDevTools = ({
  env = process.env,
  allowDevServerDefault = true,
} = {}) => {
  if (env.ELECTRON_OPEN_DEVTOOLS !== undefined) {
    return isEnabledFlag(env.ELECTRON_OPEN_DEVTOOLS)
  }

  return allowDevServerDefault && Boolean(env.VITE_DEV_SERVER_URL)
}
