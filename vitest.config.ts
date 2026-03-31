import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * Use the "edge-runtime" pool so tests run in a WinterCG-compatible
     * environment (no Node.js built-ins). This catches accidental use of
     * Buffer, fs, path, etc. before they would blow up in production.
     */
    environment: 'node',

    /**
     * File patterns to treat as tests.
     */
    include: ['tests/**/*.test.ts'],

    /**
     * Global test timeout (ms).
     */
    testTimeout: 10_000,

    /**
     * Coverage configuration (run with: npm run test:coverage)
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },

    /**
     * Resolve .js imports to .ts sources for the test environment.
     * Required because the source uses explicit .js extensions for ESM
     * compatibility but Vitest needs to resolve them to .ts files.
     */
    resolve: {
      extensions: ['.ts', '.js'],
    },
  },
})
