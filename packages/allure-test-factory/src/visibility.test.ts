import { afterEach, beforeEach, describe, expect } from 'vitest';
import { createAllureTestHelpers, type AllureRuntime } from './index.js';

type Label = {
  name: string;
  value: string;
};

const emittedLabels: Label[] = [];

function createRuntime(): AllureRuntime {
  return {
    epic: () => undefined,
    feature: () => undefined,
    parentSuite: () => undefined,
    suite: () => undefined,
    severity: () => undefined,
    story: () => undefined,
    label: (name, value) => {
      emittedLabels.push({ name, value });
    },
    step: async (_name, body) => body(),
  };
}

const { testAllure } = createAllureTestHelpers({
  defaultEpic: 'Test Infrastructure',
});

describe('corpus visibility labels', () => {
  beforeEach(() => {
    emittedLabels.length = 0;
    globalThis.allure = createRuntime();
  });

  afterEach(() => {
    delete globalThis.allure;
  });

  testAllure.withLabels({ feature: 'Corpus Visibility', visibility: 'public' })(
    'emits corpusVisibility when visibility is public',
    () => {
      expect(emittedLabels).toContainEqual({ name: 'corpusVisibility', value: 'public' });
    },
  );

  testAllure.withLabels({ feature: 'Corpus Visibility', visibility: 'internal' })(
    'omits corpusVisibility when visibility is internal',
    () => {
      expect(emittedLabels.some((label) => label.name === 'corpusVisibility')).toBe(false);
    },
  );

  testAllure.withLabels({ feature: 'Corpus Visibility' })(
    'omits corpusVisibility when visibility is omitted',
    () => {
      expect(emittedLabels.some((label) => label.name === 'corpusVisibility')).toBe(false);
    },
  );
});
