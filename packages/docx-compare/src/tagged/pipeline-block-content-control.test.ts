import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, UnsupportedBlockContainerRevisionError } from '../index.js';

const TEST_FEATURE = 'Block Container Revisions';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.31' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const blockControl = `<w:sdt><w:sdtPr/><w:sdtContent>${paragraph('Inside')}</w:sdtContent></w:sdt>`;
const runControl = '<w:p><w:sdt><w:sdtPr/><w:sdtContent>'
  + '<w:r><w:t>Inside</w:t></w:r></w:sdtContent></w:sdt></w:p>';
const wrapControl = (content: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const wrapCustomXml = (content: string) => `<w:customXml w:element="sample">${content}</w:customXml>`;
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-block-sdt-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('block content-control revision publication', () => {
  test('refuses whole block controls and custom-XML containers before returning a DOCX', async () => {
    const plain = await buildDocxFromBodyXml(paragraph('Outside'));
    for (const [container, xml] of [
      ['sdt', blockControl],
      ['sdt', wrapControl(wrapControl(paragraph('Nested')))],
      ['sdt', wrapControl(wrapCustomXml(paragraph('Nested')))],
      ['customXml', wrapCustomXml(paragraph('Nested'))],
    ] as const) {
      const withBlock = await buildDocxFromBodyXml(paragraph('Outside') + xml);
      for (const [original, revised, change] of [
        [plain, withBlock, 'insert'],
        [withBlock, plain, 'delete'],
      ] as const) {
        await expect(compareDocuments(original, revised)).rejects.toMatchObject({
          name: 'UnsupportedBlockContainerRevisionError', change, container,
        });
        await expect(compareDocuments(original, revised))
          .rejects.toBeInstanceOf(UnsupportedBlockContainerRevisionError);
      }
    }
  });

  test('keeps run-level content controls comparable in both directions', async () => {
    const plain = await buildDocxFromBodyXml(paragraph('Outside'));
    const withRun = await buildDocxFromBodyXml(paragraph('Outside') + runControl);
    for (const [original, revised] of [[plain, withRun], [withRun, plain]] as const) {
      const result = await compareDocuments(original, revised);
      await assertSchema(result.document);
    }
  });

  test('keeps run-level custom-XML containers comparable in both directions', async () => {
    const plain = await buildDocxFromBodyXml(paragraph('Outside'));
    const withRun = await buildDocxFromBodyXml(paragraph('Outside')
      + `<w:p>${wrapCustomXml('<w:r><w:t>Inside</w:t></w:r>')}</w:p>`);
    for (const [original, revised] of [[plain, withRun], [withRun, plain]] as const) {
      const result = await compareDocuments(original, revised);
      await assertSchema(result.document);
    }
  });

  test('keeps an aligned block control comparable when only its text changes', async () => {
    const original = await buildDocxFromBodyXml(paragraph('Outside') + blockControl);
    const revised = await buildDocxFromBodyXml(paragraph('Outside')
      + blockControl.replace('Inside', 'Inside revised'));
    const result = await compareDocuments(original, revised);
    await assertSchema(result.document);
  });

  test('refuses a side-only block control inside an otherwise aligned table cell', async () => {
    const table = (cellContent: string) => '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/>'
      + '</w:tblGrid><w:tr><w:tc>' + cellContent + '</w:tc></w:tr></w:tbl>';
    const plain = await buildDocxFromBodyXml(table(paragraph('Outside')));
    const withBlock = await buildDocxFromBodyXml(table(paragraph('Outside') + blockControl));
    for (const [original, revised] of [
      [plain, withBlock],
      [withBlock, plain],
    ] as const) {
      await expect(compareDocuments(original, revised)).rejects.toMatchObject({
        name: 'UnsupportedTableTopologyComparisonError', feature: 'tableContainer', tableIndex: 0,
      });
    }
  });
});
