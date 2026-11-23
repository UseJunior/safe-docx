import { copyFile, mkdir, rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
const output = path('../_site/');
await rm(output, { recursive: true, force: true });
const demo = path('../_site/labs/docx-compare/');
await mkdir(demo, { recursive: true });
await Promise.all(['index.html', 'demo.css', 'demo.js'].map(file =>
  copyFile(path(file), demo + file),
));

const builtins = new Set(builtinModules);
await build({
  entryPoints: [path('worker.js')],
  outfile: demo + 'worker.js',
  nodePaths: [path('../node_modules/')],
  alias: {
    '@usejunior/docx-core': path('../../packages/docx-core/src/index.ts'),
    '@usejunior/docx-compare': path('../../packages/docx-compare/src/index.ts'),
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: true,
  plugins: [{
    name: 'forbid-node-builtins',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => {
        if (path.startsWith('node:') || builtins.has(path)) {
          return { errors: [{ text: 'Node built-in in browser bundle: ' + path }] };
        }
      });
    },
  }],
});
