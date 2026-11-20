import { expect } from 'vitest';
import { testAllure, allureJsonAttachment, type AllureBddContext } from '../testing/allure-test.js';
import { buildDocxWithAncillaryParts, completeField, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import { OOXML } from './namespaces.js';
import { parseXml } from './xml.js';
import { getParagraphText, removeEmptyBookmarkedNumberedParagraph, replaceParagraphTextRange } from './text.js';
import { isBlankedParagraphWithDeletedMark } from './paragraph_list_numbering.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph Deletion' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' });
const W = OOXML.W_NS;
const numPr = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const localBookmark = '<w:bookmarkStart w:id="4" w:name="Target"/><w:bookmarkEnd w:id="4"/>';
const emptyItem = `<w:p><w:pPr>${numPr}</w:pPr>${localBookmark}</w:p>`;
const document = (body: string) => parseXml(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
const first = (doc: Document) => doc.getElementsByTagNameNS(W, 'p')[0]!;
const context = () => createRevisionContext({ author: 'AI', date: '2026-01-01T00:00:00Z', idState: createRevisionIdState(20) });

for (const tracked of [false, true]) {
  test(`deferred empty bookmark removal ${tracked ? 'accepts and rejects a paragraph-mark deletion' : 'removes the whole paragraph'}`, async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    await given('a numbered bookmark target before a surviving paragraph', () => { doc = document(emptyItem.replace('</w:p>', '<w:r><w:t>original</w:t></w:r></w:p>') + paragraphWithText('survivor')); });
    await when('the text is blanked and explicit removal is then finalized twice', () => {
      const p = first(doc); const ctx = tracked ? context() : undefined;
      replaceParagraphTextRange(p, 0, 'original'.length, '', ctx);
      removeEmptyBookmarkedNumberedParagraph(p, ctx, true);
      removeEmptyBookmarkedNumberedParagraph(p, ctx, true);
    });
    await then('clean or accepted output loses the target, while rejection preserves its bookmark', async () => {
      if (tracked) {
        expect(doc.getElementsByTagNameNS(W, 'del')).toHaveLength(2);
        const accepted = doc.cloneNode(true) as Document;
        acceptChanges(accepted);
        expect(Array.from(accepted.getElementsByTagNameNS(W, 'p')).map(getParagraphText)).toEqual(['survivor']);
        expect(accepted.getElementsByTagNameNS(W, 'bookmarkStart')).toHaveLength(0);
        rejectChanges(doc);
        expect(Array.from(doc.getElementsByTagNameNS(W, 'p')).map(getParagraphText)).toEqual(['original', 'survivor']);
        expect(doc.getElementsByTagNameNS(W, 'bookmarkStart')).toHaveLength(1);
      } else {
        expect(Array.from(doc.getElementsByTagNameNS(W, 'p')).map(getParagraphText)).toEqual(['survivor']);
        expect(doc.getElementsByTagNameNS(W, 'bookmarkStart')).toHaveLength(0);
      }
      await allureJsonAttachment('Removal outcome', { tracked, paragraphs: doc.getElementsByTagNameNS(W, 'p').length });
    });
  });
}

const protectedCases: Array<[string, string, boolean]> = [
  ['unnumbered item', emptyItem, false],
  ['spanning start', '<w:p><w:bookmarkStart w:id="4" w:name="Target"/></w:p>', true],
  ['mismatched endpoints of equal count', '<w:p><w:bookmarkStart w:id="4" w:name="Target"/><w:bookmarkEnd w:id="5"/></w:p>', true],
  ['section boundary', `<w:p><w:pPr>${numPr}<w:sectPr/></w:pPr>${localBookmark}</w:p>`, true],
  ['live content', `<w:p>${localBookmark}<w:r><w:t>keep</w:t></w:r></w:p>`, true],
  ['field content', `<w:p>${localBookmark}${completeField(' REF Elsewhere ', '3')}</w:p>`, true],
  ['comment anchor', `<w:p>${localBookmark}<w:commentRangeStart w:id="8"/></w:p>`, true],
  ['only cell paragraph', `<w:tbl><w:tr><w:tc>${emptyItem}</w:tc></w:tr></w:tbl>`, true],
  ['only cell paragraph inside a content control', `<w:tbl><w:tr><w:tc><w:sdt><w:sdtPr/><w:sdtContent>${emptyItem}</w:sdtContent></w:sdt></w:tc></w:tr></w:tbl>`, true],
  ['only cell paragraph inside nested customXml', `<w:tbl><w:tr><w:tc><w:customXml w:element="a"><w:customXml w:element="b">${emptyItem}</w:customXml></w:customXml></w:tc></w:tr></w:tbl>`, true],
];
for (const [name, body, numbered] of protectedCases) {
  test(`deferred removal preserves ${name}`, async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document; let p!: Element; let original!: Node;
    await given('a protected paragraph', () => { doc = document(body); p = first(doc); original = p.cloneNode(true); });
    await when('explicit removal is finalized in clean and tracked modes', () => {
      removeEmptyBookmarkedNumberedParagraph(p, undefined, numbered);
      removeEmptyBookmarkedNumberedParagraph(p, context(), numbered);
    });
    await then('the paragraph and its content are unchanged', async () => {
      expect(p.parentNode).not.toBeNull();
      expect(p.toString()).toBe(original.toString());
      await allureJsonAttachment('Protected scenario', { name, numbered });
    });
  });
}

test('deleted paragraph marks advance numbering only when surviving live text remains', async ({ given, when, then }: AllureBddContext) => {
  const cases: Array<[string, string, boolean]> = [
    ['no properties', '<w:p/>', false],
    ['formatting without deletion', '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr></w:p>', false],
    ['deleted empty mark', '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr></w:p>', true],
    ['moved-away empty mark', '<w:p><w:pPr><w:rPr><w:moveFrom w:id="1" w:author="A"/></w:rPr></w:pPr></w:p>', true],
    ['live text', '<w:r><w:t>live</w:t></w:r>', false],
    ['whitespace only', '<w:r><w:t xml:space="preserve">   </w:t></w:r>', true],
    ['new insertion', '<w:ins w:id="2" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins>', false],
    // Imported legacy producers can put w:t inside deleted wrappers. It must not become live numbering content.
    ['legacy deleted text', '<w:del w:id="2" w:author="A"><w:r><w:t>old</w:t></w:r></w:del>', true],
    ['legacy moved-away text', '<w:moveFrom w:id="2" w:author="A"><w:r><w:t>old</w:t></w:r></w:moveFrom>', true],
  ];
  let paragraphs!: Element[]; let actual!: boolean[];
  await given('empty, surviving and deleted payloads with paragraph-mark revisions', () => {
    paragraphs = cases.map(([, xml]) => first(document(xml.startsWith('<w:p') ? xml : `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>${xml}</w:p>`)));
  });
  await when('the live-numbering predicate classifies every paragraph', () => { actual = paragraphs.map(isBlankedParagraphWithDeletedMark); });
  await then('only paragraphs without surviving text are suppressed', async () => {
    expect(actual).toEqual(cases.map(([, , expected]) => expected));
    await allureJsonAttachment('Numbering classifications', cases.map(([name, , expected], i) => ({ name, expected, actual: actual[i] })));
  });
});

test('document range replacement resolves direct and inherited numbering and invalidates its view', async ({ given, when, then }: AllureBddContext) => {
  let doc!: DocxDocument; let id!: string; let version!: number; let missingError: unknown; let cached!: ReturnType<DocxDocument['buildDocumentView']>;
  await given('a style-numbered paragraph beside a directly numbered and unnumbered paragraph', async () => {
    doc = await DocxDocument.load(await buildDocxWithAncillaryParts({
      bodyXml: '<w:p><w:pPr><w:pStyle w:val="List"/></w:pPr><w:r><w:t>before</w:t></w:r></w:p>' + `<w:p><w:pPr>${numPr}</w:pPr><w:r><w:t>direct</w:t></w:r></w:p>` + paragraphWithText('plain'),
      sectPrXml: '<w:sectPr/>',
      relationships: [{ id: 'styles', type: `${OOXML.R_NS}/styles`, target: 'styles.xml' }, { id: 'numbering', type: `${OOXML.R_NS}/numbering`, target: 'numbering.xml' }],
      parts: [
        { path: 'word/styles.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml', xml: `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="List"><w:name w:val="List"/><w:pPr>${numPr}</w:pPr></w:style></w:styles>` },
        { path: 'word/numbering.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml', xml: `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>` },
      ],
    }));
    doc.insertParagraphBookmarks('range'); id = doc.readParagraphs().paragraphs[0]!.id; version = doc.getMutationVersion();
    cached = doc.buildDocumentView(); expect(cached.nodes[0]!.clean_text).toContain('before');
  });
  await when('a valid range is replaced and a missing target is refused', () => {
    doc.replaceTextAtRange({ targetParagraphId: id, start: 0, end: 6, replaceText: 'after' });
    try { doc.replaceTextAtRange({ targetParagraphId: 'missing', start: 0, end: 0, replaceText: 'x' }); } catch (e) { missingError = e; }
  });
  await then('numbering identity and the replacement are reflected by the public document view', async () => {
    expect(doc.getParagraphs().map(p => doc.isParagraphNumbered(p))).toEqual([true, true, false]);
    expect(doc.readParagraphs().paragraphs[0]!.text).toBe('after');
    expect(doc.getMutationVersion()).toBeGreaterThan(version);
    const rebuilt = doc.buildDocumentView();
    expect(rebuilt.nodes).not.toBe(cached.nodes);
    expect(rebuilt.nodes[0]!.clean_text).toContain('after');
    expect(String(missingError)).toContain('Paragraph not found: missing');
    await allureJsonAttachment('Range replacement', { id, versionBefore: version, versionAfter: doc.getMutationVersion() });
  });
});


test('explicit blanking requires a nonzero direct numbering id when no inherited hint is supplied', async ({ given, when, then }: AllureBddContext) => {
  const cases: Array<[string, string, boolean]> = [
    ['no properties', '', false], ['empty properties', '<w:pPr/>', false],
    ['missing id', '<w:pPr><w:numPr/></w:pPr>', false],
    ['empty id', '<w:pPr><w:numPr><w:numId/></w:numPr></w:pPr>', false],
    ['disabled numbering', '<w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>', false],
    ['active numbering', `<w:pPr>${numPr}</w:pPr>`, true],
  ];
  let paragraphs!: Element[];
  await given('bookmarked paragraphs with active, absent or malformed numbering references', () => {
    paragraphs = cases.map(([, props]) => first(document(`<w:p>${props}${localBookmark}<w:r><w:t>before</w:t></w:r></w:p>` + paragraphWithText('after'))));
  });
  await when('the full text is blanked under the explicit removal policy', () => {
    for (const p of paragraphs) replaceParagraphTextRange(p, 0, 6, '', undefined, { removeBookmarkedNumberedParagraph: true });
  });
  await then('only the actively numbered target is removed', async () => {
    expect(paragraphs.map(p => p.parentNode === null)).toEqual(cases.map(([, , removed]) => removed));
    await allureJsonAttachment('Direct numbering guards', cases.map(([name, , removed]) => ({ name, removed })));
  });
});
