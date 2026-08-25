import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { DocxDocument, getParagraphRuns } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const test = testAllure.epic('DOCX Markdoc')
  .withLabels({ feature: 'Canonical annotations with existing revisions' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' });

const INSERTION = '<w:ins w:id="41" w:author="Prior Author" w:date="2026-08-01T12:00:00Z"><w:r><w:t>Inserted </w:t></w:r></w:ins>';
const DELETION = '<w:del w:id="42" w:author="Prior Author" w:date="2026-08-02T12:00:00Z"><w:r><w:delText>Deleted </w:delText></w:r></w:del>';

async function revisionXml(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  return [...xml.matchAll(/<w:(?:ins|del)\b(?:[^>]*\/>|[\s\S]*?<\/w:(?:ins|del)>)/gu)]
    .map((match) => match[0])
    .filter((revision) => revision.includes('w:author="Prior Author"'));
}

function physicalText(document: DocxDocument): string {
  return document.getParagraphs().map((paragraph) => getParagraphRuns(paragraph).map((run) => run.text).join('')).join('\n');
}

async function revisedSource(kind: 'ins' | 'del', annotation: 'comment' | 'footnote', reply = false): Promise<Buffer> {
  const revision = kind === 'ins' ? INSERTION : DELETION;
  const base = await buildDocxFromBodyXml(`<w:p>${annotation === 'footnote' ? '' : revision}<w:r><w:t>Alpha beta gamma.</w:t></w:r></w:p>`);
  const document = await DocxDocument.load(base);
  document.insertParagraphBookmarks(`revision-${kind}-${annotation}`);
  const paragraphId = document.buildDocumentView().nodes[0]!.id;
  if (annotation === 'comment') {
    const point = kind === 'ins' ? { start: 15, end: 19 } : { start: 5, end: 5 };
    const root = await document.addComment({ paragraphId, ...point, author: 'Reviewer', initials: 'RV', text: 'Original note' });
    if (reply) await document.addCommentReply({ parentCommentId: root.commentId, author: 'Responder', initials: 'RS', text: 'Original reply' });
  } else {
    await document.addFootnote({ paragraphId, visibleOffset: 7, text: 'Original footnote' });
  }
  const output = (await document.toBuffer({ cleanBookmarks: false })).buffer;
  if (annotation !== 'footnote') return output;
  // Add the unrelated revision after the ordinary footnote has been created;
  // the revision must not wrap the annotation reference itself.
  const zip = await JSZip.loadAsync(output);
  const xml = await zip.file('word/document.xml')!.async('string');
  zip.file('word/document.xml', xml.replace('<w:r><w:t>Alpha beta gamma.</w:t></w:r>', `${revision}<w:r><w:t>Alpha beta gamma.</w:t></w:r>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('annotation-only projection preserves existing revisions', () => {
  test('[SDX-MDOC-92] edits a ranged comment without changing an existing insertion', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment'));
    const before = await revisionXml(imported.anchoredSource);
    const markdoc = imported.markdoc.replace('Original note', 'Edited note')
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(await revisionXml(result.tracked)).toEqual(before);
    expect(result.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1 });
    expect((await (await DocxDocument.load(result.tracked)).getComments())[0]?.text).toBe('Edited note');

    const accepted = await DocxDocument.load(result.tracked);
    const rejected = await DocxDocument.load(result.tracked);
    await accepted.acceptChanges();
    await rejected.rejectChanges();
    expect(physicalText(accepted)).toContain('Inserted Alpha beta gamma.');
    expect(physicalText(rejected)).not.toContain('Inserted ');
  });

  test('[SDX-MDOC-93] edits a point comment without changing an existing deletion', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('del', 'comment'));
    const before = await revisionXml(imported.anchoredSource);
    const markdoc = imported.markdoc.replace('Original note', 'Edited point note')
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(await revisionXml(result.tracked)).toEqual(before);
    const comment = (await (await DocxDocument.load(result.tracked)).getComments())[0]!;
    expect(comment).toMatchObject({ text: 'Edited point note', startTextOffset: 5, endTextOffset: 5 });
    const accepted = await DocxDocument.load(result.tracked);
    const rejected = await DocxDocument.load(result.tracked);
    await accepted.acceptChanges();
    await rejected.rejectChanges();
    expect(physicalText(accepted)).not.toContain('Deleted ');
    expect(physicalText(rejected)).toContain('Deleted Alpha beta gamma.');
  });

  test('[SDX-MDOC-94] edits and re-presents a footnote while preserving revisions', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'footnote'));
    const before = await revisionXml(imported.anchoredSource);
    const asFootnote = imported.markdoc.replace('Original footnote', 'Edited footnote')
      .replace('source-presentation="footnote"', 'source-presentation="footnote" presentation="footnote"');
    const footnoteResult = await compileMarkdoc(imported.anchoredSource, asFootnote);
    expect(await revisionXml(footnoteResult.tracked)).toEqual(before);
    expect((await (await DocxDocument.load(footnoteResult.tracked)).getFootnotes())[0]?.text).toContain('Edited footnote');

    const asComment = asFootnote.replace(' presentation="footnote"', ' presentation="comment"');
    const commentResult = await compileMarkdoc(imported.anchoredSource, asComment);
    expect(await revisionXml(commentResult.tracked)).toEqual(before);
    expect((await (await DocxDocument.load(commentResult.tracked)).getComments())[0]?.text).toContain('Edited footnote');
  });

  test('[SDX-MDOC-96] preserves reply topology beside an existing revision', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment', true));
    const before = await revisionXml(imported.anchoredSource);
    const markdoc = imported.markdoc.replace('Original reply', 'Edited reply')
      .replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(await revisionXml(result.tracked)).toEqual(before);
    const comments = await (await DocxDocument.load(result.tracked)).getComments();
    expect(comments[0]?.replies[0]?.text).toBe('Edited reply');
    expect(result.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1 });
  });

  test('[SDX-MDOC-95] fails atomically when existing revisions are combined with operative edits', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment'));
    const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const edited = imported.markdoc.replace(
      new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`),
      `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}\n{% before %}\n${paragraph.originalText}\n{% /before %}\n{% after %}\nRewritten.\n{% /after %}\n{% /change %}`,
    ).replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');

    await expect(compileMarkdoc(imported.anchoredSource, edited)).rejects.toMatchObject({
      code: 'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED',
      details: { existingRevisionCount: 1, operationIds: ['rewrite'] },
    });
  });
});
