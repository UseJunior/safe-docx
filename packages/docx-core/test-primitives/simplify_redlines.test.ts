import { describe, expect } from 'vitest';
import { itAllure as it } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { simplifyRedlines } from '../src/primitives/simplify_redlines.js';

const W_NS = OOXML.W_NS;

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function countWrappers(doc: Document, localName: string): number {
  return doc.getElementsByTagNameNS(W_NS, localName).length;
}

function bodyText(doc: Document): string {
  const texts: string[] = [];
  const ts = doc.getElementsByTagNameNS(W_NS, W.t);
  for (let i = 0; i < ts.length; i++) {
    texts.push(ts.item(i)!.textContent ?? '');
  }
  return texts.join('');
}

describe('simplify_redlines', () => {
  describe('same-author merging', () => {
    it('merges two adjacent same-author w:ins wrappers', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Hello </w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>World</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(1);
      expect(countWrappers(doc, 'ins')).toBe(1);
      expect(bodyText(doc)).toBe('Hello World');
    });

    it('merges two adjacent same-author w:del wrappers', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:del w:id="1" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Old </w:t></w:r>' +
        '</w:del>' +
        '<w:del w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Text</w:t></w:r>' +
        '</w:del>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(1);
      expect(countWrappers(doc, 'del')).toBe(1);
    });

    it('merges three adjacent same-author wrappers into one', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>A</w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="3" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>C</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(2);
      expect(countWrappers(doc, 'ins')).toBe(1);
      expect(bodyText(doc)).toBe('ABC');
    });
  });

  describe('no merge across different authors', () => {
    it('does NOT merge wrappers from different authors', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Hello </w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>World</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(2);
    });
  });

  describe('no merge across different change types', () => {
    it('does NOT merge w:ins with w:del', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>New</w:t></w:r>' +
        '</w:ins>' +
        '<w:del w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Old</w:t></w:r>' +
        '</w:del>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(1);
      expect(countWrappers(doc, 'del')).toBe(1);
    });
  });

  describe('whitespace handling', () => {
    it('merges wrappers separated by whitespace text nodes', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>A</w:t></w:r>' +
        '</w:ins>' +
        '\n  ' +
        '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(1);
      expect(countWrappers(doc, 'ins')).toBe(1);
    });
  });

  describe('non-wrapper separators', () => {
    it('does NOT merge wrappers separated by a plain run', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>A</w:t></w:r>' +
        '</w:ins>' +
        '<w:r><w:t>Plain</w:t></w:r>' +
        '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(2);
    });

    it('does NOT merge wrappers separated by a bookmark', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>A</w:t></w:r>' +
        '</w:ins>' +
        '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
        '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('returns zeros for empty body', () => {
      const doc = makeDoc('');

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
    });

    it('handles document with no body element', () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"/>`;
      const doc = parseXml(xml);

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
    });

    it('handles paragraph with no tracked-change wrappers', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:t>Normal text</w:t></w:r></w:p>',
      );

      const result = simplifyRedlines(doc);

      expect(result.wrappersConsolidated).toBe(0);
    });
  });
});
