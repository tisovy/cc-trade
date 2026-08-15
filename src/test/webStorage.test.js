import { describe, expect, it, vi } from 'vitest'
import { attachMockLocalStorage } from './mocks/storage.js'
import {
  createInMemoryStorage,
  installDeterministicWebStorage,
} from './webStorage.js'

const storageAvailableDuringModuleEvaluation = globalThis.localStorage
const sessionStorageAvailableDuringModuleEvaluation = globalThis.sessionStorage

describe('deterministic Vitest Web Storage', () => {
  it('is available before the test module evaluates', () => {
    expect(storageAvailableDuringModuleEvaluation).toBeDefined()
    expect(sessionStorageAvailableDuringModuleEvaluation).toBeDefined()
    expect(storageAvailableDuringModuleEvaluation.getItem('missing')).toBeNull()
    expect(sessionStorageAvailableDuringModuleEvaluation.getItem('missing')).toBeNull()
    expect(window.localStorage).toBe(globalThis.localStorage)
    expect(window.sessionStorage).toBe(globalThis.sessionStorage)
  })

  it('implements the browser Storage operations and string coercion', () => {
    const storage = createInMemoryStorage()

    expect(Object.prototype.toString.call(storage)).toBe('[object Storage]')
    expect(storage.length).toBe(0)
    expect(storage.getItem('missing')).toBeNull()
    expect(storage.key(0)).toBeNull()

    storage.setItem(7, 42)
    storage.setItem('nullable', null)

    expect(storage.length).toBe(2)
    expect(storage.key(0)).toBe('7')
    expect(storage.key(1)).toBe('nullable')
    expect(storage.key(-1)).toBeNull()
    expect(storage.key(2)).toBeNull()
    expect(storage.getItem(7)).toBe('42')
    expect(storage.getItem('nullable')).toBe('null')
    expect(storage.key(1.9)).toBe('nullable')
    expect(storage.key(Number.NaN)).toBe('7')
    expect(storage.key(Number.POSITIVE_INFINITY)).toBe('7')
    expect(storage.key(2 ** 32)).toBe('7')
    expect(storage.key((2 ** 32) + 1)).toBe('nullable')

    storage.removeItem(7)
    expect(storage.getItem('7')).toBeNull()
    expect(storage.length).toBe(1)

    storage.clear()
    expect(storage.length).toBe(0)
    expect(storage.key(0)).toBeNull()
  })

  it('matches JSDOM method arity and symbol conversion failures', () => {
    const storage = createInMemoryStorage()

    expect(() => storage.getItem()).toThrow(TypeError)
    expect(() => storage.setItem()).toThrow(TypeError)
    expect(() => storage.setItem('only-key')).toThrow(TypeError)
    expect(() => storage.removeItem()).toThrow(TypeError)
    expect(() => storage.key()).toThrow(TypeError)
    expect(() => storage.getItem(Symbol('key'))).toThrow(TypeError)
    expect(() => storage.setItem(Symbol('key'), 'value')).toThrow(TypeError)
    expect(() => storage.setItem('key', Symbol('value'))).toThrow(TypeError)
    expect(() => storage.removeItem(Symbol('key'))).toThrow(TypeError)
    expect(() => storage.key(Symbol('index'))).toThrow(TypeError)
  })

  it('replaces unavailable ambient accessors with separate stores', () => {
    const target = {}
    const localGetter = vi.fn(() => {
      throw new Error('localStorage getter must not run')
    })
    const sessionGetter = vi.fn(() => {
      throw new Error('sessionStorage getter must not run')
    })
    Object.defineProperty(target, 'localStorage', {
      configurable: true,
      get: localGetter,
    })
    Object.defineProperty(target, 'sessionStorage', {
      configurable: true,
      get: sessionGetter,
    })

    const installed = installDeterministicWebStorage(target)
    target.localStorage.setItem('scope', 'local')
    target.sessionStorage.setItem('scope', 'session')

    expect(target.localStorage).toBe(installed.localStorage)
    expect(target.sessionStorage).toBe(installed.sessionStorage)
    expect(target.localStorage.getItem('scope')).toBe('local')
    expect(target.sessionStorage.getItem('scope')).toBe('session')
    expect(localGetter).not.toHaveBeenCalled()
    expect(sessionGetter).not.toHaveBeenCalled()
  })

  it('reports a focused error for a non-configurable ambient global', () => {
    const target = {}
    Object.defineProperty(target, 'localStorage', {
      configurable: false,
      value: undefined,
    })

    expect(() => installDeterministicWebStorage(target)).toThrow(
      '[vitest setup] Cannot install deterministic localStorage: the existing global descriptor is not configurable',
    )
  })

  it('leaves both globals unchanged when the second descriptor is locked', () => {
    const target = {}
    const originalLocalStorage = { source: 'original' }
    const originalSessionStorage = { source: 'locked' }
    Object.defineProperty(target, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    })
    Object.defineProperty(target, 'sessionStorage', {
      configurable: false,
      value: originalSessionStorage,
    })

    expect(() => installDeterministicWebStorage(target)).toThrow(
      '[vitest setup] Cannot install deterministic sessionStorage: the existing global descriptor is not configurable',
    )
    expect(target.localStorage).toBe(originalLocalStorage)
    expect(target.sessionStorage).toBe(originalSessionStorage)
  })

  it('survives unrelated Vitest global-stub cleanup', () => {
    const storage = globalThis.localStorage
    vi.stubGlobal('__webStorageHarnessProbe', true)

    vi.unstubAllGlobals()

    expect(globalThis.localStorage).toBe(storage)
    expect(globalThis.__webStorageHarnessProbe).toBeUndefined()
  })

  it('keeps the explicit spy fixture available for call assertions', () => {
    const storage = attachMockLocalStorage()

    storage.setItem('observed', 'value')

    expect(storage.setItem).toHaveBeenCalledWith('observed', 'value')
    expect(storage.getItem('observed')).toBe('value')
  })
})

describe.sequential('per-test Web Storage isolation', () => {
  let priorLocalStorage
  let priorSessionStorage

  it('allows a test to replace and remove its storage globals', () => {
    priorLocalStorage = globalThis.localStorage
    priorSessionStorage = globalThis.sessionStorage
    localStorage.setItem('previous-test', 'must not leak')
    sessionStorage.setItem('previous-test', 'must not leak')

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: undefined,
    })
    delete globalThis.sessionStorage

    expect(globalThis.localStorage).toBeUndefined()
    expect(globalThis.sessionStorage).toBeUndefined()
  })

  it('reinstalls fresh local and session stores before the next test', () => {
    expect(localStorage.getItem('previous-test')).toBeNull()
    expect(sessionStorage.getItem('previous-test')).toBeNull()
    expect(localStorage).not.toBe(sessionStorage)
    expect(localStorage).not.toBe(priorLocalStorage)
    expect(sessionStorage).not.toBe(priorSessionStorage)
  })
})

describe.sequential('Vitest global-stub isolation', () => {
  it('allows a test to stub localStorage without manual cleanup', () => {
    const staleStorage = createInMemoryStorage()
    staleStorage.setItem('stale-test', 'must not return')

    vi.stubGlobal('localStorage', staleStorage)

    expect(localStorage.getItem('stale-test')).toBe('must not return')
  })

  it('cannot resurrect the previous test storage during later cleanup', () => {
    const currentStorage = globalThis.localStorage

    expect(currentStorage.getItem('stale-test')).toBeNull()
    vi.unstubAllGlobals()
    expect(globalThis.localStorage).toBe(currentStorage)
    expect(globalThis.localStorage.getItem('stale-test')).toBeNull()
  })
})
