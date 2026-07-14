// @vitest-environment node

import { describe, expect, it } from 'vitest'
import config from './vite.config.js'

describe('Vite Electron development configuration', () => {
  it('keeps React Fast Refresh disabled under the strict renderer CSP', () => {
    expect(config.server).toMatchObject({
      port: 5174,
      hmr: false,
    })
  })
})
