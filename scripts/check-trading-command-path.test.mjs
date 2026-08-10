// A guard nobody tests is a guard nobody can trust. Each case here seeds the
// shape of the path that was deleted, so a future weakening of this check fails
// here rather than by letting a second order-entry path back into the renderer.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeRendererCommandPath } from './check-trading-command-path.mjs'

let root

const write = async (relativePath, contents) => {
  const absolute = path.join(root, relativePath)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

const analyze = () => analyzeRendererCommandPath({ root })

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'command-path-'))
  await write('src/utils/tradingCommands.js', "export const place = () => ({ action: 'trade.placeOrder' })\n")
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('renderer trading-command path check', () => {
  it('passes when only the builders name a trading frame', async () => {
    await write('src/workspaces/SpotWorkspace.jsx', "import { place } from '../utils/tradingCommands.js'\nexport const send = ws => ws.send(JSON.stringify(place()))\n")

    const { violations } = await analyze()

    expect(violations).toEqual([])
  })

  // The exact shape of the deleted `buysell`.
  it('fails on an untyped legacy order frame composed elsewhere', async () => {
    await write('src/utils/operations.js', "export const buysell = (req, connection) => connection.send(JSON.stringify({ request: 'buyOrder', data: req }))\n")

    const { violations } = await analyze()

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ file: 'src/utils/operations.js', line: 1 })
    expect(violations[0].snippet).toContain('buyOrder')
  })

  it('fails on a typed action assembled outside the builders', async () => {
    await write('src/hooks/useShortcut.js', "export const cancel = ws => ws.send(JSON.stringify({ action: 'trade.cancelOrder', version: 1 }))\n")

    const { violations } = await analyze()

    expect(violations).toHaveLength(1)
    expect(violations[0].file).toBe('src/hooks/useShortcut.js')
  })

  it('catches an account frame as readily as an order one', async () => {
    await write('src/hooks/useRefresh.js', "export const refresh = ws => ws.send(JSON.stringify({ action: 'account.refresh' }))\n")

    const { violations } = await analyze()

    expect(violations).toHaveLength(1)
  })

  // Market and session control is not order entry: these must stay allowed or
  // the check would push unrelated frames into the trading builders.
  it('leaves market and session control frames alone', async () => {
    await write('src/context/GatewayContext.jsx', "export const go = send => send({ action: 'activate_market', marketMode: 'futures-live' })\n")
    await write('src/utils/channels.js', "export const sub = () => ({ action: 'subscribe' })\n")
    await write('src/hooks/useWebSocket.js', "export const chart = () => ({ request: 'chart' })\n")

    const { violations } = await analyze()

    expect(violations).toEqual([])
  })

  it('does not read a commented-out frame as a live one', async () => {
    await write('src/utils/operations.js', "// export const buysell = c => c.send(JSON.stringify({ request: 'buyOrder' }))\n/* action: 'trade.placeOrder' */\nexport const noop = () => null\n")

    const { violations } = await analyze()

    expect(violations).toEqual([])
  })

  it('does not police the tests that exercise the builders', async () => {
    await write('src/utils/tradingCommands.test.js', "it('builds', () => ({ action: 'trade.placeOrder' }))\n")

    const { violations } = await analyze()

    expect(violations).toEqual([])
  })
})
