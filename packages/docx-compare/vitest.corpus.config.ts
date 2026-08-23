import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

const base = baseConfig as ReturnType<typeof defineConfig>;

/**
 * Required real-corpus suites live outside the default workspace run so an
 * absent corpus can never be reported as a skipped passing test. This config
 * has one registered command and at least one included suite fails when its
 * required environment/corpus is absent.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    maxWorkers: 1,
    include: [
      'src/integration/real-corpus-paragraph-deletion.test.ts',
      'src/integration/strategy-differential-manifest.corpus.test.ts',
      'src/integration/taggedTreeMinimality.corpus.test.ts',
    ],
    exclude: [],
  },
});
