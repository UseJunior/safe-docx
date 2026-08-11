import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  DocxDocument,
  OOXML,
  createRevisionContext,
  createRevisionIdState,
  createZipBuffer,
  parseXml,
  readZipText,
  replaceParagraphTextRange,
} from '../index.js';
import { compareDocuments } from '@usejunior/docx-compare';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Canonical Emission Regression',
});
const numberingTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.3' },
);
const sectionTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.12' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.11' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);
const paragraphDeletionTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
);

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
  for (const kind of ['ins', 'del', 'pPrChange', 'rPrChange', 'sectPrChange', 'trPrChange', 'tcPrChange']) {
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

  paragraphDeletionTest('Table A: text.ts emits paragraph-mark deletion into an existing formatted rPr', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a real-world title shape with existing paragraph-mark font and size properties', async () => {
      const title = 'Mutual Non-Disclosure Agreement';
      const { doc, paragraphIds } = await loadIndexedDoc(
        await makeMinimalDocx(
          '<w:p>' +
            '<w:pPr><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="44"/></w:rPr></w:pPr>' +
            `<w:r><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="44"/></w:rPr><w:t>${title}</w:t></w:r>` +
          '</w:p>',
        ),
      );
      const paragraph = doc.getParagraphElementById(paragraphIds[0]!);
      expect(paragraph).toBeTruthy();

      await when('the full title is deleted under tracked changes', async () => {
        replaceParagraphTextRange(paragraph!, 0, title.length, '', createCtx());
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('document.xml preserves formatting and carries separate run and paragraph-mark deletions', () => {
      const deletions = elementsByName(documentXml, 'del');
      const paragraphMarkDeletion = deletions.find(
        (element) => (element.parentNode as Element | null)?.localName === 'rPr',
      );
      const runDeletion = deletions.find(
        (element) => (element.parentNode as Element | null)?.localName === 'p',
      );
      const paragraphRPr = paragraphMarkDeletion?.parentNode as Element | undefined;

      expect(paragraphMarkDeletion).toBeTruthy();
      expect(runDeletion).toBeTruthy();
      expect(wordAttr(paragraphMarkDeletion!, 'author')).toBe(AI_AUTHOR);
      expect(wordAttr(paragraphMarkDeletion!, 'id')).not.toBe(wordAttr(runDeletion!, 'id'));
      expect(paragraphRPr?.getElementsByTagNameNS(W_NS, 'rFonts')).toHaveLength(1);
      expect(paragraphRPr?.getElementsByTagNameNS(W_NS, 'sz')).toHaveLength(1);
      expect(Array.from(paragraphRPr!.children).map((child) => child.localName)).toEqual([
        'del',
        'rFonts',
        'sz',
      ]);
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

  numberingTest('Table A: paragraph_numbering.ts setDirectParagraphNumbering emits w:pPrChange', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a directly numbered paragraph and its numbering definitions', async () => {
      const numberingXml =
        `<w:numbering xmlns:w="${W_NS}">`
        + '<w:abstractNum w:abstractNumId="1">'
        + '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
        + '<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl>'
        + '</w:abstractNum>'
        + '<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>'
        + '</w:numbering>';
      const { doc, paragraphIds } = await loadIndexedDoc(
        await makeMinimalDocx(
          '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr><w:r><w:t>Numbered</w:t></w:r></w:p>',
          { 'word/numbering.xml': numberingXml },
        ),
      );

      await when('tracked direct numbering is changed to another valid level', async () => {
        doc.setDirectParagraphNumbering(
          { paragraphId: paragraphIds[0]!, numbering: { numId: '10', ilvl: 1 } },
          createCtx(),
        );
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(doc, ['word/document.xml']));
      });
    });

    await then('the paragraph property change preserves the prior numbering with revision metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['pPrChange']);
      const change = elementsByName(documentXml, 'pPrChange')[0]!;
      const priorIlvl = change.getElementsByTagNameNS(W_NS, 'ilvl')[0] as Element;
      expect(wordAttr(priorIlvl, 'val')).toBe('0');
    });
  });

  sectionTest('Table A: sections.ts setSectionPageNumberStart emits w:sectPrChange', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a final section with an existing page-number restart', async () => {
      const { doc } = await loadIndexedDoc(
        await makeMinimalDocx('<w:p><w:r><w:t>Section body</w:t></w:r></w:p>'),
      );
      doc.setSectionPageNumberStart({ sectionIndex: 0, pageNumberStart: 3 });

      await when('the restart is changed with a revision context', async () => {
        doc.setSectionPageNumberStart(
          { sectionIndex: 0, pageNumberStart: 1 },
          createCtx(),
        );
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(
          doc,
          ['word/document.xml'],
        ));
      });
    });

    await then('the prior restart is captured with canonical revision metadata', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['sectPrChange']);
      const change = elementsByName(documentXml, 'sectPrChange')[0]!;
      const priorPgNumType = change.getElementsByTagNameNS(
        W_NS,
        'pgNumType',
      )[0] as Element;
      expect(wordAttr(priorPgNumType, 'start')).toBe('3');
      expect(change.getElementsByTagNameNS(W_NS, 'sectPrChange')).toHaveLength(0);
    });
  });

  sectionTest('Table A: sections.ts updateSectionProperties emits atomic page setup', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let documentXml: string;

    await given('a final section with explicit portrait page setup', async () => {
      const { doc } = await loadIndexedDoc(
        await makeMinimalDocx('<w:p><w:r><w:t>Section body</w:t></w:r></w:p>'),
      );
      doc.updateSectionProperties({
        sectionIndex: 0,
        pageSize: { widthTwips: 12240, heightTwips: 15840 },
        margins: {
          topTwips: 1440,
          rightTwips: 1440,
          bottomTwips: 1440,
          leftTwips: 1440,
          headerTwips: 720,
          footerTwips: 720,
          gutterTwips: 0,
        },
      });

      await when('paper geometry and margins change with one revision context', async () => {
        doc.updateSectionProperties(
          {
            sectionIndex: 0,
            pageSize: {
              widthTwips: 15840,
              heightTwips: 12240,
              orientation: 'landscape',
            },
            margins: { topTwips: 720, leftTwips: 720 },
          },
          createCtx(),
        );
        ({ parts: { 'word/document.xml': documentXml } } = await toPartMap(
          doc,
          ['word/document.xml'],
        ));
      });
    });

    await then('current page setup and one canonical prior snapshot are emitted', () => {
      expectTrackedElementsWithFixedMetadata(documentXml, ['sectPrChange']);
      const doc = parseXml(documentXml);
      const currentPgSz = doc.getElementsByTagNameNS(W_NS, 'pgSz')[0] as Element;
      const currentPgMar = doc.getElementsByTagNameNS(W_NS, 'pgMar')[0] as Element;
      expect(wordAttr(currentPgSz, 'w')).toBe('15840');
      expect(wordAttr(currentPgSz, 'h')).toBe('12240');
      expect(wordAttr(currentPgSz, 'orient')).toBe('landscape');
      expect(wordAttr(currentPgMar, 'top')).toBe('720');
      expect(wordAttr(currentPgMar, 'left')).toBe('720');
      const change = elementsByName(documentXml, 'sectPrChange')[0]!;
      expect(change.getElementsByTagNameNS(W_NS, 'pgSz')).toHaveLength(1);
      expect(change.getElementsByTagNameNS(W_NS, 'pgMar')).toHaveLength(1);
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
          '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="360" w:hRule="atLeast"/></w:trPr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
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
          '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcMar><w:top w:w="100" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
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
    let commentsExtendedXml: string | undefined;
    let peopleXml: string | undefined;

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

        ({
          parts: {
            'word/document.xml': afterDocumentXml,
            'word/comments.xml': commentsXml,
            'word/commentsExtended.xml': commentsExtendedXml,
            'word/people.xml': peopleXml,
          },
        } = await toPartMap(doc, [
          'word/document.xml',
          'word/comments.xml',
          'word/commentsExtended.xml',
          'word/people.xml',
        ]));
      });
    });

    await then('the document body remains unchanged and the reply lands as side-part metadata only', () => {
      // Table B contract for addCommentReply (#174): replies are side-part
      // metadata writes only — no body anchor per reply, so no body revision
      // marker is emitted. ctx is accepted as plumbing for API consistency
      // but does NOT produce w:ins/w:del. The reply still updates the three
      // side parts that Word needs (comments.xml, commentsExtended.xml,
      // people.xml).
      expect(afterDocumentXml).toBe(beforeDocumentXml);
      expect(afterDocumentXml).not.toContain('<w:ins');
      expect(afterDocumentXml).not.toContain('<w:del');
      expect(commentsXml).toContain('Reply body');
      // Package-mutation half of the Table B contract — commentsExtended.xml
      // gets the threaded-reply linkage and people.xml gets the new author.
      expect(commentsExtendedXml).toBeDefined();
      expect(commentsExtendedXml).toContain('w15:commentEx');
      expect(peopleXml).toBeDefined();
      expect(peopleXml).toContain('Bob');
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

  test('insert_paragraph round-trip preserves SafeDocX paragraph-mark insertion provenance under the inplace default', async ({
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

    await then('comparison output keeps SafeDocX metadata, avoids Comparison, and preserves the original insertion date', () => {
      expectNoComparisonAuthor(comparedDocumentXml);
      // Under the shared inplace default (issue #808), comparison preserves the
      // pre-existing tracked insertion in place — including its original
      // provenance date — instead of regenerating it as the old rebuild default
      // did. Date preservation is the desired end state named by the
      // replace_text characterization above (#126): pre-existing tracked
      // changes survive with their authorship AND timestamps intact.
      expect(comparedDocumentXml).toContain(`w:date="${FIXED_DATE}"`);
      expect(revisionTuples(comparedDocumentXml, AI_AUTHOR).length).toBeGreaterThan(0);
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
