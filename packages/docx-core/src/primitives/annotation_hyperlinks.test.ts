import { readFile } from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { buildSyntheticDocx } from '../integration/synthetic-docx-fixture.js';
import { testAllure } from '../testing/allure-test.js';
import { DocxDocument } from './document.js';
import { OOXML, W } from './namespaces.js';
import { ensureExternalHyperlinkRelationships, parseRelationshipEntries, relationshipPartPath } from './relationships.js';
import { createRevisionContext } from './track-changes-emitter.js';
import { serializeXml } from './xml.js';
import { createZipBuffer, DocxZip } from './zip.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Annotation hyperlinks' });
const hyperlinkConformance = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.2.3' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' });

const LINK = 'https://example.com/annotation-link';
const OTHER = 'https://example.com/other-link';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DEAL_BY_DEAL = new URL(
  '../../../../tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx',
  import.meta.url,
);

async function loadWithParagraph(tag: string): Promise<{ document: DocxDocument; paragraphId: string }> {
  const document = await DocxDocument.load(await buildSyntheticDocx({ paragraphs: ['Alpha beta gamma.'] }));
  document.insertParagraphBookmarks(tag);
  return { document, paragraphId: document.buildDocumentView().nodes[0]!.id };
}

function reviewer() {
  return createRevisionContext({ author: 'Reviewer', date: '2026-09-01T00:00:00Z' });
}

const linkedBody = [{ runs: [
  { text: 'see ' },
  { text: 'link', style: { bold: true }, hyperlink: { destination: LINK } },
  { text: ' end' },
] }];

async function footnoteXml(document: DocxDocument, noteId: number): Promise<string> {
  const xml = serializeXml((await document.getFootnotesXmlClone())!);
  return new RegExp(`<w:footnote w:id="${noteId}".*?</w:footnote>`, 'su').exec(xml)![0];
}

async function externalTargets(document: DocxDocument, sourcePart: string): Promise<Map<string, string>> {
  const entries = parseRelationshipEntries(await document.getPartRelationshipsXmlClone(sourcePart));
  return new Map([...entries.values()]
    .filter((entry) => entry.type === OOXML.HYPERLINK_REL_TYPE && entry.targetMode === 'External')
    .map((entry) => [entry.id, entry.target ?? '']));
}

describe('annotation hyperlink emission (#956)', () => {
  hyperlinkConformance('tracked footnote insertion keeps linked runs ordered inside their hyperlink wrapper', async () => {
    const { document, paragraphId } = await loadWithParagraph('tracked-link-insert');
    await document.addFootnote(
      { paragraphId, visibleOffset: 5, text: 'see link end', presentation: { body: linkedBody } },
      reviewer(),
    );
    const note = await footnoteXml(document, 1);
    expect(note.replace(/<[^>]+>/gu, '').trim()).toBe('see link end');
    expect(note).toMatch(
      /<w:ins [^>]*>(?:<w:r>.*?<\/w:r>)+<\/w:ins><w:hyperlink r:id="rId1"><w:ins [^>]*><w:r><w:rPr>.*?<\/w:rPr><w:t>link<\/w:t><\/w:r><\/w:ins><\/w:hyperlink><w:ins [^>]*><w:r>.*?<\/w:r><\/w:ins><\/w:p>/su,
    );
    expect((await document.getFootnotesXmlClone())!.documentElement.lookupNamespaceURI('r')).toBe(OOXML.R_NS);
    expect(await externalTargets(document, 'word/footnotes.xml')).toEqual(new Map([['rId1', LINK]]));
  });

  hyperlinkConformance('tracked footnote deletion marks linked runs deleted without detaching them from the link', async () => {
    const { document, paragraphId } = await loadWithParagraph('tracked-link-delete');
    await document.addFootnote({ paragraphId, visibleOffset: 5, text: 'see link end', presentation: { body: linkedBody } });
    await document.deleteFootnote({ noteId: 1 }, reviewer());
    const note = await footnoteXml(document, 1);
    expect(note).toMatch(/<w:hyperlink r:id="rId1"><w:del [^>]*><w:r>.*?<w:delText>link<\/w:delText><\/w:r><\/w:del><\/w:hyperlink>/su);
    expect(note).not.toMatch(/<w:t[ >]/u);
    expect(note.match(/<w:del /gu)).toHaveLength(3);
  });

  hyperlinkConformance('footnote text replacement handles linked runs in both tracked and direct modes', async () => {
    const tracked = await loadWithParagraph('tracked-link-update');
    await tracked.document.addFootnote({ paragraphId: tracked.paragraphId, visibleOffset: 5, text: 'see link end', presentation: { body: linkedBody } });
    await tracked.document.updateFootnoteText({ noteId: 1, newText: 'replaced' }, reviewer());
    const trackedNote = await footnoteXml(tracked.document, 1);
    expect(trackedNote).toMatch(/<w:hyperlink r:id="rId1"><w:del [^>]*>.*?<w:delText>link<\/w:delText>.*?<\/w:del><\/w:hyperlink>/su);
    expect(trackedNote).toMatch(/<\/w:hyperlink><w:del [^>]*>.*?<\/w:del><w:ins [^>]*><w:r>.*?<\/w:r><w:r><w:t>replaced<\/w:t><\/w:r><\/w:ins><\/w:p>/su);

    const direct = await loadWithParagraph('direct-link-update');
    await direct.document.addFootnote({ paragraphId: direct.paragraphId, visibleOffset: 5, text: 'see link end', presentation: { body: linkedBody } });
    await direct.document.updateFootnoteText({ noteId: 1, newText: 'replaced' });
    const directNote = await footnoteXml(direct.document, 1);
    expect(directNote).not.toContain('<w:hyperlink');
    expect(directNote.replace(/<[^>]+>/gu, '').trim()).toBe('replaced');
  });

  hyperlinkConformance('tracked deletion of a real linked footnote keeps the link and marks every run deleted', async () => {
    const document = await DocxDocument.load(await readFile(DEAL_BY_DEAL));
    await document.deleteFootnote({ noteId: 6 }, reviewer());
    const note = await footnoteXml(document, 6);
    expect(note).toMatch(/<w:hyperlink r:id="rId1" w:history="1"><w:del [^>]*>.*?<w:delText[^>]*>https:\/\/ilpa\.org.*?<\/w:delText>.*?<\/w:del><\/w:hyperlink>/su);
    expect(note).not.toMatch(/<w:t[ >]/u);
  });

  hyperlinkConformance('comment bodies and replies group adjacent destinations and share part relationships', async () => {
    const { document, paragraphId } = await loadWithParagraph('comment-links');
    const root = await document.addComment({
      paragraphId, start: 0, end: 5, author: 'Author', text: 'ab plain c\nd',
      body: [
        { runs: [
          { text: 'a', hyperlink: { destination: LINK } },
          { text: 'b', style: { bold: true }, hyperlink: { destination: LINK } },
          { text: ' plain ' },
          { text: 'c', hyperlink: { destination: OTHER } },
        ] },
        { runs: [{ text: 'd', hyperlink: { destination: LINK } }] },
      ],
    });
    await document.addCommentReply({
      parentCommentId: root.commentId, author: 'Replier', text: 'reply',
      body: [{ runs: [{ text: 'reply', hyperlink: { destination: OTHER } }] }],
    });
    const comments = (await document.getCommentsXmlClone())!;
    expect(comments.documentElement.lookupNamespaceURI('r')).toBe(OOXML.R_NS);
    const firstHyperlink = comments.getElementsByTagNameNS(OOXML.W_NS, W.hyperlink).item(0)!;
    expect(firstHyperlink.getAttributeNS(OOXML.R_NS, 'id')).toBe('rId1');

    const xml = serializeXml(comments);
    const rootXml = /<w:comment w:id="0".*?<\/w:comment>/su.exec(xml)![0];
    expect(rootXml.match(/<w:hyperlink r:id="rId\d+">/gu)).toEqual([
      '<w:hyperlink r:id="rId1">', '<w:hyperlink r:id="rId2">', '<w:hyperlink r:id="rId1">',
    ]);
    expect(rootXml).toMatch(/<w:hyperlink r:id="rId1"><w:r><w:t>a<\/w:t><\/w:r><w:r><w:rPr>.*?<\/w:rPr><w:t>b<\/w:t><\/w:r><\/w:hyperlink>/su);
    const replyXml = /<w:comment w:id="1".*?<\/w:comment>/su.exec(xml)![0];
    expect(replyXml).toContain('<w:hyperlink r:id="rId2"><w:r><w:t>reply</w:t></w:r></w:hyperlink>');
    expect(await externalTargets(document, 'word/comments.xml')).toEqual(new Map([['rId1', LINK], ['rId2', OTHER]]));
  });

  hyperlinkConformance('rejects empty destinations and reuses only matching external relationships without rewriting the part', async () => {
    const { document, paragraphId } = await loadWithParagraph('empty-destination');
    await expect(document.addComment({
      paragraphId, start: 0, end: 5, author: 'Author', text: 'x',
      body: [{ runs: [{ text: 'x', hyperlink: { destination: '' } }] }],
    })).rejects.toThrow('External hyperlink destinations must be non-empty');

    const relsPath = 'word/_rels/footnotes.xml.rels';
    const zip = await DocxZip.load(await createZipBuffer({
      [relsPath]:
        `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OOXML.HYPERLINK_REL_TYPE}" Target="${LINK}"/>` +
        `<Relationship Id="rId3" Type="${OOXML.HYPERLINK_REL_TYPE}" Target="${LINK}" TargetMode="External"/>` +
        '</Relationships>',
    }));
    const before = await zip.readText(relsPath);
    expect(await ensureExternalHyperlinkRelationships(zip, 'word/footnotes.xml', [LINK])).toEqual(new Map([[LINK, 'rId3']]));
    expect(await zip.readText(relsPath)).toBe(before);
    expect(await ensureExternalHyperlinkRelationships(zip, 'word/footnotes.xml', [])).toEqual(new Map());
    expect(relationshipPartPath('document.xml')).toBe('_rels/document.xml.rels');
    expect(relationshipPartPath('word/comments.xml')).toBe('word/_rels/comments.xml.rels');
  });
});
