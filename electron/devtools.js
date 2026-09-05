const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

const isEnabledFlag = (value) => TRUE_ENV_VALUES.has(String(value).trim().toLowerCase())

export const shouldOpenDevTools = ({
  env = process.env,
} = {}) => {
  return isEnabledFlag(env.ELECTRON_OPEN_DEVTOOLS)
}
