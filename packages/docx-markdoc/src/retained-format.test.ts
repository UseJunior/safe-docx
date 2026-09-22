import JSZip from 'jszip';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { buildSyntheticDocx, DocxDocument, getParagraphRuns } from '@usejunior/docx-core';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { certifyRetainedFormatting, compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const retainedTest = itAllure
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.28' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' });

function directChild(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.childNodes).find((child): child is Element =>
    child.nodeType === 1 && (child as Element).localName === localName);
}

function setRuns(paragraph: Element, runs: Array<{ text: string; highlight?: boolean; underline?: boolean; bold?: boolean }>): void {
  const doc = paragraph.ownerDocument!;
  for (const child of Array.from(paragraph.childNodes)) {
    if (!(child.nodeType === 1 && (child as Element).localName === 'pPr')) paragraph.removeChild(child);
  }
  for (const item of runs) {
    const run = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
    if (item.highlight || item.underline || item.bold) {
      const rPr = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      if (item.bold) rPr.appendChild(doc.createElementNS(rPr.namespaceURI, 'w:b'));
      if (item.underline) {
        const underline = doc.createElementNS(rPr.namespaceURI, 'w:u');
        underline.setAttribute('w:val', 'single');
        rPr.appendChild(underline);
      }
      if (item.highlight) {
        const highlight = doc.createElementNS(rPr.namespaceURI, 'w:highlight');
        highlight.setAttribute('w:val', 'yellow');
        rPr.appendChild(highlight);
      }
      run.appendChild(rPr);
    }
    const text = doc.createElementNS(run.namespaceURI, 'w:t');
    text.appendChild(doc.createTextNode(item.text));
    run.appendChild(text);
    paragraph.appendChild(run);
  }
}

async function importedStyled(runs: Parameters<typeof setRuns>[1]) {
  const source = await buildSyntheticDocx({ paragraphs: [runs.map((run) => run.text).join('')] });
  const document = await DocxDocument.load(source);
  setRuns(document.getParagraphs()[0]!, runs);
  return importDocxToMarkdoc((await document.toBuffer({ cleanBookmarks: false })).buffer);
}

function change(markdoc: string, before: string, afterMarkup: string, operation = 'retained-format'): string {
  const source = requireMarkdoc(markdoc).scaffold.find((paragraph) => paragraph.originalText === before)!;
  const escapedId = source.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{% para (id="${escapedId}"[^\\n]*) %\\}[\\s\\S]*?\\{% /para %\\}`);
  return markdoc.replace(pattern, [
    `{% change $1 operation="${operation}" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', afterMarkup, '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}

async function trackedXml(buffer: Buffer): Promise<string> {
  return (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
}

describe('retained common-text formatting', () => {
  retainedTest('[SDX-MDOC-130][SDX-MDOC-131][SDX-MDOC-132][SDX-MDOC-136][SDX-MDOC-137] removes one repeated highlight with native property revision evidence', async () => {
    const imported = await importedStyled([
      { text: 'Complete / ', highlight: true, bold: true },
      { text: 'Complete', highlight: true, bold: true },
    ]);
    const markdoc = change(imported.markdoc, 'Complete / Complete', 'Complete / {% retain-format highlight="none" %}Complete{% /retain-format %}');
    expect(requireMarkdoc(markdoc).operations[0]).toMatchObject({
      retainedFormatSpans: [{ start: 11, end: 19, format: { highlight: 'none' } }],
    });

    const result = await compileMarkdoc(imported.anchoredSource, markdoc, { author: 'Reviewer', date: new Date('2026-09-22T00:00:00.000Z') });
    const clean = await DocxDocument.load(result.clean);
    const runs = getParagraphRuns(clean.getParagraphs()[0]!);
    expect(directChild(directChild(runs[0]!.r, 'rPr')!, 'highlight')).toBeDefined();
    expect(directChild(directChild(runs.at(-1)!.r, 'rPr')!, 'highlight')).toBeUndefined();
    expect(directChild(directChild(runs.at(-1)!.r, 'rPr')!, 'b')).toBeDefined();
    expect(result.certificate.retainedFormatting).toMatchObject({
      declaredSpans: 1,
      changedProperties: 1,
      textRevisionOverlaps: 0,
      passed: true,
    });
    expect(result.certificate.retainedFormatting.emittedPropertyRanges).toBeGreaterThan(0);
    const xml = await trackedXml(result.tracked);
    expect(xml).toContain('<w:rPrChange');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
  });

  retainedTest('[SDX-MDOC-132][SDX-MDOC-135] supports set/remove vocabulary and rejects deterministic no-ops', async () => {
    const imported = await importedStyled([{ text: 'Complete', highlight: true }]);
    const setUnderline = change(imported.markdoc, 'Complete', '{% retain-format highlight="none" underline="single" %}Complete{% /retain-format %}');
    const result = await compileMarkdoc(imported.anchoredSource, setUnderline);
    const run = getParagraphRuns((await DocxDocument.load(result.clean)).getParagraphs()[0]!)[0]!.r;
    expect(directChild(directChild(run, 'rPr')!, 'highlight')).toBeUndefined();
    expect(directChild(directChild(run, 'rPr')!, 'u')?.getAttribute('w:val')).toBe('single');

    await expect(compileMarkdoc(imported.anchoredSource, change(imported.markdoc, 'Complete', '{% retain-format highlight="yellow" %}Complete{% /retain-format %}')))
      .rejects.toMatchObject({ code: 'NOOP_RETAINED_FORMAT' });
    expect(() => requireMarkdoc(change(imported.markdoc, 'Complete', '{% retain-format color="red" %}Complete{% /retain-format %}'))).toThrow(/Markdoc validation failed/);

    for (const property of ['<w:u w:val="none"/>', '<w:highlight w:val="none"/>']) {
      const noneSource = await buildDocxFromBodyXml(`<w:p><w:r><w:rPr>${property}</w:rPr><w:t>Complete</w:t></w:r></w:p>`);
      const noneImported = await importDocxToMarkdoc(noneSource);
      const declaration = property.includes('<w:u') ? 'underline="none"' : 'highlight="none"';
      await expect(compileMarkdoc(noneImported.anchoredSource, change(
        noneImported.markdoc,
        'Complete',
        `{% retain-format ${declaration} %}Complete{% /retain-format %}`,
      ))).rejects.toMatchObject({ code: 'NOOP_RETAINED_FORMAT' });
    }
  });

  retainedTest('[SDX-MDOC-133][SDX-MDOC-134][SDX-MDOC-135] rejects non-common, mixed, empty, and nested scopes transactionally', async () => {
    const mixed = await importedStyled([{ text: 'Alpha ', bold: true }, { text: 'Beta' }]);
    await expect(compileMarkdoc(mixed.anchoredSource, change(mixed.markdoc, 'Alpha Beta', '{% retain-format underline="single" %}Alpha Beta{% /retain-format %}')))
      .rejects.toMatchObject({ code: 'MIXED_FORMAT_RETAINED_SCOPE' });
    await expect(compileMarkdoc(mixed.anchoredSource, change(mixed.markdoc, 'Alpha Beta', 'Alpha {% retain-format underline="single" %}New Beta{% /retain-format %}')))
      .rejects.toMatchObject({ code: 'NON_COMMON_RETAINED_SCOPE' });
    expect(() => requireMarkdoc(change(mixed.markdoc, 'Alpha Beta', 'Alpha {% retain-format underline="single" %}{% /retain-format %}Beta'))).toThrow(/Markdoc validation failed/);
    expect(() => requireMarkdoc(change(mixed.markdoc, 'Alpha Beta', '{% retain-format underline="single" %}{% run-format highlight="yellow" %}Alpha{% /run-format %}{% /retain-format %} Beta'))).toThrow(/Markdoc validation failed/);

    const structuredSource = await buildDocxFromBodyXml(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Complete</w:t></w:r></w:sdtContent></w:sdt></w:p>',
    );
    const structured = await importDocxToMarkdoc(structuredSource);
    await expect(compileMarkdoc(structured.anchoredSource, change(structured.markdoc, 'Complete', '{% retain-format highlight="none" %}Complete{% /retain-format %}')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_EDIT_STRUCTURE' });
  });

  retainedTest('[SDX-MDOC-136][SDX-MDOC-138] admits neighboring text edits while certifying no text revision overlaps the retained interval', async () => {
    const imported = await importedStyled([{ text: 'Draft: ' }, { text: 'Complete', highlight: true }]);
    const result = await compileMarkdoc(imported.anchoredSource, change(imported.markdoc, 'Draft: Complete', 'Final version: {% retain-format highlight="none" %}Complete{% /retain-format %}'));
    expect(result.certificate.retainedFormatting).toMatchObject({ textRevisionOverlaps: 0, passed: true });
    const xml = await trackedXml(result.tracked);
    expect(xml).toContain('<w:del');
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('<w:rPrChange');
  });

  retainedTest('[SDX-MDOC-132][SDX-MDOC-138] preserves compact xml:space, removes duplicate properties, and emits schema-valid revisions', async () => {
    const source = await buildDocxFromBodyXml(
      '<w:p><w:r><w:rPr><w:u w:val="single"/><w:u w:val="single"/><w:highlight w:val="yellow"/></w:rPr>'
      + '<w:t xml:space="preserve">Complete</w:t></w:r></w:p>',
    );
    const imported = await importDocxToMarkdoc(source);
    const result = await compileMarkdoc(imported.anchoredSource, change(
      imported.markdoc,
      'Complete',
      '{% retain-format highlight="none" underline="none" %}Complete{% /retain-format %}',
    ));
    const cleanXml = await trackedXml(result.clean);
    expect(cleanXml).toContain('xml:space="preserve"');
    expect(cleanXml).not.toContain('<w:u');
    expect(result.certificate.retainedFormatting).toMatchObject({ passed: true, textRevisionOverlaps: 0 });

    const directory = mkdtempSync(join(tmpdir(), 'retained-format-schema-'));
    const output = join(directory, 'tracked.docx');
    try {
      writeFileSync(output, result.tracked);
      const schema = spawnSync(process.execPath, ['scripts/check_emitted_document_schema.mjs', output], {
        cwd: join(import.meta.dirname, '../../..'),
        encoding: 'utf8',
      });
      expect(schema.status, schema.stderr || schema.stdout).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  retainedTest('[SDX-MDOC-138] requires complete property-revision coverage and exact interval text', async () => {
    const source = await buildDocxFromBodyXml(
      '<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Com</w:t></w:r>'
      + '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>plete</w:t></w:r></w:p>',
    );
    const imported = await importDocxToMarkdoc(source);
    const document = await DocxDocument.load(imported.anchoredSource);
    const paragraph = document.getParagraphs()[0]!;
    const firstRPr = directChild(getParagraphRuns(paragraph)[0]!.r, 'rPr')!;
    firstRPr.appendChild(paragraph.ownerDocument!.createElementNS(firstRPr.namespaceURI, 'w:rPrChange'));
    const baseSpan = {
      operationId: 'coverage-probe',
      paragraphId: requireMarkdoc(imported.markdoc).scaffold[0]!.id,
      start: 0,
      end: 8,
      sourceStart: 0,
      sourceEnd: 8,
      expectedText: 'Complete',
      format: { underline: 'single' as const },
    };
    expect(certifyRetainedFormatting(document, [baseSpan])).toMatchObject({
      passed: false,
      diagnostics: [{ propertyCoverageComplete: false, textMatches: true, propertyStateMatches: true }],
    });
    expect(certifyRetainedFormatting(document, [{ ...baseSpan, end: 3, sourceEnd: 3, expectedText: 'Bad' }])).toMatchObject({
      passed: false,
      diagnostics: [{ textMatches: false }],
    });
  });

  retainedTest('[SDX-MDOC-133][SDX-MDOC-138] maps comparator-wide punctuation replacement to a retained-scope diagnostic', async () => {
    const imported = await importedStyled([{ text: 'Draft-Complete', highlight: true }]);
    await expect(compileMarkdoc(imported.anchoredSource, change(
      imported.markdoc,
      'Draft-Complete',
      'Final-{% retain-format highlight="none" %}Complete{% /retain-format %}',
    ))).rejects.toMatchObject({ code: 'NON_COMMON_RETAINED_SCOPE' });
  });

  retainedTest('[SDX-MDOC-138] rejects a tracked character wrapper over a declared property-only interval', async () => {
    const source = await buildSyntheticDocx({ paragraphs: ['Complete'] });
    const imported = await importDocxToMarkdoc(source);
    const document = await DocxDocument.load(imported.anchoredSource);
    const paragraph = document.getParagraphs()[0]!;
    const run = getParagraphRuns(paragraph)[0]!.r;
    const wrapper = paragraph.ownerDocument!.createElementNS(run.namespaceURI, 'w:ins');
    paragraph.insertBefore(wrapper, run);
    paragraph.removeChild(run);
    wrapper.appendChild(run);
    const report = certifyRetainedFormatting(document, [{
      operationId: 'tampered',
      paragraphId: requireMarkdoc(imported.markdoc).scaffold[0]!.id,
      start: 0,
      end: 8,
      sourceStart: 0,
      sourceEnd: 8,
      expectedText: 'Complete',
      format: { highlight: 'none' },
    }]);
    expect(report.passed).toBe(false);
    expect(report.textRevisionOverlaps).toBeGreaterThan(0);
  });

  retainedTest('[SDX-MDOC-130] formats retained text inside an existing physical table cell without changing topology', async () => {
    const source = await buildDocxFromBodyXml(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>'
      + '<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>'
      + '<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Complete</w:t></w:r></w:p>'
      + '</w:tc></w:tr></w:tbl>',
    );
    const imported = await importDocxToMarkdoc(source);
    const result = await compileMarkdoc(imported.anchoredSource, change(
      imported.markdoc,
      'Complete',
      '{% retain-format highlight="none" %}Complete{% /retain-format %}',
      'table-retained-format',
    ));
    const xml = await trackedXml(result.clean);
    expect(xml.match(/<w:tbl(?:\s|>)/gu)).toHaveLength(1);
    expect(xml.match(/<w:tr(?:\s|>)/gu)).toHaveLength(1);
    expect(xml.match(/<w:tc(?:\s|>)/gu)).toHaveLength(1);
    expect(result.certificate.retainedFormatting).toMatchObject({ passed: true, textRevisionOverlaps: 0 });
  });
});
