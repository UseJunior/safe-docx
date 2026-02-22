import { describe, expect } from 'vitest';
import {
  emitDefinitionTagsFromString,
  stripDefinitionTags,
  stripHighlightTags,
} from './semantic_tags.js';
import { itAllure, allureStep, allureJsonAttachment } from '../test/helpers/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  
  tags: ['human-readable'],
  
  parameters: { audience: 'non-technical' },
  
});

describe('Traceability: docx-primitives — Semantic Tags', () => {
  humanReadableIt.openspec('emit definition tags for quoted term before definition verb')('Scenario: emit definition tags for quoted term before definition verb', async () => {
    const text = '"Company" means the entity described herein';

    const result = await allureStep('When emitDefinitionTagsFromString is called', async () => {
      const r = emitDefinitionTagsFromString(text);
      await allureJsonAttachment('Result', { input: text, output: r });
      return r;
    });

    await allureStep('Then the term SHALL be wrapped in definition tags', () => {
      expect(result).toContain('<definition>');
      expect(result).toContain('</definition>');
      expect(result).toContain('Company');
    });
  });

  humanReadableIt.openspec('emit definition tags for smart/curly quotes')('Scenario: emit definition tags for smart/curly quotes', async () => {
    const text = '\u201CCompany\u201D means the entity described herein';

    const result = await allureStep('When emitDefinitionTagsFromString is called', async () => {
      const r = emitDefinitionTagsFromString(text);
      await allureJsonAttachment('Result', { input: text, output: r });
      return r;
    });

    await allureStep('Then the term SHALL be wrapped in definition tags with curly quotes removed', () => {
      expect(result).toContain('<definition>');
      expect(result).toContain('Company');
    });
  });

  humanReadableIt.openspec('no tags emitted for text without definitions')('Scenario: no tags emitted for text without definitions', async () => {
    const text = 'This is a normal sentence without any definitions.';

    const result = await allureStep('When emitDefinitionTagsFromString is called', async () => {
      const r = emitDefinitionTagsFromString(text);
      await allureJsonAttachment('Result', { input: text, output: r });
      return r;
    });

    await allureStep('Then the text SHALL be returned unchanged', () => {
      expect(result).toBe(text);
    });
  });

  humanReadableIt.openspec('strip definition tags replaces with quotes')('Scenario: strip definition tags replaces with quotes', async () => {
    const text = 'The <definition>Company</definition> is defined herein';

    const result = await allureStep('When stripDefinitionTags is called', async () => {
      const r = stripDefinitionTags(text);
      await allureJsonAttachment('Result', { input: text, output: r });
      return r;
    });

    await allureStep('Then the tag SHALL be replaced with quoted term', () => {
      expect(result).toContain('"Company"');
      expect(result).not.toContain('<definition>');
    });
  });

  humanReadableIt.openspec('strip highlight tags leaves content intact')('Scenario: strip highlight tags leaves content intact', async () => {
    const text = 'Some <highlighting>important</highlighting> text';

    const result = await allureStep('When stripHighlightTags is called', async () => {
      const r = stripHighlightTags(text);
      await allureJsonAttachment('Result', { input: text, output: r });
      return r;
    });

    await allureStep('Then the tag wrappers SHALL be removed and content preserved', () => {
      expect(result).toBe('Some important text');
      expect(result).not.toContain('<highlighting>');
    });
  });
});
