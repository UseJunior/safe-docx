import { beforeEach, expect } from 'vitest';

declare const allure: { epic: (name: string) => void | Promise<void>; feature: (name: string) => void | Promise<void>; parentSuite: (name: string) => void | Promise<void>; suite: (name: string) => void | Promise<void>; subSuite: (name: string) => void | Promise<void>; severity: (level: string) => void | Promise<void>; story: (name: string) => void | Promise<void>; id: (id: string) => void | Promise<void>; allureId: (id: string) => void | Promise<void>; displayName: (value: string) => void | Promise<void>; label: (name: string, value: string) => void | Promise<void>; description: (value: string) => void | Promise<void>; tags: (...values: string[]) => void | Promise<void>; tag: (value: string) => void | Promise<void>; test: (value: unknown) => void | Promise<void>; step: <T>(name: string, body: (...args: unknown[]) => T | Promise<T>) => Promise<T>; parameter: (name: string, value: string) => void | Promise<void>; attachment: (name: string, content: string | Uint8Array, contentType?: string) => void | Promise<void>; };

const PACKAGE_NAME = 'Safe DOCX MCP Bundle';

beforeEach(async () => {
  if (typeof allure === 'undefined') return;

  const state = expect.getState() as { currentTestName?: string };
  const parts = (state.currentTestName ?? '')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);

  await allure.parentSuite(PACKAGE_NAME);

  const suiteName = parts[0];
  if (parts.length > 1 && suiteName) {
    await allure.suite(suiteName);
  }

  const subSuiteName = parts[1];
  if (parts.length > 2 && subSuiteName) {
    await allure.subSuite(subSuiteName);
  }

  await allure.epic(PACKAGE_NAME);
  const featureName = parts[0];
  if (featureName) {
    await allure.feature(featureName);
  }
});
