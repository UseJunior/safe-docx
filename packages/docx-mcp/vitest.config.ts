import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

function resolveAllureEntry(kind: 'setup' | 'reporter'): string | null {
  try {
    return require.resolve(`allure-vitest/${kind}`);
  } catch {
    // Fall through to workspace-level fallback paths.
  }

  const fallbackCandidates = [
    resolve(__dirname, '../docx-comparison/node_modules/allure-vitest/dist', `${kind}.js`),
    resolve(__dirname, '../../frontend/node_modules/allure-vitest/dist', `${kind}.js`),
  ];

  for (const candidate of fallbackCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

const allureSetup = resolveAllureEntry('setup');
const allureReporter = resolveAllureEntry('reporter');
const hasAllure = Boolean(allureSetup && allureReporter);
const allureResultsDir = resolve(__dirname, 'allure-results');
const allureCompatReporter = resolve(__dirname, 'src/testing/reporters/allureVitestCompatReporter.ts');
const pathRootsSetup = resolve(__dirname, 'src/testing/setup-path-roots.ts');

if (!hasAllure) {
  // Keep tests runnable even in offline/dev shells where allure-vitest isn't installed locally.
  // Reporter is enabled automatically when dependency is available.
  // eslint-disable-next-line no-console
  console.warn('[safe-docx-ts] allure-vitest not found; running Vitest with default reporter only.');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'html', 'json-summary'],
      exclude: [
        'node_modules',
        'dist',
        'src/**/*.test.ts',
        'src/**/*.allure.test.ts',
        // Keep runtime coverage focused on MCP/session code paths.
        'src/testing/**',
        'src/conformance/**',
      ],
    },
    setupFiles: hasAllure ? [pathRootsSetup, allureSetup!] : [pathRootsSetup],
    reporters: hasAllure
      ? [
          'default',
          [
            allureCompatReporter,
            {
              innerReporterPath: allureReporter!,
              resultsDir: allureResultsDir,
              cleanResultsDir: true,
              packageName: 'Safe DOCX MCP Server',
            },
          ],
        ]
      : ['default'],
  },
});
