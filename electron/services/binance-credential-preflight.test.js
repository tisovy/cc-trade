// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
    BINANCE_FUTURES_CREDENTIAL_FIELDS,
    BINANCE_SPOT_CREDENTIAL_FIELDS,
    BINANCE_STARTUP_CODES,
    BINANCE_STARTUP_STATES,
    createBinanceStartupEnvelope,
    evaluateBinanceCredentialPreflight,
} from './binance-credential-preflight.js'

const BOTH_PAIRS = Object.freeze({
    BK: 'spot-key',
    BS: 'spot-secret',
    BFK: 'futures-key',
    BFS: 'futures-secret',
})

describe('Binance credential preflight', () => {
    it('reports both markets ready when both pairs are complete', () => {
        const result = evaluateBinanceCredentialPreflight(BOTH_PAIRS)

        expect(result).toMatchObject({
            state: BINANCE_STARTUP_STATES.READY,
            code: BINANCE_STARTUP_CODES.READY,
            ready: true,
            missingFields: [],
        })
        expect(result.markets.spot).toMatchObject({ market: 'spot', ready: true })
        expect(result.markets.futures).toMatchObject({ market: 'futures', ready: true })
    })

    it('starts Spot and fails Futures closed when only the Spot pair is present', () => {
        const result = evaluateBinanceCredentialPreflight({ BK: 'spot-key', BS: 'spot-secret' })

        expect(result.ready).toBe(true)
        expect(result.markets.spot).toMatchObject({
            ready: true,
            code: BINANCE_STARTUP_CODES.READY,
            requiredFields: BINANCE_SPOT_CREDENTIAL_FIELDS,
        })
        expect(result.markets.futures).toMatchObject({
            ready: false,
            code: BINANCE_STARTUP_CODES.MISSING_CREDENTIALS,
            missingFields: ['BFK', 'BFS'],
            requiredFields: BINANCE_FUTURES_CREDENTIAL_FIELDS,
        })
        expect(result.message).toContain('BFK')
    })

    it('starts Futures and fails Spot closed when only the Futures pair is present', () => {
        const result = evaluateBinanceCredentialPreflight({ BFK: 'futures-key', BFS: 'futures-secret' })

        expect(result.ready).toBe(true)
        expect(result.markets.futures.ready).toBe(true)
        expect(result.markets.spot).toMatchObject({
            ready: false,
            code: BINANCE_STARTUP_CODES.MISSING_CREDENTIALS,
            missingFields: ['BK', 'BS'],
        })
        expect(result.message).toContain('BK')
    })

    it.each([
        [{ ...BOTH_PAIRS, BS: '' }, 'spot', BINANCE_STARTUP_CODES.MISSING_API_SECRET, ['BS']],
        [{ ...BOTH_PAIRS, BK: '' }, 'spot', BINANCE_STARTUP_CODES.MISSING_API_KEY, ['BK']],
        [{ ...BOTH_PAIRS, BFS: '  ' }, 'futures', BINANCE_STARTUP_CODES.MISSING_API_SECRET, ['BFS']],
        [{ ...BOTH_PAIRS, BFK: '  ' }, 'futures', BINANCE_STARTUP_CODES.MISSING_API_KEY, ['BFK']],
    ])('fails only the market holding a partial pair %#', (environment, market, code, missingFields) => {
        const result = evaluateBinanceCredentialPreflight(environment)
        const other = market === 'spot' ? 'futures' : 'spot'

        expect(result.markets[market]).toMatchObject({ ready: false, code, missingFields })
        expect(result.markets[other].ready).toBe(true)
        expect(result.ready).toBe(true)
    })

    it('fails closed entirely when neither pair is complete', () => {
        const result = evaluateBinanceCredentialPreflight({ BK: 'spot-key', BFS: 'futures-secret' })

        expect(result).toMatchObject({
            state: BINANCE_STARTUP_STATES.CONFIG_ERROR,
            ready: false,
            missingFields: ['BS', 'BFK'],
        })
        expect(result.markets.spot.ready).toBe(false)
        expect(result.markets.futures.ready).toBe(false)
    })

    it('reports missing credentials when the environment is empty', () => {
        expect(evaluateBinanceCredentialPreflight({})).toMatchObject({
            state: BINANCE_STARTUP_STATES.CONFIG_ERROR,
            code: BINANCE_STARTUP_CODES.MISSING_CREDENTIALS,
            ready: false,
            missingFields: ['BK', 'BS', 'BFK', 'BFS'],
        })
    })

    it('diagnoses retired names only when no supported pair exists', () => {
        expect(evaluateBinanceCredentialPreflight({ FUTURES_PRODUCTION_API_KEY: 'retired' }))
            .toMatchObject({
                code: BINANCE_STARTUP_CODES.RETIRED_CREDENTIALS,
                ready: false,
            })

        expect(evaluateBinanceCredentialPreflight({
            ...BOTH_PAIRS,
            FUTURES_PRODUCTION_API_KEY: 'retired',
        })).toMatchObject({ code: BINANCE_STARTUP_CODES.READY, ready: true })
    })

    it('emits only bounded field names and never credential values', () => {
        const values = Object.freeze({
            BK: 'super-secret-spot-key-value',
            BS: 'super-secret-spot-signing-value',
            BFK: 'super-secret-futures-key-value',
            BFS: 'super-secret-futures-signing-value',
            FUTURES_PRODUCTION_API_SECRET: 'retired-secret-value',
        })
        const serialized = JSON.stringify(
            createBinanceStartupEnvelope(evaluateBinanceCredentialPreflight(values)),
        )

        expect(serialized.length).toBeLessThan(4_096)
        for (const value of Object.values(values)) {
            expect(serialized).not.toContain(value)
        }
        expect(serialized).toContain('FUTURES_PRODUCTION_API_SECRET')
    })

    it('carries per-market sections through the startup envelope', () => {
        const envelope = createBinanceStartupEnvelope(
            evaluateBinanceCredentialPreflight({ BK: 'spot-key', BS: 'spot-secret' }),
        )

        expect(envelope).toMatchObject({
            type: 'startup_status',
            version: 2,
            ready: true,
            markets: {
                spot: { market: 'spot', ready: true },
                futures: { market: 'futures', ready: false, missingFields: ['BFK', 'BFS'] },
            },
        })
    })
})
