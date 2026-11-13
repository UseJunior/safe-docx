import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { acceptChanges, DocxArchive, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { compareDocuments, formatUnrepresentedChangeWarnings } from '../index.js';
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

const W_MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const innerTable = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/>'
  + '<w:gridCol w:w="1500"/></w:tblGrid><w:tr><w:tc>' + paragraph('Cell one') + '</w:tc><w:tc>'
  + paragraph('Cell two') + '</w:tc></w:tr></w:tbl>';
const blockContainerCases = [
  blockControl,
  wrapControl(paragraph('First') + '<w:p><w:r><w:t>Second </w:t></w:r><w:r><w:rPr><w:b/></w:rPr>'
    + '<w:t>bold</w:t></w:r></w:p>'),
  wrapControl(wrapControl(paragraph('Nested'))),
  wrapControl(wrapCustomXml(paragraph('Nested'))),
  wrapCustomXml(paragraph('Nested')),
  wrapControl(paragraph('Before table') + innerTable),
  wrapControl(innerTable),
] as const;

/**
 * Body structure (containers, tables, paragraph text) independent of revision
 * markup. With `dropEmptied`, a container holding only empty paragraphs and
 * emptied containers (the shell Accept/Reject leave, reported through
 * `unrepresentedChanges`) is omitted; `emptied` counts the omitted shells.
 */
function blockStructure(xml: string, dropEmptied = false): { shape: string; emptied: number } {
  let emptied = 0;
  const visit = (element: Element): string[] => Array.from(element.childNodes).flatMap((node) => {
    if (node.nodeType !== 1) return [];
    const child = node as Element;
    if (child.namespaceURI !== W_MAIN) return [];
    if (child.localName === 'p') {
      return [`p(${Array.from(child.getElementsByTagNameNS(W_MAIN, 't')).map((t) => t.textContent).join('')})`];
    }
    if (['sdt', 'customXml'].includes(child.localName)) {
      const before = emptied;
      const content = visit(child);
      if (dropEmptied && content.every((item) => item === 'p()')) {
        emptied = before + 1;
        return [];
      }
      return [`${child.localName}[${content.join(',')}]`];
    }
    if (['tbl', 'tr', 'tc'].includes(child.localName)) return [`${child.localName}[${visit(child).join(',')}]`];
    if (child.localName === 'sdtContent') return visit(child);
    return [];
  });
  const shape = visit(parseXml(xml).getElementsByTagNameNS(W_MAIN, 'body')[0]!).join(',');
  return { shape, emptied };
}

async function assertTrackedContainer(original: Buffer, revised: Buffer, kind: 'ins' | 'del'): Promise<void> {
  const result = await compareDocuments(original, revised);
  await assertSchema(result.document);
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  const document = parseXml(xml);
  for (const tag of ['ins', 'del']) {
    for (const wrapper of Array.from(document.getElementsByTagNameNS(W_MAIN, tag))) {
      const blockChildren = Array.from(wrapper.childNodes).filter((child) => child.nodeType === 1
        && ['sdt', 'customXml', 'sdtContent', 'p', 'tbl', 'tr', 'tc'].includes((child as Element).localName));
      expect(blockChildren, `${tag} wraps block content`).toHaveLength(0);
    }
  }
  const containers = [
    ...Array.from(document.getElementsByTagNameNS(W_MAIN, 'sdt')),
    ...Array.from(document.getElementsByTagNameNS(W_MAIN, 'customXml')),
  ];
  expect(containers.length).toBeGreaterThan(0);
  for (const container of containers) {
    for (const p of Array.from(container.getElementsByTagNameNS(W_MAIN, 'p'))) {
      const pPr = Array.from(p.childNodes).find((n) => (n as Element).localName === 'pPr') as Element | undefined;
      const rPr = Array.from(pPr?.childNodes ?? []).find((n) => (n as Element).localName === 'rPr') as Element | undefined;
      // A deleted row's final cell paragraph keeps its mark: the row marker
      // removes the cell (§17.13.5.12), as for any deleted table.
      const finalCellParagraph = (p.parentNode as Element).localName === 'tc'
        && Array.from(p.parentNode!.childNodes).filter((n) => (n as Element).localName === 'p').at(-1) === p;
      if (!(kind === 'del' && finalCellParagraph)) {
        expect(rPr?.getElementsByTagNameNS(W_MAIN, kind).length, 'paragraph mark revision').toBe(1);
      }
      for (const run of Array.from(p.getElementsByTagNameNS(W_MAIN, 'r'))) {
        expect((run.parentNode as Element).localName, 'run revision wrapper').toBe(kind);
      }
    }
    for (const row of Array.from(container.getElementsByTagNameNS(W_MAIN, 'tr'))) {
      const trPr = Array.from(row.childNodes).find((n) => (n as Element).localName === 'trPr') as Element | undefined;
      expect(trPr?.getElementsByTagNameNS(W_MAIN, kind).length, 'row revision marker').toBe(1);
    }
  }
  const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
  const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
  for (const [projection, astProject, nativeProject, expected] of [
    ['accept', acceptAllChanges, acceptChanges, revisedXml],
    ['reject', rejectAllChanges, rejectChanges, originalXml],
  ] as const) {
    // The projection that removes the container's content keeps one emptied
    // shell: no revision particle can wrap w:sdt or w:customXml.
    const shells = (kind === 'ins') === (projection === 'reject') ? 1 : 0;
    const want = { shape: blockStructure(expected).shape, emptied: shells };
    expect(blockStructure(astProject(xml), true), `${projection} comparison acceptor`).toEqual(want);
    const native = parseXml(xml);
    nativeProject(native);
    expect(blockStructure(serializeXml(native), true), `${projection} docx-core acceptor`).toEqual(want);
  }
  const containerChanges = (result.unrepresentedChanges ?? []).filter((change) =>
    change.scope === 'contentControl' && ['sdt', 'customXml'].includes(change.contentControl?.element ?? ''));
  expect(containerChanges).toHaveLength(1);
  expect(containerChanges[0]).toMatchObject({ kind: kind === 'ins' ? 'added' : 'removed' });
  const outer = [...Array.from(document.getElementsByTagNameNS(W_MAIN, 'sdt')),
    ...Array.from(document.getElementsByTagNameNS(W_MAIN, 'customXml'))]
    .find((container) => !['sdtContent', 'customXml'].includes((container.parentNode as Element).localName))!;
  expect(containerChanges[0]!.contentControl!.element).toBe(outer.localName);
  expect(formatUnrepresentedChangeWarnings(containerChanges)[0])
    .toContain(kind === 'ins' ? 'Reject All leaves it empty' : 'Accept All leaves it empty');
}

describe('block content-control revision publication', () => {
  test('tracks a whole inserted or deleted block container through its paragraph marks and runs', async () => {
    // With and without a following paragraph: a container can close the body story.
    for (const after of [paragraph('After'), '']) {
      const plain = await buildDocxFromBodyXml(paragraph('Outside') + after);
      for (const xml of blockContainerCases) {
        const withBlock = await buildDocxFromBodyXml(paragraph('Outside') + xml + after);
        for (const [original, revised, kind] of [
          [plain, withBlock, 'ins'],
          [withBlock, plain, 'del'],
        ] as const) {
          await assertTrackedContainer(original, revised, kind);
        }
      }
    }
  });

  test('tracks a relocated block container as a deletion and an insertion, not a move', async () => {
    const control = wrapControl(paragraph('The optional rider applies to every closing under this agreement.'));
    const original = await buildDocxFromBodyXml(paragraph('Lead') + control + paragraph('Middle') + paragraph('Tail'));
    const revised = await buildDocxFromBodyXml(paragraph('Lead') + paragraph('Middle') + paragraph('Tail') + control);
    const result = await compareDocuments(original, revised, { detectMoves: true });
    await assertSchema(result.document);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const document = parseXml(xml);
    for (const move of ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart']) {
      expect(document.getElementsByTagNameNS(W_MAIN, move), move).toHaveLength(0);
    }
    expect(document.getElementsByTagNameNS(W_MAIN, 'sdt')).toHaveLength(2);
    const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
    const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
    for (const [astProject, nativeProject, expected] of [
      [acceptAllChanges, acceptChanges, revisedXml],
      [rejectAllChanges, rejectChanges, originalXml],
    ] as const) {
      const want = { shape: blockStructure(expected).shape, emptied: 1 };
      expect(blockStructure(astProject(xml), true)).toEqual(want);
      const native = parseXml(xml);
      nativeProject(native);
      expect(blockStructure(serializeXml(native), true)).toEqual(want);
    }
    expect((result.unrepresentedChanges ?? []).map((change) => [change.kind, change.contentControl?.element]))
      .toEqual([['removed', 'sdt'], ['added', 'sdt']]);
  });

  test('still refuses a whole block container in a text box, whose emptied container cannot be reported', async () => {
    const textBox = (inner: string) => buildDocxFromBodyXml('<w:p><w:r><w:pict>'
      + '<v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="box1"><v:textbox><w:txbxContent>'
      + inner + '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>');
    const plain = await textBox(paragraph('Keep'));
    const withBlock = await textBox(paragraph('Keep') + blockControl);
    for (const [original, revised, change] of [[plain, withBlock, 'insert'], [withBlock, plain, 'delete']] as const) {
      await expect(compareDocuments(original, revised)).rejects.toMatchObject({
        name: 'UnsupportedBlockContainerRevisionError', change, container: 'sdt', partPath: 'word/document.xml',
      });
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

  test('tracks a side-only block container inside an otherwise aligned table cell', async () => {
    const table = (cellContent: string) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/>'
      + '</w:tblGrid><w:tr><w:tc>' + cellContent + '</w:tc></w:tr></w:tbl>';
    const plain = await buildDocxFromBodyXml(table(paragraph('Outside')));
    for (const xml of blockContainerCases) {
      const withBlock = await buildDocxFromBodyXml(table(paragraph('Outside') + xml));
      for (const [original, revised, kind] of [
        [plain, withBlock, 'ins'],
        [withBlock, plain, 'del'],
      ] as const) {
        await assertTrackedContainer(original, revised, kind);
      }
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

// Explicit opt-in, as in noteLifecycleBodyMarks.test.ts: a requested reader
// run must fail, never silently skip an unusable installed LibreOffice.
const reader = process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice resolves a whole inserted or deleted block container', () => {
  test('accepts and rejects to the source content, leaving at most the emptied container', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const table = (cellContent: string) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
      + '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' + cellContent + '</w:tc></w:tr></w:tbl>';
    const scenarios: Array<[string, string, string]> = [];
    for (const xml of blockContainerCases) {
      scenarios.push(['body', paragraph('Outside') + paragraph('After'), paragraph('Outside') + xml + paragraph('After')]);
      scenarios.push(['cell', table(paragraph('Outside')), table(paragraph('Outside') + xml)]);
    }
    const jobs: Array<{ op: 'accept' | 'reject' | 'identity'; documentXml: string }> = [];
    const labels: string[] = [];
    for (const [where, plainBody, blockBody] of scenarios) {
      const plain = await buildDocxFromBodyXml(plainBody);
      const withBlock = await buildDocxFromBodyXml(blockBody);
      for (const [original, revised, kind] of [[plain, withBlock, 'ins'], [withBlock, plain, 'del']] as const) {
        const compared = await (await DocxArchive.load((await compareDocuments(original, revised)).document)).getDocumentXml();
        labels.push(`${where} ${kind}`);
        jobs.push(
          { op: 'identity', documentXml: await (await DocxArchive.load(original)).getDocumentXml() },
          { op: 'identity', documentXml: await (await DocxArchive.load(revised)).getDocumentXml() },
          { op: 'accept', documentXml: compared },
          { op: 'reject', documentXml: compared },
        );
      }
    }
    const states = await runLibreOfficeOracle(jobs);
    const report: string[] = [];
    labels.forEach((label, index) => {
      const [originalState, revisedState, accepted, rejected] = states.slice(index * 4, index * 4 + 4) as [string, string, string, string];
      report.push(`${label}\n  original ${blockStructure(originalState).shape}\n  revised  ${blockStructure(revisedState).shape}`
        + `\n  accept   ${blockStructure(accepted).shape}\n  reject   ${blockStructure(rejected).shape}`);
      expect(blockStructure(accepted, true).shape, `${label} accept`).toBe(blockStructure(revisedState, true).shape);
      expect(blockStructure(rejected, true).shape, `${label} reject`).toBe(blockStructure(originalState, true).shape);
    });
    if (process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REPORT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REPORT, report.join('\n'));
    }
  }, 300_000);
});
