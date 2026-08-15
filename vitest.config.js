import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { selectFuturesWorkstationCompositionAliases } from './vite.config.js'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            { find: '@', replacement: path.resolve(__dirname, './src') },
            ...selectFuturesWorkstationCompositionAliases({ isVitest: true }),
        ],
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.js',
        unstubGlobals: true,
        exclude: ['**/node_modules/**', '**/dist/**'],
    },
})
