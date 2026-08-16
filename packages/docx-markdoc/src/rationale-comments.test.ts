import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx, DocxDocument, getParagraphRuns, parseXml } from '@usejunior/docx-core';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const identity = {
  author: 'Synthetic Reviewer',
  initials: 'SR',
  date: new Date('2026-08-16T14:30:00.000Z'),
};
const compileOptions = { author: 'Synthetic Revision Author', date: identity.date, rationaleComments: identity };

function replaceOperation(markdoc: string, before: string, after: string, operationId = 'edit'): string {
  const paragraph = requireMarkdoc(markdoc).scaffold.find((item) => item.originalText === before);
  if (!paragraph) throw new Error(`Synthetic paragraph not found: ${before}`);
  const block = new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`);
  return markdoc.replace(block, [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="${operationId}" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', after, '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}

function rationale(operationId: string, visibility: 'internal' | 'external-facing', text = 'Explain the synthetic edit.'): string {
  return `\n{% rationale for="${operationId}" visibility="${visibility}" %}\n${text}\n{% /rationale %}\n`;
}

function compilationProfile(markdoc: string, externalComments: 'include' | 'omit' = 'include'): string {
  const profile = [
    '{% compilation revision-author="Profile Revision Author" comment-author="Profile Reviewer"',
    `comment-initials="PR" build-date="2026-08-16T14:30:00.000Z" external-comments="${externalComments}" /%}`,
  ].join(' ');
  return markdoc.replace('\n\n', `\n\n${profile}\n\n`);
}

async function parts(buffer: Buffer): Promise<{ document: string; comments: string }> {
  const zip = await JSZip.loadAsync(buffer);
  return {
    document: (await zip.file('word/document.xml')?.async('string')) ?? '',
    comments: (await zip.file('word/comments.xml')?.async('string')) ?? '',
  };
}

function componentCounts(xml: string): number[] {
  const doc = parseXml(xml);
  return ['commentRangeStart', 'commentRangeEnd', 'commentReference']
    .map((name) => doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', name).length);
}

describe('external-facing rationale comments', () => {
  itAllure('[SDX-MDOC-49][SDX-MDOC-58] compiles attributed external comments from Markdoc alone', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = compilationProfile(replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.'))
      + rationale('edit', 'external-facing', 'Synthetic explanation.');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const output = await parts(result.tracked);
    expect(output.comments).toContain('w:author="Profile Reviewer"');
    expect(output.comments).toContain('w:initials="PR"');
    expect(output.comments).toContain('w:date="2026-08-16T14:30:00.000Z"');
    expect(result.certificate.commentRendering).toMatchObject({
      configurationSource: 'markdoc',
      buildDate: '2026-08-16T14:30:00.000Z',
      revisionAuthor: 'Profile Revision Author',
      externalCommentsIncluded: true,
      internalCommentsIncluded: false,
      warnings: [],
    });
  });

  itAllure('[SDX-MDOC-52][SDX-MDOC-59] lets CLI policy suppress external comments with a warning', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = compilationProfile(replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.'))
      + rationale('edit', 'external-facing');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, {
      externalComments: false,
      configurationSource: 'cli',
    });
    expect((await parts(result.tracked)).comments).toBe('');
    expect(result.certificate.commentRendering).toMatchObject({
      configurationSource: 'cli',
      externalRationalesFound: 1,
      externalCommentsIncluded: false,
      warnings: ['1 external-facing rationale(s) were present but not included.'],
    });
  });

  itAllure('[SDX-MDOC-53][SDX-MDOC-54] requires explicit dangerous API capability for internal comments', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = compilationProfile(replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.'))
      + rationale('edit', 'internal', 'Internal synthetic explanation.');
    const ordinary = await compileMarkdoc(imported.anchoredSource, markdoc);
    expect((await parts(ordinary.tracked)).comments).toBe('');
    expect(ordinary.certificate.commentRendering.warnings).toEqual([]);
    const dangerous = await compileMarkdoc(imported.anchoredSource, markdoc, {
      dangerouslyIncludeInternalComments: true,
      configurationSource: 'api',
    });
    expect((await parts(dangerous.tracked)).comments).toContain('Internal synthetic explanation.');
    expect(dangerous.certificate.commentRendering.internalCommentsIncluded).toBe(true);
  });

  itAllure('[SDX-MDOC-34][SDX-MDOC-37] selects external visibility and emits deterministic identity', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.')
      + rationale('edit', 'external-facing', 'Synthetic explanation.');
    const first = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const second = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const firstParts = await parts(first.tracked);
    const secondParts = await parts(second.tracked);
    expect(firstParts.comments).toBe(secondParts.comments);
    expect(firstParts.document).toBe(secondParts.document);
    expect(firstParts.comments).toContain('w:author="Synthetic Reviewer"');
    expect(firstParts.comments).toContain('w:initials="SR"');
    expect(firstParts.comments).toContain('w:date="2026-08-16T14:30:00.000Z"');
    expect(firstParts.comments).toContain('Synthetic explanation.');
  });

  itAllure('[SDX-MDOC-36] rejects duplicate selected rationales before compilation', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.')
      + rationale('edit', 'external-facing', 'First synthetic explanation.')
      + rationale('edit', 'external-facing', 'Second synthetic explanation.');
    await expect(compileMarkdoc(imported.anchoredSource, markdoc, compileOptions)).rejects.toMatchObject({
      code: 'INVALID_MARKDOC',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_EXTERNAL_RATIONALE' })]),
    });
  });

  for (const visibility of ['External-facing', 'external-facing ', '']) {
    itAllure(`[SDX-MDOC-57] rejects ${visibility || 'unclassified'} rationale visibility`, async () => {
      const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
      const imported = await importDocxToMarkdoc(source);
      const visibilityAttribute = visibility ? ` visibility="${visibility}"` : '';
      const markdoc = replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.')
        + `\n{% rationale for="edit"${visibilityAttribute} %}\nPrivate synthetic note.\n{% /rationale %}\n`;
      await expect(compileMarkdoc(imported.anchoredSource, markdoc, compileOptions))
        .rejects.toMatchObject({ code: 'INVALID_MARKDOC' });
    });
  }

  itAllure('[SDX-MDOC-35][SDX-MDOC-51] leaves internal rationale passive without a warning', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.') + rationale('edit', 'internal');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    expect((await parts(result.tracked)).comments).toBe('');
    expect(result.certificate.commentRendering.warnings).toEqual([]);
  });

  itAllure('[SDX-MDOC-50][SDX-MDOC-56] rejects invalid compilation metadata identically before replay', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const duplicate = imported.markdoc.replace('\n\n', [
      '\n\n{% compilation build-date="not-a-date" /%}',
      '{% compilation build-date="2026-08-16T14:30:00.000Z" /%}\n\n',
    ].join('\n'));
    let validateCode = '';
    try {
      requireMarkdoc(duplicate);
    } catch (error) {
      validateCode = (error as { code?: string }).code ?? '';
    }
    await expect(compileMarkdoc(imported.anchoredSource, duplicate)).rejects.toMatchObject({ code: validateCode });
    expect(validateCode).toBe('INVALID_MARKDOC');
  });

  itAllure('[SDX-MDOC-38] rejects missing or invalid comment identity without fallback', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Alpha term.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Alpha term.', 'Beta term.') + rationale('edit', 'external-facing');
    await expect(compileMarkdoc(imported.anchoredSource, markdoc, {
      rationaleComments: { author: ' ', initials: 'SR' },
    })).rejects.toMatchObject({ code: 'INVALID_RATIONALE_COMMENT_IDENTITY' });
  });

  itAllure('[SDX-MDOC-39] anchors insertion comments to inserted text only', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Anchor text.', 'Tail text.'] });
    const imported = await importDocxToMarkdoc(source);
    const anchor = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const insertion = `\n{% insert-after anchor="${anchor.id}" operation="add" %}\n{% after %}\nInserted synthetic text.\n{% /after %}\n{% /insert-after %}`;
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc + insertion + rationale('add', 'external-facing'), compileOptions);
    const xml = (await parts(result.tracked)).document;
    expect(xml).toMatch(/commentRangeStart[\s\S]*?<w:ins\b[\s\S]*?Inserted synthetic text\.[\s\S]*?<\/w:ins>[\s\S]*?commentRangeEnd/u);
  });

  itAllure('[SDX-MDOC-40] anchors deletion comments around deleted markup', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Keep prefix obsolete words keep suffix.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Keep prefix obsolete words keep suffix.', 'Keep prefix keep suffix.', 'remove')
      + rationale('remove', 'external-facing');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const xml = (await parts(result.tracked)).document;
    const range = xml.slice(xml.indexOf('commentRangeStart'), xml.indexOf('commentRangeEnd'));
    expect(range).toContain('<w:del');
    expect(range).toContain('obsolete');
    expect(range).toContain('words');
  });

  itAllure('[SDX-MDOC-41][SDX-MDOC-44] replacement comments prefer inserted text and preserve projections', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Keep old value here.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Keep old value here.', 'Keep new value here.')
      + rationale('edit', 'external-facing', 'Why the value changed.');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const xml = (await parts(result.tracked)).document;
    expect(xml).toMatch(/commentRangeStart[\s\S]*?<w:ins\b[\s\S]*?new[\s\S]*?<\/w:ins>[\s\S]*?commentRangeEnd/u);
    const range = xml.slice(xml.indexOf('commentRangeStart'), xml.indexOf('commentRangeEnd'));
    expect(range).not.toContain('old');
    expect(result.certificate).toMatchObject({
      rejectAllEqualsSource: true,
      acceptAllEqualsClean: true,
      rejectAllFormattingEqualsSource: true,
      acceptAllFormattingEqualsClean: true,
    });
    const accepted = await DocxDocument.load(result.tracked);
    const rejected = await DocxDocument.load(result.tracked);
    await accepted.acceptChanges();
    await rejected.rejectChanges();
    const projected = await Promise.all([
      accepted.toBuffer({ cleanBookmarks: false }),
      rejected.toBuffer({ cleanBookmarks: false }),
    ]);
    for (const artifact of [
      imported.anchoredSource,
      result.clean,
      result.tracked,
      projected[0].buffer,
      projected[1].buffer,
    ]) {
      expect(JSON.stringify(await parts(artifact))).not.toContain('safe-docx-rationale-');
    }
  });

  itAllure('[SDX-MDOC-44] preserves boundary whitespace exposed by private marker removal', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Letter of Intent'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Letter of Intent', 'Mutual Letter of Intent')
      + rationale('edit', 'external-facing');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const xml = (await parts(result.tracked)).document;
    expect(xml).toContain('<w:t xml:space="preserve">Mutual </w:t>');
    expect(result.certificate).toMatchObject({ acceptAllEqualsClean: true, rejectAllEqualsSource: true });
  });

  itAllure('[SDX-MDOC-42] emits one bounded comment across a multi-paragraph insertion', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Anchor text.', 'Tail text.'] });
    const imported = await importDocxToMarkdoc(source);
    const anchor = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const insertion = `\n{% insert-after anchor="${anchor.id}" operation="add-many" %}\n{% after %}\nFirst inserted paragraph.\n\nSecond inserted paragraph.\n{% /after %}\n{% /insert-after %}`;
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc + insertion + rationale('add-many', 'external-facing'), compileOptions);
    expect(componentCounts((await parts(result.tracked)).document)).toEqual([1, 1, 1]);
  });

  itAllure('[SDX-MDOC-43] fails closed when an operation has no anchorable tracked content', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Unchanged synthetic text.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Unchanged synthetic text.', 'Unchanged synthetic text.')
      + rationale('edit', 'external-facing');
    await expect(compileMarkdoc(imported.anchoredSource, markdoc, compileOptions))
      .rejects.toMatchObject({ code: 'RATIONALE_ANCHOR_UNAVAILABLE' });
  });

  itAllure('[SDX-MDOC-48] accept and reject retain balanced comments and collapse removed anchors', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Keep old value here.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Keep old value here.', 'Keep new value here.')
      + rationale('edit', 'external-facing');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const accepted = await DocxDocument.load(result.tracked);
    const rejected = await DocxDocument.load(result.tracked);
    await accepted.acceptChanges();
    await rejected.rejectChanges();
    for (const projected of [accepted, rejected]) {
      const buffer = (await projected.toBuffer({ cleanBookmarks: false })).buffer;
      const xml = (await parts(buffer)).document;
      expect(componentCounts(xml)).toEqual([1, 1, 1]);
      expect((await projected.getComments())).toHaveLength(1);
    }
    expect(getParagraphRuns(rejected.getParagraphs()[0]!).map((run) => run.text).join('')).toBe('Keep old value here.');
  });

  itAllure('[SDX-MDOC-47] keeps rationale fixtures synthetic and public-safe', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Synthetic source text.'] });
    const imported = await importDocxToMarkdoc(source);
    const markdoc = replaceOperation(imported.markdoc, 'Synthetic source text.', 'Synthetic revised text.')
      + rationale('edit', 'external-facing', 'Synthetic public rationale.');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, compileOptions);
    const serialized = JSON.stringify(await parts(result.tracked));
    expect(serialized).toContain('Synthetic public rationale.');
    expect(serialized).not.toMatch(/matter|client|privileged|private corpus/iu);
  });
});
