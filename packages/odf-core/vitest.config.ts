import { defineConfig } from 'vitest/config';
import { randomUUID } from 'node:crypto';

// One id per test invocation, inherited by every worker: LibreOffice-backed suites share a
// single launchability probe per run instead of one per worker (issue #1037).
process.env.SAFE_DOCX_SOFFICE_RUN_ID ??= randomUUID();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
