import { readFile } from 'node:fs/promises';
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx, DocxDocument } from '@usejunior/docx-core';
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

  runStyleConformance('[SDX-MDOC-103] admits real ILPA style runs before failing closed on hyperlinks', async () => {
    const fixtures = [
      '../../../tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx',
      '../../../tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx',
    ];
    for (const fixture of fixtures) {
      await expect(importDocxToMarkdoc(await readFile(new URL(fixture, import.meta.url)))).rejects.toMatchObject({
        code: 'ANNOTATION_IMPORT_UNSUPPORTED', details: { annotationId: 'footnote:6', element: 'w:hyperlink' },
      });
    }
  });

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
