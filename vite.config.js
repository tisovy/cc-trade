import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: {
    port: 5174
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
    electron({
      entry: process.env.BUILD_MODE === 'e2e' ? 'electron/main.e2e.js' : 'electron/main.js',
    }),
  ],
})
