// A guard nobody tests is a guard nobody can trust. Each case here seeds one
// regression the previous version of this check let through, so a future
// weakening of the check fails here instead of on a live desk.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  analyzeProductionSourceGraph,
  runProductionSourceGraphCheck,
} from './check-runtime-mock-layer.mjs'

let root

const write = async (relativePath, contents) => {
  const absolute = path.join(root, relativePath)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

const analyze = () => analyzeProductionSourceGraph({
  root,
  entryPoints: ['electron/main.js'],
})

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'production-graph-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('production source graph check', () => {
  it('walks a clean graph and reports nothing', async () => {
    await write('electron/main.js', "import './service.js'\n")
    await write('electron/service.js', 'export const start = () => null\n')

    const { moduleCount, violations } = await analyze()

    expect(moduleCount).toBe(2)
    expect(violations).toEqual([])
  })

  it('fails on a mock reintroduced under a name it has never seen', async () => {
    await write('electron/main.js', "import './feed.js'\n")
    await write('electron/feed.js', 'const syntheticDepthLadder = () => ({ bids: [] })\nexport default syntheticDepthLadder\n')

    const { violations } = await analyze()

    expect(violations).toEqual(['electron/feed.js: synthetic data identifier'])
  })

  it('walks a first-party module reached through a bare specifier', async () => {
    // The old check only followed specifiers starting with a dot, so this
    // module and everything under it left the graph without a word.
    await write('electron/main.js', "import 'src/hidden.js'\n")
    await write('src/hidden.js', 'export const mockTicker = () => ({ price: 1 })\n')

    const { moduleCount, violations } = await analyze()

    expect(moduleCount).toBe(2)
    expect(violations).toEqual(['src/hidden.js: synthetic data identifier'])
  })

  it('walks a first-party module reached through an alias', async () => {
    await write('electron/main.js', "import '@/aliased.js'\n")
    await write('src/aliased.js', "import './deeper.js'\n")
    await write('src/deeper.js', 'export const fakeBalance = () => 100\n')

    const { moduleCount, violations } = await analyze()

    expect(moduleCount).toBe(3)
    expect(violations).toEqual(['src/deeper.js: synthetic data identifier'])
  })

  it('fails when the graph shrinks below the recorded floor', async () => {
    await write('electron/main.js', 'export const start = () => null\n')

    const { moduleCount, failures } = await runProductionSourceGraphCheck({
      root,
      entryPoints: ['electron/main.js'],
      moduleFloor: 5,
    })

    expect(moduleCount).toBe(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/shrank to 1 modules, below the recorded floor of 5/)
  })

  it('accepts a graph at or above the floor', async () => {
    await write('electron/main.js', "import './a.js'\n")
    await write('electron/a.js', 'export const a = 1\n')

    const { failures } = await runProductionSourceGraphCheck({
      root,
      entryPoints: ['electron/main.js'],
      moduleFloor: 2,
    })

    expect(failures).toEqual([])
  })

  it('treats Math.random() as a finding unless the file is explained', async () => {
    await write('electron/main.js', "import './prices.js'\n")
    await write('electron/prices.js', 'export const price = () => 100 + Math.random() * 5\n')

    const { violations } = await analyze()

    expect(violations).toEqual(['electron/prices.js: unexplained Math.random() in the production graph'])

    const allowed = await analyzeProductionSourceGraph({
      root,
      entryPoints: ['electron/main.js'],
      randomnessAllowlist: new Map([['electron/prices.js', 'explained in review']]),
    })
    expect(allowed.violations).toEqual([])
  })

  it('does not read code out of comments', async () => {
    await write('electron/main.js', [
      '// mockTicker( was removed here on purpose',
      '/* fakeBalance: also gone */',
      "export const url = 'https://fapi.binance.com/fapi/v1/time'",
      '',
    ].join('\n'))

    const { violations } = await analyze()

    expect(violations).toEqual([])
  })

  it('does not walk third-party or non-executable files', async () => {
    await write('electron/main.js', [
      "import 'node:https'",
      "import 'lightweight-charts'",
      "import './styles.css'",
      "import './service.js'",
      '',
    ].join('\n'))
    await write('electron/styles.css', '.cancel-order-stub:hover { color: red }\n')
    await write('electron/service.js', 'export const start = () => null\n')

    const { moduleCount, violations } = await analyze()

    expect(moduleCount).toBe(2)
    expect(violations).toEqual([])
  })
})
