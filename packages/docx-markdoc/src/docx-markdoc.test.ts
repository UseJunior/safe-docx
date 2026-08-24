import { describe, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import JSZip from 'jszip';
import { buildDocxFromParts, buildSyntheticDocx, DocxDocument, parseXml } from '@usejunior/docx-core';
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
  ) + '\n{% rationale for="rename" visibility="internal" %}\nUse the current name.\n{% /rationale %}\n';
}

describe('brownfield Markdoc authoring', () => {
  itAllure('[SDX-MDOC-01][SDX-MDOC-02] imports a complete hash-pinned scaffold without mutating input', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.', 'Second paragraph.'] });
    const imported = await importDocxToMarkdoc(original);
    expect(imported.anchoredSource.equals(original)).toBe(false);
    expect(imported.source.paragraphs).toBe(2);
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.scaffold.map((paragraph) => paragraph.originalText)).toEqual(['The Old Name.', 'Second paragraph.']);
    expect(ir.scaffold.every((paragraph) => paragraph.id.startsWith('_bk_'))).toBe(true);
  });

  itAllure('[SDX-MDOC-03][SDX-MDOC-07][SDX-MDOC-13] compiles canonical clean states to verified clean and tracked DOCX', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.', 'Second paragraph.'] });
    const imported = await importDocxToMarkdoc(original);
    const markdoc = withBeforeAfterEdit(imported.markdoc);
    const result = await compileMarkdoc(imported.anchoredSource, markdoc, {
      author: 'Test Author',
      date: new Date('2026-08-12T00:00:00.000Z'),
    });
    expect(result.certificate.passed).toBe(true);
    expect(result.certificate).toMatchObject({ projectionPassed: true, draftCompletenessPassed: true, deliveryReady: true });
    expect(result.certificate.rejectAllEqualsSource).toBe(true);
    expect(result.certificate.acceptAllEqualsClean).toBe(true);
    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual(['The New Name.', 'Second paragraph.']);
    expect(result.ir.rationales).toEqual([{ operationId: 'rename', text: 'Use the current name.', visibility: 'internal' }]);
  });

  itAllure('[SDX-MDOC-05][SDX-MDOC-15] replaces a canonical before/after paragraph and exports an edit pair', async () => {
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
    expect(pairs[0]?.rationales).toEqual([]);
  });

  itAllure('[SDX-MDOC-63] exports paired rationale records without collapsing visibility', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Original provision.'] });
    const imported = await importDocxToMarkdoc(original);
    const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const markdoc = imported.markdoc.replace(
      new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`),
      `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}\n{% before %}\nOriginal provision.\n{% /before %}\n{% after %}\nRevised provision.\n{% /after %}\n{% /change %}`,
    ) + '\n{% rationale for="rewrite" visibility="internal" %}\nPrivate record.\n{% /rationale %}\n{% rationale for="rewrite" visibility="external-facing" %}\nPublic explanation.\n{% /rationale %}\n';
    const pair = exportEditPairs(requireMarkdoc(markdoc))[0]!;
    expect(pair.rationales).toEqual([
      { operationId: 'rewrite', text: 'Private record.', visibility: 'internal' },
      { operationId: 'rewrite', text: 'Public explanation.', visibility: 'external-facing' },
    ]);
    expect(pair).not.toHaveProperty('rationale');
    expect(pair).not.toHaveProperty('visibility');
  });

  itAllure('[SDX-MDOC-04][SDX-MDOC-08] rejects nested revisions and orphan rationale', async () => {
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

  itAllure('[SDX-MDOC-06][SDX-MDOC-14] fails before output when the source hash drifts', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Text.'] });
    const imported = await importDocxToMarkdoc(original);
    const other = await buildSyntheticDocx({ paragraphs: ['Other.'] });
    await expect(compileMarkdoc(other, imported.markdoc)).rejects.toMatchObject({ code: 'SOURCE_HASH_DRIFT' });
  });

  itAllure('[SDX-MDOC-01] preserves source-significant boundary spaces and literal entities', async () => {
    const text = '  # Price * &amp; value  ';
    const original = await buildSyntheticDocx({ paragraphs: [text] });
    const imported = await importDocxToMarkdoc(original);
    expect(imported.markdoc).toContain('&#32;&#32;');
    expect(requireMarkdoc(imported.markdoc).scaffold[0]?.originalText).toBe(text);
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc);
    expect(result.certificate.passed).toBe(true);
  });

  itAllure('[SDX-MDOC-01][SDX-MDOC-13] preserves trailing tabs in signature-label paragraphs during untouched replay', async () => {
    // Public form documents commonly use literal tabs as blank signature lines.
    // CommonMark discards them at line boundaries unless import encodes them.
    const original = await buildSyntheticDocx({ paragraphs: ['By:\t\t', 'Address:\t\t\n\t', 'Total Cash \nPurchase Price'] });
    const imported = await importDocxToMarkdoc(original);
    expect(imported.markdoc).toContain('By:&#9;&#9;');
    expect(imported.markdoc).toContain('Address:&#9;&#9;&#10;&#9;');
    expect(imported.markdoc).toContain('Total Cash &#10;Purchase Price');
    expect(requireMarkdoc(imported.markdoc).scaffold.map((paragraph) => paragraph.originalText))
      .toEqual(['By:\t\t', 'Address:\t\t\n\t', 'Total Cash \nPurchase Price']);
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc);
    expect(result.certificate).toMatchObject({ rejectAllEqualsSource: true, acceptAllEqualsClean: true, passed: true });
  });

  itAllure('[SDX-MDOC-01][SDX-MDOC-72][SDX-MDOC-81] rejects unsupported public NVCA footnotes atomically', async () => {
    const directory = fileURLToPath(new URL('../../../tests/test_documents/nvca-regression/', import.meta.url));
    for (const name of ['source.docx']) {
      await expect(importDocxToMarkdoc(await readFile(`${directory}${name}`))).rejects.toMatchObject({
        code: 'ANNOTATION_IMPORT_UNSUPPORTED',
        details: { annotationId: 'footnote:2', element: 'w:sz' },
      });
    }
  }, 60_000);

  itAllure('[SDX-MDOC-05][SDX-MDOC-13] applies and verifies paragraph insertion and deletion from stable anchors', async () => {
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

  itAllure('[SDX-MDOC-05][SDX-MDOC-09][SDX-MDOC-13] edits numbered paragraphs without changing list topology', async () => {
    const original = await numberedFixture();
    const imported = await importDocxToMarkdoc(original);
    const [first, second, third] = requireMarkdoc(imported.markdoc).scaffold;
    if (!first || !second || !third) throw new Error('numbered fixture paragraphs missing');

    let markdoc = withCanonicalChange(imported.markdoc, 'First item.', 'First item revised.', 'replace-numbered');
    markdoc = withCanonicalChange(markdoc, 'Second item.', '', 'delete-numbered');
    markdoc += [
      `{% insert-after anchor="${first.id}" operation="insert-numbered" style-source="${first.id}" %}`,
      '{% after %}', 'Inserted item.', '{% /after %}', '{% /insert-after %}', '',
    ].join('\n');

    const parsedNumbered = parseMarkdoc(markdoc);
    if (!parsedNumbered.valid) throw new Error(JSON.stringify(parsedNumbered.issues));
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual([
      'First item revised.', 'Inserted item.', 'Third item.',
    ]);
    expect(result.certificate).toMatchObject({ rejectAllEqualsSource: true, acceptAllEqualsClean: true, passed: true });

    const sourceTopology = await numberingTopology(imported.anchoredSource);
    const cleanTopology = await numberingTopology(result.clean);
    expect(sourceTopology.map((entry) => entry.signature)).toEqual([
      'ListParagraph|7|0|720|360', 'ListParagraph|7|0|720|360', 'ListParagraph|7|0|720|360',
    ]);
    expect(cleanTopology.map((entry) => entry.signature)).toEqual([
      'ListParagraph|7|0|720|360', 'ListParagraph|7|0|720|360', 'ListParagraph|7|0|720|360',
    ]);
    expect(cleanTopology.map((entry) => entry.text)).toEqual(['First item revised.', 'Inserted item.', 'Third item.']);

    const accepted = await DocxDocument.load(result.tracked);
    const rejected = await DocxDocument.load(result.tracked);
    await accepted.acceptChanges();
    await rejected.rejectChanges();
    expect(await numberingTopology((await accepted.toBuffer({ cleanBookmarks: false })).buffer)).toEqual(cleanTopology);
    expect((await numberingTopology((await rejected.toBuffer({ cleanBookmarks: false })).buffer)).map(({ text, signature }) => ({ text, signature })))
      .toEqual(sourceTopology.map(({ text, signature }) => ({ text, signature })));
  });

  itAllure('[SDX-MDOC-06][SDX-MDOC-14] requires an explicit numbered insertion style source and rejects stale sources', async () => {
    const imported = await importDocxToMarkdoc(await numberedFixture());
    const first = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const insertion = (styleSource = '') => `${imported.markdoc}\n{% insert-after anchor="${first.id}" operation="insert"${styleSource} %}\n{% after %}\nInserted.\n{% /after %}\n{% /insert-after %}\n`;
    await expect(compileMarkdoc(imported.anchoredSource, insertion()))
      .rejects.toMatchObject({ code: 'NUMBERED_INSERT_REQUIRES_STYLE_SOURCE' });
    await expect(compileMarkdoc(imported.anchoredSource, insertion(' style-source="_bk_missing"')))
      .rejects.toMatchObject({ code: 'MISSING_STYLE_SOURCE' });
  });

  itAllure('[SDX-MDOC-16] compares adjacent revisions while retaining only supplied labels', async () => {
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

  itAllure('[SDX-MDOC-11] emits selective normalized detail and coalesces equivalent adjacent runs', async () => {
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

  itAllure('[SDX-MDOC-06][SDX-MDOC-10][SDX-MDOC-14] fails closed on anchor, fingerprint, scaffold, and mixed-format drift', async () => {
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
    const mixedChange = withCanonicalChange(mixedImported.markdoc, 'Alpha beta.', 'Alpha inserted beta.');
    await expect(compileMarkdoc(mixedImported.anchoredSource, mixedChange)).rejects.toMatchObject({ code: 'MIXED_FORMATTING_REQUIRES_DETAIL' });
    const resolved = mixedChange.replace(
      'format="inherit-source-paragraph"',
      'format="inherit-source-paragraph" format-source="Alpha "',
    );
    const resolvedResult = await compileMarkdoc(mixedImported.anchoredSource, resolved);
    const resolvedClean = await DocxDocument.load(resolvedResult.clean);
    expect(runFormatProjection(resolvedClean.getParagraphs()[0]!)).toEqual([
      { text: 'Alpha inserted ', bold: false },
      { text: 'beta.', bold: true },
    ]);
  });

  itAllure('[SDX-MDOC-09][SDX-MDOC-10] preserves mixed emphasis across localized founding-member edits', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Founding Members: Alice and Bob.', 'Context.'] });
    const styled = await DocxDocument.load(original);
    setParagraphRuns(styled.getParagraphs()[0]!, [
      { text: 'Founding Members: ' },
      { text: 'Alice and Bob.', bold: true },
    ]);
    const imported = await importDocxToMarkdoc((await styled.toBuffer({ cleanBookmarks: false })).buffer);
    const markdoc = withCanonicalChange(
      imported.markdoc,
      'Founding Members: Alice and Bob.',
      'Initial Members: Alice and Carol.',
    );
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    expect(result.certificate).toMatchObject({ passed: true, rejectAllEqualsSource: true, acceptAllEqualsClean: true });

    const clean = await DocxDocument.load(result.clean);
    expect(runFormatProjection(clean.getParagraphs()[0]!)).toEqual([
      { text: 'Initial Members: ', bold: false },
      { text: 'Alice and Carol.', bold: true },
    ]);
  });

  itAllure('[SDX-MDOC-09] deletes a mixed-format witness line without flattening adjacent content', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Operative text.', 'Witness: ____________________', 'Following text.'] });
    const styled = await DocxDocument.load(original);
    setParagraphRuns(styled.getParagraphs()[1]!, [
      { text: 'Witness:', bold: true },
      { text: ' ____________________' },
    ]);
    const imported = await importDocxToMarkdoc((await styled.toBuffer({ cleanBookmarks: false })).buffer);
    const markdoc = withCanonicalChange(imported.markdoc, 'Witness: ____________________', '');
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    expect(result.certificate).toMatchObject({ passed: true, rejectAllEqualsSource: true, acceptAllEqualsClean: true });

    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual(['Operative text.', 'Following text.']);
    expect(runFormatProjection(clean.getParagraphs()[0]!)).toEqual([{ text: 'Operative text.', bold: false }]);
    expect(runFormatProjection(clean.getParagraphs()[1]!)).toEqual([{ text: 'Following text.', bold: false }]);
  });

  itAllure('[SDX-MDOC-17][SDX-MDOC-20] separates exact projection from blocked draft completeness and orphan remnants', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.', 'Legacy certification remains.'] });
    const imported = await importDocxToMarkdoc(original);
    const markdoc = `${withBeforeAfterEdit(imported.markdoc)}
{% requirement id="remove-remnant" satisfied-by="remove-certification" %}
Remove the obsolete certification block as one drafting decision.
{% /requirement %}
{% assert id="no-legacy-remnant" kind="absent" text="Legacy certification" /%}
`;

    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(result.certificate).toMatchObject({
      passed: false,
      projectionPassed: true,
      draftCompletenessPassed: false,
      deliveryReady: false,
    });
    expect(result.certificate.completeness.requirements).toEqual([
      expect.objectContaining({ id: 'remove-remnant', status: 'blocked', missingOperations: ['remove-certification'] }),
    ]);
    expect(result.certificate.completeness.assertions).toEqual([
      expect.objectContaining({ id: 'no-legacy-remnant', passed: false }),
    ]);
    expect(result.clean).toBeInstanceOf(Buffer);
    expect(result.tracked).toBeInstanceOf(Buffer);
  });

  itAllure('[SDX-MDOC-18] accepts only an explicit human-supplied waiver and records it in the delivery certificate', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.'] });
    const imported = await importDocxToMarkdoc(original);
    const markdoc = `${withBeforeAfterEdit(imported.markdoc)}
{% requirement id="deferred-decision" satisfied-by="future-operation" %}
Resolve the deferred drafting decision.
{% /requirement %}
{% waiver for="deferred-decision" authority="reviewing-lawyer" %}
The reviewer expressly deferred this decision to a later instrument.
{% /waiver %}
{% assert id="new-name-present" kind="present" text="The New Name." /%}
`;

    const result = await compileMarkdoc(imported.anchoredSource, markdoc);

    expect(result.certificate).toMatchObject({ passed: true, draftCompletenessPassed: true, deliveryReady: true });
    expect(result.certificate.completeness.requirements[0]).toMatchObject({
      status: 'waived',
      waiver: { authority: 'reviewing-lawyer', reason: 'The reviewer expressly deferred this decision to a later instrument.' },
    });
    expect(() => requireMarkdoc(markdoc.replace('The reviewer expressly deferred this decision to a later instrument.', '')))
      .toThrow(DocxMarkdocError);
  });

  itAllure('[SDX-MDOC-19] rejects an incomplete atomic change set before any member can apply', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.'] });
    const imported = await importDocxToMarkdoc(original);
    const markdoc = `${withBeforeAfterEdit(imported.markdoc)}
{% change-set id="remove-certification-block" operations="rename,remove-witness-line" atomic=true /%}
`;

    await expect(compileMarkdoc(imported.anchoredSource, markdoc)).rejects.toMatchObject({
      code: 'INCOMPLETE_ATOMIC_CHANGE_SET',
      details: { changeSets: [expect.objectContaining({ id: 'remove-certification-block', missingOperations: ['remove-witness-line'] })] },
    });
  });

  itAllure('[SDX-MDOC-19] certifies a complete atomic change set', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['The Old Name.'] });
    const imported = await importDocxToMarkdoc(original);
    const markdoc = `${withBeforeAfterEdit(imported.markdoc)}
{% change-set id="rename-unit" operations="rename" atomic=true /%}
{% requirement id="rename-required" satisfied-by="rename" %}
Use the current name.
{% /requirement %}
`;

    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    expect(result.certificate.deliveryReady).toBe(true);
    expect(result.certificate.completeness.changeSets).toEqual([
      { id: 'rename-unit', complete: true, appliedOperations: ['rename'], missingOperations: [] },
    ]);
  });

  itAllure('[SDX-MDOC-10] requires and applies an exact run source for insertion from a mixed numbered paragraph', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Defined item — source details.', 'Following text.'] });
    const styled = await DocxDocument.load(original);
    const sourceParagraph = styled.getParagraphs()[0]!;
    setParagraphRuns(sourceParagraph, [
      { text: 'Defined item', bold: true },
      { text: ' — source details.' },
    ]);
    addDirectNumbering(sourceParagraph, '7', '1');
    const imported = await importDocxToMarkdoc((await styled.toBuffer({ cleanBookmarks: false })).buffer);
    const sourceId = requireMarkdoc(imported.markdoc).scaffold[0]!.id;
    const insertion = [
      `{% insert-after anchor="${sourceId}" operation="insert-item" style-source="${sourceId}" %}`,
      '{% after %}', 'Inserted item.', '{% /after %}', '{% /insert-after %}',
    ].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, `${imported.markdoc}\n${insertion}`))
      .rejects.toMatchObject({ code: 'MIXED_FORMATTING_REQUIRES_DETAIL' });

    const resolved = insertion.replace(
      'style-source="',
      'format-source="Defined item" style-source="',
    );
    const result = await compileMarkdoc(imported.anchoredSource, `${imported.markdoc}\n${resolved}`);
    expect(result.certificate).toMatchObject({ passed: true, rejectAllEqualsSource: true, acceptAllEqualsClean: true });
    const clean = await DocxDocument.load(result.clean);
    expect(clean.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual([
      'Defined item — source details.', 'Inserted item.', 'Following text.',
    ]);
    expect(runFormatProjection(clean.getParagraphs()[1]!)).toEqual([{ text: 'Inserted item.', bold: true }]);
    expect(directChild(directChild(clean.getParagraphs()[1]!, 'pPr')!, 'numPr')?.toString()).toContain('w:numId');
  });
});

function directChild(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.childNodes)
    .find((child): child is Element => child.nodeType === 1 && (child as Element).localName === localName);
}

function addDirectNumbering(paragraph: Element, numId: string, level: string): void {
  const doc = paragraph.ownerDocument!;
  let pPr = directChild(paragraph, 'pPr');
  if (!pPr) {
    pPr = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }
  const numPr = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:numPr');
  const ilvl = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ilvl');
  ilvl.setAttribute('w:val', level);
  const number = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:numId');
  number.setAttribute('w:val', numId);
  numPr.appendChild(ilvl);
  numPr.appendChild(number);
  pPr.appendChild(numPr);
}

function setParagraphRuns(paragraph: Element, runs: Array<{ text: string; bold?: boolean }>): void {
  const doc = paragraph.ownerDocument!;
  for (const child of Array.from(paragraph.childNodes)) {
    if (child.nodeType === 1 && (child as Element).localName === 'r') paragraph.removeChild(child);
  }
  for (const item of runs) {
    const run = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
    if (item.bold) {
      const rPr = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      rPr.appendChild(doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b'));
      run.appendChild(rPr);
    }
    const text = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
    if (item.text.startsWith(' ') || item.text.endsWith(' ')) text.setAttribute('xml:space', 'preserve');
    text.textContent = item.text;
    run.appendChild(text);
    paragraph.appendChild(run);
  }
}

function runFormatProjection(paragraph: Element): Array<{ text: string; bold: boolean }> {
  const projected = Array.from(paragraph.childNodes)
    .filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === 'r')
    .map((run) => ({
      text: Array.from(run.getElementsByTagName('*')).filter((el) => el.localName === 't').map((el) => el.textContent ?? '').join(''),
      bold: Array.from(run.getElementsByTagName('*')).some((el) => el.localName === 'b'),
    }))
    .filter((run) => run.text.length > 0);
  return projected.reduce<Array<{ text: string; bold: boolean }>>((result, run) => {
    const previous = result[result.length - 1];
    if (previous?.bold === run.bold) previous.text += run.text;
    else result.push(run);
    return result;
  }, []);
}

function getFirstElement(parent: Element, localName: string): Element {
  const element = Array.from(parent.getElementsByTagName('*')).find((candidate) => candidate.localName === localName);
  if (!element) throw new Error(`Missing ${localName}`);
  return element;
}

function withCanonicalChange(markdoc: string, before: string, after: string, operation = 'change'): string {
  const source = requireMarkdoc(markdoc).scaffold.find((paragraph) => paragraph.originalText === before);
  if (!source) throw new Error(`Fixture paragraph not found: ${before}`);
  const escapedId = source.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{% para (id="${escapedId}"[^\\n]*) %\\}[\\s\\S]*?\\{% /para %\\}`);
  const match = markdoc.match(pattern);
  if (!match?.[1]) throw new Error(`Fixture paragraph block not found: ${before}`);
  return markdoc.replace(pattern, [
    `{% change ${match[1]} operation="${operation}" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', after, '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}

async function numberedFixture(): Promise<Buffer> {
  const paragraph = (text: string) => [
    '<w:p>',
    '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr><w:ind w:left="720" w:hanging="360"/></w:pPr>',
    `<w:r><w:t>${text}</w:t></w:r>`,
    '</w:p>',
  ].join('');
  return buildDocxFromParts({
    bodyXml: [paragraph('First item.'), paragraph('Second item.'), paragraph('Third item.')].join(''),
    numberingXml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>',
  });
}

async function numberingTopology(buffer: Buffer): Promise<Array<{ text: string; signature: string }>> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'))
    .filter((paragraph) => paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'numPr').length > 0)
    .map((paragraph) => {
      const value = (name: string, attribute = 'val') => paragraph
        .getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', name)[0]
        ?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', attribute) ?? '';
      const texts = Array.from(paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't'));
      return {
        text: texts.map((node) => node.textContent ?? '').join(''),
        signature: [value('pStyle'), value('numId'), value('ilvl'), value('ind', 'left'), value('ind', 'hanging')].join('|'),
      };
    });
}
