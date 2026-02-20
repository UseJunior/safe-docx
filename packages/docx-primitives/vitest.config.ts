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
    resolve(__dirname, '../safe-docx/node_modules/allure-vitest/dist', `${kind}.js`),
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
const allureCompatReporterPath = resolve(__dirname, 'test/reporters/allureVitestCompatReporter.ts');
const allureLabelsSetup = resolve(__dirname, 'test/setup-allure-labels.ts');

if (!hasAllure) {
  // eslint-disable-next-line no-console
  console.warn('[docx-primitives-ts] allure-vitest not found; running Vitest with default reporter only.');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
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
      ],
    },
    setupFiles: hasAllure ? [allureSetup!, allureLabelsSetup] : [],
    reporters: hasAllure
      ? [
          'default',
          [
            allureCompatReporterPath,
            {
              innerReporterPath: allureReporter!,
              resultsDir: allureResultsDir,
              packageName: 'DOCX Primitives',
            },
          ],
        ]
      : ['default'],
  },
});
