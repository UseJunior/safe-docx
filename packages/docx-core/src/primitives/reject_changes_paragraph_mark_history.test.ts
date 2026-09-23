/**
 * Selective reject of a paragraph-mark w:rPrChange must not consume a foreign
 * paragraph-mark revision marker that shares the same w:pPr/w:rPr (#991).
 *
 * CT_ParaRPr = EG_ParaRPrTrackChanges (ins | del | moveFrom | moveTo), then
 * EG_RPrBase*, then rPrChange. The marker records a revision to the paragraph
 * BREAK; the rPrChange records the mark's formatting history. Rejecting one
 * author's formatting history restores the snapshot and leaves the other
 * author's break revision byte-untouched, in schema order.
 */
import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from '../testing/allure-test.js';
import { parseXml, serializeXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { DocxDocument } from './document.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph-mark history preservation' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.30' });

const MARKS = ['ins', 'del', 'moveFrom', 'moveTo'] as const;
type Mark = typeof MARKS[number];
const DT = 'w:date="2026-09-17T00:00:00Z"';
const marker = (kind: Mark, author = 'Human') => `<w:${kind} w:id="2" w:author="${author}" ${DT}/>`;
const history = (author = 'AI', snapshot = '<w:rPr><w:i/></w:rPr>') =>
  `<w:rPrChange w:id="1" w:author="${author}" ${DT}>${snapshot}</w:rPrChange>`;
/** Paragraph "A" whose mark carries a break marker, live bold, and a formatting history whose snapshot is italic. */
const marked = (rPrInner: string, pPrExtra = '') =>
  `<w:p><w:pPr>${pPrExtra}<w:rPr>${rPrInner}</w:rPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p>`;
const following = '<w:p><w:r><w:t>B</w:t></w:r></w:p>';
const wrap = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const fixture = (kind: Mark) => wrap(marked(marker(kind) + '<w:b/>' + history()) + following);

const byAuthor = (author: string) => (e: Element) => e.getAttributeNS(W, 'author') === author;
const serializer = new XMLSerializer();
const subtree = (el: Element) => serializer.serializeToString(el);
const paragraphs = (doc: Document) => Array.from(doc.getElementsByTagNameNS(W, 'p'));
const texts = (doc: Document) => paragraphs(doc).map(p => Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''));
const markRPr = (p: Element): Element | null => {
  const pPr = Array.from(p.childNodes).find(n => n.nodeType === 1 && (n as Element).localName === 'pPr') as Element | undefined;
  return (pPr && Array.from(pPr.childNodes).find(n => n.nodeType === 1 && (n as Element).localName === 'rPr') as Element) ?? null;
};
const childNames = (el: Element | null) => el ? Array.from(el.childNodes).filter(n => n.nodeType === 1).map(n => (n as Element).localName) : [];
const firstByName = (doc: Document, name: string) => doc.getElementsByTagNameNS(W, name)[0] ?? null;

describe('selective reject of a paragraph-mark rPrChange beside a foreign break marker (#991)', () => {
  for (const kind of MARKS) {
    test(`rejecting AI leaves the Human ${kind} mark byte-identical and restores the snapshot in schema order`, () => {
      const doc = parseXml(fixture(kind));
      const before = subtree(firstByName(doc, kind)!);

      const result = rejectChanges(doc, { filter: byAuthor('AI') });

      expect(result).toEqual({ insertionsRemoved: 0, deletionsRestored: 0, movesReverted: 0, propertyChangesReverted: 1, unresolvedRowRevisions: 0 });
      expect(texts(doc)).toEqual(['A', 'B']);
      const rPr = markRPr(paragraphs(doc)[0]!);
      expect(childNames(rPr)).toEqual([kind, 'i']);
      expect(subtree(firstByName(doc, kind)!)).toBe(before);
      expect(doc.getElementsByTagNameNS(W, 'rPrChange')).toHaveLength(0);
      expect(doc.getElementsByTagNameNS(W, 'b')).toHaveLength(0);
    });

    test(`rejecting Human resolves the ${kind} mark and leaves the AI history byte-identical`, () => {
      const doc = parseXml(fixture(kind));
      const before = subtree(firstByName(doc, 'rPrChange')!);

      rejectChanges(doc, { filter: byAuthor('Human') });

      expect(doc.getElementsByTagNameNS(W, kind)).toHaveLength(0);
      expect(subtree(firstByName(doc, 'rPrChange')!)).toBe(before);
      // An inserted or moved-in break is undone by merging into the following
      // paragraph; a deleted or moved-out break is restored in place.
      expect(texts(doc)).toEqual(kind === 'ins' || kind === 'moveTo' ? ['AB'] : ['A', 'B']);
    });

    test(`a filter matching neither author leaves the ${kind} fixture byte-identical`, () => {
      const doc = parseXml(fixture(kind));
      const before = serializeXml(doc);
      const result = rejectChanges(doc, { filter: byAuthor('Nobody') });
      expect(result.propertyChangesReverted).toBe(0);
      expect(serializeXml(doc)).toBe(before);
    });

    test(`a filter matching both authors consumes the ${kind} mark and the history like Reject All`, () => {
      const input = wrap(marked(marker(kind, 'AI') + '<w:b/>' + history()) + following);
      const selective = parseXml(input);
      rejectChanges(selective, { filter: byAuthor('AI') });
      const all = parseXml(input);
      rejectChanges(all);
      expect(serializeXml(selective)).toBe(serializeXml(all));
      for (const name of [kind, 'rPrChange', 'b']) expect(selective.getElementsByTagNameNS(W, name)).toHaveLength(0);
      expect(texts(selective)).toEqual(kind === 'ins' || kind === 'moveTo' ? ['AB'] : ['A', 'B']);
    });

    test(`the surviving Human ${kind} mark can be rejected after the AI history was rejected`, () => {
      const doc = parseXml(fixture(kind));
      rejectChanges(doc, { filter: byAuthor('AI') });
      const result = rejectChanges(doc, { filter: byAuthor('Human') });
      expect(result.propertyChangesReverted).toBe(0);
      expect(doc.getElementsByTagNameNS(W, kind)).toHaveLength(0);
      expect(texts(doc)).toEqual(kind === 'ins' || kind === 'moveTo' ? ['AB'] : ['A', 'B']);
      if (kind === 'del' || kind === 'moveFrom') expect(childNames(markRPr(paragraphs(doc)[0]!))).toEqual(['i']);
    });

    test(`the surviving Human ${kind} mark can be accepted after the AI history was rejected`, () => {
      const doc = parseXml(fixture(kind));
      rejectChanges(doc, { filter: byAuthor('AI') });
      acceptChanges(doc, { filter: byAuthor('Human') });
      expect(doc.getElementsByTagNameNS(W, kind)).toHaveLength(0);
      // Accepting a deleted or moved-out break removes it (merge); accepting an
      // inserted or moved-in break keeps the paragraph with its restored italic.
      expect(texts(doc)).toEqual(kind === 'del' || kind === 'moveFrom' ? ['AB'] : ['A', 'B']);
      if (kind === 'ins' || kind === 'moveTo') expect(childNames(markRPr(paragraphs(doc)[0]!))).toEqual(['i']);
    });
  }

  test('nested rollback: pPrChange and rPrChange by AI both revert while the Human ins mark survives', () => {
    const pPrChange = `<w:jc w:val="center"/><w:pPrChange w:id="3" w:author="AI" ${DT}><w:pPr><w:jc w:val="right"/></w:pPr></w:pPrChange>`;
    const doc = parseXml(wrap(marked(marker('ins') + '<w:b/>' + history('AI', '<w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr>'), pPrChange) + following));
    const before = subtree(firstByName(doc, 'ins')!);

    const result = rejectChanges(doc, { filter: byAuthor('AI') });

    expect(result.propertyChangesReverted).toBe(2);
    const pPr = paragraphs(doc)[0]!.getElementsByTagNameNS(W, 'pPr')[0]!;
    expect(childNames(pPr)).toEqual(['jc', 'rPr']);
    expect(firstByName(doc, 'jc')!.getAttributeNS(W, 'val')).toBe('right');
    expect(childNames(markRPr(paragraphs(doc)[0]!))).toEqual(['ins', 'i', 'color']);
    expect(subtree(firstByName(doc, 'ins')!)).toBe(before);
    for (const name of ['pPrChange', 'rPrChange', 'b']) expect(doc.getElementsByTagNameNS(W, name)).toHaveLength(0);
  });

  test('a snapshot that repeats the live marker yields exactly one marker, the live one', () => {
    const stale = marker('ins').replace(DT, 'w:date="2020-01-01T00:00:00Z"');
    const doc = parseXml(wrap(marked(marker('ins') + '<w:b/>' + history('AI', `<w:rPr>${stale}<w:i/></w:rPr>`)) + following));
    const live = subtree(firstByName(doc, 'ins')!);

    rejectChanges(doc, { filter: byAuthor('AI') });

    expect(doc.getElementsByTagNameNS(W, 'ins')).toHaveLength(1);
    expect(subtree(firstByName(doc, 'ins')!)).toBe(live);
    expect(childNames(markRPr(paragraphs(doc)[0]!))).toEqual(['ins', 'i']);
  });

  test('a snapshot-less rPrChange still keeps the foreign marker instead of dropping the whole rPr', () => {
    const doc = parseXml(wrap(marked(marker('del') + '<w:b/>' + `<w:rPrChange w:id="1" w:author="AI" ${DT}/>`) + following));
    const before = subtree(firstByName(doc, 'del')!);

    rejectChanges(doc, { filter: byAuthor('AI') });

    expect(childNames(markRPr(paragraphs(doc)[0]!))).toEqual(['del']);
    expect(subtree(firstByName(doc, 'del')!)).toBe(before);
    expect(doc.getElementsByTagNameNS(W, 'rPrChange')).toHaveLength(0);
  });

  test('a run-level rPrChange is unaffected: the run rPr is still replaced by its snapshot', () => {
    const doc = parseXml(wrap(`<w:p><w:r><w:rPr><w:b/>${history()}</w:rPr><w:t>A</w:t></w:r></w:p>`));
    rejectChanges(doc, { filter: byAuthor('AI') });
    expect(childNames(firstByName(doc, 'rPr'))).toEqual(['i']);
  });

  for (const kind of MARKS) {
    test(`package round trip: rejectAIEdits by author keeps the Human ${kind} mark in document.xml`, async () => {
      const buffer = await buildDocxFromBodyXml(marked(marker(kind) + '<w:b/>' + history()) + following);
      const doc = await DocxDocument.load(buffer);
      // The #123 overlap gate still classifies a selected property change that
      // shares its w:pPr with a foreign revision as ambiguous; normalizeFirst is
      // the documented way through, and it is the path this repair protects.
      await expect(doc.rejectAIEdits({ author: 'AI' })).rejects.toMatchObject({ code: 'AMBIGUOUS_REVISION_OVERLAP' });
      const { result, selectedIds } = await doc.rejectAIEdits({ author: 'AI', normalizeFirst: true });
      expect(selectedIds).toEqual(['1']);
      expect(result.propertyChangesReverted).toBe(1);

      const xml = await (await DocxArchive.load((await doc.toBuffer()).buffer)).getDocumentXml();
      expect(xml).toContain(marker(kind));
      expect(xml).not.toContain('rPrChange');
      expect(xml).toMatch(new RegExp(`<w:rPr><w:${kind}[^>]*/><w:i/></w:rPr>`));
    });
  }
});
