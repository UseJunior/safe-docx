import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { acceptChanges, DocxArchive, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { compareDocuments, UnsupportedBlockContainerRevisionError } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

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

describe('block content-control boundary moves (#1028)', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const control = (inner: string) => `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
  const intoControl = [
    para('Before control.') + control(para('Inside control.')) + para('After control.'),
    control(para('Before control.') + para('Inside control.')) + para('After control, amended.'),
  ] as const;
  const trailingOutOfControl = [
    para('Lead paragraph.') + control(para('Inside control.') + para('Leaving control.')),
    para('Lead paragraph.') + control(para('Inside control.')) + para('Leaving control.'),
  ] as const;
  // Each paragraph's text, marked with whether it sits inside the block control.
  const shape = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map((p) => {
    let inControl = false;
    for (let node = p.parentNode; node; node = node.parentNode) {
      if ((node as Element).localName === 'sdtContent') inControl = true;
    }
    const text = Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
    return `${inControl ? 'sdt:' : ''}${text}`;
  });
  const cases = [
    ['a paragraph moves into the control', intoControl],
    ['a paragraph moves into the control (reverse direction)', [intoControl[1], intoControl[0]]],
    ['a trailing paragraph leaves the control', trailingOutOfControl],
    ['a trailing paragraph leaves the control (reverse direction)', [trailingOutOfControl[1], trailingOutOfControl[0]]],
  ] as const;

  for (const [name, [originalBody, revisedBody]] of cases) {
    for (const detectMoves of [false, true]) {
      test(`${name} with detectMoves=${detectMoves} tracks paragraphs, not the control`, async () => {
        const original = await buildDocxFromBodyXml(originalBody);
        const revised = await buildDocxFromBodyXml(revisedBody);
        const result = await compareDocuments(original, revised, { detectMoves });
        await assertSchema(result.document);
        const xml = (await (await DocxArchive.load(result.document)).getDocumentXml());
        const document = parseXml(xml);
        for (const tag of ['ins', 'del', 'moveFrom', 'moveTo']) {
          for (const wrapper of Array.from(document.getElementsByTagNameNS(W, tag))) {
            if (wrapper.parentNode && (wrapper.parentNode as Element).localName === 'rPr') continue;
            const blockChildren = Array.from(wrapper.childNodes)
              .filter((child) => child.nodeType === 1 && ['sdt', 'p', 'tbl'].includes((child as Element).localName));
            expect(blockChildren, `${tag} wraps block content`).toHaveLength(0);
          }
        }
        expect(document.getElementsByTagNameNS(W, 'sdt')).toHaveLength(1);
        const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
        const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
        for (const [astProject, nativeProject, expected] of [
          [acceptAllChanges, acceptChanges, revisedXml],
          [rejectAllChanges, rejectChanges, originalXml],
        ] as const) {
          expect(shape(astProject(xml))).toEqual(shape(expected));
          const native = parseXml(xml);
          nativeProject(native);
          expect(shape(serializeXml(native))).toEqual(shape(expected));
        }
      });
    }
  }
});
