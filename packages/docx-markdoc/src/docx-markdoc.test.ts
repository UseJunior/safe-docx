import { describe, expect, it } from 'vitest';
import { buildSyntheticDocx, DocxDocument } from '@usejunior/docx-core';
import { compileMarkdoc } from './compile.js';
import { DocxMarkdocError } from './errors.js';
import { exportAdjacentRevisionPairs, exportEditPairs } from './export.js';
import { importDocxToMarkdoc } from './import.js';
import { inspectMarkdocSource } from './inspect.js';
import { parseMarkdoc, requireMarkdoc } from './markdoc.js';

function withBeforeAfterEdit(markdoc: string): string {
  const opening = /\{% para ([^\n]+) %\}\nThe Old Name\./;
  const match = markdoc.match(opening);
  if (!match?.[1]) throw new Error('fixture paragraph not found');
  return markdoc.replace(
    /\{% para ([^\n]+) %\}\nThe Old Name\.\n\{% \/para %\}/,
    `{% change ${match[1]} operation="rename" format="inherit-source-paragraph" %}\n{% before %}\nThe Old Name.\n{% /before %}\n{% after %}\nThe New Name.\n{% /after %}\n{% /change %}`,
  ) + '\n{% rationale for="rename" category="correction" %}\nUse the current name.\n{% /rationale %}\n';
}

describe('brownfield Markdoc authoring', () => {
  it('[SDX-MDOC-01][SDX-MDOC-02] imports a complete hash-pinned scaffold without mutating input', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.', 'Second paragraph.'] });
    const imported = await importDocxToMarkdoc(original);
    expect(imported.anchoredSource.equals(original)).toBe(false);
    expect(imported.source.paragraphs).toBe(2);
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.scaffold.map((paragraph) => paragraph.originalText)).toEqual(['The Old Name.', 'Second paragraph.']);
    expect(ir.scaffold.every((paragraph) => paragraph.id.startsWith('_bk_'))).toBe(true);
  });

  it('[SDX-MDOC-03][SDX-MDOC-07][SDX-MDOC-13] compiles canonical clean states to verified clean and tracked DOCX', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.', 'Second paragraph.'] });
    const imported = await importDocxToMarkdoc(original);
    const markdoc = withBeforeAfterEdit(imported.markdoc);
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, {
      author: 'Test Author',
      date: new Date('2026-08-12T00:00:00.000Z'),
    });
    expect(result.certificate.passed).toBe(true);
    expect(result.certificate.rejectAllEqualsSource).toBe(true);
    expect(result.certificate.acceptAllEqualsClean).toBe(true);
    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual(['The New Name.', 'Second paragraph.']);
    expect(result.ir.rationales).toEqual([{ operationId: 'rename', text: 'Use the current name.', category: 'correction' }]);
  });

  it('[SDX-MDOC-05][SDX-MDOC-15] replaces a canonical before/after paragraph and exports an edit pair', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Original provision.', 'Context paragraph.'] });
    const imported = await importDocxToMarkdoc(original);
    const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const replaceBlock = [
      `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Original provision.', '{% /before %}',
      '{% after %}', 'Revised provision.', '{% /after %}',
      '{% /change %}',
    ].join('\n');
    const firstBlock = new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`);
    const markdoc = imported.markdoc.replace(firstBlock, replaceBlock);
    expect(markdoc).toContain('Original provision.');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const pairs = exportEditPairs(result.ir, { verified: result.certificate.passed });
    expect(pairs[0]).toMatchObject({ before: 'Original provision.', after: 'Revised provision.', verified: true });
  });

  it('[SDX-MDOC-04][SDX-MDOC-08] rejects nested revisions and orphan rationale', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Text.'] });
    const imported = await importDocxToMarkdoc(original);
    const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const invalid = [
      `{% source sha256="${imported.source.sha256}" paragraphs=1 /%}`,
      `{% para id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="bad" %}`,
      '{% del %}A {% ins %}nested{% /ins %} edit{% /del %}',
      '{% /para %}',
      '{% rationale for="missing" %}Orphan.{% /rationale %}',
    ].join('\n');
    expect(() => requireMarkdoc(invalid)).toThrow(DocxMarkdocError);
  });

  it('[SDX-MDOC-06][SDX-MDOC-14] fails before output when the source hash drifts', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Text.'] });
    const imported = await importDocxToMarkdoc(original);
    const other = await buildSyntheticDocx({ paragraphs: ['Other.'] });
    await expect(compileMarkdoc(other, imported.markdoc)).rejects.toMatchObject({ code: 'SOURCE_HASH_DRIFT' });
  });

  it('[SDX-MDOC-01] preserves source-significant boundary spaces and literal entities', async () => {
    const text = '  # Price * &amp; value  ';
    const original = await buildSyntheticDocx({ paragraphs: [text] });
    const imported = await importDocxToMarkdoc(original);
    expect(imported.markdoc).toContain('&#32;&#32;');
    expect(requireMarkdoc(imported.markdoc).scaffold[0]?.originalText).toBe(text);
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc);
    expect(result.certificate.passed).toBe(true);
  });

  it('[SDX-MDOC-05][SDX-MDOC-13] applies and verifies paragraph insertion and deletion from stable anchors', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Keep.', 'Delete me.', 'Stable tail context.'] });
    const imported = await importDocxToMarkdoc(original);
    const [keep, remove] = requireMarkdoc(imported.markdoc).scaffold;
    if (!keep || !remove) throw new Error('fixture paragraphs missing');
    const deletion = `{% change id="${remove.id}" fingerprint="${remove.fingerprint}" style="${remove.style}" operation="delete" format="inherit-source-paragraph" %}\n{% before %}\nDelete me.\n{% /before %}\n{% after %}\n{% /after %}\n{% /change %}`;
    const removeBlock = new RegExp(`\\{% para id="${remove.id}"[\\s\\S]*?\\{% /para %\\}`);
    const markdoc = `${imported.markdoc.replace(removeBlock, deletion)}\n{% insert-after anchor="${keep.id}" operation="insert" style-source="${keep.id}" %}\n{% after %}\nInserted.\n{% /after %}\n{% /insert-after %}\n`;
    const parsed = parseMarkdoc(markdoc);
    if (!parsed.valid) throw new Error(JSON.stringify(parsed.issues));
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual(['Keep.', 'Inserted.', 'Stable tail context.']);
    expect(result.certificate).toMatchObject({ rejectAllEqualsSource: true, acceptAllEqualsClean: true, passed: true });
  });

  it('[SDX-MDOC-16] compares adjacent revisions while retaining only supplied labels', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.'] });
    const imported = await importDocxToMarkdoc(original);
    const before = requireMarkdoc(imported.markdoc);
    const after = requireMarkdoc(withBeforeAfterEdit(imported.markdoc));
    expect(exportAdjacentRevisionPairs(before, after, { labels: { before: 'ai-draft', after: 'human-correction' } })[0]).toMatchObject({
      before: 'The Old Name.',
      after: 'The New Name.',
      labels: { before: 'ai-draft', after: 'human-correction' },
    });
    expect(exportAdjacentRevisionPairs(before, after)[0]).not.toHaveProperty('actor');
  });

  it('[SDX-MDOC-11] emits selective normalized detail and coalesces equivalent adjacent runs', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Alpha beta.'] });
    const imported = await importDocxToMarkdoc(original);
    const source = await DocxDocument.load(imported.anchoredSource);
    const paragraph = source.getParagraphs()[0]!;
    const run = getFirstElement(paragraph, 'r');
    const text = getFirstElement(run, 't');
    text.textContent = 'Alpha ';
    const clone = run.cloneNode(true) as Element;
    getFirstElement(clone, 't').textContent = 'beta.';
    paragraph.appendChild(clone);
    const splitSource = (await source.toBuffer({ cleanBookmarks: false })).buffer;
    const id = source.buildDocumentView().nodes[0]!.id;

    const detail = await inspectMarkdocSource(splitSource, { paragraphIds: [id] });

    expect(detail).toHaveLength(1);
    expect(detail[0]?.normalizedRuns).toEqual([
      expect.objectContaining({ text: 'Alpha beta.', sourceRunCount: 2 }),
    ]);
    expect(detail[0]?.paragraphPropertySha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(inspectMarkdocSource(splitSource, { paragraphIds: ['_bk_missing'] })).rejects.toMatchObject({ code: 'UNKNOWN_INSPECTION_ANCHOR' });
  });

  it('[SDX-MDOC-06][SDX-MDOC-10][SDX-MDOC-14] fails closed on anchor, fingerprint, scaffold, and mixed-format drift', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Alpha beta.', 'Context.'] });
    const imported = await importDocxToMarkdoc(original);
    const canonical = withCanonicalChange(imported.markdoc, 'Alpha beta.', 'Alpha revised.');
    await expect(compileMarkdoc(imported.anchoredSource, canonical.replace(/id="_bk_[^"]+"/, 'id="_bk_missing"')))
      .rejects.toMatchObject({ code: 'SCAFFOLD_ORDER_DRIFT' });
    await expect(compileMarkdoc(imported.anchoredSource, canonical.replace(/fingerprint="[^"]+"/, 'fingerprint="sha256:nfkc:stale"')))
      .rejects.toMatchObject({ code: 'FINGERPRINT_DRIFT' });
    const oneBlockRemoved = canonical.replace(/\n\{% para id="[^"]+"[\s\S]*?\{% \/para %\}\n?/, '\n');
    await expect(compileMarkdoc(imported.anchoredSource, oneBlockRemoved)).rejects.toMatchObject({ code: 'SCAFFOLD_DRIFT' });

    const mixed = await DocxDocument.load(imported.anchoredSource);
    const paragraph = mixed.getParagraphs()[0]!;
    const run = getFirstElement(paragraph, 'r');
    const text = getFirstElement(run, 't');
    text.textContent = 'Alpha ';
    const clone = run.cloneNode(true) as Element;
    getFirstElement(clone, 't').textContent = 'beta.';
    const rPr = clone.ownerDocument!.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
    rPr.appendChild(clone.ownerDocument!.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b'));
    clone.insertBefore(rPr, clone.firstChild);
    paragraph.appendChild(clone);
    const mixedBuffer = (await mixed.toBuffer({ cleanBookmarks: false })).buffer;
    const mixedImported = await importDocxToMarkdoc(mixedBuffer);
    const mixedChange = withCanonicalChange(mixedImported.markdoc, 'Alpha beta.', 'Alpha revised.');
    await expect(compileMarkdoc(mixedImported.anchoredSource, mixedChange)).rejects.toMatchObject({ code: 'MIXED_FORMATTING_REQUIRES_DETAIL' });
  });
});

function getFirstElement(parent: Element, localName: string): Element {
  const element = Array.from(parent.getElementsByTagName('*')).find((candidate) => candidate.localName === localName);
  if (!element) throw new Error(`Missing ${localName}`);
  return element;
}

function withCanonicalChange(markdoc: string, before: string, after: string): string {
  const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{% para ([^\\n]+) %\\}\\n${escaped}\\n\\{% /para %\\}`);
  const match = markdoc.match(pattern);
  if (!match?.[1]) throw new Error(`Fixture paragraph not found: ${before}`);
  return markdoc.replace(pattern, [
    `{% change ${match[1]} operation="change" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', after, '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}
