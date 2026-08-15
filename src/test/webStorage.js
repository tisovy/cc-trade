const STORAGE_GLOBAL_NAMES = Object.freeze(['localStorage', 'sessionStorage'])

const normalizeStorageKey = (value, methodName, parameterNumber) => {
  if (typeof value === 'symbol') {
    throw new TypeError(
      `Failed to execute '${methodName}' on 'Storage': parameter ${parameterNumber} is a symbol, which cannot be converted to a string.`,
    )
  }

  return String(value)
}

const requireArguments = (methodName, actual, required) => {
  if (actual >= required) return

  throw new TypeError(
    `Failed to execute '${methodName}' on 'Storage': ${required} argument${required === 1 ? '' : 's'} required, but only ${actual} present.`,
  )
}

const toUnsignedLong = value => {
  const number = Number(value)
  if (!Number.isFinite(number) || number === 0) return 0

  const modulo = 2 ** 32
  const integer = Math.trunc(number)
  return ((integer % modulo) + modulo) % modulo
}

export const createInMemoryStorage = () => {
  const entries = new Map()

  return {
    get length() {
      return entries.size
    },

    clear() {
      entries.clear()
    },

    getItem(key) {
      requireArguments('getItem', arguments.length, 1)
      const normalizedKey = normalizeStorageKey(key, 'getItem', 1)
      return entries.has(normalizedKey) ? entries.get(normalizedKey) : null
    },

    key(index) {
      requireArguments('key', arguments.length, 1)
      const normalizedIndex = toUnsignedLong(index)
      return Array.from(entries.keys())[normalizedIndex] ?? null
    },

    removeItem(key) {
      requireArguments('removeItem', arguments.length, 1)
      entries.delete(normalizeStorageKey(key, 'removeItem', 1))
    },

    setItem(key, value) {
      requireArguments('setItem', arguments.length, 2)
      entries.set(
        normalizeStorageKey(key, 'setItem', 1),
        normalizeStorageKey(value, 'setItem', 2),
      )
    },

    [Symbol.toStringTag]: 'Storage',
  }
}

const assertStorageGlobalIsReplaceable = (target, name) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, name)
  if (descriptor && !descriptor.configurable) {
    throw new Error(
      `[vitest setup] Cannot install deterministic ${name}: the existing global descriptor is not configurable`,
    )
  }

  if (!descriptor && !Object.isExtensible(target)) {
    throw new Error(
      `[vitest setup] Cannot install deterministic ${name}: the test global is not extensible`,
    )
  }
}

const installStorageGlobal = (target, name, storage) => {
  try {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: storage,
    })
  } catch (cause) {
    throw new Error(
      `[vitest setup] Cannot install deterministic ${name} on the test global`,
      { cause },
    )
  }

  if (Object.getOwnPropertyDescriptor(target, name)?.value !== storage) {
    throw new Error(`[vitest setup] Failed to verify deterministic ${name}`)
  }
}

export const installDeterministicWebStorage = (target = globalThis) => {
  for (const name of STORAGE_GLOBAL_NAMES) {
    assertStorageGlobalIsReplaceable(target, name)
  }

  const storages = {
    localStorage: createInMemoryStorage(),
    sessionStorage: createInMemoryStorage(),
  }

  for (const name of STORAGE_GLOBAL_NAMES) {
    installStorageGlobal(target, name, storages[name])
  }

  return storages
}
