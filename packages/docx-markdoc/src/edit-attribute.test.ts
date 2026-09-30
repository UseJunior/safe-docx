import { describe, expect } from 'vitest';
import { buildSyntheticDocx, DocxDocument } from '@usejunior/docx-core';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { DocxMarkdocError } from './errors.js';
import { importDocxToMarkdoc } from './import.js';
import { parseMarkdoc, requireMarkdoc } from './markdoc.js';
import type { SourceParagraph } from './types.js';

async function fixture(): Promise<{ source: Buffer; anchored: Buffer; markdoc: string; paragraph: SourceParagraph }> {
  const source = await buildSyntheticDocx({ paragraphs: ['Either party may terminate this Agreement.', 'Second paragraph.'] });
  const imported = await importDocxToMarkdoc(source);
  const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
  return { source, anchored: imported.anchoredSource, markdoc: imported.markdoc, paragraph };
}

function withChange(markdoc: string, paragraph: SourceParagraph, nameAttributes: string): string {
  const block = [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" ${nameAttributes} format="inherit-source-paragraph" %}`,
    '{% before %}', 'Either party may terminate this Agreement.', '{% /before %}',
    '{% after %}', 'Either party may terminate this Agreement after a thirty-day cure period.', '{% /after %}',
    '{% /change %}',
  ].join('\n');
  return markdoc.replace(new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`), block);
}

function invalidCodes(markdoc: string): string[] {
  const result = parseMarkdoc(markdoc);
  return result.valid ? [] : result.issues.map((issue) => issue.code);
}

describe('edit= names an edit', () => {
  itAllure('[SDX-MDOC-147] the new spelling resolves every cross-reference without warnings', async () => {
    const { anchored, markdoc, paragraph } = await fixture();
    const authored = [
      withChange(markdoc, paragraph, 'edit="add-cure-period"'),
      '{% rationale for="add-cure-period" visibility="internal" %}',
      'Give the counterparty a chance to cure before termination.',
      '{% /rationale %}',
      '{% requirement id="cure-before-termination" satisfied-by="add-cure-period" mode="all" %}',
      'Termination must be preceded by a cure period.',
      '{% /requirement %}',
      '{% change-set id="cure-period" edits="add-cure-period" atomic=true /%}',
      '',
    ].join('\n');
    const parsed = parseMarkdoc(authored);
    expect(parsed.valid).toBe(true);
    expect(parsed.warnings).toEqual([]);
    if (!parsed.valid) return;
    expect(parsed.ir.operations.map((operation) => operation.operationId)).toEqual(['add-cure-period']);
    expect(parsed.ir.rationales[0]?.operationId).toBe('add-cure-period');
    expect(parsed.ir.requirements?.[0]?.satisfiedBy).toEqual(['add-cure-period']);
    expect(parsed.ir.changeSets?.[0]?.operationIds).toEqual(['add-cure-period']);

    const result = await compileMarkdoc(anchored, authored, { author: 'Test Author', date: new Date('2026-09-27T00:00:00.000Z') });
    expect(result.certificate.passed).toBe(true);
    expect(result.certificate.appliedOperations).toEqual(['add-cure-period']);
    expect(result.certificate).not.toHaveProperty('markdocWarnings');
    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes[0]?.raw_text).toBe('Either party may terminate this Agreement after a thirty-day cure period.');
  });

  itAllure('[SDX-MDOC-147] edit= is read on every edit tag and on annotations', async () => {
    const { markdoc, paragraph } = await fixture();
    const second = requireMarkdoc(markdoc).scaffold[1]!;
    const authored = [
      withChange(markdoc, paragraph, 'edit="add-cure-period"'),
      `{% insert-after anchor="${second.id}" edit="add-notice" style-source="${second.id}" %}`,
      '{% after %}', 'Notices go to the addresses below.', '{% /after %}',
      '{% /insert-after %}',
      `{% annotation id="note-1" edit="add-cure-period" audience="internal" role="drafting-note" source-presentation="authored" source-kind="point" source-paragraph="${paragraph.id}" source-offset=0 anchor-kind="point" paragraph="${paragraph.id}" offset=0 %}`,
      '{% annotation-p %}', 'Cure period agreed on the call.', '{% /annotation-p %}',
      '{% /annotation %}',
      '',
    ].join('\n');
    const parsed = parseMarkdoc(authored);
    expect(parsed.valid).toBe(true);
    expect(parsed.warnings).toEqual([]);
    if (!parsed.valid) return;
    expect(parsed.ir.operations.map((operation) => operation.operationId)).toEqual(['add-cure-period', 'add-notice']);
    expect(parsed.ir.annotations.find((annotation) => annotation.id === 'note-1')?.operationId).toBe('add-cure-period');

    // Parse-level coverage of the remaining edit tags; anchors need not resolve until compile.
    const everyTag = [
      '{% source sha256="0000" paragraphs=2 /%}',
      '{% replace-source id="_bk_a" fingerprint="sha256:nfkc:a" style="Normal" edit="replace-a" format="inherit-source-paragraph" %}',
      'Replacement text.',
      '{% /replace-source %}',
      '{% delete-source id="_bk_b" fingerprint="sha256:nfkc:b" style="Normal" edit="delete-b" format="inherit-source-paragraph" /%}',
      '{% insert-before anchor="_bk_a" edit="insert-before-a" %}',
      '{% after %}', 'Inserted before.', '{% /after %}',
      '{% /insert-before %}',
      '{% insert-table-rows anchor="_bk_row" position="after" edit="add-rows" %}',
      '{% row %}', '{% cell text="Acme" /%}', '{% /row %}',
      '{% /insert-table-rows %}',
      '{% delete-table-row anchor="_bk_old_row" edit="remove-row" /%}',
      '',
    ].join('\n');
    const everyTagParsed = parseMarkdoc(everyTag);
    expect(everyTagParsed.valid).toBe(true);
    expect(everyTagParsed.warnings).toEqual([]);
    if (!everyTagParsed.valid) return;
    expect(everyTagParsed.ir.operations.map((operation) => [operation.kind, operation.operationId])).toEqual([
      ['replace-source', 'replace-a'],
      ['delete-source', 'delete-b'],
      ['insert-before', 'insert-before-a'],
      ['insert-table-rows', 'add-rows'],
      ['delete-table-row', 'remove-row'],
    ]);
  });

  itAllure('[SDX-MDOC-148] the removed operation= spelling fails validation with a migration message', async () => {
    const { anchored, markdoc, paragraph } = await fixture();
    const authored = [
      withChange(markdoc, paragraph, 'operation="add-cure-period"'),
      '{% rationale for="add-cure-period" visibility="internal" %}',
      'Give the counterparty a chance to cure before termination.',
      '{% /rationale %}',
      '{% change-set id="cure-period" operations="add-cure-period" atomic=true /%}',
      '',
    ].join('\n');
    const parsed = parseMarkdoc(authored);
    expect(parsed.valid).toBe(false);
    expect(parsed.warnings).toEqual([]);
    if (parsed.valid) return;
    expect(parsed.issues.map((issue) => [issue.code, issue.message])).toEqual([
      ['REMOVED_EDIT_ATTRIBUTE', 'operation= was renamed to edit=; rename the attribute on this change.'],
      ['REMOVED_EDIT_ATTRIBUTE', 'operations= was renamed to edits=; rename the attribute on this change-set.'],
    ]);
    expect(parsed.issues.every((issue) => Number.isInteger(issue.line))).toBe(true);

    expect(() => requireMarkdoc(authored)).toThrow(DocxMarkdocError);
    await expect(compileMarkdoc(anchored, authored, { author: 'Test Author', date: new Date('2026-09-27T00:00:00.000Z') }))
      .rejects.toThrow(DocxMarkdocError);

    const renamed = authored.replace('operation="add-cure-period"', 'edit="add-cure-period"').replace('operations="add-cure-period"', 'edits="add-cure-period"');
    const fixed = parseMarkdoc(renamed);
    expect(fixed.valid).toBe(true);
    expect(fixed.warnings).toEqual([]);
  });

  itAllure('[SDX-MDOC-148] operation= is rejected on every edit tag and on annotations', async () => {
    const tags = [
      '{% source sha256="0000" paragraphs=2 /%}',
      '{% replace-source id="_bk_a" fingerprint="sha256:nfkc:a" style="Normal" operation="replace-a" format="inherit-source-paragraph" %}',
      'Replacement text.',
      '{% /replace-source %}',
      '{% delete-source id="_bk_b" fingerprint="sha256:nfkc:b" style="Normal" operation="delete-b" format="inherit-source-paragraph" /%}',
      '{% insert-before anchor="_bk_a" operation="insert-before-a" %}',
      '{% after %}', 'Inserted before.', '{% /after %}',
      '{% /insert-before %}',
      '{% insert-after anchor="_bk_b" operation="insert-after-b" %}',
      '{% after %}', 'Inserted after.', '{% /after %}',
      '{% /insert-after %}',
      '{% insert-table-rows anchor="_bk_row" position="after" operation="add-rows" %}',
      '{% row %}', '{% cell text="Acme" /%}', '{% /row %}',
      '{% /insert-table-rows %}',
      '{% delete-table-row anchor="_bk_old_row" operation="remove-row" /%}',
      '{% annotation id="note-1" operation="replace-a" audience="internal" role="drafting-note" source-presentation="authored" source-kind="point" source-paragraph="_bk_a" source-offset=0 anchor-kind="point" paragraph="_bk_a" offset=0 %}',
      '{% annotation-p %}', 'Cure period agreed on the call.', '{% /annotation-p %}',
      '{% /annotation %}',
      '',
    ].join('\n');
    const parsed = parseMarkdoc(tags);
    expect(parsed.valid).toBe(false);
    if (parsed.valid) return;
    expect(parsed.issues.map((issue) => issue.message)).toEqual(
      ['replace-source', 'delete-source', 'insert-before', 'insert-after', 'insert-table-rows', 'delete-table-row', 'annotation']
        .map((tag) => `operation= was renamed to edit=; rename the attribute on this ${tag}.`),
    );
    expect(new Set(parsed.issues.map((issue) => issue.code))).toEqual(new Set(['REMOVED_EDIT_ATTRIBUTE']));
    expect(parseMarkdoc(tags.replaceAll('operation=', 'edit=')).valid).toBe(true);
  });

  itAllure('[SDX-MDOC-149] the removed spelling is rejected even beside the new one', async () => {
    const { markdoc, paragraph } = await fixture();
    const bothOnChange = withChange(markdoc, paragraph, 'edit="add-cure-period" operation="add-cure-period"');
    expect(invalidCodes(bothOnChange)).toEqual(['REMOVED_EDIT_ATTRIBUTE']);
    expect(() => requireMarkdoc(bothOnChange)).toThrow(DocxMarkdocError);

    const bothOnChangeSet = `${withChange(markdoc, paragraph, 'edit="add-cure-period"')}\n{% change-set id="cure-period" edits="add-cure-period" operations="add-cure-period" atomic=true /%}\n`;
    expect(invalidCodes(bothOnChangeSet)).toEqual(['REMOVED_EDIT_ATTRIBUTE']);

    const missing = withChange(markdoc, paragraph, '');
    expect(invalidCodes(missing)).toEqual(['MISSING_EDIT_NAME']);
    const empty = withChange(markdoc, paragraph, 'edit=""');
    expect(invalidCodes(empty)).toEqual(['MISSING_EDIT_NAME']);
  });

  itAllure('[SDX-MDOC-147] diagnostics about edit names say edit', async () => {
    const { markdoc, paragraph } = await fixture();
    const second = requireMarkdoc(markdoc).scaffold[1]!;
    const duplicate = [
      withChange(markdoc, paragraph, 'edit="add-cure-period"'),
      `{% insert-after anchor="${second.id}" edit="add-cure-period" style-source="${second.id}" %}`,
      '{% after %}', 'Notices go to the addresses below.', '{% /after %}',
      '{% /insert-after %}',
      '{% rationale for="missing-edit" visibility="internal" %}', 'Orphan.', '{% /rationale %}',
      '',
    ].join('\n');
    const result = parseMarkdoc(duplicate);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_EDIT', message: 'Duplicate edit name add-cure-period.' }),
      expect.objectContaining({ code: 'ORPHAN_RATIONALE', message: 'Rationale targets unknown edit missing-edit.' }),
    ]));
    expect(result.issues.map((issue) => issue.code)).not.toContain('DUPLICATE_OPERATION');
  });

  // Imported Word comments carry no edit reference (import.ts builds them without
  // operationId), so this proves the emitter writes no old spelling and is
  // deterministic; the parser tests above cover `edit=` on an annotation.
  itAllure('[SDX-MDOC-150] import emits only the new spelling and is byte-identical across runs', async () => {
    const base = await buildSyntheticDocx({ paragraphs: ['Either party may terminate this Agreement.'] });
    const document = await DocxDocument.load(base);
    document.insertParagraphBookmarks('edit-attribute-test');
    const paragraphId = document.buildDocumentView().nodes[0]!.id;
    await document.addComment({ paragraphId, start: 0, end: 6, author: 'Alice', initials: 'AL', text: 'Existing comment' });
    const source = (await document.toBuffer({ cleanBookmarks: false })).buffer;

    const first = await importDocxToMarkdoc(source);
    const second = await importDocxToMarkdoc(source);
    expect(first.markdoc).toContain('{% annotation ');
    expect(first.markdoc).not.toMatch(/\boperations?=/u);
    expect(second.markdoc).toBe(first.markdoc);
    const parsed = parseMarkdoc(first.markdoc);
    expect(parsed.valid).toBe(true);
    expect(parsed.warnings).toEqual([]);
  });
});
