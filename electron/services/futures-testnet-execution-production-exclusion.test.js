import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const serviceDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(serviceDirectory, '../..')
const runtimeFiles = fs.readdirSync(serviceDirectory)
    .filter(name => name.startsWith('futures-testnet-execution-'))
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))
const runtimeSources = runtimeFiles.map(name => ({
    name,
    source: fs.readFileSync(path.join(serviceDirectory, name), 'utf8'),
}))

describe('Futures testnet execution production exclusion', () => {
    it('has one fixed demo literal and no production Futures execution host', () => {
        const combined = runtimeSources.map(({ source }) => source).join('\n')
        expect(combined).not.toContain('https://fapi.binance.com')
        expect(combined.match(/https:\/\/demo-fapi\.binance\.com/g)).toHaveLength(1)
        expect(combined).not.toMatch(/FUTURES_(?:PRODUCTION|MAINNET)_EXECUTION/)
    })

    it('keeps credentials and execution configuration out of renderer modules', () => {
        const rendererFiles = [
            'src/hooks/useFuturesTestnetExecution.js',
            'src/utils/futuresTestnetExecutionProtocol.js',
            'src/components/features/futures/FuturesTestnetExecutionTicket.jsx',
        ]
        const renderer = rendererFiles
            .map(name => fs.readFileSync(path.join(projectRoot, name), 'utf8'))
            .join('\n')
        expect(renderer).not.toMatch(/FUTURES_TESTNET_(?:API_KEY|API_SECRET)/)
        expect(renderer).not.toMatch(/process\.env|import\.meta\.env/)
        expect(renderer).not.toMatch(/demo-fapi|fapi\.binance|fetch\s*\(/)
        expect(renderer).not.toMatch(/localStorage|sessionStorage|clipboard|analytics|telemetry/)
    })
})
