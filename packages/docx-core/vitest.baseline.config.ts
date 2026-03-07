import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
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
    resolve(__dirname, '../docx-primitives/node_modules/allure-vitest/dist', `${kind}.js`),
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
const allureResultsDir = resolve(__dirname, 'allure-results-baseline');

if (!hasAllure) {
  // eslint-disable-next-line no-console
  console.warn('[docx-comparison:baseline] allure-vitest not found; running Vitest with default reporter only.');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/baselines/**/*.test.ts'],
    setupFiles: hasAllure ? [allureSetup!] : [],
    reporters: hasAllure
      ? [
          'default',
          [
            '@usejunior/allure-test-factory/compat-reporter',
            {
              innerReporterPath: allureReporter!,
              resultsDir: allureResultsDir,
              cleanResultsDir: true,
              packageName: 'DOCX Comparison',
              packageNameOverrides: { 'src/primitives': 'DOCX Primitives' },
            },
          ],
        ]
      : ['default'],
  },
});
