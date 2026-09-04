import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

const baseLanguageOptions = {
  ecmaVersion: 2020,
  globals: globals.browser,
  parserOptions: {
    ecmaVersion: 'latest',
    ecmaFeatures: { jsx: true },
    sourceType: 'module',
  },
}

const nodeLanguageOptions = {
  ...baseLanguageOptions,
  globals: globals.node,
}

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'release']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: baseLanguageOptions,
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: [
      'electron/**/*.js',
      'tele_announcer/**/*.js',
      '*.config.js',
      'src/**/*.test.js',
    ],
    languageOptions: nodeLanguageOptions,
  },
])
