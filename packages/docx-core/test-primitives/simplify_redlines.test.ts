import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { simplifyRedlines } from '../src/primitives/simplify_redlines.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Simplify Redlines' });

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
    test('merges two adjacent same-author w:ins wrappers', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('two adjacent w:ins wrappers from the same author', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Hello </w:t></w:r>' +
          '</w:ins>' +
          '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>World</w:t></w:r>' +
          '</w:ins>' +
          '</w:p>',
        );
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('one wrapper is consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(1);
      });

      await and('only one w:ins wrapper remains', async () => {
        expect(countWrappers(doc, 'ins')).toBe(1);
      });

      await and('all text is preserved', async () => {
        expect(bodyText(doc)).toBe('Hello World');
      });
    });

    test('merges two adjacent same-author w:del wrappers', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('two adjacent w:del wrappers from the same author', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:del w:id="1" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Old </w:t></w:r>' +
          '</w:del>' +
          '<w:del w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Text</w:t></w:r>' +
          '</w:del>' +
          '</w:p>',
        );
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('one wrapper is consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(1);
      });

      await and('only one w:del wrapper remains', async () => {
        expect(countWrappers(doc, 'del')).toBe(1);
      });
    });

    test('merges three adjacent same-author wrappers into one', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('three adjacent w:ins wrappers from the same author', async () => {
        doc = makeDoc(
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
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('two wrappers are consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(2);
      });

      await and('only one w:ins wrapper remains', async () => {
        expect(countWrappers(doc, 'ins')).toBe(1);
      });

      await and('all text is preserved in order', async () => {
        expect(bodyText(doc)).toBe('ABC');
      });
    });
  });

  describe('no merge across different authors', () => {
    test('does NOT merge wrappers from different authors', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('two adjacent w:ins wrappers from different authors', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Hello </w:t></w:r>' +
          '</w:ins>' +
          '<w:ins w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>World</w:t></w:r>' +
          '</w:ins>' +
          '</w:p>',
        );
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('no wrappers are consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });

      await and('both w:ins wrappers remain', async () => {
        expect(countWrappers(doc, 'ins')).toBe(2);
      });
    });
  });

  describe('no merge across different change types', () => {
    test('does NOT merge w:ins with w:del', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('adjacent w:ins and w:del wrappers from the same author', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>New</w:t></w:r>' +
          '</w:ins>' +
          '<w:del w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Old</w:t></w:r>' +
          '</w:del>' +
          '</w:p>',
        );
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('no wrappers are consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });

      await and('one w:ins and one w:del wrapper remain', async () => {
        expect(countWrappers(doc, 'ins')).toBe(1);
        expect(countWrappers(doc, 'del')).toBe(1);
      });
    });
  });

  describe('whitespace handling', () => {
    test('merges wrappers separated by whitespace text nodes', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('two same-author w:ins wrappers separated by whitespace', async () => {
        doc = makeDoc(
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
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('one wrapper is consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(1);
      });

      await and('only one w:ins wrapper remains', async () => {
        expect(countWrappers(doc, 'ins')).toBe(1);
      });
    });
  });

  describe('non-wrapper separators', () => {
    test('does NOT merge wrappers separated by a plain run', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('two same-author w:ins wrappers separated by a plain run', async () => {
        doc = makeDoc(
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
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('no wrappers are consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });

      await and('both w:ins wrappers remain', async () => {
        expect(countWrappers(doc, 'ins')).toBe(2);
      });
    });

    test('does NOT merge wrappers separated by a bookmark', async ({ given, when, then, and }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('two same-author w:ins wrappers separated by a bookmark', async () => {
        doc = makeDoc(
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
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('no wrappers are consolidated', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });

      await and('both w:ins wrappers remain', async () => {
        expect(countWrappers(doc, 'ins')).toBe(2);
      });
    });
  });

  describe('edge cases', () => {
    test('returns zeros for empty body', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('a document with an empty body', async () => {
        doc = makeDoc('');
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('wrappersConsolidated is zero', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });
    });

    test('handles document with no body element', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('a document with no body element', async () => {
        const xml =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="${W_NS}"/>`;
        doc = parseXml(xml);
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('wrappersConsolidated is zero', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });
    });

    test('handles paragraph with no tracked-change wrappers', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let result: ReturnType<typeof simplifyRedlines>;

      await given('a document with only plain text', async () => {
        doc = makeDoc(
          '<w:p><w:r><w:t>Normal text</w:t></w:r></w:p>',
        );
      });

      await when('simplifyRedlines is called', async () => {
        result = simplifyRedlines(doc);
      });

      await then('wrappersConsolidated is zero', async () => {
        expect(result.wrappersConsolidated).toBe(0);
      });
    });
  });
});
