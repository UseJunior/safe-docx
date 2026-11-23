/**
 * A revised input whose table cell carries a prior `w:tcPrChange` came out
 * of a comparison that also recorded a cell-property change with two sibling
 * `w:tcPrChange` records, which CT_TcPr does not admit. These tests pin one
 * record per property element: the prior record kept as written when its
 * old-value snapshot is the original's properties, a single comparison record
 * otherwise, schema validity, and both PRESERVE laws under both acceptors.
 * The same rule covers `w:tblPrChange` and `w:sectPrChange`.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1572
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

const TEST_FEATURE = 'Prior table and section property record in a comparison input';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SCHEMA_SCRIPT = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const DATE = 'w:date="2026-01-01T00:00:00Z"';
const RECORDS = new Set(['tcPrChange', 'tblPrChange', 'sectPrChange', 'trPrChange', 'pPrChange', 'rPrChange']);

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (text: string, tcPr = '<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>') => `<w:tc>${tcPr}<w:p>${t(text)}</w:p></w:tc>`;
const table = (cells: string, tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>') =>
  `<w:tbl>${tblPr}<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl><w:p/>`;
const tcPr = (live: string, old?: string) =>
  `<w:tcPr><w:tcW w:w="4000" w:type="dxa"/>${live}${old === undefined ? '' : `<w:tcPrChange w:id="8" w:author="Reviewer" ${DATE}><w:tcPr><w:tcW w:w="4000" w:type="dxa"/>${old}</w:tcPr></w:tcPrChange>`}</w:tcPr>`;

const elements = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
const serialize = (element: Element): string => {
  // w:orient="portrait" is the default (§17.6.13), so explicit and implicit portrait are the same page.
  const attributes = Array.from(element.attributes).filter(attribute => !attribute.name.startsWith('xmlns'))
    .filter(attribute => !(attribute.localName === 'orient' && attribute.value === 'portrait'))
    .map(attribute => `${attribute.localName}=${attribute.value}`).sort();
  return `${element.localName}{${attributes.join(';')}}[${elements(element).map(serialize).join('')}]`;
};
const live = (property: Element | undefined): string =>
  property ? elements(property).filter(child => !RECORDS.has(child.localName)).map(serialize).join('') : '';

/** Table, cell and section properties plus text, change records excluded. */
function projection(xml: string): string[] {
  const document = parseXml(xml);
  const tables = Array.from(document.getElementsByTagNameNS(W, 'tbl')).map(tbl =>
    `tbl:${live(elements(tbl).find(child => child.localName === 'tblPr'))}`);
  const rows = Array.from(document.getElementsByTagNameNS(W, 'tr')).map(tr =>
    `tr:${live(elements(tr).find(child => child.localName === 'trPr'))}`);
  const cells = Array.from(document.getElementsByTagNameNS(W, 'tc')).map(tc =>
    `tc:${live(elements(tc).find(child => child.localName === 'tcPr'))}|${tc.textContent}`);
  const sections = Array.from(document.getElementsByTagNameNS(W, 'sectPr'))
    .filter(section => (section.parentNode as Element).localName !== 'sectPrChange')
    .map(section => `sect:${elements(section).filter(child => !RECORDS.has(child.localName) && !child.localName.endsWith('Reference')).map(serialize).join('')}`);
  return [...tables, ...rows, ...cells, ...sections];
}

function records(xml: string, localName: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, localName))
    .map(record => `${record.getAttributeNS(W, 'author')}@${record.getAttributeNS(W, 'date')}`);
}

async function nativeDocumentXml(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<string> {
  const document = await DocxDocument.load(docx);
  await document[operation]();
  return (await DocxArchive.load((await document.toBuffer()).buffer)).getDocumentXml();
}

async function expectSchemaValid(docx: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sdx-1572-'));
  try {
    const path = join(dir, 'out.docx');
    await writeFile(path, docx);
    const check = spawnSync(process.execPath, [SCHEMA_SCRIPT, path], { encoding: 'utf8' });
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A package whose body is `bodyXml`; a trailing body `w:sectPr` replaces the fixture's empty one. */
async function packageOf(bodyXml: string): Promise<Buffer> {
  const sectionStart = bodyXml.lastIndexOf('<w:sectPr>');
  if (sectionStart < 0 || !bodyXml.endsWith('</w:sectPr>')) return buildDocxFromBodyXml(bodyXml);
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(bodyXml.slice(0, sectionStart)));
  archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr/>', bodyXml.slice(sectionStart)));
  return archive.save();
}

async function compareAndCheck(originalBody: string, revisedBody: string): Promise<string> {
  const original = await packageOf(originalBody);
  const revised = await packageOf(revisedBody);
  const result = await compareDocuments(original, revised, { author: 'cmp' });
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  await expectSchemaValid(result.document);
  const expectedAccepted = projection(acceptAllChanges(await (await DocxArchive.load(revised)).getDocumentXml()));
  const expectedRejected = projection(rejectAllChanges(await (await DocxArchive.load(original)).getDocumentXml()));
  expect(projection(acceptAllChanges(xml))).toEqual(expectedAccepted);
  expect(projection(rejectAllChanges(xml))).toEqual(expectedRejected);
  expect(projection(await nativeDocumentXml(result.document, 'acceptChanges'))).toEqual(expectedAccepted);
  expect(projection(await nativeDocumentXml(result.document, 'rejectChanges'))).toEqual(expectedRejected);
  return xml;
}

const SHADE = '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>';
const VALIGN = '<w:vAlign w:val="center"/>';
const CLEAN = table(cell('A') + cell('B'));
const PRIOR = table(cell('A', tcPr(SHADE, '')) + cell('B'));
const PRIOR_AUTHOR = ['Reviewer@2026-01-01T00:00:00Z'];
const cmpOnly = [expect.stringMatching(/^cmp@/)];

describe('a prior cell property record in a comparison input (#1572)', () => {
  const tcPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.36' });

  tcPrChange('keeps the prior tcPrChange as the one record when its snapshot is the clean original', async () => {
    expect(records(await compareAndCheck(CLEAN, PRIOR), 'tcPrChange')).toEqual(PRIOR_AUTHOR);
  });

  tcPrChange('keeps the prior tcPrChange beside a text edit in the same cell', async () => {
    const revised = table(cell('A more', tcPr(SHADE, '')) + cell('B'));
    expect(records(await compareAndCheck(CLEAN, revised), 'tcPrChange')).toEqual(PRIOR_AUTHOR);
  });

  tcPrChange('emits one comparison tcPrChange when the prior snapshot is not the original properties', async () => {
    const original = table(cell('A', tcPr(VALIGN)) + cell('B'));
    expect(records(await compareAndCheck(original, PRIOR), 'tcPrChange')).toEqual(cmpOnly);
  });

  tcPrChange('keeps the original prior tcPrChange in the reverse direction', async () => {
    expect(records(await compareAndCheck(PRIOR, CLEAN), 'tcPrChange').length).toBeLessThanOrEqual(1);
  });

  tcPrChange('keeps one tcPrChange for redline to redline, with and without a further cell change', async () => {
    expect(records(await compareAndCheck(PRIOR, PRIOR), 'tcPrChange')).toEqual(PRIOR_AUTHOR);
    const further = table(cell('A', tcPr(SHADE + VALIGN, '')) + cell('B'));
    expect(records(await compareAndCheck(PRIOR, further), 'tcPrChange')).toHaveLength(1);
  });
});

describe('a prior table property record in a comparison input (#1572)', () => {
  const tblPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.34' });
  const tblPr = (live: string, old?: string) =>
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/>${live}${old === undefined ? '' : `<w:tblPrChange w:id="9" w:author="Reviewer" ${DATE}><w:tblPr><w:tblW w:w="0" w:type="auto"/>${old}</w:tblPr></w:tblPrChange>`}</w:tblPr>`;
  const JC = '<w:jc w:val="center"/>';

  tblPrChange('keeps the prior tblPrChange when its snapshot is the clean original', async () => {
    const revised = table(cell('A') + cell('B'), tblPr(JC, ''));
    expect(records(await compareAndCheck(CLEAN, revised), 'tblPrChange')).toEqual(PRIOR_AUTHOR);
  });

  tblPrChange('emits one comparison tblPrChange when the prior snapshot is not the original properties', async () => {
    const original = table(cell('A') + cell('B'), tblPr('<w:jc w:val="right"/>'));
    const revised = table(cell('A') + cell('B'), tblPr(JC, ''));
    expect(records(await compareAndCheck(original, revised), 'tblPrChange')).toEqual(cmpOnly);
  });
});

describe('a prior section property record in a comparison input (#1572)', () => {
  const sectPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' });
  const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
  const section = (size: string, old?: string) =>
    `<w:p>${t('Body')}</w:p><w:sectPr>${size}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>${old === undefined ? '' : `<w:sectPrChange w:id="10" w:author="Reviewer" ${DATE}><w:sectPr>${old}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:sectPrChange>`}</w:sectPr>`;

  sectPrChange('keeps the prior sectPrChange when its snapshot is the clean original', async () => {
    const xml = await compareAndCheck(section(PORTRAIT), section('<w:pgSz w:w="12240" w:h="20160"/>', PORTRAIT));
    expect(records(xml, 'sectPrChange')).toEqual(PRIOR_AUTHOR);
  });

  sectPrChange('emits one comparison sectPrChange when a landscape prior snapshot omits the old portrait orientation', async () => {
    const landscape = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
    const xml = await compareAndCheck(section(PORTRAIT), section(landscape, PORTRAIT));
    expect(records(xml, 'sectPrChange')).toEqual(cmpOnly);
  });
});

describe('different prior row, cell and table records under unchanged live properties (#1574)', () => {
  const trPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.37' });
  const tcPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.36' });
  const tblPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.34' });
  const HEIGHT = '<w:trHeight w:val="400"/>';
  const rowTable = (trPr: string) =>
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${trPr}${cell('A')}${cell('B')}</w:tr></w:tbl><w:p/>`;
  const trPr = (old?: string, author = 'Reviewer') =>
    `<w:trPr>${HEIGHT}${old === undefined ? '' : `<w:trPrChange w:id="7" w:author="${author}" ${DATE}><w:trPr>${old}</w:trPr></w:trPrChange>`}</w:trPr>`;
  const rowRecords = async (original: string, revised: string) => records(await compareAndCheck(original, revised), 'trPrChange');

  trPrChange('completes with one trPrChange when the two inputs carry different prior row records', async () => {
    const found = await rowRecords(rowTable(trPr('<w:cantSplit/>')), rowTable(trPr('<w:tblHeader/>')));
    expect(found).toHaveLength(1);
  });

  trPrChange('completes when only the original or only the revised row has a prior record', async () => {
    expect(await rowRecords(rowTable(trPr('<w:cantSplit/>')), rowTable(trPr()))).toHaveLength(1);
    // The original's reject projection is its live row, which the revised row already equals.
    expect(await rowRecords(rowTable(trPr()), rowTable(trPr('<w:cantSplit/>')))).toEqual([]);
  });

  trPrChange('keeps a single record when the prior row records differ only in author', async () => {
    const found = await rowRecords(rowTable(trPr('<w:cantSplit/>')), rowTable(trPr('<w:cantSplit/>', 'Other')));
    expect(found).toHaveLength(1);
  });

  tcPrChange('completes with one tcPrChange when the two inputs carry different prior cell records', async () => {
    const original = table(cell('A', tcPr(SHADE, VALIGN)) + cell('B'));
    const revised = table(cell('A', tcPr(SHADE, '')) + cell('B'));
    expect(records(await compareAndCheck(original, revised), 'tcPrChange')).toHaveLength(1);
  });

  tblPrChange('completes with one tblPrChange when the two inputs carry different prior table records', async () => {
    const tblPr = (old: string) =>
      `<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblPrChange w:id="9" w:author="Reviewer" ${DATE}><w:tblPr><w:tblW w:w="0" w:type="auto"/>${old}</w:tblPr></w:tblPrChange></w:tblPr>`;
    const original = table(cell('A') + cell('B'), tblPr('<w:jc w:val="right"/>'));
    const revised = table(cell('A') + cell('B'), tblPr(''));
    expect(records(await compareAndCheck(original, revised), 'tblPrChange')).toHaveLength(1);
  });
});
