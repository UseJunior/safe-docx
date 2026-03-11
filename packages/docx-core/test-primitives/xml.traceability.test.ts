import { describe, expect } from 'vitest';
import { parseXml, serializeXml, textContent } from '../src/primitives/xml.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'XML Parsing' });

describe('Traceability: docx-primitives — XML Round-Trip', () => {
  test.openspec('parse and serialize preserves element structure')('Scenario: parse and serialize preserves element structure', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const input = '<root><child attr="val">hello</child><sibling/></root>';
    let result!: { doc: ReturnType<typeof parseXml>; output: string };

    await when('valid XML is parsed and immediately serialized', async () => {
      const doc = parseXml(input);
      const output = serializeXml(doc);
      await attachPrettyJson('Round-trip', { input, output });
      result = { doc, output };
    });

    await then('the output SHALL contain all original elements, attributes, and text', () => {
      expect(result.output).toContain('child');
      expect(result.output).toContain('attr="val"');
      expect(result.output).toContain('hello');
      expect(result.output).toContain('sibling');
    });
  });

  test.openspec('namespaced XML preserved through round-trip')('Scenario: namespaced XML preserved through round-trip', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const input = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>';
    let result!: string;

    await when('the XML is parsed and serialized', async () => {
      const doc = parseXml(input);
      result = serializeXml(doc);
      await attachPrettyJson('Round-trip', { input, output: result });
    });

    await then('namespace prefixes and URIs SHALL be preserved', () => {
      expect(result).toContain('w:document');
      expect(result).toContain('w:body');
      expect(result).toContain('xmlns:w=');
    });
  });

  test.openspec('textContent returns concatenated text of nested elements')('Scenario: textContent returns concatenated text of nested elements', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const xml = '<root><a>Hello </a><b>World</b></root>';
    const doc = parseXml(xml);
    let result!: string;

    await when('textContent is called', async () => {
      result = textContent(doc.documentElement);
      await attachPrettyJson('Result', { xml, textContent: result });
    });

    await then('the result SHALL be the concatenated text content', () => {
      expect(result).toBe('Hello World');
    });
  });

  test.openspec('textContent returns empty string for null or undefined input')('Scenario: textContent returns empty string for null or undefined input', async ({ when, then }: AllureBddContext) => {
    let resultNull!: string;
    let resultUndefined!: string;

    await when('textContent is called with null', async () => {
      resultNull = textContent(null);
    });

    await when('textContent is called with undefined', async () => {
      resultUndefined = textContent(undefined);
    });

    await then('the result SHALL be an empty string', () => {
      expect(resultNull).toBe('');
      expect(resultUndefined).toBe('');
    });
  });
});
