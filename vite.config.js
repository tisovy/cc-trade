import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { fileURLToPath } from 'node:url'

const VERIFICATION_BUILD_MODES = new Set(['safe-dev', 'smoke'])

const verificationCompositionPath = environment => fileURLToPath(new URL(
  `./electron/services/futures-${environment}-workstation-verification-composition.js`,
  import.meta.url,
))

export const selectFuturesWorkstationCompositionAliases = ({
  buildMode,
  isVitest,
} = {}) => {
  const deterministic = isVitest === true || VERIFICATION_BUILD_MODES.has(buildMode)
  if (!deterministic) return []
  return [
    {
      find: /(?:^|.*\/)futures-production-workstation-composition\.js$/,
      replacement: verificationCompositionPath('production'),
    },
  ]
}

const futuresWorkstationCompositionAliases = selectFuturesWorkstationCompositionAliases({
  buildMode: process.env.BUILD_MODE,
  isVitest: process.env.VITEST === 'true',
})

export const selectElectronMainEntry = ({ buildMode } = {}) => {
  if (buildMode === undefined || buildMode === '') return 'electron/main.js'
  if (buildMode === 'safe-dev') return 'electron/main.safe-dev.js'
  if (buildMode === 'smoke') return 'electron/main.smoke.js'
  throw new Error(`Unsupported Electron build mode: ${buildMode}`)
}

const electronMainEntry = selectElectronMainEntry({
  buildMode: process.env.BUILD_MODE,
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  resolve: {
    alias: futuresWorkstationCompositionAliases,
  },
  server: {
    port: 5174,
    // Electron applies the same strict script-src policy in development.
    // React Fast Refresh injects an inline preamble that this policy must
    // reject, so keep HMR off instead of weakening the renderer CSP.
    hmr: false,
  },
  define: {
    // Expose only non-secret analytics env vars to browser
    'process.env.ANALYTICS_URL': JSON.stringify(process.env.ANALYTICS_URL || ''),
    'process.env.ANALYTICS_BASE_URL': JSON.stringify(process.env.ANALYTICS_BASE_URL || ''),
    'process.env.ANALYTICS_KEY': JSON.stringify(process.env.ANALYTICS_KEY || ''),
    'process.env.ANALYTICS_REQUIRES_MAIN_SIGNING': JSON.stringify(
      process.env.ANALYTICS_SECRET ? 'true' : process.env.ANALYTICS_REQUIRES_MAIN_SIGNING || ''
    ),
    'process.env.ANALYTICS_POLL_INTERVAL': JSON.stringify(process.env.ANALYTICS_POLL_INTERVAL || ''),
    'process.env.ANALYTICS_LIMIT': JSON.stringify(process.env.ANALYTICS_LIMIT || ''),
  },
  plugins: [
    react(),
    electron([
      {
        entry: electronMainEntry,
        vite: {
          resolve: {
            alias: futuresWorkstationCompositionAliases,
          },
          build: {
            lib: {
              // package.json launches dist-electron/main.js. Keep that stable
              // filename for every retained Electron entry.
              fileName: () => 'main.js',
            },
          },
        },
      },
      {
        vite: {
          build: {
            rollupOptions: {
              input: 'electron/preload.cjs',
              external: ['electron'],
              output: {
                format: 'cjs',
                inlineDynamicImports: true,
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
    ]),
  ],
})
