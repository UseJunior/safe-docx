import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { OOXML, readZipText, parseXml } from '@usejunior/docx-core';
import { COMPLETE_PAGE_FIELD, buildDocxFromBodyXml, buildDocxWithAncillaryParts } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { importDocxToMarkdoc } from './import.js';
import { compileMarkdoc } from './compile.js';
import { DocxMarkdocError } from './errors.js';
import { exportEditPairs } from './export.js';
import { sha256 } from './hash.js';
import { requireMarkdoc } from './markdoc.js';
import { selectedStories } from './story-inventory.js';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const HEADER_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const W_NS = OOXML.W_NS;
const TEST_FEATURE = 'Selected header and footer Markdoc authoring';
const storyTest = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1034 selected running-story authoring',
  severity: 'critical',
}).openspec('add-markdoc-header-footer-authoring');

async function sharedHeader(): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>',
    sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
    relationships: [{ id: 'rIdHeader', type: REL, target: 'header1.xml' }],
    parts: [{
      path: 'word/header1.xml', contentType: HEADER_CONTENT_TYPE,
      xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>Draft of September 1, 2026</w:t></w:r></w:p></w:hdr>`,
    }],
  });
}

async function singleHeader(headerContent: string): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: '<w:p><w:r><w:t>Body anchor</w:t></w:r></w:p>',
    sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
    relationships: [{ id: 'rIdHeader', type: REL, target: 'header1.xml' }],
    parts: [{
      path: 'word/header1.xml', contentType: HEADER_CONTENT_TYPE,
      xml: `<w:hdr xmlns:w="${W_NS}">${headerContent}</w:hdr>`,
    }],
  });
}

describe('selected header/footer Markdoc import', () => {
  storyTest('[SDX-MDOC-120] shared header is projected once with complete bindings', async () => {
    const imported = await importDocxToMarkdoc(await sharedHeader());
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.source.paragraphs).toBe(1);
    expect(ir.scaffold).toHaveLength(1);
    expect(ir.stories).toHaveLength(1);
    expect(ir.stories?.[0]).toMatchObject({ kind: 'header', bindings: ['0:default', '1:default'], paragraphs: 1 });
    expect(ir.storyScaffold).toHaveLength(1);
    expect(ir.storyScaffold?.[0]).toMatchObject({
      story: ir.stories?.[0]?.id,
      originalText: 'Draft of September 1, 2026',
      style: 'Header',
    });
    expect(imported.markdoc.match(/\{% story /gu)).toHaveLength(1);
  });

  storyTest('[SDX-MDOC-121] story anchors are globally unique and leave the caller source untouched', async () => {
    const original = await sharedHeader();
    const preserved = Buffer.from(original);
    const imported = await importDocxToMarkdoc(original);
    expect(original.equals(preserved)).toBe(true);
    expect(await readZipText(original, 'word/header1.xml')).not.toContain('_bk_');
    const [body, header] = await Promise.all([
      readZipText(imported.anchoredSource, 'word/document.xml'),
      readZipText(imported.anchoredSource, 'word/header1.xml'),
    ]);
    const bookmarks = [body, header].flatMap((xml) => Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'bookmarkStart')));
    const names = bookmarks.map((node) => node.getAttributeNS(W_NS, 'name'));
    const ids = bookmarks.map((node) => node.getAttributeNS(W_NS, 'id'));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  storyTest('[SDX-MDOC-122][SDX-MDOC-128] punctuation-adjacent header date edit projects to native revisions', async () => {
    const imported = await importDocxToMarkdoc(await sharedHeader());
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold?.[0];
    if (!paragraph?.story) throw new Error('Expected an admitted header paragraph');
    const oldBlock = [
      `{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
      paragraph.originalText,
      '{% /para %}',
    ].join('\n');
    const newBlock = [
      `{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="header-date" format="inherit-source-paragraph" %}`,
      '{% before %}', paragraph.originalText, '{% /before %}',
      '{% after %}', 'Draft of September 2, 2026', '{% /after %}',
      '{% /change %}',
    ].join('\n');
    const markdoc = imported.markdoc.replace(oldBlock, newBlock);
    expect(markdoc).not.toBe(imported.markdoc);
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    expect(result.certificate.passed).toBe(true);
    expect(result.certificate.storyProjections?.[0]).toMatchObject({
      bindings: ['0:default', '1:default'],
      rejectAllTextEqualsSource: true,
      acceptAllTextEqualsClean: true,
      passed: true,
    });
    expect(exportEditPairs(result.ir)[0]).toMatchObject({ story: paragraph.story, before: paragraph.originalText, after: 'Draft of September 2, 2026' });
    const trackedHeader = await readZipText(result.tracked, 'word/header1.xml');
    const cleanHeader = await readZipText(result.clean, 'word/header1.xml');
    expect(trackedHeader).toContain('w:ins');
    expect(trackedHeader).toContain('w:del');
    expect(parseXml(cleanHeader!).documentElement.textContent).toContain('September 2, 2026');
  });

  storyTest('[SDX-MDOC-123] a body anchor cannot be used through a declared story', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader('<w:p><w:r><w:t>Header text</w:t></w:r></w:p>'));
    const ir = requireMarkdoc(imported.markdoc);
    const markdoc = imported.markdoc + [
      `{% insert-after story="${ir.stories![0]!.id}" anchor="${ir.scaffold[0]!.id}" operation="wrong-story" %}`,
      '{% after %}', 'Not in the header', '{% /after %}', '{% /insert-after %}', '',
    ].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, markdoc)).rejects.toMatchObject({ code: 'STORY_ANCHOR_MISMATCH' });
  });

  storyTest('[SDX-MDOC-125] drawing-bearing story paragraph is read-only and has no operative anchor', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader(
      '<w:p><w:r><w:t>Protected</w:t><w:drawing/></w:r></w:p>'
      + '<w:p><w:r><w:t>Editable</w:t></w:r></w:p>',
    ));
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.stories?.[0]?.paragraphs).toBe(1);
    expect(ir.stories?.[0]?.readOnlyParagraphs).toBe(1);
    expect(ir.storyReadOnly).toMatchObject([{ reason: 'drawing', text: 'Protected', ordinal: 0 }]);
    expect(imported.markdoc).toContain('{% readonly ');
    expect(imported.markdoc.indexOf('{% readonly ')).toBeLessThan(imported.markdoc.indexOf('{% para story='));
    expect(ir.storyScaffold?.map((paragraph) => paragraph.originalText)).toEqual(['Editable']);
    const xml = await readZipText(imported.anchoredSource, 'word/header1.xml');
    expect(xml?.match(/_bk_/gu)).toHaveLength(1);
    const foreign = await singleHeader(
      '<w:p><w:bookmarkStart w:id="42" w:name="_bk_legacy"/><w:r><w:t>Protected</w:t><w:drawing/></w:r><w:bookmarkEnd w:id="42"/></w:p>'
      + '<w:p><w:r><w:t>Editable</w:t></w:r></w:p>',
    );
    const protectedImport = await importDocxToMarkdoc(foreign);
    const story = requireMarkdoc(protectedImport.markdoc).stories![0]!;
    const attempted = protectedImport.markdoc + [
      `{% insert-after story="${story.id}" anchor="_bk_legacy" operation="unsafe-drawing" %}`,
      '{% after %}', 'Not allowed', '{% /after %}', '{% /insert-after %}', '',
    ].join('\n');
    await expect(compileMarkdoc(protectedImport.anchoredSource, attempted))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_STORY_CONTENT' });
    const hidden = imported.markdoc.replace(/\{% readonly [\s\S]*?\{% \/readonly %\}\n\n/u, '');
    await expect(compileMarkdoc(imported.anchoredSource, hidden))
      .rejects.toMatchObject({ code: 'INVALID_MARKDOC' });
  });

  storyTest('[SDX-MDOC-127] field-bearing paragraph deletion is rejected before replay', async () => {
    for (const field of [COMPLETE_PAGE_FIELD, '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>']) {
      const imported = await importDocxToMarkdoc(await singleHeader(
        `<w:p><w:r><w:t>Page </w:t></w:r>${field}</w:p><w:p><w:r><w:t>Keep</w:t></w:r></w:p>`,
      ));
      const paragraph = requireMarkdoc(imported.markdoc).storyScaffold![0]!;
      const block = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
        paragraph.originalText, '{% /para %}'].join('\n');
      const deletion = [`{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="delete-field" format="inherit-source-paragraph" %}`,
        '{% before %}', paragraph.originalText, '{% /before %}', '{% after %}', '{% /after %}', '{% /change %}'].join('\n');
      await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, deletion)))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_STORY_FIELD_EDIT' });
    }
  });

  storyTest('[SDX-MDOC-127] deleting the sole header paragraph is rejected in preflight', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader('<w:p><w:r><w:t>Only</w:t></w:r></w:p>'));
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold![0]!;
    const block = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
      'Only', '{% /para %}'].join('\n');
    const deletion = [`{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="delete-only" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Only', '{% /before %}', '{% after %}', '{% /after %}', '{% /change %}'].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, deletion)))
      .rejects.toMatchObject({ code: 'STORY_REQUIRES_PARAGRAPH' });
  });

  storyTest('[SDX-MDOC-124] cumulative cell deletions fail with a typed preflight diagnostic', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr/>'
      + '<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Last</w:t></w:r></w:p>'
      + '</w:tc></w:tr></w:tbl>',
    ));
    let markdoc = imported.markdoc;
    for (const [index, paragraph] of requireMarkdoc(imported.markdoc).storyScaffold!.entries()) {
      const block = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
        paragraph.originalText, '{% /para %}'].join('\n');
      const deletion = [`{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="delete-cell-${index}" format="inherit-source-paragraph" %}`,
        '{% before %}', paragraph.originalText, '{% /before %}', '{% after %}', '{% /after %}', '{% /change %}'].join('\n');
      markdoc = markdoc.replace(block, deletion);
    }
    await expect(compileMarkdoc(imported.anchoredSource, markdoc))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_STORY_EDIT' });
  });

  storyTest('[SDX-MDOC-127] a header root cannot lose its final direct paragraph after a table', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader(
      '<w:p><w:r><w:t>Intro</w:t></w:r></w:p>'
      + '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      + '<w:p><w:r><w:t>Tail</w:t></w:r></w:p>',
    ));
    const tail = requireMarkdoc(imported.markdoc).storyScaffold!.at(-1)!;
    const block = [`{% para story="${tail.story}" id="${tail.id}" fingerprint="${tail.fingerprint}" style="${tail.style}" %}`,
      'Tail', '{% /para %}'].join('\n');
    const deletion = [`{% change story="${tail.story}" id="${tail.id}" fingerprint="${tail.fingerprint}" style="${tail.style}" operation="delete-tail" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Tail', '{% /before %}', '{% after %}', '{% /after %}', '{% /change %}'].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, deletion)))
      .rejects.toMatchObject({ code: 'STORY_REQUIRES_PARAGRAPH' });
  });

  storyTest('[SDX-MDOC-127] deleting a hyperlink-bearing story paragraph is explicitly unsupported', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader(
      '<w:p><w:hyperlink w:anchor="destination"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>'
      + '<w:p><w:r><w:t>Keep</w:t></w:r></w:p>',
    ));
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold![0]!;
    const block = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
      'Link', '{% /para %}'].join('\n');
    const deletion = [`{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="delete-hyperlink" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Link', '{% /before %}', '{% after %}', '{% /after %}', '{% /change %}'].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, deletion)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_STORY_HYPERLINK_EDIT' });
  });

  storyTest('[SDX-MDOC-125][SDX-MDOC-128] text box is read-only while adjacent ordinary text remains editable', async () => {
    const box = '<w:p><w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
      + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
      + ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
      + '<wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>'
      + '<w:p><w:r><w:t>Box text</w:t></w:r></w:p>'
      + '</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor>'
      + '</w:drawing></w:r></w:p>';
    const imported = await importDocxToMarkdoc(await singleHeader(box + '<w:p><w:r><w:t>Plain</w:t></w:r></w:p>'));
    expect(requireMarkdoc(imported.markdoc).storyReadOnly).toHaveLength(2);
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold![0]!;
    const block = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
      'Plain', '{% /para %}'].join('\n');
    const edit = [`{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="beside-box" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Plain', '{% /before %}', '{% after %}', 'Plainer', '{% /after %}', '{% /change %}'].join('\n');
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, edit));
    expect(result.certificate.storyProjections?.[0]?.passed).toBe(true);
  });

  storyTest('[SDX-MDOC-125] AlternateContent fallback does not duplicate a logical text box', async () => {
    const box = '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
      + '<mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice>'
      + '<mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback>'
      + '</mc:AlternateContent></w:r></w:p>';
    const imported = await importDocxToMarkdoc(await singleHeader(box + '<w:p><w:r><w:t>Plain</w:t></w:r></w:p>'));
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.storyReadOnly?.filter((paragraph) => paragraph.text === 'Box text')).toHaveLength(1);
    expect(ir.storyReadOnly?.map((paragraph) => paragraph.ordinal)).toEqual([0, 1]);
  });

  storyTest('[SDX-MDOC-125] a table cell inside a text box is read-only, not a physical story cell', async () => {
    const box = '<w:p><w:r><w:drawing><w:txbxContent><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>'
      + '<w:tr><w:tc><w:tcPr/><w:p><w:bookmarkStart w:id="80" w:name="_bk_nested"/>'
      + '<w:r><w:t>Nested cell</w:t></w:r><w:bookmarkEnd w:id="80"/></w:p></w:tc></w:tr>'
      + '</w:tbl></w:txbxContent></w:drawing></w:r></w:p>';
    const imported = await importDocxToMarkdoc(await singleHeader(box + '<w:p><w:r><w:t>Plain</w:t></w:r></w:p>'));
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.storyScaffold?.map((paragraph) => paragraph.originalText)).toEqual(['Plain']);
    expect(ir.storyReadOnly?.map((paragraph) => paragraph.reason)).toEqual(['drawing', 'nested']);
    const attempt = imported.markdoc + [
      `{% insert-after story="${ir.stories![0]!.id}" anchor="_bk_nested" operation="nested-cell" %}`,
      '{% after %}', 'Unsafe', '{% /after %}', '{% /insert-after %}', '',
    ].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, attempt))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_STORY_CONTENT', message: expect.stringContaining('read-only nested content') });
  });

  storyTest('[SDX-MDOC-125] horizontal-merge continuation cell stays read-only', async () => {
    const source = await singleHeader(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid>'
      + '<w:tr><w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Visible</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:tcPr><w:hMerge w:val="continue"/></w:tcPr><w:p><w:r><w:t>Continuation</w:t></w:r></w:p></w:tc>'
      + '</w:tr></w:tbl>',
    );
    const imported = await importDocxToMarkdoc(source);
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.storyScaffold?.map((paragraph) => paragraph.originalText)).toEqual(['Visible']);
    expect(ir.storyReadOnly?.map((paragraph) => paragraph.reason)).toEqual(['hMerge']);
  });

  storyTest('[SDX-MDOC-124] existing header cell admits replacement, insertion, and safe deletion', async () => {
    const source = await singleHeader(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>'
      + '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell A</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Cell tail</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    const imported = await importDocxToMarkdoc(source);
    const [first, tail] = requireMarkdoc(imported.markdoc).storyScaffold ?? [];
    if (!first?.story || !tail) throw new Error('Expected two admitted cell paragraphs');
    const oldBlock = [
      `{% para story="${first.story}" id="${first.id}" fingerprint="${first.fingerprint}" style="${first.style}" %}`,
      'Cell A', '{% /para %}',
    ].join('\n');
    const replacement = imported.markdoc.replace(oldBlock, [
      `{% change story="${first.story}" id="${first.id}" fingerprint="${first.fingerprint}" style="${first.style}" operation="cell-replace" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Cell A', '{% /before %}',
      '{% after %}', 'Cell X', '{% /after %}', '{% /change %}',
    ].join('\n'));
    const insertion = imported.markdoc + [
      `{% insert-after story="${first.story}" anchor="${first.id}" operation="cell-insert" %}`,
      '{% after %}', 'Cell B', '{% /after %}', '{% /insert-after %}', '',
    ].join('\n');
    const deletion = imported.markdoc.replace(oldBlock, [
      `{% change story="${first.story}" id="${first.id}" fingerprint="${first.fingerprint}" style="${first.style}" operation="cell-delete" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Cell A', '{% /before %}',
      '{% after %}', '{% /after %}', '{% /change %}',
    ].join('\n'));
    for (const [markdoc, expected] of [[replacement, 'Cell X'], [insertion, 'Cell B'], [deletion, 'Cell tail']]) {
      const result = await compileMarkdoc(imported.anchoredSource, markdoc!).catch((error: unknown) => {
        if (error instanceof DocxMarkdocError) throw new Error(`${error.code}: ${JSON.stringify(error.details)}`);
        throw error;
      });
      expect(result.certificate.storyProjections?.[0]?.passed).toBe(true);
      const xml = await readZipText(result.clean, 'word/header1.xml');
      expect(parseXml(xml!).documentElement.textContent).toContain(expected);
      expect((xml?.match(/<w:tr>/gu) ?? [])).toHaveLength(1);
      expect((xml?.match(/<w:tc>/gu) ?? [])).toHaveLength(1);
    }
  });

  storyTest('[SDX-MDOC-126] partial alias closure is rejected before mutation', async () => {
    const imported = await importDocxToMarkdoc(await sharedHeader());
    const shortened = imported.markdoc.replace('bindings="0:default,1:default"', 'bindings="0:default"');
    await expect(compileMarkdoc(imported.anchoredSource, shortened)).rejects.toMatchObject({ code: 'STORY_TOPOLOGY_DRIFT' });
  });

  storyTest('[SDX-MDOC-127] side-story rationale cannot materialize an external Word comment', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader('<w:p><w:r><w:t>Header text</w:t></w:r></w:p>'));
    const ir = requireMarkdoc(imported.markdoc);
    const markdoc = imported.markdoc + [
      `{% insert-after story="${ir.stories![0]!.id}" anchor="${ir.storyScaffold![0]!.id}" operation="story-note" %}`,
      '{% after %}', 'Another line', '{% /after %}', '{% /insert-after %}',
      '{% rationale for="story-note" visibility="external-facing" %}', 'Explain the new line.', '{% /rationale %}', '',
    ].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, markdoc)).rejects.toMatchObject({ code: 'STORY_COMMENT_UNSUPPORTED' });
  });

  storyTest('[SDX-MDOC-129] body-only canonical import remains story-free', async () => {
    const imported = await importDocxToMarkdoc(await buildDocxFromBodyXml('<w:p><w:r><w:t>Body only</w:t></w:r></w:p>'));
    expect(imported.markdoc).not.toContain('{% story ');
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.stories).toBeUndefined();
    expect(ir.storyScaffold).toBeUndefined();
    expect((await compileMarkdoc(imported.anchoredSource, imported.markdoc)).certificate.passed).toBe(true);
  });

  storyTest('[SDX-MDOC-120] first, even, default and orphan bindings are inventoried without filenames', async () => {
    const source = await buildDocxWithAncillaryParts({
      bodyXml: '<w:p><w:r><w:t>Body</w:t></w:r></w:p>',
      sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>'
        + '<w:headerReference w:type="first" r:id="rIdHeader"/>'
        + '<w:headerReference w:type="even" r:id="rIdHeader"/></w:sectPr>',
      relationships: [{ id: 'rIdHeader', type: REL, target: 'header7.xml' }],
      parts: [
        { path: 'word/header7.xml', contentType: HEADER_CONTENT_TYPE, xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:hdr>` },
        { path: 'word/header-orphan.xml', contentType: HEADER_CONTENT_TYPE, xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Orphan</w:t></w:r></w:p></w:hdr>` },
      ],
    });
    const imported = await importDocxToMarkdoc(source);
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.stories).toHaveLength(1);
    expect(ir.stories?.[0]?.bindings).toEqual(['0:default', '0:even', '0:first']);
    expect(imported.markdoc).not.toContain('header7.xml');
    expect(imported.markdoc).not.toContain('Orphan');
  });

  storyTest('[SDX-MDOC-120][SDX-MDOC-128] title-page first and even selectors remain separate physical stories', async () => {
    const selectors = ['default', 'first', 'even'] as const;
    const source = await buildDocxWithAncillaryParts({
      bodyXml: '<w:p><w:r><w:t>Body</w:t></w:r></w:p>',
      sectPrXml: '<w:sectPr>'
        + selectors.map((role, index) => `<w:headerReference w:type="${role}" r:id="rIdHeader${index}"/>`).join('')
        + '<w:titlePg/></w:sectPr>',
      relationships: selectors.map((_, index) => ({ id: `rIdHeader${index}`, type: REL, target: `header${index + 1}.xml` })),
      parts: selectors.map((role, index) => ({
        path: `word/header${index + 1}.xml`, contentType: HEADER_CONTENT_TYPE,
        xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>${role} text</w:t></w:r></w:p></w:hdr>`,
      })),
    });
    const imported = await importDocxToMarkdoc(source);
    const ir = requireMarkdoc(imported.markdoc);
    expect(ir.stories?.flatMap((story) => story.bindings).sort()).toEqual(['0:default', '0:even', '0:first']);
    const first = ir.storyScaffold?.find((paragraph) => paragraph.originalText === 'first text');
    if (!first?.story) throw new Error('Expected first-page header');
    const block = [`{% para story="${first.story}" id="${first.id}" fingerprint="${first.fingerprint}" style="${first.style}" %}`,
      'first text', '{% /para %}'].join('\n');
    const edit = [`{% change story="${first.story}" id="${first.id}" fingerprint="${first.fingerprint}" style="${first.style}" operation="first-title" format="inherit-source-paragraph" %}`,
      '{% before %}', 'first text', '{% /before %}', '{% after %}', 'first revised', '{% /after %}', '{% /change %}'].join('\n');
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, edit));
    expect(result.certificate.storyProjections).toMatchObject([{ bindings: ['0:first'], passed: true }]);
    expect(parseXml((await readZipText(result.clean, 'word/header2.xml'))!).documentElement.textContent).toContain('first revised');
    expect(parseXml((await readZipText(result.clean, 'word/header1.xml'))!).documentElement.textContent).toContain('default text');
    expect(parseXml((await readZipText(result.clean, 'word/header3.xml'))!).documentElement.textContent).toContain('even text');
  });

  storyTest('[SDX-MDOC-127] existing section-property revisions reject operative story edits', async () => {
    const source = await buildDocxWithAncillaryParts({
      bodyXml: '<w:p><w:r><w:t>Body</w:t></w:r></w:p>',
      sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>'
        + '<w:sectPrChange w:id="1" w:author="Tester" w:date="2026-09-23T00:00:00Z">'
        + '<w:sectPr><w:titlePg/></w:sectPr>'
        + '</w:sectPrChange></w:sectPr>',
      relationships: [{ id: 'rIdHeader', type: REL, target: 'header1.xml' }],
      parts: [{ path: 'word/header1.xml', contentType: HEADER_CONTENT_TYPE,
        xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Before</w:t></w:r></w:p></w:hdr>` }],
    });
    const imported = await importDocxToMarkdoc(source);
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold?.[0];
    if (!paragraph?.story) throw new Error('Expected story paragraph');
    const block = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`,
      'Before', '{% /para %}'].join('\n');
    const edit = [`{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="section-revision" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Before', '{% /before %}', '{% after %}', 'After', '{% /after %}', '{% /change %}'].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, edit)))
      .rejects.toMatchObject({ code: 'EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED' });
  });

  storyTest('[SDX-MDOC-123][SDX-MDOC-127] selector changes invalidate the pinned source', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader('<w:p><w:r><w:t>Header</w:t></w:r></w:p>'));
    const zip = await JSZip.loadAsync(imported.anchoredSource);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    const revisedXml = documentXml.replace('<w:headerReference w:type="default" r:id="rIdHeader"/>',
      '<w:headerReference w:type="default" r:id="rIdHeader"/>'
      + '<w:headerReference w:type="first" r:id="rIdHeader"/><w:titlePg/>');
    expect(revisedXml).toContain('<w:titlePg/>');
    expect(revisedXml).toContain('w:type="first"');
    zip.file('word/document.xml', revisedXml);
    const changed = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(compileMarkdoc(changed, imported.markdoc)).rejects.toMatchObject({ code: 'SOURCE_HASH_DRIFT' });
    expect((await selectedStories(changed))[0]?.bindings).toEqual(['0:default', '0:first']);
    const rehashedMarkdoc = imported.markdoc.replace(
      `source sha256="${requireMarkdoc(imported.markdoc).source.sha256}"`,
      `source sha256="${sha256(changed)}"`,
    );
    await expect(compileMarkdoc(changed, rehashedMarkdoc)).rejects.toMatchObject({ code: 'STORY_TOPOLOGY_DRIFT' });
  });

  storyTest('[SDX-MDOC-127] even-odd settings changes invalidate the pinned source', async () => {
    const source = await buildDocxWithAncillaryParts({
      bodyXml: '<w:p><w:r><w:t>Body</w:t></w:r></w:p>',
      sectPrXml: '<w:sectPr><w:headerReference w:type="even" r:id="rIdHeader"/></w:sectPr>',
      relationships: [
        { id: 'rIdHeader', type: REL, target: 'header1.xml' },
        { id: 'rIdSettings', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', target: 'settings.xml' },
      ],
      parts: [
        { path: 'word/header1.xml', contentType: HEADER_CONTENT_TYPE,
          xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Even</w:t></w:r></w:p></w:hdr>` },
        { path: 'word/settings.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
          xml: `<w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders/></w:settings>` },
      ],
    });
    const imported = await importDocxToMarkdoc(source);
    expect(requireMarkdoc(imported.markdoc).stories?.[0]?.bindings).toEqual(['0:even']);
    const zip = await JSZip.loadAsync(imported.anchoredSource);
    const settings = await zip.file('word/settings.xml')!.async('string');
    expect(settings).toContain('<w:evenAndOddHeaders/>');
    zip.file('word/settings.xml', settings.replace('<w:evenAndOddHeaders/>', '<w:evenAndOddHeaders w:val="0"/>'));
    const changed = await zip.generateAsync({ type: 'nodebuffer' });
    expect(await readZipText(changed, 'word/settings.xml')).toContain('w:val="0"');
    await expect(compileMarkdoc(changed, imported.markdoc)).rejects.toMatchObject({ code: 'SOURCE_HASH_DRIFT' });
  });

  storyTest('[SDX-MDOC-122] ordinary text beside a PAGE field can change without changing the field', async () => {
    const original = await singleHeader(`<w:p><w:r><w:t>Draft 17 September — page </w:t></w:r>${COMPLETE_PAGE_FIELD}<w:r><w:t>.</w:t></w:r></w:p>`);
    const imported = await importDocxToMarkdoc(original);
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold?.[0];
    if (!paragraph?.story) throw new Error('Expected field-bearing story paragraph');
    const before = paragraph.originalText;
    const after = before.replace('17', '18');
    const oldBlock = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`, before, '{% /para %}'].join('\n');
    const newBlock = [
      `{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="field-neighbor" format="inherit-source-paragraph" %}`,
      '{% before %}', before, '{% /before %}', '{% after %}', after, '{% /after %}', '{% /change %}',
    ].join('\n');
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(oldBlock, newBlock));
    expect(result.certificate.storyProjections?.[0]?.passed).toBe(true);
    const tracked = await readZipText(result.tracked, 'word/header1.xml');
    expect(tracked).toContain(' PAGE ');
    expect(tracked).toContain('w:ins');
  });

  storyTest('[SDX-MDOC-128] retained header text can lose placeholder highlighting without text replacement', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader(
      '<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Placeholder</w:t></w:r></w:p>',
    ));
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold?.[0];
    if (!paragraph?.story) throw new Error('Expected highlighted header paragraph');
    const oldBlock = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`, 'Placeholder', '{% /para %}'].join('\n');
    const newBlock = [
      `{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="remove-highlight" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Placeholder', '{% /before %}',
      '{% after %}', '{% retain-format highlight="none" %}Placeholder{% /retain-format %}', '{% /after %}', '{% /change %}',
    ].join('\n');
    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(oldBlock, newBlock));
    expect(result.certificate.storyProjections?.[0]?.passed).toBe(true);
    const tracked = await readZipText(result.tracked, 'word/header1.xml');
    expect(tracked).toContain('w:rPrChange');
    expect(tracked).not.toContain('<w:del');
    expect(tracked).not.toContain('<w:ins');
  });

  storyTest('[SDX-MDOC-127] edit intersecting a preserved PAGE result fails before publication', async () => {
    const imported = await importDocxToMarkdoc(await singleHeader(
      `<w:p><w:r><w:t>Page </w:t></w:r>${COMPLETE_PAGE_FIELD}<w:r><w:t>.</w:t></w:r></w:p>`,
    ));
    const paragraph = requireMarkdoc(imported.markdoc).storyScaffold?.[0];
    if (!paragraph?.story) throw new Error('Expected field-bearing story paragraph');
    const oldBlock = [`{% para story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" %}`, paragraph.originalText, '{% /para %}'].join('\n');
    const newBlock = [
      `{% change story="${paragraph.story}" id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="field-result" format="inherit-source-paragraph" %}`,
      '{% before %}', paragraph.originalText, '{% /before %}',
      '{% after %}', paragraph.originalText.replace('1.', '2.'), '{% /after %}', '{% /change %}',
    ].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(oldBlock, newBlock)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_STORY_FIELD_EDIT' });
  });
});
