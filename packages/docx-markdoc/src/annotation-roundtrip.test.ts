import { readFile } from 'node:fs/promises';
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildDocxFromParts, buildSyntheticDocx, DocxDocument, OOXML, parseRelationshipEntries, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const test = testAllure.epic('DOCX Markdoc').withLabels({ feature: 'Canonical annotations' });
const commentsConformance = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.3' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' });
const footnoteConformance = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });

async function sourceWithComment(start: number, end: number, reply = false): Promise<Buffer> {
  const base = await buildSyntheticDocx({ paragraphs: ['Alpha beta gamma.'] });
  const document = await DocxDocument.load(base);
  document.insertParagraphBookmarks('annotation-test');
  const paragraphId = document.buildDocumentView().nodes[0]!.id;
  const root = await document.addComment({
    paragraphId, start, end, author: 'Alice', initials: 'AL',
    text: 'Original note', body: [{ runs: [{ text: 'Original ', style: { bold: true, color: '884400' } }, { text: 'note', style: { italic: true, highlight: 'yellow' } }] }],
  });
  if (reply) await document.addCommentReply({ parentCommentId: root.commentId, author: 'Bob', initials: 'BB', text: 'Reply' });
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

async function sourceWithFootnote(offset: number): Promise<Buffer> {
  const base = await buildSyntheticDocx({ paragraphs: ['Alpha beta gamma.'] });
  const document = await DocxDocument.load(base);
  document.insertParagraphBookmarks('annotation-test');
  const paragraphId = document.buildDocumentView().nodes[0]!.id;
  await document.addFootnote({ paragraphId, visibleOffset: offset, text: 'Substantive note' });
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

async function sourceWithNamedStyleComment(styles: string): Promise<Buffer> {
  const base = await buildSyntheticDocx({ paragraphs: ['Alpha beta gamma.'] });
  const document = await DocxDocument.load(base);
  document.insertParagraphBookmarks('annotation-style-test');
  const paragraphId = document.buildDocumentView().nodes[0]!.id;
  await document.addComment({ paragraphId, start: 0, end: 5, author: 'Style Tester', initials: 'ST', text: 'Named style' });
  const zip = await JSZip.loadAsync((await document.toBuffer({ cleanBookmarks: false })).buffer);
  const commentsXml = await zip.file('word/comments.xml')!.async('string');
  zip.file('word/comments.xml', commentsXml.replace(
    '<w:t>Named style</w:t>',
    '<w:rPr><w:rStyle w:val="AnnotationChild"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>Named style</w:t>',
  ));
  zip.file('word/styles.xml', `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${styles}</w:styles>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const PRIMARY_LINK = 'https://example.com/annotation-primary';
const SECONDARY_LINK = 'https://example.com/annotation-secondary';
const HYPERLINK_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

async function sourceWithLinkedAnnotation(source: 'comment' | 'footnote'): Promise<Buffer> {
  const stylesXml =
    `<w:styles xmlns:w="${OOXML.W_NS}">` +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr></w:style>` +
    `</w:styles>`;
  const base = await buildDocxFromParts({
    bodyXml: '<w:p><w:r><w:t>Alpha beta gamma.</w:t></w:r></w:p>',
    stylesXml,
    documentRelEntries: [
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    ],
  });
  const document = await DocxDocument.load(base);
  document.insertParagraphBookmarks(`linked-${source}`);
  const paragraphId = document.buildDocumentView().nodes[0]!.id;
  const body = [{ runs: [
    { text: 'Before ' },
    { text: 'Primary ', style: { styleId: 'Hyperlink', fontSizeHalfPoints: 18 }, hyperlink: { destination: PRIMARY_LINK } },
    { text: 'formatted', style: { styleId: 'Hyperlink', fontSizeHalfPoints: 18, bold: true }, hyperlink: { destination: PRIMARY_LINK } },
    { text: ' between ' },
    { text: 'Secondary', style: { italic: true }, hyperlink: { destination: SECONDARY_LINK } },
    { text: ' and ' },
    { text: 'Primary again', style: { underline: true }, hyperlink: { destination: PRIMARY_LINK } },
    { text: ' after' },
  ] }];
  if (source === 'comment') {
    await document.addComment({ paragraphId, start: 0, end: 5, author: 'Link Tester', initials: 'LT', text: 'linked', body });
  } else {
    await document.addFootnote({ paragraphId, visibleOffset: 5, text: 'linked', presentation: { body } });
  }
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

async function withDestinationRelationshipCollision(buffer: Buffer, destination: 'comment' | 'footnote'): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const relsPath = destination === 'comment' ? 'word/_rels/comments.xml.rels' : 'word/_rels/footnotes.xml.rels';
  zip.file(relsPath,
    `<Relationships xmlns="${RELATIONSHIPS_NS}">` +
    '<Relationship Id="rId1" Type="https://example.com/relationships/reserved" Target="https://example.com/reserved" TargetMode="External"/>' +
    '</Relationships>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function withoutFootnoteBookmarks(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const footnotesXml = await zip.file('word/footnotes.xml')!.async('string');
  zip.file('word/footnotes.xml', footnotesXml.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/gu, ''));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function projectEveryAnnotationAs(markdoc: string, destination: 'comment' | 'footnote'): string {
  return markdoc.replace(/source-presentation="(?:comment|footnote)"/gu, (sourcePresentation) =>
    `${sourcePresentation} presentation="${destination}"`);
}

function relationshipEntries(xml: string): ReturnType<typeof parseRelationshipEntries> {
  return parseRelationshipEntries(parseXml(xml));
}

describe('canonical annotation round trips', () => {
  commentsConformance('[SDX-MDOC-82] imports and re-emits exact ranged comments with editable structured bodies', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(6, 10));
    const annotation = imported.annotations[0]!;
    expect(annotation).toMatchObject({
      audience: 'unspecified', semanticRole: 'unspecified', sourcePresentation: 'comment',
      sourceAnchor: { kind: 'range', start: { offset: 6 }, end: { offset: 10 } },
      anchor: { kind: 'range', start: { offset: 6 }, end: { offset: 10 } },
      author: 'Alice', initials: 'AL',
    });
    expect(annotation.body[0]?.runs).toEqual([
      { text: 'Original ', style: { bold: true, color: '884400' } },
      { text: 'note', style: { italic: true, highlight: 'yellow' } },
    ]);
    const markdoc = imported.markdoc.replace('Original', 'Edited')
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const comments = await (await DocxDocument.load(result.tracked)).getComments();
    expect(comments[0]).toMatchObject({ startTextOffset: 6, endTextOffset: 10 });
    expect(comments[0]?.paragraphs[0]?.text).toBe('Edited note');
  });

  commentsConformance('[SDX-MDOC-83] preserves point comments without guessing a selected range', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(5, 5));
    expect(imported.annotations[0]?.sourceAnchor).toMatchObject({ kind: 'point', point: { offset: 5 } });
    const markdoc = imported.markdoc.replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const comment = (await (await DocxDocument.load(result.tracked)).getComments())[0]!;
    expect(comment.startTextOffset).toBe(5);
    expect(comment.endTextOffset).toBe(5);
    expect(result.certificate.annotationRendering.dispositions[0]).toMatchObject({ as: 'comment', lossy: false });
  });

  footnoteConformance('[SDX-MDOC-84] imports footnotes as substantive exact points and requires explicit conversion choices', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithFootnote(7));
    expect(imported.annotations[0]).toMatchObject({
      semanticRole: 'substantive-footnote', audience: 'unspecified', sourcePresentation: 'footnote',
      sourceAnchor: { kind: 'point', point: { offset: 7 } },
    });
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc, {
      annotationPresentation: { unspecified: { as: 'comment' } },
    })).rejects.toMatchObject({ code: 'EXPLICIT_ANNOTATION_DECISION_REQUIRED' });
    const explicit = imported.markdoc.replace('source-presentation="footnote"', 'source-presentation="footnote" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, explicit);
    const comment = (await (await DocxDocument.load(result.tracked)).getComments())[0]!;
    expect(comment.startTextOffset).toBe(7);
    expect(comment.endTextOffset).toBe(7);
    expect(result.certificate.annotationRendering.dispositions[0]).toMatchObject({ as: 'comment', lossy: false });
  });

  const runStyleConformance = test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.29' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.38' });

  runStyleConformance('[SDX-MDOC-101] preserves inherited named run styles and direct sizes across annotation projections', async () => {
    const source = await sourceWithNamedStyleComment([
      '<w:style w:type="character" w:styleId="AnnotationParent"><w:name w:val="Annotation Parent"/><w:rPr><w:b/><w:color w:val="884400"/></w:rPr></w:style>',
      '<w:style w:type="character" w:styleId="AnnotationChild"><w:name w:val="Annotation Child"/><w:basedOn w:val="AnnotationParent"/></w:style>',
    ].join(''));
    const imported = await importDocxToMarkdoc(source);
    expect(imported.annotations[0]?.body[0]?.runs).toEqual([
      { text: 'Named style', style: { bold: true, color: '884400', styleId: 'AnnotationChild', fontSizeHalfPoints: 18 } },
    ]);
    expect(imported.markdoc).toContain('style="AnnotationChild" size=18 bold=true color="884400"');

    const asComment = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(
      'source-presentation="comment"', 'source-presentation="comment" presentation="comment"',
    ));
    const commentXml = await (await JSZip.loadAsync(asComment.tracked)).file('word/comments.xml')!.async('string');
    expect(commentXml).toContain('<w:rStyle w:val="AnnotationChild"/>');
    expect(commentXml).toContain('<w:sz w:val="18"/>');

    const asFootnote = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(
      'source-presentation="comment"', 'source-presentation="comment" presentation="footnote"',
    ));
    const footnoteXml = await (await JSZip.loadAsync(asFootnote.tracked)).file('word/footnotes.xml')!.async('string');
    expect(footnoteXml).toContain('<w:rStyle w:val="AnnotationChild"/>');
    expect(footnoteXml).toContain('<w:sz w:val="18"/>');
  });

  runStyleConformance('[SDX-MDOC-102] rejects missing and cyclic named annotation styles', async () => {
    await expect(importDocxToMarkdoc(await sourceWithNamedStyleComment(''))).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', reason: 'missing-style' },
    });
    await expect(importDocxToMarkdoc(await sourceWithNamedStyleComment([
      '<w:style w:type="character" w:styleId="AnnotationChild"><w:basedOn w:val="AnnotationParent"/></w:style>',
      '<w:style w:type="character" w:styleId="AnnotationParent"><w:basedOn w:val="AnnotationChild"/></w:style>',
    ].join('')))).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', reason: 'cyclic-style' },
    });
    await expect(importDocxToMarkdoc(await sourceWithNamedStyleComment(
      '<w:style w:type="paragraph" w:styleId="AnnotationChild"><w:name w:val="Wrong style type"/></w:style>',
    ))).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', reason: 'non-character-style', styleType: 'paragraph' },
    });
  });

  runStyleConformance('[SDX-MDOC-103] admits real ILPA style runs and external hyperlinks before the next bookmark boundary', async () => {
    const wof = await readFile(new URL('../../../tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx', import.meta.url));
    await expect(importDocxToMarkdoc(wof)).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'footnote:19', element: 'w:bookmarkStart' },
    });

    // The Deal-By-Deal fixture on origin/main has no bookmark markers in
    // footnote:19, so advancing beyond footnote:6 imports it completely.
    const dealByDeal = await readFile(new URL('../../../tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx', import.meta.url));
    const imported = await importDocxToMarkdoc(dealByDeal);
    expect(imported.annotations.find((annotation) => annotation.id === 'footnote:6')?.body[0]?.runs)
      .toContainEqual(expect.objectContaining({ hyperlink: { destination: PRIMARY_LINK.replace('example.com/annotation-primary', 'ilpa.org/wp-content/uploads/2017/06/ILPA-Subscription-Lines-of-Credit-and-Alignment-of-Interests-June-2017.pdf') } }));
  });

  const hyperlinkConformance = test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.2.3' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' });

  hyperlinkConformance('[SDX-MDOC-104] preserves external links and formatting across all annotation projections', async () => {
    for (const source of ['comment', 'footnote'] as const) {
      const imported = await importDocxToMarkdoc(await sourceWithLinkedAnnotation(source));
      const linkedRuns = imported.annotations[0]!.body[0]!.runs.filter((run) => run.hyperlink);
      expect(linkedRuns.map((run) => run.hyperlink?.destination)).toEqual([PRIMARY_LINK, PRIMARY_LINK, SECONDARY_LINK, PRIMARY_LINK]);
      expect(linkedRuns[0]).toMatchObject({ text: 'Primary ', style: { styleId: 'Hyperlink', fontSizeHalfPoints: 18 } });
      expect(linkedRuns[1]).toMatchObject({ text: 'formatted', style: { styleId: 'Hyperlink', fontSizeHalfPoints: 18, bold: true } });
      expect(imported.markdoc).toContain(`href="${PRIMARY_LINK}" style="Hyperlink" size=18`);
      const parsedBody = requireMarkdoc(imported.markdoc).annotations[0]!.body;
      expect(parsedBody.flatMap((paragraph) => paragraph.runs).filter((run) => run.hyperlink)).toEqual(linkedRuns);
      expect(parsedBody.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'))
        .toBe(imported.annotations[0]!.body.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'));

      for (const destination of ['comment', 'footnote'] as const) {
        const markdoc = imported.markdoc.replace(
          `source-presentation="${source}"`,
          `source-presentation="${source}" presentation="${destination}"`,
        );
        const projected = await compileMarkdoc(imported.anchoredSource, markdoc);
        const zip = await JSZip.loadAsync(projected.tracked);
        const partPath = destination === 'comment' ? 'word/comments.xml' : 'word/footnotes.xml';
        const relsPath = destination === 'comment' ? 'word/_rels/comments.xml.rels' : 'word/_rels/footnotes.xml.rels';
        const partXml = await zip.file(partPath)!.async('string');
        const rels = relationshipEntries(await zip.file(relsPath)!.async('string'));
        const externalLinks = [...rels.values()].filter((entry) => entry.type === HYPERLINK_REL_TYPE && entry.targetMode === 'External');
        expect(externalLinks.filter((entry) => entry.target === PRIMARY_LINK)).toHaveLength(1);
        expect(externalLinks.filter((entry) => entry.target === SECONDARY_LINK)).toHaveLength(1);
        expect(partXml).toContain('<w:hyperlink r:id=');
        expect(partXml).toContain('<w:rStyle w:val="Hyperlink"/>');
        expect(partXml).toContain('<w:sz w:val="18"/>');
        expect(partXml).toContain('Primary ');
        expect(partXml).toContain('formatted');
      }
    }
  });

  hyperlinkConformance('[SDX-MDOC-105] allocates repeated annotation destinations deterministically across relationship collisions', async () => {
    const source = await sourceWithLinkedAnnotation('footnote');
    const collided = await withDestinationRelationshipCollision(source, 'comment');
    const imported = await importDocxToMarkdoc(collided);
    const markdoc = imported.markdoc.replace(
      'source-presentation="footnote"',
      'source-presentation="footnote" presentation="comment"',
    );
    const first = await compileMarkdoc(imported.anchoredSource, markdoc);
    const second = await compileMarkdoc(imported.anchoredSource, markdoc);
    for (const projected of [first, second]) {
      const zip = await JSZip.loadAsync(projected.tracked);
      const entries = relationshipEntries(await zip.file('word/_rels/comments.xml.rels')!.async('string'));
      expect(entries.get('rId1')).toMatchObject({ type: 'https://example.com/relationships/reserved' });
      expect(entries.get('rId2')).toMatchObject({ target: PRIMARY_LINK, targetMode: 'External' });
      expect(entries.get('rId3')).toMatchObject({ target: SECONDARY_LINK, targetMode: 'External' });
      expect([...entries.values()].filter((entry) => entry.target === PRIMARY_LINK)).toHaveLength(1);
    }
    const firstRels = await (await JSZip.loadAsync(first.tracked)).file('word/_rels/comments.xml.rels')!.async('string');
    const secondRels = await (await JSZip.loadAsync(second.tracked)).file('word/_rels/comments.xml.rels')!.async('string');
    expect(secondRels).toBe(firstRels);
  });

  hyperlinkConformance('[SDX-MDOC-106] rejects malformed and invalid external annotation hyperlink relationships', async () => {
    const source = await sourceWithLinkedAnnotation('comment');
    const cases: Array<{ reason: string; mutatePart?: (xml: string) => string; mutateRels?: (xml: string) => string }> = [
      { reason: 'missing-hyperlink-id', mutatePart: (xml) => xml.replace(/ r:id="rId1"/u, '') },
      { reason: 'dangling-hyperlink-relationship', mutatePart: (xml) => xml.replace('r:id="rId1"', 'r:id="rId404"') },
      { reason: 'wrong-hyperlink-relationship-type', mutateRels: (xml) => xml.replace(HYPERLINK_REL_TYPE, 'https://example.com/relationships/image') },
      { reason: 'non-external-hyperlink', mutateRels: (xml) => xml.replace(' TargetMode="External"', '') },
      { reason: 'non-external-hyperlink', mutateRels: (xml) => xml.replace('TargetMode="External"', 'TargetMode="Internal"') },
      { reason: 'missing-hyperlink-target', mutateRels: (xml) => xml.replace(`Target="${PRIMARY_LINK}"`, 'Target=""') },
      { reason: 'unsupported-hyperlink-attribute', mutatePart: (xml) => xml.replace('<w:hyperlink ', '<w:hyperlink w:tooltip="not-represented" ') },
      { reason: 'unsupported-hyperlink-content', mutatePart: (xml) => xml.replace(/(<w:hyperlink[^>]*>)/u, '$1<w:p/>') },
    ];
    for (const item of cases) {
      const zip = await JSZip.loadAsync(source);
      if (item.mutatePart) zip.file('word/comments.xml', item.mutatePart(await zip.file('word/comments.xml')!.async('string')));
      if (item.mutateRels) zip.file('word/_rels/comments.xml.rels', item.mutateRels(await zip.file('word/_rels/comments.xml.rels')!.async('string')));
      await expect(importDocxToMarkdoc(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({
        code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', reason: item.reason },
      });
    }
  });

  hyperlinkConformance('[SDX-MDOC-107] keeps internal annotation anchors and bookmark markers fail-closed', async () => {
    const source = await sourceWithLinkedAnnotation('comment');
    const anchorZip = await JSZip.loadAsync(source);
    const commentXml = await anchorZip.file('word/comments.xml')!.async('string');
    anchorZip.file('word/comments.xml', commentXml.replace('<w:hyperlink ', '<w:hyperlink w:anchor="inside" '));
    await expect(importDocxToMarkdoc(await anchorZip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', reason: 'internal-anchor', anchor: 'inside' },
    });

    const bookmarkZip = await JSZip.loadAsync(source);
    bookmarkZip.file('word/comments.xml', commentXml.replace('</w:comment>', '<w:bookmarkStart w:id="9" w:name="inside"/></w:comment>'));
    await expect(importDocxToMarkdoc(await bookmarkZip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', element: 'w:bookmarkStart' },
    });
  });

  hyperlinkConformance('projects bookmark-stripped real ILPA hyperlinks both ways with valid destination-part relationships', async () => {
    const fixtures = [
      '../../../tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx',
      '../../../tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx',
    ];
    const expectedDestination = 'https://ilpa.org/wp-content/uploads/2017/06/ILPA-Subscription-Lines-of-Credit-and-Alignment-of-Interests-June-2017.pdf';
    const expectedText = expectedDestination;
    for (const fixture of fixtures) {
      const source = await withoutFootnoteBookmarks(await readFile(new URL(fixture, import.meta.url)));
      const imported = await importDocxToMarkdoc(source);
      const hyperlinkRun = imported.annotations
        .find((annotation) => annotation.id === 'footnote:6')!
        .body.flatMap((paragraph) => paragraph.runs)
        .find((run) => run.hyperlink);
      expect(hyperlinkRun).toMatchObject({
        text: expectedText,
        hyperlink: { destination: expectedDestination },
        style: { styleId: 'Hyperlink', fontSizeHalfPoints: 18 },
      });

      for (const destination of ['comment', 'footnote'] as const) {
        const projected = await compileMarkdoc(imported.anchoredSource, projectEveryAnnotationAs(imported.markdoc, destination));
        const zip = await JSZip.loadAsync(projected.tracked);
        const partPath = destination === 'comment' ? 'word/comments.xml' : 'word/footnotes.xml';
        const relsPath = destination === 'comment' ? 'word/_rels/comments.xml.rels' : 'word/_rels/footnotes.xml.rels';
        const partXml = await zip.file(partPath)!.async('string');
        const entries = relationshipEntries(await zip.file(relsPath)!.async('string'));
        const relationship = [...entries.values()].find((entry) => entry.target === expectedDestination);
        expect(relationship).toMatchObject({ type: HYPERLINK_REL_TYPE, targetMode: 'External' });
        expect(partXml).toContain(`<w:hyperlink r:id="${relationship!.id}">`);
        expect(partXml).toContain('<w:rStyle w:val="Hyperlink"/>');
        expect(partXml).toContain('<w:sz w:val="18"/>');
        expect(partXml).toContain(expectedText);
      }
    }
  }, 30_000);

  footnoteConformance('[SDX-MDOC-85] switches profiles and style-only recompiles from one immutable annotation', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(0, 5));
    const parsed = requireMarkdoc(imported.markdoc);
    parsed.annotations[0]!.audience = 'internal';
    const commentMarkdoc = imported.markdoc
      .replace('audience="unspecified"', 'audience="internal"')
      .replace('role="unspecified"', 'role="drafting-note"');
    const asComment = await compileMarkdoc(imported.anchoredSource, commentMarkdoc, {
      annotationPresentation: { internal: { as: 'comment' } },
    });
    const asFootnote = await compileMarkdoc(imported.anchoredSource, commentMarkdoc, {
      annotationPresentation: { internal: { as: 'footnote', prefix: [{ text: 'NOTE', style: { bold: true } }], separator: [{ text: ': ' }], bodyStyle: { color: '654321' } } },
    });
    expect((await (await DocxDocument.load(asComment.tracked)).getComments())).toHaveLength(1);
    const notes = await (await DocxDocument.load(asFootnote.tracked)).getFootnotes();
    expect(notes[0]?.text).toBe(' NOTE: Original note');
    expect(asFootnote.ir.annotations[0]?.body).toEqual(asComment.ir.annotations[0]?.body);
    expect(asFootnote.certificate.annotationRendering.profileDigest).not.toBe(asComment.certificate.annotationRendering.profileDigest);
    expect(asFootnote.certificate.annotationRendering.dispositions[0]).toMatchObject({ as: 'footnote', lossy: true });
  });

  test('[SDX-MDOC-91] records omission as an intentional lossy projection', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(0, 5));
    const omitted = imported.markdoc.replace('source-presentation="comment"', 'source-presentation="comment" presentation="omit"');
    const result = await compileMarkdoc(imported.anchoredSource, omitted);
    expect(result.certificate.annotationRendering.dispositions[0]).toMatchObject({ as: 'omit', lossy: true });
    expect(result.certificate.annotationRendering.warnings[0]).toContain('intentionally absent');
  });

  commentsConformance('[SDX-MDOC-86] retains reply topology and fails closed when the parent projection is incompatible', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(0, 5, true));
    expect(imported.annotations[1]?.replyParentId).toBe(imported.annotations[0]?.id);
    const explicitComments = imported.markdoc.replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, explicitComments);
    const roots = await (await DocxDocument.load(result.tracked)).getComments();
    expect(roots[0]?.replies[0]?.text).toBe('Reply');
    const lossy = imported.markdoc.replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="footnote"');
    const footnotes = await compileMarkdoc(imported.anchoredSource, lossy);
    expect(footnotes.certificate.annotationRendering.dispositions[1]).toMatchObject({ lossy: true });
  });

  test('[SDX-MDOC-87] fails closed for unrouted unspecified annotations and ambiguous edited anchors', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(7, 8));
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc)).rejects.toMatchObject({ code: 'UNROUTED_ANNOTATION' });
    const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const edited = imported.markdoc
      .replace(new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`), `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}\n{% before %}\nAlpha beta gamma.\n{% /before %}\n{% after %}\nAlpha changed gamma.\n{% /after %}\n{% /change %}`)
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    await expect(compileMarkdoc(imported.anchoredSource, edited)).rejects.toMatchObject({
      code: 'ANNOTATION_ANCHOR_AMBIGUOUS', details: { annotationId: imported.annotations[0]!.id },
    });
  });

  commentsConformance('[SDX-MDOC-88] remaps an anchor after an unambiguous operative-text edit', async () => {
    const imported = await importDocxToMarkdoc(await sourceWithComment(11, 16));
    const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const edited = imported.markdoc
      .replace(new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`), `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}\n{% before %}\nAlpha beta gamma.\n{% /before %}\n{% after %}\nNew Alpha beta gamma.\n{% /after %}\n{% /change %}`)
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, edited);
    const comment = (await (await DocxDocument.load(result.tracked)).getComments())[0]!;
    expect(comment.startTextOffset).toBe(15);
    expect(comment.endTextOffset).toBe(20);
    expect(result.ir.annotations[0]?.sourceAnchor).toMatchObject({ kind: 'range', start: { offset: 11 }, end: { offset: 16 } });
  });

  commentsConformance('[SDX-MDOC-90] rejects unsupported bodies and orphan reply topology atomically', async () => {
    const source = await sourceWithComment(0, 5, true);
    const unsupportedZip = await JSZip.loadAsync(source);
    const commentsXml = await unsupportedZip.file('word/comments.xml')!.async('string');
    unsupportedZip.file('word/comments.xml', commentsXml.replace('</w:comment>', '<w:tbl/></w:comment>'));
    const unsupported = await unsupportedZip.generateAsync({ type: 'nodebuffer' });
    await expect(importDocxToMarkdoc(unsupported)).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:0', element: 'w:tbl' },
    });
    expect(source.equals(unsupported)).toBe(false);

    const topologyZip = await JSZip.loadAsync(source);
    const extendedXml = await topologyZip.file('word/commentsExtended.xml')!.async('string');
    topologyZip.file('word/commentsExtended.xml', extendedXml.replace(/w15:paraIdParent="[^"]+"/u, 'w15:paraIdParent="FFFFFFFF"'));
    await expect(importDocxToMarkdoc(await topologyZip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({
      code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'comment:1', topology: 'orphan-or-cycle' },
    });
  });
});
