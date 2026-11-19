import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { getFirstChild } from './xml-helpers.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'XML Child Lookup' });
const NS = 'urn:safe-docx:child-lookup';

describe('direct XML child lookup', () => {
  test('direct-child identity and namespace take precedence over matching descendants', async ({ given, when, then }: AllureBddContext) => {
    let document!: Document;
    let direct!: Element | null;
    let nested!: Element | null;
    await given('a foreign namespace match, comments, text, a nested match and a direct match', () => {
      document = parseXml(`<root xmlns="${NS}" xmlns:other="urn:other"> text <!-- ignored --> <other:target/><container><target id="nested"/><nested-only/></container><target id="direct"/></root>`);
    });
    await when('children are selected by expanded name', () => {
      direct = getFirstChild(document.documentElement!, NS, 'target');
      nested = getFirstChild(document.documentElement!, NS, 'nested-only');
    });
    await then('the matching direct child is returned and nested-only content is excluded', () => {
      expect(direct?.getAttribute('id')).toBe('direct');
      expect(nested).toBeNull();
      expect(getFirstChild(document.documentElement!, 'urn:other', 'target')?.namespaceURI).toBe('urn:other');
      expect(getFirstChild(document.documentElement!, 'urn:missing', 'target')).toBeNull();
    });
  });

  test('Document queries inspect root children and tolerate a Document with no root', async ({ given, when, then }: AllureBddContext) => {
    let document!: Document;
    let empty!: Document;
    let child!: Element | null;
    await given('a rooted document and an empty DOM document', () => {
      document = parseXml(`<root xmlns="${NS}"><body/></root>`);
      empty = parseXml('<temporary/>');
      empty.removeChild(empty.documentElement!);
    });
    await when('the Document itself is passed as the container', () => {
      child = getFirstChild(document, NS, 'body');
    });
    await then('the root is unwrapped once, without treating the root as its own child', () => {
      expect(child).toBe(document.documentElement!.firstChild);
      expect(getFirstChild(document, NS, 'root')).toBeNull();
      expect(getFirstChild(empty, NS, 'body')).toBeNull();
    });
  });
});
