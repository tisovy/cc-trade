import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

// https://vite.dev/config/
export default defineConfig({
  base: './',
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
        entry: process.env.BUILD_MODE === 'e2e' ? 'electron/main.e2e.js' : 'electron/main.js',
        vite: {
          build: {
            lib: {
              // Playwright and package.json both launch dist-electron/main.js.
              // Keep that stable filename when the E2E-only entry is selected.
              fileName: () => 'main.js',
            },
          },
        },
      },
      {
        entry: 'electron/preload.cjs',
        vite: {
          build: {
            lib: {
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
})
