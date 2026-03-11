import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseDocumentRels } from '../src/primitives/relationships.js';
import { parseXml } from '../src/primitives/xml.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Relationships' });

function makeRelsXml(rels: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels +
      `</Relationships>`,
  );
}

describe('parseDocumentRels', () => {
  test('returns empty map for null document', async ({ given, when, then }: AllureBddContext) => {
    let result!: Map<string, string>;

    await given('no relationships document (null input)', async () => {});

    await when('parseDocumentRels is called with null', async () => {
      result = parseDocumentRels(null);
    });

    await then('the result map is empty', () => {
      expect(result.size).toBe(0);
    });
  });

  test('extracts external hyperlink relationships', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: Document;
    let result!: Map<string, string>;

    await given('a relationships document with two external hyperlinks', async () => {
      doc = makeRelsXml(
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://other.com/path" TargetMode="External"/>`,
      );
    });

    await when('parseDocumentRels is called', async () => {
      result = parseDocumentRels(doc);
    });

    await then('the map contains both hyperlink entries', () => {
      expect(result.size).toBe(2);
      expect(result.get('rId1')).toBe('https://example.com');
    });

    await and('rId2 maps to its target URL', () => {
      expect(result.get('rId2')).toBe('https://other.com/path');
    });
  });

  test('skips internal bookmarks (no TargetMode=External)', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let result!: Map<string, string>;

    await given('a relationships document with an internal bookmark hyperlink (no TargetMode)', async () => {
      doc = makeRelsXml(
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#_Toc123"/>`,
      );
    });

    await when('parseDocumentRels is called', async () => {
      result = parseDocumentRels(doc);
    });

    await then('the result map is empty because internal bookmarks are excluded', () => {
      expect(result.size).toBe(0);
    });
  });

  test('skips non-hyperlink relationship types', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let result!: Map<string, string>;

    await given('a relationships document with styles and numbering relationships (no hyperlinks)', async () => {
      doc = makeRelsXml(
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
      );
    });

    await when('parseDocumentRels is called', async () => {
      result = parseDocumentRels(doc);
    });

    await then('the result map is empty because non-hyperlink types are excluded', () => {
      expect(result.size).toBe(0);
    });
  });

  test('handles mixed relationship types', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: Document;
    let result!: Map<string, string>;

    await given('a relationships document with styles, one external hyperlink, and numbering', async () => {
      doc = makeRelsXml(
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
          `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
      );
    });

    await when('parseDocumentRels is called', async () => {
      result = parseDocumentRels(doc);
    });

    await then('only the external hyperlink is returned', () => {
      expect(result.size).toBe(1);
    });

    await and('rId2 maps to its target URL', () => {
      expect(result.get('rId2')).toBe('https://example.com');
    });
  });
});
