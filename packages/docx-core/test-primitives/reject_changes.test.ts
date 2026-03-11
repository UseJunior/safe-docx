import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { rejectChanges } from '../src/primitives/reject_changes.js';
import { getParagraphText } from '../src/primitives/text.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Reject Changes' });

const W_NS = OOXML.W_NS;

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function getAllParagraphTexts(doc: Document): string[] {
  const paras = doc.getElementsByTagNameNS(W_NS, 'p');
  const texts: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    texts.push(getParagraphText(paras[i]!));
  }
  return texts;
}

describe('rejectChanges', () => {
  test('should return zero stats for a document with no tracked changes', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with no tracked changes', async () => {
      doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('all stats are zero and text is unchanged', async () => {
      expect(result.insertionsRemoved).toBe(0);
      expect(result.deletionsRestored).toBe(0);
      expect(result.movesReverted).toBe(0);
      expect(result.propertyChangesReverted).toBe(0);
      expect(getAllParagraphTexts(doc)).toEqual(['Hello']);
    });
  });

  test('should remove inserted content', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with original text and an insertion', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Original</w:t></w:r>' +
          '<w:ins w:author="Author" w:date="2024-01-01T00:00:00Z">' +
            '<w:r><w:t> added</w:t></w:r>' +
          '</w:ins>' +
        '</w:p>',
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('inserted content is removed', async () => {
      expect(result.insertionsRemoved).toBe(1);
      expect(getAllParagraphTexts(doc)).toEqual(['Original']);
    });
  });

  test('should restore deleted text (w:delText -> w:t conversion)', async ({ given, when, then, and }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with kept text and a deletion', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Keep</w:t></w:r>' +
          '<w:del w:author="Author" w:date="2024-01-01T00:00:00Z">' +
            '<w:r><w:delText> deleted</w:delText></w:r>' +
          '</w:del>' +
        '</w:p>',
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('deleted text is restored', async () => {
      expect(result.deletionsRestored).toBe(1);
      expect(getAllParagraphTexts(doc)).toEqual(['Keep deleted']);
    });

    await and('w:delText was renamed to w:t', async () => {
      const delTexts = doc.getElementsByTagNameNS(W_NS, 'delText');
      expect(delTexts.length).toBe(0);
    });
  });

  test('should unwrap moveFrom and remove moveTo content', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with moveFrom and moveTo paragraphs', async () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:moveFrom w:author="Author">' +
            '<w:r><w:t>moved text</w:t></w:r>' +
          '</w:moveFrom>' +
        '</w:p>' +
        '<w:p>' +
          '<w:moveTo w:author="Author">' +
            '<w:r><w:t>moved text</w:t></w:r>' +
          '</w:moveTo>' +
        '</w:p>',
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('moves are reverted and text stays at original position', async () => {
      expect(result.movesReverted).toBeGreaterThanOrEqual(1);
      // The first paragraph should keep the text at original position
      const texts = getAllParagraphTexts(doc);
      expect(texts[0]).toBe('moved text');
    });
  });

  test('should restore original properties from rPrChange', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with rPrChange from italic to bold', async () => {
      doc = makeDoc(
        '<w:p><w:r>' +
          '<w:rPr>' +
            '<w:b/>' +
            '<w:rPrChange w:author="Author">' +
              '<w:rPr><w:i/></w:rPr>' +
            '</w:rPrChange>' +
          '</w:rPr>' +
          '<w:t>Formatted</w:t>' +
        '</w:r></w:p>',
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('original italic property is restored and bold removed', async () => {
      expect(result.propertyChangesReverted).toBe(1);
      // After reject, the rPr should contain the original (italic), not current (bold)
      const run = doc.getElementsByTagNameNS(W_NS, 'r')[0]!;
      const rPr = run.getElementsByTagNameNS(W_NS, 'rPr')[0]!;
      expect(rPr.getElementsByTagNameNS(W_NS, 'i').length).toBe(1);
      expect(rPr.getElementsByTagNameNS(W_NS, 'b').length).toBe(0);
    });
  });

  test('should remove parent property element when rPrChange has empty original', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with rPrChange containing empty original rPr', async () => {
      doc = makeDoc(
        '<w:p><w:r>' +
          '<w:rPr>' +
            '<w:b/>' +
            '<w:rPrChange w:author="Author">' +
              '<w:rPr/>' +
            '</w:rPrChange>' +
          '</w:rPr>' +
          '<w:t>Formatted</w:t>' +
        '</w:r></w:p>',
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('rPr is restored to empty and bold is removed', async () => {
      expect(result.propertyChangesReverted).toBe(1);
      // After reject with empty original, rPr should be replaced with the empty clone
      const run = doc.getElementsByTagNameNS(W_NS, 'r')[0]!;
      const rPr = run.getElementsByTagNameNS(W_NS, 'rPr')[0];
      // The rPr should exist but be empty (restored from the empty <w:rPr/> inside rPrChange)
      expect(rPr).toBeDefined();
      expect(rPr!.getElementsByTagNameNS(W_NS, 'b').length).toBe(0);
    });
  });

  test('should remove entirely inserted paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with an original and a fully inserted paragraph', async () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>Original</w:t></w:r></w:p>' +
        '<w:p>' +
          '<w:pPr><w:rPr><w:ins w:author="Author"/></w:rPr></w:pPr>' +
          '<w:ins w:author="Author"><w:r><w:t>New paragraph</w:t></w:r></w:ins>' +
        '</w:p>',
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('inserted paragraph is removed entirely', async () => {
      expect(result.insertionsRemoved).toBeGreaterThanOrEqual(1);
      expect(getAllParagraphTexts(doc)).toEqual(['Original']);
    });
  });

  test('should return zero stats for empty body', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with an empty body', async () => {
      doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<w:document xmlns:w="${W_NS}"><w:body/></w:document>`,
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('all stats are zero', async () => {
      expect(result.insertionsRemoved).toBe(0);
      expect(result.deletionsRestored).toBe(0);
    });
  });

  test('should handle missing body gracefully', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof rejectChanges>;

    await given('a document with no body element', async () => {
      doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<w:document xmlns:w="${W_NS}"/>`,
      );
    });

    await when('rejectChanges is called', async () => {
      result = rejectChanges(doc);
    });

    await then('insertionsRemoved is zero', async () => {
      expect(result.insertionsRemoved).toBe(0);
    });
  });
});
