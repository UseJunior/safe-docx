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
const allureResultsDir = resolve(__dirname, 'allure-results');

if (!hasAllure) {
  // eslint-disable-next-line no-console
  console.warn('[docx-comparison] allure-vitest not found; running Vitest with default reporter only.');
}

export default defineConfig({
  resolve: {
    alias: {
      '@usejunior/docx-core': resolve(__dirname, 'src/index.ts'),
      '@usejunior/docx-compare': resolve(__dirname, '../docx-compare/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test-primitives/**/*.test.ts'],
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
        'src/testing/**',
        'src/benchmark/**',
        // Local-only LibreOffice accept/reject oracle driver: its core (driving headless
        // LibreOffice via an injected macro) cannot run in CI, which installs no LibreOffice, so it
        // would otherwise sink package coverage. The gated voter exercises it locally; see
        // local-only LibreOffice oracle integration tests.
        'src/integration/libreoffice-oracle.ts',
      ],
    },
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
              packageNameOverrides: { 'test-primitives': 'DOCX Primitives' },
            },
          ],
        ]
      : ['default'],
  },
});
