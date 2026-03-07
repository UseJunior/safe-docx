import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML } from './namespaces.js';
import { rejectChanges } from './reject_changes.js';
import { getParagraphText } from './text.js';

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
  it('should return zero stats for a document with no tracked changes', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const result = rejectChanges(doc);
    expect(result.insertionsRemoved).toBe(0);
    expect(result.deletionsRestored).toBe(0);
    expect(result.movesReverted).toBe(0);
    expect(result.propertyChangesReverted).toBe(0);
    expect(getAllParagraphTexts(doc)).toEqual(['Hello']);
  });

  it('should remove inserted content', () => {
    const doc = makeDoc(
      '<w:p>' +
        '<w:r><w:t>Original</w:t></w:r>' +
        '<w:ins w:author="Author" w:date="2024-01-01T00:00:00Z">' +
          '<w:r><w:t> added</w:t></w:r>' +
        '</w:ins>' +
      '</w:p>',
    );
    const result = rejectChanges(doc);
    expect(result.insertionsRemoved).toBe(1);
    expect(getAllParagraphTexts(doc)).toEqual(['Original']);
  });

  it('should restore deleted text (w:delText → w:t conversion)', () => {
    const doc = makeDoc(
      '<w:p>' +
        '<w:r><w:t>Keep</w:t></w:r>' +
        '<w:del w:author="Author" w:date="2024-01-01T00:00:00Z">' +
          '<w:r><w:delText> deleted</w:delText></w:r>' +
        '</w:del>' +
      '</w:p>',
    );
    const result = rejectChanges(doc);
    expect(result.deletionsRestored).toBe(1);
    expect(getAllParagraphTexts(doc)).toEqual(['Keep deleted']);

    // Verify w:delText was actually renamed to w:t
    const delTexts = doc.getElementsByTagNameNS(W_NS, 'delText');
    expect(delTexts.length).toBe(0);
  });

  it('should unwrap moveFrom and remove moveTo content', () => {
    const doc = makeDoc(
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
    const result = rejectChanges(doc);
    expect(result.movesReverted).toBeGreaterThanOrEqual(1);
    // The first paragraph should keep the text at original position
    const texts = getAllParagraphTexts(doc);
    expect(texts[0]).toBe('moved text');
  });

  it('should restore original properties from rPrChange', () => {
    const doc = makeDoc(
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
    const result = rejectChanges(doc);
    expect(result.propertyChangesReverted).toBe(1);

    // After reject, the rPr should contain the original (italic), not current (bold)
    const run = doc.getElementsByTagNameNS(W_NS, 'r')[0]!;
    const rPr = run.getElementsByTagNameNS(W_NS, 'rPr')[0]!;
    expect(rPr.getElementsByTagNameNS(W_NS, 'i').length).toBe(1);
    expect(rPr.getElementsByTagNameNS(W_NS, 'b').length).toBe(0);
  });

  it('should remove parent property element when rPrChange has empty original', () => {
    const doc = makeDoc(
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
    const result = rejectChanges(doc);
    expect(result.propertyChangesReverted).toBe(1);

    // After reject with empty original, rPr should be replaced with the empty clone
    const run = doc.getElementsByTagNameNS(W_NS, 'r')[0]!;
    const rPr = run.getElementsByTagNameNS(W_NS, 'rPr')[0];
    // The rPr should exist but be empty (restored from the empty <w:rPr/> inside rPrChange)
    expect(rPr).toBeDefined();
    expect(rPr!.getElementsByTagNameNS(W_NS, 'b').length).toBe(0);
  });

  it('should remove entirely inserted paragraphs', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>Original</w:t></w:r></w:p>' +
      '<w:p>' +
        '<w:pPr><w:rPr><w:ins w:author="Author"/></w:rPr></w:pPr>' +
        '<w:ins w:author="Author"><w:r><w:t>New paragraph</w:t></w:r></w:ins>' +
      '</w:p>',
    );
    const result = rejectChanges(doc);
    expect(result.insertionsRemoved).toBeGreaterThanOrEqual(1);
    expect(getAllParagraphTexts(doc)).toEqual(['Original']);
  });

  it('should return zero stats for empty body', () => {
    const doc = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<w:document xmlns:w="${W_NS}"><w:body/></w:document>`,
    );
    const result = rejectChanges(doc);
    expect(result.insertionsRemoved).toBe(0);
    expect(result.deletionsRestored).toBe(0);
  });

  it('should handle missing body gracefully', () => {
    const doc = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<w:document xmlns:w="${W_NS}"/>`,
    );
    const result = rejectChanges(doc);
    expect(result.insertionsRemoved).toBe(0);
  });
});
