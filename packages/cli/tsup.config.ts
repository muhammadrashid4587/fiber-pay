import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  outDir: 'dist',
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
