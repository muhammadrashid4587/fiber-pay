import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist',
    shims: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist',
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
