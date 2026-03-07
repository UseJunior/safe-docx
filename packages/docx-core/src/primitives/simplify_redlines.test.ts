import { describe, expect } from 'vitest';
import { itAllure, allureStep, allureJsonAttachment } from './testing/allure-test.js';

const it = itAllure;
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { simplifyRedlines } from './simplify_redlines.js';

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

const TEST_FEATURE = 'add-auto-normalization-on-open';

const humanReadableIt = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE }).allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

describe('Traceability: Auto-Normalization on Open — Redline Simplification', () => {
  humanReadableIt.openspec('merge adjacent same-author same-type tracked-change wrappers')('Scenario: merge adjacent same-author same-type tracked-change wrappers', async () => {
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

    const result = await allureStep('When simplify_redlines is called on adjacent same-author w:ins wrappers', async () => {
      const r = simplifyRedlines(doc);
      await allureJsonAttachment('simplify_redlines result', r);
      return r;
    });

    await allureStep('Then the adjacent wrappers SHALL be consolidated into a single wrapper', () => {
      expect(result.wrappersConsolidated).toBeGreaterThanOrEqual(1);
      expect(countWrappers(doc, 'ins')).toBe(1);
    });

    await allureStep('And the merged wrapper SHALL preserve all child content', () => {
      expect(bodyText(doc)).toBe('Hello World');
    });
  });

  humanReadableIt.openspec('never merge wrappers from different authors')('Scenario: never merge wrappers from different authors', async () => {
    const doc = makeDoc(
      '<w:p>' +
      '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
      '<w:r><w:t>Alice text</w:t></w:r>' +
      '</w:ins>' +
      '<w:ins w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
      '<w:r><w:t>Bob text</w:t></w:r>' +
      '</w:ins>' +
      '</w:p>',
    );

    const result = await allureStep('When simplify_redlines is called on adjacent different-author wrappers', async () => {
      const r = simplifyRedlines(doc);
      await allureJsonAttachment('simplify_redlines result', r);
      return r;
    });

    await allureStep('Then the wrappers SHALL NOT be merged', () => {
      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(2);
    });

    await allureStep('And author attribution SHALL be preserved', () => {
      const wrappers = doc.getElementsByTagNameNS(W_NS, 'ins');
      const authors = new Set<string>();
      for (let i = 0; i < wrappers.length; i++) {
        authors.add(wrappers.item(i)!.getAttribute('w:author') ?? '');
      }
      expect(authors).toEqual(new Set(['Alice', 'Bob']));
    });
  });

  humanReadableIt.openspec('never merge across different change types')('Scenario: never merge across different change types', async () => {
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

    const result = await allureStep('When simplify_redlines is called on adjacent w:ins + w:del from same author', async () => {
      const r = simplifyRedlines(doc);
      await allureJsonAttachment('simplify_redlines result', r);
      return r;
    });

    await allureStep('Then the wrappers SHALL NOT be merged', () => {
      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(1);
      expect(countWrappers(doc, 'del')).toBe(1);
    });
  });
});
