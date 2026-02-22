import { describe, expect } from 'vitest';
import { parseXml, serializeXml, textContent } from './xml.js';
import { itAllure, allureStep, allureJsonAttachment } from '../test/helpers/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  
  tags: ['human-readable'],
  
  parameters: { audience: 'non-technical' },
  
});

describe('Traceability: docx-primitives — XML Round-Trip', () => {
  humanReadableIt.openspec('parse and serialize preserves element structure')('Scenario: parse and serialize preserves element structure', async () => {
    const input = '<root><child attr="val">hello</child><sibling/></root>';

    const result = await allureStep('When valid XML is parsed and immediately serialized', async () => {
      const doc = parseXml(input);
      const output = serializeXml(doc);
      await allureJsonAttachment('Round-trip', { input, output });
      return { doc, output };
    });

    await allureStep('Then the output SHALL contain all original elements, attributes, and text', () => {
      expect(result.output).toContain('child');
      expect(result.output).toContain('attr="val"');
      expect(result.output).toContain('hello');
      expect(result.output).toContain('sibling');
    });
  });

  humanReadableIt.openspec('namespaced XML preserved through round-trip')('Scenario: namespaced XML preserved through round-trip', async () => {
    const input = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>';

    const result = await allureStep('When the XML is parsed and serialized', async () => {
      const doc = parseXml(input);
      const output = serializeXml(doc);
      await allureJsonAttachment('Round-trip', { input, output });
      return output;
    });

    await allureStep('Then namespace prefixes and URIs SHALL be preserved', () => {
      expect(result).toContain('w:document');
      expect(result).toContain('w:body');
      expect(result).toContain('xmlns:w=');
    });
  });

  humanReadableIt.openspec('textContent returns concatenated text of nested elements')('Scenario: textContent returns concatenated text of nested elements', async () => {
    const xml = '<root><a>Hello </a><b>World</b></root>';
    const doc = parseXml(xml);

    const result = await allureStep('When textContent is called', async () => {
      const r = textContent(doc.documentElement);
      await allureJsonAttachment('Result', { xml, textContent: r });
      return r;
    });

    await allureStep('Then the result SHALL be the concatenated text content', () => {
      expect(result).toBe('Hello World');
    });
  });

  humanReadableIt.openspec('textContent returns empty string for null or undefined input')('Scenario: textContent returns empty string for null or undefined input', async () => {
    const resultNull = await allureStep('When textContent is called with null', async () => {
      return textContent(null as any);
    });

    const resultUndefined = await allureStep('When textContent is called with undefined', async () => {
      return textContent(undefined as any);
    });

    await allureStep('Then the result SHALL be an empty string', () => {
      expect(resultNull).toBe('');
      expect(resultUndefined).toBe('');
    });
  });
});
