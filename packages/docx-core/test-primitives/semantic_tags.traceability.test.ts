import { describe, expect } from 'vitest';
import {
  stripHighlightTags,
} from '../src/primitives/semantic_tags.js';
import { itAllure, allureStep } from './helpers/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

describe('Traceability: docx-primitives — Semantic Tags', () => {
  humanReadableIt.openspec('strip highlight tags leaves content intact')('Scenario: strip highlight tags leaves content intact', async () => {
    const result = await allureStep('When highlight tags are stripped from tagged text', async () => {
      const text = 'Some <highlight>important</highlight> text';
      return stripHighlightTags(text);
    });

    await allureStep('Then the content is preserved without tags', () => {
      expect(result).toBe('Some important text');
      expect(result).not.toContain('<highlight>');
    });
  });

  humanReadableIt('Scenario: strip legacy highlighting tags leaves content intact', async () => {
    const result = await allureStep('When legacy highlighting tags are stripped', async () => {
      const text = 'Some <highlighting>important</highlighting> text';
      return stripHighlightTags(text);
    });

    await allureStep('Then the content is preserved without tags', () => {
      expect(result).toBe('Some important text');
      expect(result).not.toContain('<highlighting>');
    });
  });
});
