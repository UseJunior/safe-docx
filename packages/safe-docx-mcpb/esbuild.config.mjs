import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node18',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  // Bundle everything — workspace deps, transitive deps — into one file.
  // Only leave out Node built-ins.
  external: [],
  minify: false,
  sourcemap: false,
});

console.log('✅ Bundled dist/index.js');
