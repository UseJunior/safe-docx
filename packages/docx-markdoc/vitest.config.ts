import { defineConfig } from 'vitest/config';

// Test discovery and timeouts stay on vitest defaults; this file only scopes
// coverage so `npm run test:coverage` reports on this package's sources.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
