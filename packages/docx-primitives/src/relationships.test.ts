import { describe, expect } from 'vitest';
import { testAllure as test } from '../test/helpers/allure-test.js';
import { parseDocumentRels } from './relationships.js';
import { parseXml } from './xml.js';

function makeRelsXml(rels: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels +
      `</Relationships>`,
  );
}

describe('parseDocumentRels', () => {
  test('returns empty map for null document', () => {
    const result = parseDocumentRels(null);
    expect(result.size).toBe(0);
  });

  test('extracts external hyperlink relationships', () => {
    const doc = makeRelsXml(
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://other.com/path" TargetMode="External"/>`,
    );
    const result = parseDocumentRels(doc);
    expect(result.size).toBe(2);
    expect(result.get('rId1')).toBe('https://example.com');
    expect(result.get('rId2')).toBe('https://other.com/path');
  });

  test('skips internal bookmarks (no TargetMode=External)', () => {
    const doc = makeRelsXml(
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#_Toc123"/>`,
    );
    const result = parseDocumentRels(doc);
    expect(result.size).toBe(0);
  });

  test('skips non-hyperlink relationship types', () => {
    const doc = makeRelsXml(
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
    );
    const result = parseDocumentRels(doc);
    expect(result.size).toBe(0);
  });

  test('handles mixed relationship types', () => {
    const doc = makeRelsXml(
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
    );
    const result = parseDocumentRels(doc);
    expect(result.size).toBe(1);
    expect(result.get('rId2')).toBe('https://example.com');
  });
});
