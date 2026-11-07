import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildSyntheticDocx, DocxDocument } from '@usejunior/docx-core';
import { importDocxToMarkdoc } from './import.js';
import { parseMarkdoc, requireMarkdoc } from './markdoc.js';
import { compileMarkdoc } from './compile.js';
import { exportAdjacentRevisionPairs } from './export.js';
import { projectAnnotations } from './presentation.js';
import type { CanonicalAnnotation } from './types.js';

async function fixture() {
  const imported = await importDocxToMarkdoc(await buildSyntheticDocx({ paragraphs: ['Acme source.', 'Other paragraph.'] }));
  return { imported, ir: requireMarkdoc(imported.markdoc) };
}

describe('Markdoc phase boundaries', () => {
  itAllure('rejects unresolved adjacent revisions on either side', async () => {
    const { ir } = await fixture();
    const unresolved = structuredClone(ir);
    unresolved.scaffold[0]!.originalTextFromSource = true;
    expect(() => exportAdjacentRevisionPairs(unresolved, ir)).toThrow(/Resolve source-only/);
    expect(() => exportAdjacentRevisionPairs(ir, unresolved)).toThrow(/Resolve source-only/);
    expect(exportAdjacentRevisionPairs(ir, ir)).toEqual([]);
  });

  itAllure('emits reply dependencies independently of declaration order and rejects impossible graphs', async () => {
    const { imported, ir } = await fixture();
    const point = { paragraphId: ir.scaffold[0]!.id, offset: 0 };
    const annotation = (id: string, replyParentId?: string): CanonicalAnnotation => ({
      id, replyParentId, body: [{ runs: [{ text: id }] }], audience: 'unspecified',
      semanticRole: 'note', sourcePresentation: 'comment', presentation: 'comment',
      sourceAnchor: { kind: 'point', point }, anchor: { kind: 'point', point },
    });
    ir.annotations = [annotation('child', 'parent'), annotation('parent')];
    const projected = await projectAnnotations(imported.anchoredSource, ir);
    const doc = await DocxDocument.load(projected.buffer);
    expect((await doc.getComments())[0]?.replies[0]?.text).toBe('child');
    const replay = await importDocxToMarkdoc(projected.buffer);
    const replayIr = requireMarkdoc(replay.markdoc);
    replayIr.annotations.reverse();
    for (const annotation of replayIr.annotations) annotation.presentation = 'comment';
    const inplace = await projectAnnotations(replay.anchoredSource, replayIr);
    expect((await (await DocxDocument.load(inplace.buffer)).getComments())[0]?.replies[0]?.text).toBe('child');
    ir.annotations = [annotation('self', 'self')];
    await expect(projectAnnotations(imported.anchoredSource, ir)).rejects.toMatchObject({ code: 'ANNOTATION_REPLY_CYCLE' });
    for (const presentation of ['omit', 'footnote'] as const) {
      ir.annotations = [annotation('child', 'parent'), { ...annotation('parent'), presentation }];
      await expect(projectAnnotations(imported.anchoredSource, ir)).rejects.toMatchObject({ code: 'ANNOTATION_REPLY_PROJECTION_UNRESOLVABLE' });
    }
  });

  itAllure('rejects cyclic reply declarations during parsing', async () => {
    const { imported, ir } = await fixture();
    const id = ir.scaffold[0]!.id;
    const annotation = (name: string, parent: string) => `{% annotation id="${name}" reply-parent="${parent}" audience="unspecified" role="note" source-presentation="comment" source-kind="point" source-paragraph="${id}" source-offset=0 anchor-kind="point" paragraph="${id}" offset=0 %}\nNote\n{% /annotation %}`;
    for (const declarations of [annotation('self', 'self'), annotation('a', 'b') + '\n' + annotation('b', 'a')]) {
      expect(parseMarkdoc(imported.markdoc + '\n' + declarations).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ANNOTATION_REPLY_CYCLE' })]));
    }
  });

  itAllure('reads insertion formatting before edits change the donor text', async () => {
    const { imported, ir } = await fixture();
    const p = ir.scaffold[0]!;
    const replacement = imported.markdoc.replace(/\{% para[^]*?\{% \/para %\}/u,
      `{% replace-source id="${p.id}" fingerprint="${p.fingerprint}" style="${p.style}" format="inherit-source-paragraph" edit="replace" %}\nChanged donor.\n{% /replace-source %}`);
    const insertion = `{% insert-after anchor="${ir.scaffold[1]!.id}" style-source="${p.id}" format-source="Acme" edit="insert" %}\n{% after %}\nInserted.\n{% /after %}\n{% /insert-after %}`;
    const result = await compileMarkdoc(imported.anchoredSource, replacement + '\n' + insertion);
    expect(result.certificate.deliveryReady).toBe(true);
    const document = await DocxDocument.load(result.clean);
    expect(document.getParagraphs().map((p) => p.textContent).join(' ')).toContain('Inserted.');
  });

  itAllure('rejects formatted multiline insertions before mutation', async () => {
    const { imported, ir } = await fixture();
    const insertion = `\n{% insert-after anchor="${ir.scaffold[0]!.id}" edit="insert" underline="single" %}\n{% after %}\nOne.\n\nTwo.\n{% /after %}\n{% /insert-after %}`;
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc + insertion))
      .rejects.toMatchObject({ code: 'INVALID_MARKDOC', issues: expect.arrayContaining([expect.objectContaining({ code: 'AMBIGUOUS_RUN_FORMAT_SCOPE' })]) });
  });

  itAllure('rejects deleted anchors regardless of insertion order', async () => {
    const { imported, ir } = await fixture();
    const p = ir.scaffold[0]!;
    const deleted = imported.markdoc.replace(/\{% para[^]*?\{% \/para %\}/u,
      `{% delete-source id="${p.id}" fingerprint="${p.fingerprint}" style="${p.style}" format="inherit-source-paragraph" edit="delete" /%}`);
    const insertion = `{% insert-after anchor="${p.id}" edit="insert" %}\n{% after %}\nNew.\n{% /after %}\n{% /insert-after %}`;
    for (const source of [deleted + '\n' + insertion, insertion + '\n' + deleted]) {
      await expect(compileMarkdoc(imported.anchoredSource, source)).rejects.toMatchObject({ code: 'CONFLICTING_INSERT_DEPENDENCY' });
    }
  });
});
