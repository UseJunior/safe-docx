/**
 * A comparison input whose paragraph mark carries a prior tracked insertion
 * (`w:ins` in `w:pPr/w:rPr`) used to abort with TaggedPublicationSafetyError:
 * the original's live mark was matched to the revised's inserted mark, and the
 * one published mark vanished under Reject All. These tests pin a complete
 * redline that keeps the prior author's mark insertion, is schema-valid, and
 * keeps both PRESERVE laws under both acceptors.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1565
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocuments, acceptAllChanges, rejectAllChanges } from '../index.js';

const TEST_FEATURE = 'Prior inserted paragraph mark in a comparison input';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SCHEMA_SCRIPT = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const REVISION = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
const DATE = 'w:date="2026-01-01T00:00:00Z"';

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (id: number, author: string, xml: string) => `<w:ins w:id="${id}" w:author="${author}" ${DATE}>${xml}</w:ins>`;
const p = (xml: string, pPr = '') => `<w:p>${pPr}${xml}</w:p>`;


/** A run property with its attribute values, e.g. `b{val=0}`, so an explicit off value never projects like on. */
function propertySignature(property: Element): string {
  const attributes = Array.from(property.attributes).map(attribute => `${attribute.localName}=${attribute.value}`).sort();
  return attributes.length ? `${property.localName}{${attributes.join(';')}}` : property.localName;
}

/** Visible text of each body paragraph, as `[b,i]text` segments of equal direct run formatting. */
function paragraphTexts(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map(paragraph =>
    Array.from(paragraph.getElementsByTagNameNS(W, 't')).map(node => {
      const rPr = Array.from((node.parentNode as Element).childNodes)
        .find((child): child is Element => child.nodeType === 1 && (child as Element).localName === 'rPr');
      const format = rPr
        ? Array.from(rPr.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).localName !== 'rPrChange').map(propertySignature)
        : [];
      return { format: format.join(','), text: node.textContent ?? '' };
    }).reduce<{ format: string; text: string }[]>((segments, run) => {
      const last = segments[segments.length - 1];
      if (last && last.format === run.format) last.text += run.text;
      else if (run.text) segments.push({ ...run });
      return segments;
    }, []).map(segment => `[${segment.format}]${segment.text}`).join(''));
}

async function nativeDocumentXml(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<string> {
  const document = await DocxDocument.load(docx);
  await document[operation]();
  return (await DocxArchive.load((await document.toBuffer()).buffer)).getDocumentXml();
}

async function expectSchemaValid(docx: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sdx-1565-'));
  try {
    const path = join(dir, 'out.docx');
    await writeFile(path, docx);
    const check = spawnSync(process.execPath, [SCHEMA_SCRIPT, path], { encoding: 'utf8' });
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Compare, then check the emitted chains, schema validity and both PRESERVE laws under both acceptors. */
async function compareAndCheck(originalBody: string, revisedBody: string): Promise<{ xml: string }> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, { author: 'cmp' });
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  await expectSchemaValid(result.document);

  const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
  const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
  const expectedAccepted = paragraphTexts(acceptAllChanges(revisedXml));
  const expectedRejected = paragraphTexts(rejectAllChanges(originalXml));
  expect(paragraphTexts(acceptAllChanges(xml))).toEqual(expectedAccepted);
  expect(paragraphTexts(rejectAllChanges(xml))).toEqual(expectedRejected);
  expect(paragraphTexts(await nativeDocumentXml(result.document, 'acceptChanges'))).toEqual(expectedAccepted);
  expect(paragraphTexts(await nativeDocumentXml(result.document, 'rejectChanges'))).toEqual(expectedRejected);
  return { xml };
}


const markInserted = (id: number, author: string, xml: string) =>
  `<w:p><w:pPr><w:rPr><w:ins w:id="${id}" w:author="${author}" ${DATE}/></w:rPr></w:pPr>${xml}</w:p>`;
const PRIOR_MARK = markInserted(9, 'Reviewer', ins(10, 'Reviewer', t('New para'))) + p(t('Next para'));
const BASE = p(t('First ')) + p(t('Second'));

/** Authors of the paragraph-mark revision markers of each body paragraph. */
function markMarkers(xml: string): string[][] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map(paragraph => {
    const pPr = Array.from(paragraph.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'pPr');
    const rPr = pPr && Array.from(pPr.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'rPr');
    return rPr
      ? Array.from(rPr.childNodes).filter((node): node is Element => node.nodeType === 1 && REVISION.has((node as Element).localName))
        .map(marker => `${marker.localName}(${marker.getAttributeNS(W, 'author')})`)
      : [];
  });
}

describe('a prior inserted paragraph mark in a comparison input', () => {
  const conformant = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' });

  conformant('completes a clean original against a revised file with a prior mark insertion and keeps that insertion', async () => {
    const { xml } = await compareAndCheck(BASE, PRIOR_MARK);
    const marks = markMarkers(xml);
    expect(marks.filter(markers => markers.includes('ins(Reviewer)'))).toEqual([['ins(Reviewer)']]);
    expect(marks.every(markers => markers.length <= 1)).toBe(true);
  });

  conformant('completes the reverse direction, deleting the paragraph that holds the prior mark insertion', async () => {
    const { xml } = await compareAndCheck(PRIOR_MARK, BASE);
    expect(markMarkers(xml)).toContainEqual(['ins(Reviewer)', 'del(cmp)']);
  });

  conformant('compares two redlines that both carry the prior mark insertion and edits its text', async () => {
    const edited = markInserted(9, 'Reviewer', ins(10, 'Reviewer', t('New paragraph'))) + p(t('Next para'));
    const { xml } = await compareAndCheck(PRIOR_MARK, edited);
    expect(markMarkers(xml)[0]).toEqual(['ins(Reviewer)']);
  });

  conformant('compares a clean paragraph against a prior split of the same text', async () => {
    const split = markInserted(9, 'Reviewer', t('Alpha ')) + p(t('Beta gamma'));
    await compareAndCheck(p(t('Alpha Beta gamma')), split);
    await compareAndCheck(split, p(t('Alpha Beta gamma')));
  });

  conformant('compares a clean original against an unchanged paragraph whose mark a reviewer inserted', async () => {
    const original = p(t('Alpha')) + p(t('Beta'));
    const revised = markInserted(9, 'Reviewer', t('Alpha')) + p(t('Beta'));
    const { xml } = await compareAndCheck(original, revised);
    expect(markMarkers(xml).flat()).toContain('ins(Reviewer)');
  });
  conformant('never pairs an edited paragraph by similarity across a mark-insertion difference, in body, table cell or content control', async () => {
    const containers: Array<(xml: string) => string> = [
      xml => xml,
      xml => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${xml}</w:tc></w:tr></w:tbl>`,
      xml => `<w:sdt><w:sdtPr/><w:sdtContent>${xml}</w:sdtContent></w:sdt>`,
    ];
    for (const container of containers) {
      for (const kind of ['ins', 'moveTo']) {
        const clean = container(p(t('Alpha beta gamma delta')) + p(t('End')));
        const prior = container(`<w:p><w:pPr><w:rPr><w:${kind} w:id="9" w:author="Reviewer" ${DATE}/></w:rPr></w:pPr>${t('Alpha beta gamma revised')}</w:p>` + p(t('End')));
        await compareAndCheck(clean, prior);
        await compareAndCheck(prior, clean);
      }
    }
  });
});
