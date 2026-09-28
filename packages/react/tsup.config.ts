import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Rollup tree-shaking would strip the 'use client' banner; esbuild still drops dead code.
  treeshake: false,
  target: 'es2022',
  external: ['react', 'react/jsx-runtime'],
  // Client components: lets React Server Component frameworks (Next.js App Router) import them.
  banner: { js: "'use client';" },
});
