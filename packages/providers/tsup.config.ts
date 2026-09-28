import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/openai-compatible.ts',
    'src/anthropic.ts',
    'src/gemini.ts',
    'src/ai-sdk.ts',
    'src/mock.ts',
    'src/remote.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: ['@anthropic-ai/sdk', 'ai'],
});
