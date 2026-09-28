import JSZip from 'jszip';
import { afterEach, describe, expect, vi } from 'vitest';
import { OOXML, ZIP_EPOCH } from '@usejunior/docx-core';
import { buildDocxWithAncillaryParts } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const W_NS = OOXML.W_NS;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const HEADER_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

const TEST_FEATURE = 'Deterministic Markdoc import';
const determinismTest = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1110 import output depends only on input bytes',
  severity: 'critical',
}).openspec('make-markdoc-import-deterministic');

// A body plus a selected header, so both serializations on the import path
// (DocxDocument.toBuffer for the body anchors, anchorSelectedStories for the
// header anchors) rewrite a part and would otherwise stamp the wall clock.
async function bodyWithHeader(): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: '<w:p><w:r><w:t>Either party may terminate this Agreement.</w:t></w:r></w:p>',
    sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
    relationships: [{ id: 'rIdHeader', type: REL, target: 'header1.xml' }],
    parts: [{
      path: 'word/header1.xml', contentType: HEADER_CONTENT_TYPE,
      xml: `<w:hdr xmlns:w="${W_NS}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>Draft of September 1, 2026</w:t></w:r></w:p></w:hdr>`,
    }],
  });
}

async function entryDates(buffer: Buffer): Promise<Record<string, number>> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.fromEntries(Object.values(zip.files).map((file) => [file.name, file.date.getTime()]));
}

describe('deterministic Markdoc import', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  determinismTest('[SDX-MDOC-154] importing the same DOCX across a ZIP timestamp tick is byte-identical and still compiles', async () => {
    const source = await bodyWithHeader();
    // ZIP entry times have 2-second resolution; 10 seconds guarantees the two
    // imports land on different ticks. Only Date is faked so JSZip's
    // `new Date()` default reads the advanced clock while async work still runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
    const first = await importDocxToMarkdoc(source);
    vi.setSystemTime(new Date('2026-09-28T12:00:10.000Z'));
    const second = await importDocxToMarkdoc(source);
    vi.useRealTimers();

    expect(second.markdoc).toBe(first.markdoc);
    expect(second.anchoredSource.equals(first.anchoredSource)).toBe(true);
    expect(requireMarkdoc(first.markdoc).source.sha256).toBe(second.source.sha256);

    // Every rewritten part carries the fixed date, so the anchored package
    // never depends on when it was produced.
    const dates = await entryDates(second.anchoredSource);
    expect(dates['word/document.xml']).toBe(ZIP_EPOCH.getTime());
    expect(dates['word/header1.xml']).toBe(ZIP_EPOCH.getTime());
    expect(new Set(Object.values(dates))).toEqual(new Set([ZIP_EPOCH.getTime()]));

    // The hash still names the anchored bytes, so Markdoc from one import
    // compiles against the anchored source of another without hash drift.
    await expect(compileMarkdoc(second.anchoredSource, first.markdoc)).resolves.toMatchObject({
      certificate: { projectionPassed: true },
    });
  });
});
