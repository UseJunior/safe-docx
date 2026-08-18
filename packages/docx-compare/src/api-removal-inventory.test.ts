import { describe, expect } from 'vitest';
import * as publicApi from './index.js';
import { testAllure } from './testing/allure-test.js';

const TEST_FEATURE = 'Refactor Tagged Tree Spine';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Public API Inventory' });

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
