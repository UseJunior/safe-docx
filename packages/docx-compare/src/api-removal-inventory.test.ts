import { describe, expect } from 'vitest';
import * as publicApi from './index.js';
import { testAllure } from './testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'refactor-tagged-tree-spine', story: 'Public API Inventory' });

describe('public API removal inventory', () => {
  test.openspec('Legacy move generators are absent')(
    'does not export the superseded atom-era move markup entry points',
    () => {
      expect(publicApi).not.toHaveProperty('generateMoveSourceMarkup');
      expect(publicApi).not.toHaveProperty('generateMoveDestinationMarkup');
      expect(publicApi).not.toHaveProperty('allocateMoveIds');
    },
  );
});
