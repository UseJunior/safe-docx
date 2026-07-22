import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import {
  parseDocumentRels,
  parseHyperlinkRelTargets,
  parseHyperlinkRelEntries,
  listRelationshipIds,
} from './relationships.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Relationships Parsing' });

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function relsDoc(inner: string): Document {
  return parseXml(`<Relationships xmlns="${REL_NS}">${inner}</Relationships>`);
}

describe('document.xml.rels parsing (issue #376 helpers)', () => {
  const doc = relsDoc(
    `<Relationship Id="rId1" Type="${HYPERLINK}" Target="https://ext.example.com" TargetMode="External"/>` +
    `<Relationship Id="rId2" Type="${HYPERLINK}" Target="#anchor-part"/>` +
    `<Relationship Id="rId3" Type="${IMAGE}" Target="media/image1.png"/>`,
  );

  test('parseDocumentRels keeps only external hyperlinks', () => {
    const map = parseDocumentRels(doc);
    expect(map.get('rId1')).toBe('https://ext.example.com');
    expect(map.has('rId2')).toBe(false); // internal hyperlink excluded
    expect(map.has('rId3')).toBe(false); // image excluded
  });

  test('parseHyperlinkRelTargets covers external AND internal hyperlinks, folding in the mode', () => {
    const map = parseHyperlinkRelTargets(doc);
    expect(map.get('rId1')).toBe('External:https://ext.example.com');
    expect(map.get('rId2')).toBe('Internal:#anchor-part');
    expect(map.has('rId3')).toBe(false); // non-hyperlink excluded
  });

  test('parseHyperlinkRelEntries preserves target + external flag', () => {
    const map = parseHyperlinkRelEntries(doc);
    expect(map.get('rId1')).toEqual({ target: 'https://ext.example.com', external: true });
    expect(map.get('rId2')).toEqual({ target: '#anchor-part', external: false });
    expect(map.has('rId3')).toBe(false);
  });

  test('listRelationshipIds returns every id regardless of type', () => {
    expect([...listRelationshipIds(doc)].sort()).toEqual(['rId1', 'rId2', 'rId3']);
  });

  test('all parsers return empty for a null rels document', () => {
    expect(parseDocumentRels(null).size).toBe(0);
    expect(parseHyperlinkRelTargets(null).size).toBe(0);
    expect(parseHyperlinkRelEntries(null).size).toBe(0);
    expect(listRelationshipIds(null).size).toBe(0);
  });

  test('namespace-prefixed Relationship elements are still parsed (not just default-namespace)', () => {
    // Valid OPC packages may serialize the rels part with a prefix; a plain
    // getElementsByTagName('Relationship') would miss these and silently drop
    // every relationship (regressing #376 to unresolved raw r:id).
    const prefixed = parseXml(
      `<pr:Relationships xmlns:pr="${REL_NS}">` +
      `<pr:Relationship Id="rId7" Type="${HYPERLINK}" Target="https://alpha.example.com" TargetMode="External"/>` +
      `</pr:Relationships>`,
    );
    expect(parseHyperlinkRelTargets(prefixed).get('rId7')).toBe('External:https://alpha.example.com');
    expect(parseHyperlinkRelEntries(prefixed).get('rId7')).toEqual({
      target: 'https://alpha.example.com',
      external: true,
    });
    expect([...listRelationshipIds(prefixed)]).toEqual(['rId7']);
    expect(parseDocumentRels(prefixed).get('rId7')).toBe('https://alpha.example.com');
  });
});
