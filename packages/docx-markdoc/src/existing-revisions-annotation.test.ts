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

async function partXml(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(path)!.async('string');
}

function physicalText(document: DocxDocument): string {
  return document.getParagraphs().map((paragraph) => getParagraphRuns(paragraph).map((run) => run.text).join('')).join('\n');
}

async function revisedSource(kind: 'ins' | 'del', annotation: 'comment' | 'footnote', reply: boolean | 'nested' = false): Promise<Buffer> {
  const revision = kind === 'ins' ? INSERTION : DELETION;
  const base = await buildDocxFromBodyXml(`<w:p>${revision}<w:r><w:t>Alpha beta gamma.</w:t></w:r></w:p>`);
  const document = await DocxDocument.load(base);
  document.insertParagraphBookmarks(`revision-${kind}-${annotation}`);
  const paragraphId = document.buildDocumentView().nodes[0]!.id;
  // Visible text is "Inserted Alpha beta gamma." for an insertion and
  // "Alpha beta gamma." for a deletion (deleted text is not visible). Every
  // anchor below lands outside the revision container itself.
  if (annotation === 'comment') {
    const point = kind === 'ins' ? { start: 15, end: 19 } : { start: 5, end: 5 };
    const root = await document.addComment({ paragraphId, ...point, author: 'Reviewer', initials: 'RV', text: 'Original note' });
    if (reply) {
      const firstReply = await document.addCommentReply({ parentCommentId: root.commentId, author: 'Responder', initials: 'RS', text: 'Original reply' });
      if (reply === 'nested') await document.addCommentReply({ parentCommentId: firstReply.commentId, author: 'Leaf', initials: 'LF', text: 'Original leaf' });
    }
  } else {
    await document.addFootnote({ paragraphId, visibleOffset: kind === 'ins' ? 14 : 7, text: 'Original footnote' });
  }
  return (await document.toBuffer({ cleanBookmarks: false })).buffer;
}

function rewriteFirstParagraph(markdoc: string): string {
  const paragraph = requireMarkdoc(markdoc).scaffold[0]!;
  return markdoc.replace(
    new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`),
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}\n{% before %}\n${paragraph.originalText}\n{% /before %}\n{% after %}\nRewritten.\n{% /after %}\n{% /change %}`,
  );
}

describe('annotation-only projection preserves existing revisions', () => {
  test('[SDX-MDOC-92] edits a ranged comment without changing an existing insertion', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment'));
    const before = await revisionXml(imported.anchoredSource);
    expect(before).toHaveLength(1);
    const markdoc = imported.markdoc.replace('Original note', 'Edited note')
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(await revisionXml(result.tracked)).toEqual(before);
    expect(result.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1, projectedRevisionCount: 1 });
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
    expect(before).toHaveLength(1);
    const markdoc = imported.markdoc.replace('Original note', 'Edited point note')
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(await revisionXml(result.tracked)).toEqual(before);
    expect(result.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1, projectedRevisionCount: 1 });
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
    expect(before).toHaveLength(1);
    const asFootnote = imported.markdoc.replace('Original footnote', 'Edited footnote')
      .replace('source-presentation="footnote"', 'source-presentation="footnote" presentation="footnote"');
    const footnoteResult = await compileMarkdoc(imported.anchoredSource, asFootnote);
    expect(await revisionXml(footnoteResult.tracked)).toEqual(before);
    expect(footnoteResult.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1, projectedRevisionCount: 1 });
    expect((await (await DocxDocument.load(footnoteResult.tracked)).getFootnotes())[0]?.text).toContain('Edited footnote');

    const asComment = asFootnote.replace(' presentation="footnote"', ' presentation="comment"');
    const commentResult = await compileMarkdoc(imported.anchoredSource, asComment);
    expect(await revisionXml(commentResult.tracked)).toEqual(before);
    expect(commentResult.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1 });
    expect((await (await DocxDocument.load(commentResult.tracked)).getComments())[0]?.text).toContain('Edited footnote');
  });

  test('[SDX-MDOC-96] preserves reply topology beside an existing revision', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment', true));
    const before = await revisionXml(imported.anchoredSource);
    expect(before).toHaveLength(1);
    const markdoc = imported.markdoc.replace('Original reply', 'Edited reply')
      .replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(await revisionXml(result.tracked)).toEqual(before);
    const comments = await (await DocxDocument.load(result.tracked)).getComments();
    expect(comments[0]?.replies[0]?.text).toBe('Edited reply');
    expect(result.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 1, projectedRevisionCount: 1 });
  });

  for (const presentation of ['omit', 'footnote'] as const) {
    test(`[SDX-MDOC-96] removes a reply comment when an in-place root keeps the reply as ${presentation}`, async () => {
      const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment', true));
      const markdoc = imported.markdoc
        .replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"')
        .replace(/(id="comment:1"[^\n]*?) presentation="comment"/u, `$1 presentation="${presentation}"`);
      const result = await compileMarkdoc(imported.anchoredSource, markdoc);
      const loaded = await DocxDocument.load(result.tracked);
      const comments = await loaded.getComments();

      expect(comments).toHaveLength(1);
      expect(comments[0]?.replies).toHaveLength(0);
      if (presentation === 'footnote') expect(await loaded.getFootnotes()).toHaveLength(1);
      expect(result.certificate.existingRevisionsPreserved).toBe(true);
    });
  }

  test('[SDX-MDOC-96] re-emits a moved root and its unchanged reply as one thread', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment', true));
    const markdoc = imported.markdoc
      .replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"')
      .replace(/(id="comment:0"[^\n]*? anchor-kind="range" paragraph="[^"]+" offset=)15( end-paragraph="[^"]+" end-offset=)19/u, '$116$220');

    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const comments = await (await DocxDocument.load(result.tracked)).getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ startTextOffset: 16, endTextOffset: 20 });
    expect(comments[0]?.replies).toHaveLength(1);
    expect(result.certificate.existingRevisionsPreserved).toBe(true);
  });

  test('[SDX-MDOC-96] re-emits changed comment metadata instead of silently retaining source authorship', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment'));
    const markdoc = imported.markdoc
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"')
      .replace('author="Reviewer"', 'author="Jane Doe"')
      .replace('initials="RV"', 'initials="JD"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const comments = await (await DocxDocument.load(result.tracked)).getComments();

    expect(comments[0]).toMatchObject({ author: 'Jane Doe', initials: 'JD' });
    expect(result.certificate.existingRevisionsPreserved).toBe(true);
  });

  test('[SDX-MDOC-96] re-emits an entire three-level thread when an intermediate reply changes metadata', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment', 'nested'));
    const markdoc = imported.markdoc
      .replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"')
      .replace('author="Responder"', 'author="Jane Doe"');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const comments = await (await DocxDocument.load(result.tracked)).getComments();

    expect(comments[0]?.replies[0]).toMatchObject({ author: 'Jane Doe' });
    expect(comments[0]?.replies[0]?.replies[0]).toMatchObject({ author: 'Leaf', text: 'Original leaf' });
  });

  test('[SDX-MDOC-96] rejects reply re-parenting to a missing canonical comment instead of retaining the old parent', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment', true));
    const markdoc = imported.markdoc
      .replaceAll('source-presentation="comment"', 'source-presentation="comment" presentation="comment"')
      .replace('reply-parent="comment:0"', 'reply-parent="comment:999"');

    await expect(compileMarkdoc(imported.anchoredSource, markdoc)).rejects.toMatchObject({
      code: 'INVALID_MARKDOC',
      details: [{ code: 'ORPHAN_ANNOTATION_REPLY' }],
    });
  });

  test('[SDX-MDOC-95] fails atomically when existing revisions are combined with operative edits', async () => {
    const imported = await importDocxToMarkdoc(await revisedSource('ins', 'comment'));
    const edited = rewriteFirstParagraph(imported.markdoc)
      .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');

    await expect(compileMarkdoc(imported.anchoredSource, edited)).rejects.toMatchObject({
      code: 'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED',
      details: { existingRevisionCount: 1, operationIds: ['rewrite'] },
    });
  });

  for (const scenario of [
    { label: 'inside the insertion', start: 8, end: 12 },
    { label: 'starting at the insertion end', start: 19, end: 26 },
    { label: 'spanning the insertion', start: 6, end: 19 },
    { label: 'ending at the insertion start', start: 0, end: 6 },
    { label: 'as a point at the insertion start', start: 6, end: 6 },
  ]) {
    test(`[SDX-MDOC-97] edits a comment ${scenario.label} without moving revision-contained anchors`, async () => {
      const base = await buildDocxFromBodyXml(
        '<w:p><w:r><w:t>Alpha </w:t></w:r><w:del w:id="43" w:author="Prior Author" w:date="2026-08-02T12:00:00Z"><w:r><w:delText>Deleted text</w:delText></w:r></w:del><w:ins w:id="44" w:author="Prior Author" w:date="2026-08-03T12:00:00Z"><w:r><w:t>Inserted text</w:t></w:r></w:ins><w:r><w:t> gamma.</w:t></w:r></w:p>',
      );
      const document = await DocxDocument.load(base);
      document.insertParagraphBookmarks('revision-inline-comment');
      const paragraphId = document.buildDocumentView().nodes[0]!.id;
      const added = await document.addComment({ paragraphId, start: scenario.start, end: scenario.end, author: 'Reviewer', initials: 'RV', text: 'Original note' });
      const source = (await document.toBuffer({ cleanBookmarks: false })).buffer;
      const sourceDocumentXml = await partXml(source, 'word/document.xml');
      const imported = await importDocxToMarkdoc(source);
      const markdoc = imported.markdoc.replace('Original note', `Edited note ${scenario.label}`)
        .replace('source-presentation="comment"', 'source-presentation="comment" presentation="comment"');
      const result = await compileMarkdoc(imported.anchoredSource, markdoc);

      expect(await partXml(result.tracked, 'word/document.xml')).toBe(sourceDocumentXml);
      expect(await revisionXml(result.tracked)).toEqual(await revisionXml(source));
      expect(result.certificate).toMatchObject({ existingRevisionsPreserved: true, existingRevisionCount: 2, projectedRevisionCount: 2 });
      const comments = await (await DocxDocument.load(result.tracked)).getComments();
      expect(comments[0]).toMatchObject({ id: added.commentId, author: 'Reviewer', initials: 'RV', text: `Edited note ${scenario.label}` });
      const accepted = await DocxDocument.load(result.tracked);
      const rejected = await DocxDocument.load(result.tracked);
      await accepted.acceptChanges();
      await rejected.rejectChanges();
      expect(physicalText(accepted)).toContain('Inserted text');
      expect(physicalText(accepted)).not.toContain('Deleted text');
      expect(physicalText(rejected)).not.toContain('Inserted text');
      expect(physicalText(rejected)).toContain('Deleted text');
    });
  }

  test('[SDX-MDOC-98] rejects operative edits when the only existing revision is a property change', async () => {
    const base = await buildDocxFromBodyXml(
      '<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="45" w:author="Prior Author" w:date="2026-08-04T12:00:00Z"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>Alpha beta gamma.</w:t></w:r></w:p>',
    );
    const imported = await importDocxToMarkdoc(base);

    await expect(compileMarkdoc(imported.anchoredSource, rewriteFirstParagraph(imported.markdoc))).rejects.toMatchObject({
      code: 'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED',
      details: { existingRevisionCount: 1, operationIds: ['rewrite'] },
    });
  });
});
