import { beforeEach, expect } from 'vitest';

declare const allure: any;

const PACKAGE_NAME = 'Safe DOCX MCP Bundle';

beforeEach(async () => {
  if (typeof allure === 'undefined') return;

  const state = expect.getState() as { currentTestName?: string };
  const parts = (state.currentTestName ?? '')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);

  await allure.parentSuite(PACKAGE_NAME);

  if (parts.length > 1) {
    await allure.suite(parts[0]);
  }

  if (parts.length > 2 && typeof allure.subSuite === 'function') {
    await allure.subSuite(parts[1]);
  }

  await allure.epic(PACKAGE_NAME);
  if (parts.length > 0) {
    await allure.feature(parts[0]);
  }
});
