import { defineConfig, type Options } from 'tsup';

// Thin re-exports: every @avinash-baraiya/pragma-* package stays external.
const shared: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  target: 'es2022',
  external: [/^@avinash-baraiya\//, 'react', '@tanstack/react-table'],
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    entry: {
      index: 'src/index.ts',
      tanstack: 'src/tanstack.ts',
      server: 'src/server.ts',
      'providers/openai-compatible': 'src/providers/openai-compatible.ts',
      'providers/anthropic': 'src/providers/anthropic.ts',
      'providers/gemini': 'src/providers/gemini.ts',
      'providers/ai-sdk': 'src/providers/ai-sdk.ts',
      'providers/mock': 'src/providers/mock.ts',
      'providers/remote': 'src/providers/remote.ts',
    },
  },
  // Client-only entries keep the 'use client' directive (tree-shaking would strip it).
  {
    ...shared,
    treeshake: false,
    banner: { js: "'use client';" },
    entry: { react: 'src/react.ts', 'tanstack-react': 'src/tanstack-react.ts' },
  },
]);
