import { defineConfig } from 'vitest/config';

const sourceCondition = ['@pragma/source'];

export default defineConfig({
  define: { __PRAGMA_VERSION__: JSON.stringify('0.0.0-test') },
  resolve: { conditions: sourceCondition },
  ssr: { resolve: { conditions: sourceCondition, externalConditions: sourceCondition } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'benchmarks/src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['packages/*/src/**/*.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', 'packages/conformance/**', '**/testing/**'],
      thresholds: {
        'packages/core/src/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
        'packages/interpreter/src/**': { lines: 95, functions: 95, branches: 88, statements: 95 },
      },
    },
  },
});
