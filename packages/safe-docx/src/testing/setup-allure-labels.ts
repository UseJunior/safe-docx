/**
 * Global Allure label setup for safe-docx-ts.
 *
 * Sets package-level parentSuite and epic so the Allure report groups tests
 * under "Safe DOCX MCP Server" instead of the flat "test" directory name.
 *
 * Tests using `itAllure`/`testAllure` override these defaults in their test
 * body — the wrapWithAllure() call runs AFTER beforeEach, so its values win.
 */
import { beforeEach, expect } from 'vitest';

declare const allure: any;

const PACKAGE_NAME = 'Safe DOCX MCP Server';

beforeEach(async () => {
  if (typeof allure === 'undefined') return;

  const state = expect.getState() as { currentTestName?: string };
  const parts = (state.currentTestName ?? '')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);

  // Top-level grouping in Suites view
  await allure.parentSuite(PACKAGE_NAME);

  // First describe block → suite
  if (parts.length > 1) {
    await allure.suite(parts[0]);
  }

  // Second describe block → subSuite
  if (parts.length > 2 && typeof allure.subSuite === 'function') {
    await allure.subSuite(parts[1]);
  }

  // Behaviors view: epic + feature
  await allure.epic(PACKAGE_NAME);
  if (parts.length > 0) {
    await allure.feature(parts[0]);
  }
});
