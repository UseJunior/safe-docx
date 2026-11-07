import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import {
  ParagraphPropertiesMutationError,
  setParagraphProperties,
  setParagraphSpacing,
} from './layout.js';
import { OOXML, W } from './namespaces.js';
import { createRevisionContext, createRevisionIdState, type RevisionContext } from './track-changes-emitter.js';
import { parseXml } from './xml.js';

const W_NS = OOXML.W_NS;
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph Property Layout Primitives' });
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.14' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.15' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.23' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' },
);

function indexed(bodyXml: string): { doc: Document; ids: string[] } {
  const doc = parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<w:document xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${bodyXml}</w:body></w:document>`,
  );
  insertParagraphBookmarks(doc, 'paragraph-properties-test');
  const ids = Array.from(doc.getElementsByTagNameNS(W_NS, W.p)).map((p) => {
    const id = getParagraphBookmarkId(p as Element);
    if (!id) throw new Error('Expected paragraph bookmark');
    return id;
  });
  return { doc, ids };
}

function ctx(author = 'AI'): RevisionContext {
  return createRevisionContext({ author, date: '2026-11-06T00:00:00Z', idState: createRevisionIdState() });
}

function pPrOf(doc: Document, index = 0): Element {
  const p = doc.getElementsByTagNameNS(W_NS, W.p).item(index) as Element;
  const pPr = getDirectChildrenByName(p, W.pPr)[0];
  if (!pPr) throw new Error('Expected pPr');
  return pPr;
}

function names(el: Element | undefined): string[] {
  return el ? Array.from(el.children).map((c) => (c as Element).localName) : [];
}

function val(el: Element | undefined): string | null {
  return el ? el.getAttributeNS(W_NS, 'val') : null;
}

describe('setParagraphProperties', () => {
  conformanceTest('creates pPr, inserts in CT_PPrBase order and snapshots an empty prior pPr', () => {
    const { doc, ids } = indexed('<w:p><w:r><w:t>Plain</w:t></w:r></w:p>');
    const result = setParagraphProperties(doc, {
      paragraphIds: [ids[0]!],
      alignment: 'right',
      pageBreakBefore: true,
      keepLines: true,
      keepNext: true,
    }, ctx());
    expect(result).toEqual({
      affectedParagraphs: 1,
      affectedParagraphIds: [ids[0]],
      unchangedParagraphIds: [],
      missingParagraphIds: [],
    });
    const pPr = pPrOf(doc);
    expect(names(pPr)).toEqual(['keepNext', 'keepLines', 'pageBreakBefore', 'jc', 'pPrChange']);
    const change = getDirectChildrenByName(pPr, 'pPrChange')[0]!;
    expect(change.getAttributeNS(W_NS, 'author')).toBe('AI');
    expect(names(getDirectChildrenByName(change, W.pPr)[0])).toEqual([]);
  });

  test('without a revision context edits directly and emits no pPrChange', () => {
    const { doc, ids } = indexed('<w:p><w:pPr><w:jc w:val="left"/><w:jc w:val="right"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>');
    setParagraphProperties(doc, { paragraphIds: [ids[0]!], alignment: 'center' });
    const pPr = pPrOf(doc);
    expect(names(pPr)).toEqual(['jc']);
    expect(val(getDirectChildrenByName(pPr, W.jc)[0])).toBe('center');
  });

  test('treats matching values as no-ops, including explicit on and off forms', () => {
    const { doc, ids } = indexed(
      '<w:p><w:pPr><w:keepNext w:val="true"/><w:keepLines w:val="off"/><w:jc w:val="both"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>',
    );
    const result = setParagraphProperties(doc, {
      paragraphIds: [ids[0]!, '_bk_missing'],
      alignment: 'both',
      keepNext: true,
      keepLines: false,
      pageBreakBefore: false,
    }, ctx());
    expect(result.affectedParagraphs).toBe(0);
    expect(result.unchangedParagraphIds).toEqual([ids[0]]);
    expect(result.missingParagraphIds).toEqual(['_bk_missing']);
    expect(getDirectChildrenByName(pPrOf(doc), 'pPrChange')).toHaveLength(0);
  });

  test('turns an explicit off element on and removes every on duplicate', () => {
    const { doc, ids } = indexed(
      '<w:p><w:pPr><w:keepNext w:val="0"/><w:pageBreakBefore/><w:pageBreakBefore w:val="1"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>',
    );
    setParagraphProperties(doc, { paragraphIds: [ids[0]!], keepNext: true, pageBreakBefore: false }, ctx());
    const pPr = pPrOf(doc);
    expect(names(pPr)).toEqual(['keepNext', 'pPrChange']);
    expect(getDirectChildrenByName(pPr, 'keepNext')[0]!.attributes.length).toBe(0);
    const prior = getDirectChildrenByName(getDirectChildrenByName(pPr, 'pPrChange')[0]!, W.pPr)[0];
    expect(names(prior)).toEqual(['keepNext', 'pageBreakBefore', 'pageBreakBefore']);
  });

  test('skips non-WordprocessingML children when choosing the insertion point', () => {
    const { doc, ids } = indexed(
      '<w:p><w:pPr><w:pStyle w:val="Body"/><w14:ext/><w:spacing w:after="0"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>',
    );
    setParagraphProperties(doc, { paragraphIds: [ids[0]!], keepNext: true, alignment: 'center' });
    expect(names(pPrOf(doc))).toEqual(['pStyle', 'ext', 'keepNext', 'spacing', 'jc']);
  });

  test('keeps a same-author baseline across spacing and property edits', () => {
    const { doc, ids } = indexed('<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>');
    const revision = ctx();
    setParagraphProperties(doc, { paragraphIds: [ids[0]!], alignment: 'center' }, revision);
    setParagraphSpacing(doc, { paragraphIds: [ids[0]!], afterTwips: 120 }, revision);
    setParagraphProperties(doc, { paragraphIds: [ids[0]!], keepLines: true }, revision);
    const changes = getDirectChildrenByName(pPrOf(doc), 'pPrChange');
    expect(changes).toHaveLength(1);
    expect(names(getDirectChildrenByName(changes[0]!, W.pPr)[0])).toEqual(['jc']);
  });

  test('refuses foreign or author-less revisions before mutating any target', () => {
    for (const authorAttr of [' w:author="Human"', '']) {
      const { doc, ids } = indexed(
        '<w:p><w:r><w:t>First</w:t></w:r></w:p>'
        + `<w:p><w:pPr><w:jc w:val="right"/><w:pPrChange w:id="1"${authorAttr} w:date="2026-01-01T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr>`
        + '<w:r><w:t>Second</w:t></w:r></w:p>',
      );
      expect(() => setParagraphProperties(doc, { paragraphIds: ids, alignment: 'center' }, ctx()))
        .toThrow(ParagraphPropertiesMutationError);
      const first = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      expect(getDirectChildrenByName(first, W.pPr)).toHaveLength(0);
    }
  });

  test('spacing still replaces a foreign wrapper with a new snapshot', () => {
    const { doc, ids } = indexed(
      '<w:p><w:pPr><w:jc w:val="right"/><w:pPrChange w:id="1" w:author="Human" w:date="2026-01-01T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>A</w:t></w:r></w:p>',
    );
    setParagraphSpacing(doc, { paragraphIds: [ids[0]!], beforeTwips: 60 }, ctx());
    const changes = getDirectChildrenByName(pPrOf(doc), 'pPrChange');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.getAttributeNS(W_NS, 'author')).toBe('AI');
    expect(names(getDirectChildrenByName(changes[0]!, W.pPr)[0])).toEqual(['jc']);
  });

  test('rejects unsupported alignment and non-boolean flags', () => {
    const { doc, ids } = indexed('<w:p><w:r><w:t>A</w:t></w:r></w:p>');
    expect(() => setParagraphProperties(doc, { paragraphIds: ids, alignment: 'start' as never })).toThrow(RangeError);
    expect(() => setParagraphProperties(doc, { paragraphIds: ids, keepNext: 'yes' as never })).toThrow(TypeError);
  });
});
