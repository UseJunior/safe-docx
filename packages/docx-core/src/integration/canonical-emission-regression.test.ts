import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  DocxDocument,
  OOXML,
  compareDocuments,
  createRevisionContext,
  createRevisionIdState,
  createZipBuffer,
  parseXml,
  readZipText,
  replaceParagraphTextRange,
} from '../index.js';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Canonical Emission Regression',
});

const AI_AUTHOR = 'SafeDocX';
const FIXED_DATE = '2026-05-07T12:00:00Z';
const W_NS = OOXML.W_NS;

const MINIMAL_CONTENT_TYPES_XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '  <Default Extension="xml" ContentType="application/xml"/>',
  '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '</Types>',
].join('\n');

const MINIMAL_RELS_XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  '</Relationships>',
].join('\n');

function createCtx() {
  return createRevisionContext({
    author: AI_AUTHOR,
    date: FIXED_DATE,
    idState: createRevisionIdState(),
  });
}

async function makeMinimalDocx(bodyXml: string, extraFiles?: Record<string, string>): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${OOXML.W14_NS}" xmlns:r="${OOXML.R_NS}">` +
    `<w:body>${bodyXml}<w:sectPr/></w:body>` +
    `</w:document>`;

  return createZipBuffer({
    '[Content_Types].xml': MINIMAL_CONTENT_TYPES_XML,
    '_rels/.rels': MINIMAL_RELS_XML,
    'word/document.xml': documentXml,
    ...(extraFiles ?? {}),
  });
}

async function loadIndexedDoc(buffer: Buffer): Promise<{ doc: DocxDocument; paragraphIds: string[] }> {
  const doc = await DocxDocument.load(buffer);
  doc.insertParagraphBookmarks('attachment-1');
  return {
    doc,
    paragraphIds: doc.readParagraphs().paragraphs.map((paragraph) => paragraph.id),
  };
}

async function toPartMap<K extends string>(
  doc: DocxDocument,
  partPaths: readonly K[],
): Promise<{ buffer: Buffer; parts: Record<K, string> }> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  const entries = await Promise.all(
    partPaths.map(async (partPath) => {
      const text = await readZipText(buffer, partPath);
      if (text === null) {
        throw new Error(`Missing expected DOCX part: ${partPath}`);
      }
      return [partPath, text] as const;
    }),
  );
  return { buffer, parts: Object.fromEntries(entries) as Record<K, string> };
}

function wordAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(W_NS, localName) ??
    element.getAttribute(`w:${localName}`) ??
    element.getAttribute(localName)
  );
}

function elementsByName(xml: string, localName: string): Element[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, localName)) as Element[];
}

function expectTrackedElementsWithFixedMetadata(xml: string, localNames: string[]): void {
  for (const localName of localNames) {
    const matches = elementsByName(xml, localName);
    expect(matches.length, `expected <w:${localName}> in XML`).toBeGreaterThan(0);

    for (const match of matches) {
      expect(wordAttr(match, 'id')).toMatch(/^\d+$/);
      expect(wordAttr(match, 'author')).toBe(AI_AUTHOR);
      expect(wordAttr(match, 'date')).toBe(FIXED_DATE);
    }
  }
}

function expectNoComparisonAuthor(...xmlParts: Array<string | null>): void {
  for (const xml of xmlParts) {
    if (!xml) continue;
    expect(xml).not.toContain('w:author="Comparison"');
  }
}

type RevisionTuple = {
  kind: string;
  id: string | null;
  author: string | null;
  date: string | null;
  textContent: string;
};

function revisionTuples(xml: string, requiredAuthor?: string): RevisionTuple[] {
  const out: RevisionTuple[] = [];
  for (const kind of ['ins', 'del', 'pPrChange', 'rPrChange', 'trPrChange', 'tcPrChange']) {
    for (const el of elementsByName(xml, kind)) {
      const author = wordAttr(el, 'author');
      if (requiredAuthor && author !== requiredAuthor) continue;
      out.push({
        kind,
        id: wordAttr(el, 'id'),
        author,
        date: wordAttr(el, 'date'),
        textContent: el.textContent ?? '',
      });
    }
  }
  return out;
}

describe('Canonical emission catalog', () => {
  test('Table A: text.ts replaceParagraphTextRange emits tracked insertion, deletion, and run-property change wrappers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a fresh document with one editable paragraph', async () => {
      const { doc, paragraphIds } = await loadIndexedDoc(
        await makeMinimalDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'),
      );
      const paragraph = doc.getParagraphElementById(paragraphIds[0]!);
      expect(paragraph).toBeTruthy();

      await when('replaceParagraphTextRange runs with a revision context', async () => {
        replaceParagraphTextRange(
          paragraph!,
          0,
          5,
          [{ text: 'NEW', addRunProps: { bold: true } }],
          createCtx(),
        );

        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('document.xml contains tracked insertion, deletion, and run-property metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['ins', 'del', 'rPrChange']);
      expect(elementsByName(documentXml, 'b').length).toBeGreaterThan(0);
      const rPrChange = elementsByName(documentXml, 'rPrChange')[0]!;
      expect(rPrChange.getElementsByTagNameNS(W_NS, 'rPr')).toHaveLength(1);
    });
  });

  test('Table A: layout.ts setParagraphSpacing emits w:pPrChange', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a paragraph with existing spacing properties', async () => {
      const { doc, paragraphIds } = await loadIndexedDoc(
        await makeMinimalDocx(
          '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>',
        ),
      );

      await when('tracked paragraph spacing is updated', async () => {
        doc.setParagraphSpacing({ paragraphIds: [paragraphIds[0]!], beforeTwips: 240 }, createCtx());
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('the paragraph properties change wrapper carries revision metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['pPrChange']);
    });
  });

  test('Table A: layout.ts setTableRowHeight emits w:trPrChange', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a table row with a prior height definition', async () => {
      const { doc } = await loadIndexedDoc(
        await makeMinimalDocx(
          '<w:tbl><w:tr><w:trPr><w:trHeight w:val="360" w:hRule="atLeast"/></w:trPr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        ),
      );

      await when('tracked row height is updated', async () => {
        doc.setTableRowHeight({ tableIndexes: [0], valueTwips: 480, rule: 'exact' }, createCtx());
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('the row properties change wrapper carries revision metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['trPrChange']);
    });
  });

  test('Table A: layout.ts setTableCellPadding emits w:tcPrChange', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a table cell with prior padding properties', async () => {
      const { doc } = await loadIndexedDoc(
        await makeMinimalDocx(
          '<w:tbl><w:tr><w:tc><w:tcPr><w:tcMar><w:top w:w="100" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        ),
      );

      await when('tracked cell padding is updated', async () => {
        doc.setTableCellPadding({ tableIndexes: [0], leftDxa: 240 }, createCtx());
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('the cell properties change wrapper carries revision metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['tcPrChange']);
    });
  });

  test('Table A: comments.ts addComment emits a tracked insertion in document.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;
    let commentsXml: string;

    await given('a paragraph ready for a root comment', async () => {
      const { doc, paragraphIds } = await loadIndexedDoc(
        await makeMinimalDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'),
      );

      await when('addComment runs with a revision context', async () => {
        await doc.addComment(
          {
            paragraphId: paragraphIds[0]!,
            start: 0,
            end: 5,
            author: 'Reviewer',
            text: 'Comment body',
          },
          createCtx(),
        );

        ({ parts: { 'word/document.xml': documentXml, 'word/comments.xml': commentsXml } } = await toPartMap(doc, [
          'word/document.xml',
          'word/comments.xml',
        ]));
      });
    });

    await then('the body reference run is tracked and the comment side part is created', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['ins']);
      expect(commentsXml).toContain('Comment body');
    });
  });

  test('Table B: comments.ts addCommentReply performs package mutation only with no body revision', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let beforeDocumentXml: string;
    let afterDocumentXml: string;
    let commentsXml: string;

    await given('a document with an existing root comment', async () => {
      const { doc } = await loadIndexedDoc(
        await buildSyntheticDocx({
          paragraphs: ['Hello world'],
          commentOnParagraph: 0,
          commentText: 'Root comment',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
        }),
      );

      ({ parts: { 'word/document.xml': beforeDocumentXml } } = await toPartMap(doc, ['word/document.xml']));

      await when('addCommentReply receives a revision context', async () => {
        await doc.addCommentReply(
          {
            parentCommentId: 1,
            author: 'Bob',
            text: 'Reply body',
          },
          createCtx(),
        );

        ({ parts: { 'word/document.xml': afterDocumentXml, 'word/comments.xml': commentsXml } } = await toPartMap(doc, [
          'word/document.xml',
          'word/comments.xml',
        ]));
      });
    });

    await then('the document body remains unchanged while the reply is added to comments.xml', () => {
      // Current implementation explicitly ignores ctx for replies. This test
      // locks that behavior until reply-side tracked emission lands.
      expect(afterDocumentXml).toBe(beforeDocumentXml);
      expect(afterDocumentXml).not.toContain('<w:ins');
      expect(afterDocumentXml).not.toContain('<w:del');
      expect(commentsXml).toContain('Reply body');
    });
  });

  test('Table A: comments.ts deleteComment emits a tracked deletion in document.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a document with an existing root comment', async () => {
      const { doc } = await loadIndexedDoc(
        await buildSyntheticDocx({
          paragraphs: ['Hello world'],
          commentOnParagraph: 0,
          commentText: 'Delete me',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
        }),
      );

      await when('deleteComment runs with a revision context', async () => {
        await doc.deleteComment({ commentId: 1 }, createCtx());
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('the removed comment reference is preserved under w:del with revision metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['del']);
    });
  });

  test('Table A: footnotes.ts addFootnote emits tracked insertions in document.xml and footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;
    let footnotesXml: string;

    await given('a paragraph ready for a footnote insertion', async () => {
      const { doc, paragraphIds } = await loadIndexedDoc(
        await makeMinimalDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'),
      );

      await when('addFootnote runs with a revision context', async () => {
        await doc.addFootnote({ paragraphId: paragraphIds[0]!, text: 'Note body' }, createCtx());

        ({ parts: { 'word/document.xml': documentXml, 'word/footnotes.xml': footnotesXml } } = await toPartMap(doc, [
          'word/document.xml',
          'word/footnotes.xml',
        ]));
      });
    });

    await then('both the body reference and the footnote text carry tracked insertion metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['ins']);
      expectTrackedElementsWithFixedMetadata(footnotesXml, ['ins']);
    });
  });

  test('Table A: footnotes.ts updateFootnoteText emits tracked deletion and insertion wrappers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let footnotesXml: string;

    await given('a document with an existing footnote body', async () => {
      const { doc } = await loadIndexedDoc(
        await buildSyntheticDocx({
          paragraphs: ['Hello world'],
          footnoteOnParagraph: 0,
          footnoteText: 'Old footnote',
        }),
      );

      await when('updateFootnoteText runs with a revision context', async () => {
        await doc.updateFootnoteText({ noteId: 1, newText: 'Updated footnote' }, createCtx());
        ({ parts: { 'word/footnotes.xml': footnotesXml } } = await toPartMap(doc, ['word/footnotes.xml']));
      });
    });

    await then('footnotes.xml contains tracked deletion and insertion wrappers with fixed metadata', () => {
      expectTrackedElementsWithFixedMetadata(footnotesXml, ['ins', 'del']);
    });
  });

  test('Table A: footnotes.ts deleteFootnote emits tracked deletions in document.xml and footnotes.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;
    let footnotesXml: string;

    await given('a document with an existing footnote', async () => {
      const { doc } = await loadIndexedDoc(
        await buildSyntheticDocx({
          paragraphs: ['Hello world'],
          footnoteOnParagraph: 0,
          footnoteText: 'Delete this note',
        }),
      );

      await when('deleteFootnote runs with a revision context', async () => {
        await doc.deleteFootnote({ noteId: 1 }, createCtx());
        ({ parts: { 'word/document.xml': documentXml, 'word/footnotes.xml': footnotesXml } } = await toPartMap(doc, [
          'word/document.xml',
          'word/footnotes.xml',
        ]));
      });
    });

    await then('the body reference and the footnote body are both wrapped in tracked deletions', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['del']);
      expectTrackedElementsWithFixedMetadata(footnotesXml, ['del']);
    });
  });
});

describe('Round-trip with comparison', () => {
  test('replace_text round-trip preserves AI revision date and content semantically through comparison', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let preCompareDocumentXml: string;
    let comparedDocumentXml: string;

    await given('a baseline document and a tracked text replacement', async () => {
      const baseline = await makeMinimalDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      const { doc, paragraphIds } = await loadIndexedDoc(baseline);
      const paragraph = doc.getParagraphElementById(paragraphIds[0]!);
      expect(paragraph).toBeTruthy();

      replaceParagraphTextRange(paragraph!, 0, 5, 'NEW', createCtx());
      const modifiedParts = await toPartMap(doc, ['word/document.xml']);
      preCompareDocumentXml = modifiedParts.parts['word/document.xml']!;

      await when('compareDocuments runs against the tracked document', async () => {
        const compared = await compareDocuments(baseline, modifiedParts.buffer, {
          author: AI_AUTHOR,
          engine: 'atomizer',
        });
        comparedDocumentXml = (await readZipText(compared.document, 'word/document.xml'))!;
      });
    });

    await then('the AI revision survives semantically: SafeDocX author and replacement content (note: date is currently regenerated by comparison; gap tracked by #126)', () => {
      expectNoComparisonAuthor(comparedDocumentXml);

      const preTuples = revisionTuples(preCompareDocumentXml, AI_AUTHOR);
      expect(preTuples.length).toBeGreaterThanOrEqual(2); // expect at least one ins + one del

      const postTuples = revisionTuples(comparedDocumentXml, AI_AUTHOR);
      expect(postTuples.length).toBeGreaterThanOrEqual(2);

      // What survives semantically through compareDocuments today:
      //   ✓ author identity (SafeDocX) — accept_changes can still target AI revisions
      //   ✓ revision element kinds (w:ins / w:del present)
      //   ✓ content text (NEW appears inside w:ins; Hello inside w:del)
      // What does NOT survive byte-identically:
      //   ✗ w:date timestamps — comparison regenerates with current time
      //   ✗ w:id values — comparison reallocates
      //
      // This is a known gap in the umbrella's "AI revisions co-exist with comparison"
      // story. Resolution comes when comparison is removed from the default
      // finalization path (milestone #126); until then, the AI's provenance is
      // partially preserved (author + content semantics, not full byte identity).

      // Author identity preservation (the strong claim that holds today):
      for (const t of postTuples) {
        expect(t.author).toBe(AI_AUTHOR);
      }

      // Content semantics preservation:
      const insertions = elementsByName(comparedDocumentXml, 'ins');
      expect(insertions.some((el) => wordAttr(el, 'author') === AI_AUTHOR && (el.textContent ?? '').includes('NEW'))).toBe(true);
      const deletions = elementsByName(comparedDocumentXml, 'del');
      expect(deletions.some((el) => wordAttr(el, 'author') === AI_AUTHOR && (el.textContent ?? '').includes('Hello'))).toBe(true);

      // Lock in the CURRENT GAP: at least one date in the post-compare output
      // differs from FIXED_DATE. If a future change to comparison preserves
      // dates, this assertion will fail and the test should be updated to
      // assert preservation instead — at which point #126's milestone has
      // been at least partially achieved.
      const datesInPost = postTuples.map((t) => t.date);
      const allDatesAreFixed = datesInPost.every((d) => d === FIXED_DATE);
      expect(
        allDatesAreFixed,
        'Comparison currently regenerates dates. If this test now passes (all dates preserved), comparison gained date-preservation — update this test to assert preservation instead. See #126.',
      ).toBe(false);
    });
  });

  test('insert_paragraph round-trip retains the original AI paragraph-mark insertion alongside comparison output', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let comparedDocumentXml: string;

    await given('a baseline document and a tracked paragraph insertion', async () => {
      const baseline = await makeMinimalDocx('<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>');
      const { doc, paragraphIds } = await loadIndexedDoc(baseline);
      doc.insertParagraph(
        {
          positionalAnchorNodeId: paragraphIds[0]!,
          relativePosition: 'AFTER',
          newText: 'Inserted paragraph',
        },
        createCtx(),
      );
      const { buffer: modified } = await toPartMap(doc, ['word/document.xml']);

      await when('compareDocuments runs against the tracked insertion', async () => {
        const compared = await compareDocuments(baseline, modified, {
          author: AI_AUTHOR,
          engine: 'atomizer',
        });
        comparedDocumentXml = (await readZipText(compared.document, 'word/document.xml'))!;
      });
    });

    await then('comparison output keeps the original SafeDocX paragraph-mark metadata and avoids Comparison', () => {
      expectNoComparisonAuthor(comparedDocumentXml);
      expect(comparedDocumentXml).toContain(`w:date="${FIXED_DATE}"`);
      expect(comparedDocumentXml).toContain('Inserted paragraph');
    });
  });

  test('add_comment round-trip preserves comments.xml while keeping SafeDocX in document.xml', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let modifiedCommentsXml: string;
    let comparedDocumentXml: string;
    let comparedCommentsXml: string | null;

    await given('a baseline document and a tracked root comment insertion', async () => {
      const baseline = await makeMinimalDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      const { doc, paragraphIds } = await loadIndexedDoc(baseline);
      await doc.addComment(
        {
          paragraphId: paragraphIds[0]!,
          start: 0,
          end: 5,
          author: 'Reviewer',
          text: 'Comment body',
        },
        createCtx(),
      );
      const modifiedParts = await toPartMap(doc, ['word/document.xml', 'word/comments.xml']);
      modifiedCommentsXml = modifiedParts.parts['word/comments.xml'];

      await when('compareDocuments runs against the tracked comment document', async () => {
        const compared = await compareDocuments(baseline, modifiedParts.buffer, {
          author: AI_AUTHOR,
          engine: 'atomizer',
        });
        const parts = await getResultParts(compared.document);
        comparedDocumentXml = parts.documentXml;
        comparedCommentsXml = parts.commentsXml;
      });
    });

    await then('comments.xml is preserved verbatim and document.xml never uses Comparison as the author', () => {
      expectNoComparisonAuthor(comparedDocumentXml, comparedCommentsXml);
      expect(comparedCommentsXml).toBe(modifiedCommentsXml);
      expect(comparedDocumentXml).toContain('w:commentReference');
    });
  });

  test('add_footnote round-trip preserves footnotes.xml while keeping SafeDocX authors', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let modifiedFootnotesXml: string;
    let comparedDocumentXml: string;
    let comparedFootnotesXml: string | null;

    await given('a baseline document and a tracked footnote insertion', async () => {
      const baseline = await makeMinimalDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      const { doc, paragraphIds } = await loadIndexedDoc(baseline);
      await doc.addFootnote({ paragraphId: paragraphIds[0]!, text: 'Note body' }, createCtx());
      const modifiedParts = await toPartMap(doc, ['word/document.xml', 'word/footnotes.xml']);
      modifiedFootnotesXml = modifiedParts.parts['word/footnotes.xml'];

      await when('compareDocuments runs against the tracked footnote document', async () => {
        const compared = await compareDocuments(baseline, modifiedParts.buffer, {
          author: AI_AUTHOR,
          engine: 'atomizer',
        });
        const parts = await getResultParts(compared.document);
        comparedDocumentXml = parts.documentXml;
        comparedFootnotesXml = parts.footnotesXml;
      });
    });

    await then('footnotes.xml is preserved verbatim and no Comparison author is introduced', () => {
      expectNoComparisonAuthor(comparedDocumentXml, comparedFootnotesXml);
      expect(comparedFootnotesXml).toBe(modifiedFootnotesXml);
      expect(comparedDocumentXml).toContain('w:footnoteReference');
    });
  });
});
