import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import { OOXML, W } from './namespaces.js';
import {
  ParagraphNumberingMutationError,
  getDirectParagraphNumbering,
  setDirectParagraphNumbering,
} from './paragraph_numbering.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';

const W_NS = OOXML.W_NS;
const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'add-paragraph-numbering-formatting',
});
const numberingConformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.3' },
);

function makeDocument(bodyXml: string): Document {
  const doc = parseXml(
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
  insertParagraphBookmarks(doc, 'paragraph-numbering-test');
  return doc;
}

function makeNumbering(): Document {
  return parseXml(
    `<w:numbering xmlns:w="${W_NS}">`
      + '<w:abstractNum w:abstractNumId="1">'
      + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl>'
      + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%2)"/></w:lvl>'
      + '</w:abstractNum>'
      + '<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>'
      + '</w:numbering>',
  );
}

function paragraphId(doc: Document, index = 0): string {
  const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(index) as Element;
  const id = getParagraphBookmarkId(paragraph);
  if (!id) throw new Error('Expected paragraph bookmark');
  return id;
}

function direct(parent: Element, name: string): Element {
  const child = getDirectChildrenByName(parent, name)[0];
  if (!child) throw new Error(`Expected ${name}`);
  return child;
}

function attr(el: Element, name: string): string | null {
  return el.getAttributeNS(W_NS, name) || el.getAttribute(`w:${name}`) || null;
}

describe('direct paragraph numbering mutation', () => {
  numberingConformanceTest('sets a validated reference in schema order and preserves unrelated properties', () => {
    const doc = makeDocument(
      '<w:p><w:pPr><w:pStyle w:val="Body"/><w:spacing w:after="120"/></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>',
    );
    const id = paragraphId(doc);

    const result = setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: id, numbering: { numId: '10', ilvl: 1 } },
    );

    expect(result).toEqual({
      paragraphId: id,
      changed: true,
      previous: null,
      current: { numId: '10', ilvl: 1 },
    });
    const pPr = direct(doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element, W.pPr);
    expect(Array.from(pPr.children).map((child) => child.localName))
      .toEqual([W.pStyle, W.numPr, W.spacing]);
    const numPr = direct(pPr, W.numPr);
    expect(Array.from(numPr.children).map((child) => child.localName))
      .toEqual([W.ilvl, W.numId]);
    expect(attr(direct(numPr, W.ilvl), W.val)).toBe('1');
    expect(attr(direct(numPr, W.numId), W.val)).toBe('10');
    expect(getDirectParagraphNumbering(doc, id)).toEqual({ numId: '10', ilvl: 1 });
  });

  test('emits one tracked property snapshot and makes an identical request a no-op', () => {
    const doc = makeDocument(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>',
    );
    const id = paragraphId(doc);
    const ctx = createRevisionContext({
      author: 'SafeDocX AI',
      date: '2026-07-27T12:00:00Z',
      idState: createRevisionIdState(),
    });

    const changed = setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: id, numbering: { numId: '10', ilvl: 1 } },
      ctx,
    );
    expect(changed.changed).toBe(true);

    const pPr = direct(doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element, W.pPr);
    const change = direct(pPr, 'pPrChange');
    expect(attr(change, 'author')).toBe('SafeDocX AI');
    expect(attr(change, 'date')).toBe('2026-07-27T12:00:00Z');
    const prior = direct(direct(change, W.pPr), W.numPr);
    expect(attr(direct(prior, W.ilvl), W.val)).toBe('0');
    expect(getDirectChildrenByName(pPr, 'pPrChange')).toHaveLength(1);

    const before = serializeXml(doc);
    const noOp = setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: id, numbering: { numId: '10', ilvl: 1 } },
      ctx,
    );
    expect(noOp.changed).toBe(false);
    expect(serializeXml(doc)).toBe(before);
    expect(ctx.idState.nextId).toBe(2);
  });

  test('removes direct numbering and reports absent direct numbering explicitly', () => {
    const doc = makeDocument(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>'
        + '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>Beta</w:t></w:r></w:p>',
    );

    expect(setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: paragraphId(doc, 0), numbering: null },
    )).toMatchObject({
      changed: true,
      previous: { numId: '10', ilvl: 0 },
      current: null,
    });
    expect(setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: paragraphId(doc, 1), numbering: null },
    )).toMatchObject({
      changed: false,
      warning: expect.stringContaining('style-inherited'),
    });
  });

  test('rejects dangling references before changing serialized XML', () => {
    const doc = makeDocument('<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>');
    const before = serializeXml(doc);
    expect(() => setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: paragraphId(doc), numbering: { numId: '99', ilvl: 0 } },
    )).toThrowError(ParagraphNumberingMutationError);
    expect(serializeXml(doc)).toBe(before);

    expect(() => setDirectParagraphNumbering(
      doc,
      makeNumbering(),
      { paragraphId: paragraphId(doc), numbering: { numId: '10', ilvl: 8 } },
    )).toThrowError(expect.objectContaining({ code: 'NUMBERING_LEVEL_NOT_FOUND' }));
    expect(serializeXml(doc)).toBe(before);
  });
});
