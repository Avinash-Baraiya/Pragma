import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', '@tanstack/react-table', '@tanstack/table-core'],
};

export default defineConfig([
  { ...shared, entry: ['src/index.ts'], clean: true },
  // The React hook is client-only; mark it for React Server Component frameworks.
  // Rollup tree-shaking would strip the banner, so this entry uses esbuild's alone.
  { ...shared, entry: ['src/react.ts'], treeshake: false, banner: { js: "'use client';" } },
]);
