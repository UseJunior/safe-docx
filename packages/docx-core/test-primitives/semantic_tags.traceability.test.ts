import { describe, expect } from 'vitest';
import {
  stripHighlightTags,
} from '../src/primitives/semantic_tags.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Semantic Tags' });

describe('Traceability: docx-primitives — Semantic Tags', () => {
  test.openspec('strip highlight tags leaves content intact')('Scenario: strip highlight tags leaves content intact', async ({ when, then }: AllureBddContext) => {
    let result!: string;

    await when('highlight tags are stripped from tagged text', async () => {
      const text = 'Some <highlight>important</highlight> text';
      result = stripHighlightTags(text);
    });

    await then('the content is preserved without tags', () => {
      expect(result).toBe('Some important text');
      expect(result).not.toContain('<highlight>');
    });
  });

  test('Scenario: strip legacy highlighting tags leaves content intact', async ({ when, then }: AllureBddContext) => {
    let result!: string;

    await when('legacy highlighting tags are stripped', async () => {
      const text = 'Some <highlighting>important</highlighting> text';
      result = stripHighlightTags(text);
    });

    await then('the content is preserved without tags', () => {
      expect(result).toBe('Some important text');
      expect(result).not.toContain('<highlighting>');
    });
  });
});
