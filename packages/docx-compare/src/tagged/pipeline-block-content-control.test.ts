import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import {
  acceptChanges,
  collectStrictFieldStructureIssues,
  DocxArchive,
  parseXml,
  rejectChanges,
  serializeXml,
} from '@usejunior/docx-core';
import { compareDocuments, formatUnrepresentedChangeWarnings } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

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
  // One test per container shape keeps each within the default timeout.
  // With and without a following paragraph: a container can close the body story.
  for (const [placement, after] of [['before a paragraph', paragraph('After')], ['at the end of the body', '']] as const) {
    blockContainerCases.forEach((xml, caseIndex) => {
      test(`tracks a whole inserted or deleted block container (shape ${caseIndex}, ${placement}) through its paragraph marks and runs`, async () => {
        const plain = await buildDocxFromBodyXml(paragraph('Outside') + after);
        const withBlock = await buildDocxFromBodyXml(paragraph('Outside') + xml + after);
        await assertTrackedContainer(plain, withBlock, 'ins');
        await assertTrackedContainer(withBlock, plain, 'del');
      });
    });
  }

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

  blockContainerCases.forEach((xml, caseIndex) => {
    test(`tracks a side-only block container (shape ${caseIndex}) inside an otherwise aligned table cell`, async () => {
      const table = (cellContent: string) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/>'
        + '</w:tblGrid><w:tr><w:tc>' + cellContent + '</w:tc></w:tr></w:tbl>';
      const plain = await buildDocxFromBodyXml(table(paragraph('Outside')));
      const withBlock = await buildDocxFromBodyXml(table(paragraph('Outside') + xml));
      await assertTrackedContainer(plain, withBlock, 'ins');
      await assertTrackedContainer(withBlock, plain, 'del');
    });
  });

});

describe('block content-control formatting fidelity', () => {
  const shadedTable = (fill: string, cellContent: string) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'
    + fill + '"/></w:tcPr>' + cellContent + '</w:tc></w:tr></w:tbl>';
  const documentXml = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();

  test('still measures the table formatting of an empty control both documents hold', async () => {
    const emptyControl = wrapControl('<w:p/>');
    const originalXml = await documentXml(await buildDocxFromBodyXml(shadedTable('FF0000', emptyControl)));
    const revisedXml = await documentXml(await buildDocxFromBodyXml(shadedTable('0000FF', emptyControl)));
    const fidelity = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, revisedXml);
    expect(fidelity.reject.tableFormatting.divergent).toBeGreaterThan(0);
    expect(fidelity.score).toBeLessThan(1);
  });

  test('skips only the placeholder paragraph a whole inserted or deleted container leaves in a cell', async () => {
    const plain = await buildDocxFromBodyXml(shadedTable('FF0000', paragraph('Outside')));
    // A plain control, and one holding a paragraph and a table: the final
    // paragraph of a deleted cell is tracked by its row marker, not its mark.
    for (const xml of [blockControl, blockContainerCases[5]!]) {
      const withBlock = await buildDocxFromBodyXml(shadedTable('FF0000', paragraph('Outside') + xml));
      for (const [original, revised] of [[plain, withBlock], [withBlock, plain]] as const) {
        const result = await compareDocuments(original, revised);
        const fidelity = compareSourceProjectedFormattingFidelity(
          await documentXml(original),
          await documentXml(revised),
          await documentXml(result.document),
        );
        expect(fidelity.accept.divergences).toEqual([]);
        expect(fidelity.reject.divergences).toEqual([]);
        expect(fidelity.score).toBe(1);
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

describe('block customXml boundary moves (#1102)', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const boldPara = (text: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const styledPara = (text: string) =>
    `<w:p><w:pPr><w:spacing w:after="240"/><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const custom = (inner: string, element = 'clause') =>
    `<w:customXml w:uri="urn:example:terms" w:element="${element}">${inner}</w:customXml>`;
  const control = (inner: string, tag = 'party') =>
    `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:id w:val="7"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
  const intoCustom = [
    boldPara('Before clause.') + custom(para('Inside clause.')) + para('After clause.'),
    custom(boldPara('Before clause.') + para('Inside clause.')) + para('After clause, amended.'),
  ] as const;
  const trailingOutOfCustom = [
    para('Lead paragraph.') + custom(para('Inside clause.') + para('Leaving clause.')),
    para('Lead paragraph.') + custom(para('Inside clause.')) + para('Leaving clause.'),
  ] as const;
  // A paragraph moves into a content control nested in a customXml container.
  const intoNestedControl = [
    custom(para('Before control.') + control(para('Inside clause.'))) + para('After clause.'),
    custom(control(para('Before control.') + para('Inside clause.'))) + para('After clause.'),
  ] as const;
  // A paragraph leaves a customXml container nested in a content control.
  const outOfNestedCustom = [
    control(custom(para('Inside clause.') + para('Leaving clause.'))),
    control(custom(para('Inside clause.')) + para('Leaving clause.')),
  ] as const;
  // Each paragraph's text, prefixed by its enclosing containers (outermost
  // first) and their identity: the customXml element name, the sdt tag.
  const shape = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map((p) => {
    const containers: string[] = [];
    for (let node = p.parentNode; node; node = node.parentNode) {
      const element = node as Element;
      if (element.localName === 'customXml') containers.unshift(`cx[${element.getAttributeNS(W, 'element')}]`);
      if (element.localName === 'sdt') {
        const tag = element.getElementsByTagNameNS(W, 'tag')[0]?.getAttributeNS(W, 'val') ?? '';
        containers.unshift(`sdt[${tag}]`);
      }
    }
    const text = Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
    return [...containers, text].join(':');
  });
  // Text inside tracked insertions and deletions.
  const trackedText = (document: Document): string[] => ['ins', 'del'].flatMap((tag) =>
    Array.from(document.getElementsByTagNameNS(W, tag))
      .flatMap((wrapper) => [...Array.from(wrapper.getElementsByTagNameNS(W, 't')),
        ...Array.from(wrapper.getElementsByTagNameNS(W, 'delText'))])
      .map((text) => text.textContent ?? ''));
  const pairedCases = [
    ['a paragraph moves into the customXml container', intoCustom, 1],
    ['a paragraph moves into the customXml container (reverse direction)', [intoCustom[1], intoCustom[0]], 1],
    ['a trailing paragraph leaves the customXml container', trailingOutOfCustom, 1],
    ['a trailing paragraph leaves the customXml container (reverse direction)', [trailingOutOfCustom[1], trailingOutOfCustom[0]], 1],
    ['a paragraph moves into a content control nested in a customXml container', intoNestedControl, 1],
    ['a paragraph leaves a customXml container nested in a content control', outOfNestedCustom, 1],
  ] as const;

  async function compareAndProject(
    originalBody: string,
    revisedBody: string,
    detectMoves: boolean,
    project: (xml: string) => string[] = shape,
  ) {
    const original = await buildDocxFromBodyXml(originalBody);
    const revised = await buildDocxFromBodyXml(revisedBody);
    const result = await compareDocuments(original, revised, { detectMoves });
    await assertSchema(result.document);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
    const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
    const projections = ([
      ['accept', acceptAllChanges, acceptChanges, revisedXml],
      ['reject', rejectAllChanges, rejectChanges, originalXml],
    ] as const).map(([label, astProject, nativeProject, expected]) => {
      const native = parseXml(xml);
      nativeProject(native);
      return { label, ast: project(astProject(xml)), native: project(serializeXml(native)), expected: project(expected) };
    });
    const fidelity = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, xml);
    return { result, xml, document: parseXml(xml), projections, fidelity };
  }

  for (const [name, [originalBody, revisedBody], customCount] of pairedCases) {
    for (const detectMoves of [false, true]) {
      test(`${name} with detectMoves=${detectMoves} pairs the container and tracks only the moved paragraph`, async () => {
        const { result, document, projections, fidelity } = await compareAndProject(originalBody, revisedBody, detectMoves);
        expect(fidelity.accept.divergences).toEqual([]);
        expect(fidelity.reject.divergences).toEqual([]);
        for (const tag of ['ins', 'del', 'moveFrom', 'moveTo']) {
          for (const wrapper of Array.from(document.getElementsByTagNameNS(W, tag))) {
            if (wrapper.parentNode && (wrapper.parentNode as Element).localName === 'rPr') continue;
            const blockChildren = Array.from(wrapper.childNodes).filter((child) => child.nodeType === 1
              && ['sdt', 'customXml', 'p', 'tbl'].includes((child as Element).localName));
            expect(blockChildren, `${tag} wraps block content`).toHaveLength(0);
          }
        }
        expect(document.getElementsByTagNameNS(W, 'customXml')).toHaveLength(customCount);
        expect(trackedText(document).filter((text) => text.includes('Inside')), 'unchanged inner paragraph').toEqual([]);
        expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl')).toEqual([]);
        for (const projection of projections) {
          expect(projection.ast, `${projection.label} comparison acceptor`).toEqual(projection.expected);
          expect(projection.native, `${projection.label} docx-core acceptor`).toEqual(projection.expected);
        }
      });
    }
  }

  // w:customXmlPr, like w:sdtPr, admits no revision particle: an aligned
  // custom XML element whose properties differ publishes the revised
  // properties whole and reports the difference, never w:ins/w:del inside them.
  const withProperties = (value: string, inner: string, element = 'term') =>
    `<w:customXml w:uri="urn:example:terms" w:element="${element}"><w:customXmlPr>`
    + `<w:attr w:name="status" w:val="${value}"/></w:customXmlPr>${inner}</w:customXml>`;
  const propertyCases = [
    ['a nested element whose properties change as a paragraph moves into its container',
      para('Moving text.') + custom(withProperties('old', para('Inside clause.'))),
      custom(para('Moving text.') + withProperties('new', para('Inside clause.'))), 'changed', 1],
    ['an element whose properties change while its text stays',
      para('Outside.') + withProperties('old', para('Inside clause.')),
      para('Outside.') + withProperties('new', para('Inside clause.')), 'changed', 0],
    ['an element that gains properties while its text stays',
      para('Outside.') + custom(para('Inside clause.'), 'term'),
      para('Outside.') + withProperties('new', para('Inside clause.')), 'added', 0],
  ] as const;

  for (const [name, originalBody, revisedBody, kind, index] of propertyCases) {
    for (const detectMoves of [false, true]) {
      test(`${name} with detectMoves=${detectMoves}: publishes the revised w:customXmlPr and reports it`, async () => {
        const { result, document, projections } = await compareAndProject(originalBody, revisedBody, detectMoves);
        for (const properties of Array.from(document.getElementsByTagNameNS(W, 'customXmlPr'))) {
          const revisions = ['ins', 'del'].flatMap((tag) => Array.from(properties.getElementsByTagNameNS(W, tag)));
          expect(revisions, 'revision inside w:customXmlPr').toEqual([]);
        }
        const changes = (result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl');
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
          kind,
          contentControl: { element: 'customXmlPr', index, customXmlElement: 'term', customXmlUri: 'urn:example:terms' },
        });
        expect(formatUnrepresentedChangeWarnings(changes)[0])
          .toContain(`properties (w:customXmlPr) of custom XML element #${index + 1} (element "term"`);
        for (const projection of projections) {
          expect(projection.ast, `${projection.label} comparison acceptor`).toEqual(projection.expected);
          expect(projection.native, `${projection.label} docx-core acceptor`).toEqual(projection.expected);
        }
      });
    }
  }

  // A container whose identity differs is a different container: no revision
  // can record a w:element, w:uri or w:sdtPr change, so its content is tracked
  // as leaving the original container and entering the revised one, and each
  // emptied container is reported by name.
  const renamedCases = [
    ['the customXml element name changes', 'customXml',
      para('Outside.') + custom(para('Inside text.')), para('Outside.') + custom(para('Inside text.'), 'term'),
      'cx[clause]:', 'cx[term]:', 'element "clause"', 'element "term"'],
    ['the customXml element name changes as a paragraph moves into it', 'customXml',
      para('Before clause.') + custom(para('Inside clause.')) + para('After clause.'),
      custom(para('Before clause.') + para('Inside clause.'), 'term') + para('After clause.'),
      'cx[clause]:', 'cx[term]:', 'element "clause"', 'element "term"'],
    // Paragraph properties survive on the emptied container's placeholder paragraph.
    ['the customXml element name changes around formatted paragraphs', 'customXml',
      para('Outside.') + custom(styledPara('First inside.') + styledPara('Second inside.')),
      para('Outside.') + custom(styledPara('First inside.') + styledPara('Second inside.'), 'term'),
      'cx[clause]:', 'cx[term]:', 'element "clause"', 'element "term"'],
    ['the content control tag changes as a paragraph moves into it', 'sdt',
      para('Before control.') + control(para('Inside clause.')) + para('After control.'),
      control(para('Before control.') + para('Inside clause.'), 'signer') + para('After control.'),
      'sdt[party]:', 'sdt[signer]:', 'tag "party"', 'tag "signer"'],
  ] as const;

  for (const [name, container, originalBody, revisedBody, removedShell, addedShell, removedName, addedName] of renamedCases) {
    test(`${name}: tracks the content out of one container and into the other, reporting both by name`, async () => {
      const { result, document, projections } = await compareAndProject(originalBody, revisedBody, false);
      expect(document.getElementsByTagNameNS(W, container)).toHaveLength(2);
      const changes = (result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl');
      expect(changes.map((change) => [change.kind, change.contentControl?.element])).toEqual([
        ['removed', container], ['added', container],
      ]);
      const warnings = formatUnrepresentedChangeWarnings(changes);
      expect(warnings[0]).toContain(removedName);
      expect(warnings[0]).toContain('Accept All leaves it empty');
      expect(warnings[1]).toContain(addedName);
      expect(warnings[1]).toContain('Reject All leaves it empty');
      for (const projection of projections) {
        // The projection keeps the other side's container, emptied, as one empty paragraph.
        const shell = projection.label === 'accept' ? removedShell : addedShell;
        for (const actual of [projection.ast, projection.native]) {
          expect(actual.filter((entry) => entry === shell), `${projection.label} emptied container`).toHaveLength(1);
          expect(actual.filter((entry) => entry !== shell), `${projection.label} projection`).toEqual(projection.expected);
        }
      }
    });
  }

  // A block container holding a field pairs across a boundary move: pairing
  // it diffs its children through the same field guard, so no paragraph
  // holding a field is fuzzily paired and no field complex is split (#1459).
  describe('a block container holding a field (#1459)', () => {
    const fieldTest = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
    const fieldBegin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
    const fieldInstruction = (instruction: string) =>
      `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>`;
    const fieldSeparate = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    const fieldEnd = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const field = (instruction: string, result: string) =>
      fieldBegin + fieldInstruction(instruction) + fieldSeparate + run(result) + fieldEnd;
    const refPara = `<w:p>${run('Held clause, see ')}${field('REF _Ref1459 \\h', 'Section 1.1')}${run('.')}</w:p>`;
    const pagePara = `<w:p>${run('Held clause on page ')}${field('PAGE', '3')}</w:p>`;
    // One REF field whose result runs across two paragraphs of the container.
    const spanningPair = `<w:p>${run('Held clause, see ')}${fieldBegin}${fieldInstruction('REF _Ref1459 \\h')}`
      + `${fieldSeparate}${run('Section')}</w:p><w:p>${run('1.1 continued')}${fieldEnd}${run(' held.')}</w:p>`;
    // The halves of a field that crosses the container boundary.
    const opensField = `<w:p>${run('Held clause, see ')}${fieldBegin}${fieldInstruction('REF _Ref1459 \\h')}`
      + `${fieldSeparate}${run('Section')}</w:p>`;
    const closesField = `<w:p>${run('1.1 continued')}${fieldEnd}${run(' after.')}</w:p>`;
    const moving = 'Moving text.';
    // Each paragraph's containers, then its text, field characters and field
    // instructions interleaved in document order (adjacent text merged, so
    // run splitting does not matter but a result moving past a field
    // character does).
    const fieldShape = (xml: string) => {
      const texts = shape(xml);
      return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map((p, index) => {
        const tokens: string[] = [];
        let text = '';
        for (const element of Array.from(p.getElementsByTagNameNS(W, '*'))) {
          if (element.localName === 't') {
            text += element.textContent ?? '';
            if (tokens.at(-1)?.startsWith('"')) tokens[tokens.length - 1] = `"${tokens.at(-1)!.slice(1, -1)}${element.textContent ?? ''}"`;
            else tokens.push(`"${element.textContent ?? ''}"`);
          } else if (element.localName === 'fldChar') {
            tokens.push(`{${element.getAttributeNS(W, 'fldCharType')}}`);
          } else if (['instrText', 'delInstrText'].includes(element.localName)) {
            tokens.push(`${element.localName}(${(element.textContent ?? '').trim()})`);
          }
        }
        const containers = texts[index]!.slice(0, texts[index]!.length - text.length);
        return `${containers}${tokens.join('')}`;
      });
    };
    const fieldPairedCases = [
      ['a paragraph moves into a customXml container holding a REF field', [
        para(moving) + custom(refPara) + para('After clause.'),
        custom(para(moving) + refPara) + para('After clause.'),
      ], 1],
      ['a paragraph leaves a customXml container holding a REF field', [
        custom(para(moving) + refPara) + para('After clause.'),
        para(moving) + custom(refPara) + para('After clause.'),
      ], 1],
      ['a trailing paragraph leaves a customXml container holding a PAGE field', [
        para('Lead paragraph.') + custom(pagePara + para(moving)),
        para('Lead paragraph.') + custom(pagePara) + para(moving),
      ], 1],
      ['a trailing paragraph moves into a customXml container holding a PAGE field', [
        para('Lead paragraph.') + custom(pagePara) + para(moving),
        para('Lead paragraph.') + custom(pagePara + para(moving)),
      ], 1],
      ['a paragraph moves into a content control holding a REF field', [
        para(moving) + control(refPara) + para('After control.'),
        control(para(moving) + refPara) + para('After control.'),
      ], 0],
      ['a trailing paragraph leaves a content control holding a PAGE field', [
        control(pagePara + para(moving)) + para('After control.'),
        control(pagePara) + para(moving) + para('After control.'),
      ], 0],
      ['a paragraph moves into a content control holding a REF field nested in a customXml container', [
        custom(para(moving) + control(refPara)) + para('After clause.'),
        custom(control(para(moving) + refPara)) + para('After clause.'),
      ], 1],
      ['a paragraph moves into a customXml container whose field spans two of its paragraphs', [
        para(moving) + custom(spanningPair) + para('After clause.'),
        custom(para(moving) + spanningPair) + para('After clause.'),
      ], 1],
      ['a trailing paragraph leaves a content control whose field spans two of its paragraphs', [
        control(spanningPair + para(moving)) + para('After control.'),
        control(spanningPair) + para(moving) + para('After control.'),
      ], 0],
    ] as const;

    for (const [name, [originalBody, revisedBody], customCount] of fieldPairedCases) {
      for (const detectMoves of [false, true]) {
        fieldTest(`${name} with detectMoves=${detectMoves} pairs the container and leaves the field untracked`, async () => {
          const { result, document, projections, fidelity } =
            await compareAndProject(originalBody, revisedBody, detectMoves, fieldShape);
          expect(fidelity.accept.divergences).toEqual([]);
          expect(fidelity.reject.divergences).toEqual([]);
          for (const tag of ['ins', 'del', 'moveFrom', 'moveTo']) {
            for (const wrapper of Array.from(document.getElementsByTagNameNS(W, tag))) {
              if (wrapper.parentNode && (wrapper.parentNode as Element).localName === 'rPr') continue;
              const tracked = Array.from(wrapper.getElementsByTagNameNS(W, '*'))
                .filter((element) => ['sdt', 'customXml', 'p', 'tbl', 'fldChar', 'instrText', 'delInstrText']
                  .includes(element.localName));
              expect(tracked.map((element) => element.localName), `${tag} wraps block content or a field`).toEqual([]);
            }
          }
          expect(document.getElementsByTagNameNS(W, 'customXml')).toHaveLength(customCount);
          expect(trackedText(document).filter((text) => text.trim() && !moving.includes(text)), 'tracked text').toEqual([]);
          expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl')).toEqual([]);
          for (const projection of projections) {
            expect(projection.ast, `${projection.label} comparison acceptor`).toEqual(projection.expected);
            expect(projection.native, `${projection.label} docx-core acceptor`).toEqual(projection.expected);
          }
          const xml = serializeXml(document);
          for (const [label, astProject, nativeProject] of [
            ['accept', acceptAllChanges, acceptChanges],
            ['reject', rejectAllChanges, rejectChanges],
          ] as const) {
            const native = parseXml(xml);
            nativeProject(native);
            expect(collectStrictFieldStructureIssues(astProject(xml)), `${label} comparison acceptor fields`).toEqual([]);
            expect(collectStrictFieldStructureIssues(serializeXml(native)), `${label} docx-core acceptor fields`).toEqual([]);
          }
        });
      }
    }

    // A moving paragraph that holds a complete field still lets the
    // containers pair; only that paragraph is tracked, as a whole.
    const movingField = `<w:p>${run('Moving, see ')}${field('REF _Ref1459 \\h', 'Section 1.1')}</w:p>`;
    const movingPage = `<w:p>${run('Moving, page ')}${field('PAGE', '3')}</w:p>`;
    const unchanged = para('Unchanged clause.');
    const fieldTrackedCases = [
      ['a paragraph holding a REF field moves into the customXml container', [
        movingField + custom(unchanged) + para('After clause.'),
        custom(movingField + unchanged) + para('After clause.'),
      ], 1],
      ['a paragraph holding a PAGE field leaves the content control', [
        control(unchanged + movingPage) + para('After control.'),
        control(unchanged) + movingPage + para('After control.'),
      ], 0],
    ] as const;

    for (const [name, [originalBody, revisedBody], customCount] of fieldTrackedCases) {
      for (const detectMoves of [false, true]) {
        fieldTest(`${name} with detectMoves=${detectMoves} pairs the container and tracks the field paragraph whole`, async () => {
          const { result, document, projections, fidelity, xml } =
            await compareAndProject(originalBody, revisedBody, detectMoves, fieldShape);
          expect(fidelity.accept.divergences).toEqual([]);
          expect(fidelity.reject.divergences).toEqual([]);
          expect(document.getElementsByTagNameNS(W, 'customXml')).toHaveLength(customCount);
          expect(trackedText(document).filter((text) => text.includes('Unchanged')), 'unchanged paragraph').toEqual([]);
          expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl')).toEqual([]);
          for (const projection of projections) {
            expect(projection.ast, `${projection.label} comparison acceptor`).toEqual(projection.expected);
            expect(projection.native, `${projection.label} docx-core acceptor`).toEqual(projection.expected);
          }
          for (const [label, astProject, nativeProject] of [
            ['accept', acceptAllChanges, acceptChanges],
            ['reject', rejectAllChanges, rejectChanges],
          ] as const) {
            const native = parseXml(xml);
            nativeProject(native);
            expect(collectStrictFieldStructureIssues(astProject(xml)), `${label} comparison acceptor fields`).toEqual([]);
            expect(collectStrictFieldStructureIssues(serializeXml(native)), `${label} docx-core acceptor fields`).toEqual([]);
          }
        });
      }
    }

    // A field that crosses a container boundary (#1462). The paragraphs
    // holding its halves are tracked as deletions and insertions, and the
    // deleted halves stay deleted as one field: lifting their field characters
    // out of w:del left an extra empty field (begin, separate, end with no
    // instruction) after Accept All while every field-structure check passed.
    // `fieldShape` compares text, field characters and instructions in
    // document order, so a duplicated or dropped field character fails.
    const crossingTest = fieldTest.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' });
    const sourceStrict = (body: string) =>
      collectStrictFieldStructureIssues(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
    async function expectFieldExactProjections(
      originalBody: string,
      revisedBody: string,
      detectMoves: boolean,
      // The container change `unrepresentedChanges` lists for a container
      // that is not in both documents, whose emptied shell the projection
      // that removes its content keeps (as for any whole container).
      listed: ReadonlyArray<'added' | 'removed' | 'changed'> = [],
    ) {
      expect(sourceStrict(originalBody)).toEqual([]);
      expect(sourceStrict(revisedBody)).toEqual([]);
      const { result, projections, xml } = await compareAndProject(originalBody, revisedBody, detectMoves, fieldShape);
      const containerChanges = (result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl');
      expect(containerChanges.map((change) => change.kind).sort()).toEqual([...listed].sort());
      const shellsAllowed = { accept: listed.filter((kind) => kind === 'removed').length,
        reject: listed.filter((kind) => kind === 'added').length };
      // An emptied container keeps one empty paragraph: containers, no tokens.
      const isShell = (row: string) => row.endsWith(':') && !/["{(]/u.test(row);
      // Changed control properties publish the revised ones whole (#1095).
      const identity = (rows: readonly string[]) => listed.includes('changed')
        ? rows.map((row) => row.replace(/sdt\[[^\]]*\]/gu, 'sdt[]'))
        : [...rows];
      for (const projection of projections) {
        const expected = identity(projection.expected);
        for (const [who, rows] of [['comparison', projection.ast], ['docx-core', projection.native]] as const) {
          const actual = identity(rows);
          const kept = actual.filter((row) => !isShell(row) || expected.includes(row));
          expect(kept, `${projection.label} ${who} acceptor`).toEqual(expected);
          expect(actual.length - kept.length, `${projection.label} ${who} emptied shells`)
            .toBeLessThanOrEqual(shellsAllowed[projection.label]);
        }
      }
      for (const [label, astProject, nativeProject] of [
        ['accept', acceptAllChanges, acceptChanges],
        ['reject', rejectAllChanges, rejectChanges],
      ] as const) {
        const native = parseXml(xml);
        nativeProject(native);
        expect(collectStrictFieldStructureIssues(astProject(xml)), `${label} comparison acceptor fields`).toEqual([]);
        expect(collectStrictFieldStructureIssues(serializeXml(native)), `${label} docx-core acceptor fields`).toEqual([]);
      }
      return { result, document: parseXml(xml) };
    }

    // The container is in both documents: it pairs, so it is tracked, not
    // listed, and no emptied shell is left.
    const crossingWrappers = [
      ['customXml container', (inner: string) => custom(inner)],
      ['content control', (inner: string) => control(inner)],
    ] as const;
    const crossingCases = crossingWrappers.flatMap(([kind, wrap]) => [
      [`the field's begin leaves the ${kind} and its end enters it`, [
        wrap(opensField) + closesField + para('Tail.'),
        opensField + wrap(closesField) + para('Tail.'),
      ]],
      [`the field's begin enters the ${kind} and its end leaves it`, [
        opensField + wrap(closesField) + para('Tail.'),
        wrap(opensField) + closesField + para('Tail.'),
      ]],
      [`the field's end moves into the ${kind} that holds its begin`, [
        wrap(para('Held clause.') + opensField) + closesField + para('Tail.'),
        wrap(para('Held clause.') + opensField + closesField) + para('Tail.'),
      ]],
      [`the field's end leaves the ${kind} that holds its begin, beside an edit`, [
        wrap(para('Held clause.') + opensField + closesField) + para('Tail.'),
        wrap(para('Held clause.') + opensField) + closesField + para('Tail, amended.'),
      ]],
      [`a field begins inside the ${kind} and ends after it while a paragraph moves in`, [
        para(moving) + wrap(unchanged + opensField) + closesField,
        wrap(para(moving) + unchanged + opensField) + closesField,
      ]],
      [`a field begins before the ${kind} and ends inside it while a paragraph moves out`, [
        opensField + wrap(closesField + unchanged + para(moving)) + para('After.'),
        opensField + wrap(closesField + unchanged) + para(moving) + para('After.'),
      ]],
    ] as const);

    for (const [name, [originalBody, revisedBody]] of crossingCases) {
      for (const detectMoves of [false, true]) {
        crossingTest(`${name} with detectMoves=${detectMoves} pairs the container and keeps one field in each projection`, async () => {
          const { document } = await expectFieldExactProjections(originalBody, revisedBody, detectMoves);
          // Each deleted half keeps its field characters inside its deletion.
          for (const fieldChar of Array.from(document.getElementsByTagNameNS(W, 'fldChar'))) {
            const run = fieldChar.parentNode as Element;
            const paragraph = run.parentNode as Element;
            const deletedParagraph = Array.from(paragraph.getElementsByTagNameNS(W, 'delText')).length > 0
              && Array.from(paragraph.getElementsByTagNameNS(W, 't')).length === 0;
            if (deletedParagraph) expect((run.parentNode as Element).localName, 'deleted field character').toBe('del');
          }
        });
      }
    }

    // A container that only one document holds, or whose identity changes,
    // with a field crossing its boundary: the container's content is tracked
    // whole as for any container that is not in both documents, and the
    // deleted half of the field stays deleted.
    const renamed = (inner: string) => custom(inner, 'renamedClause');
    const otherUri = (inner: string) => `<w:customXml w:uri="urn:example:other" w:element="clause">${inner}</w:customXml>`;
    const retagged = (inner: string) => control(inner, 'counterparty');
    const lead = para('Lead paragraph.');
    const tail = para('Tail paragraph.');
    const unpairedCases = crossingWrappers.flatMap(([kind, wrap]) => [
      [`a ${kind} holding the field's begin is removed`, [lead + wrap(opensField) + closesField + tail,
        lead + opensField + closesField + tail], ['removed']],
      [`a ${kind} holding the field's end is removed`, [lead + opensField + wrap(closesField) + tail,
        lead + opensField + closesField + tail], ['removed']],
      [`a ${kind} holding the field's begin and an edited paragraph is removed`, [
        lead + wrap(opensField + para('Middle clause.')) + closesField + tail,
        lead + opensField + para('Middle clause, amended.') + closesField + tail], ['removed']],
      [`a ${kind} is added around the field's begin`, [lead + opensField + closesField + tail,
        lead + wrap(opensField) + closesField + tail], ['added']],
    ] as const);
    const identityCases = [
      ["a customXml container holding the field's begin is renamed", [lead + custom(opensField) + closesField + tail,
        lead + renamed(opensField) + closesField + tail], ['added', 'removed']],
      ["a customXml container holding the field's end changes its namespace", [lead + opensField + custom(closesField) + tail,
        lead + opensField + otherUri(closesField) + tail], ['added', 'removed']],
      ["a customXml container is renamed while the field's end moves into it", [custom(opensField) + closesField + tail,
        opensField + renamed(closesField) + tail], ['added', 'removed']],
      // A content control pairs whatever its tag; the changed properties
      // are published whole and listed (#1095).
      ["a content control holding the field's begin is retagged", [lead + control(opensField) + closesField + tail,
        lead + retagged(opensField) + closesField + tail], ['changed']],
      ["a content control is retagged while the field's end moves into it", [control(opensField) + closesField + tail,
        opensField + retagged(closesField) + tail], ['added', 'removed']],
    ] as const;

    for (const [name, [originalBody, revisedBody], listed] of [...unpairedCases, ...identityCases]) {
      for (const detectMoves of [false, true]) {
        crossingTest(`${name} with detectMoves=${detectMoves} tracks it whole and keeps one field in each projection`, async () => {
          await expectFieldExactProjections(originalBody, revisedBody, detectMoves, listed);
        });
      }
    }
  });
});

// Explicit opt-in, as in noteLifecycleBodyMarks.test.ts: a requested reader
// run must fail, never silently skip an unusable installed LibreOffice.
const reader = process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice resolves a whole inserted or deleted block container', () => {
  test('accepts and rejects to the source content, leaving at most the emptied container or its empty paragraph', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const table = (cellContent: string) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
      + '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' + cellContent + '</w:tc></w:tr></w:tbl>';
    // One representative per container shape keeps each headless launch short.
    const [control, , , controlInCustomXml, customXml, controlWithTable] = blockContainerCases;
    const scenarios: Array<[string, string, string]> = [
      ...[control, controlInCustomXml, customXml, controlWithTable].map((xml): [string, string, string] =>
        ['body', paragraph('Outside') + paragraph('After'), paragraph('Outside') + xml + paragraph('After')]),
      ['cell', table(paragraph('Outside')), table(paragraph('Outside') + control)],
    ];
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
    const states: string[] = [];
    for (let start = 0; start < jobs.length; start += 4) {
      states.push(...await runLibreOfficeOracle(jobs.slice(start, start + 4)));
    }
    const report: string[] = [];
    const checks: Array<[string, string, string]> = [];
    // LibreOffice may keep the emptied container or only its empty paragraph;
    // either way no text survives and nothing else differs.
    const withoutEmpty = (xml: string) => blockStructure(xml, true).shape.replace(/(^|,)p\(\)/g, '');
    labels.forEach((label, index) => {
      const [originalState, revisedState, accepted, rejected] = states.slice(index * 4, index * 4 + 4) as [string, string, string, string];
      report.push(`${label}\n  original ${blockStructure(originalState).shape}\n  revised  ${blockStructure(revisedState).shape}`
        + `\n  accept   ${blockStructure(accepted).shape}\n  reject   ${blockStructure(rejected).shape}`);
      checks.push([`${label} accept`, withoutEmpty(accepted), withoutEmpty(revisedState)]);
      checks.push([`${label} reject`, withoutEmpty(rejected), withoutEmpty(originalState)]);
    });
    if (process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REPORT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REPORT, report.join('\n'));
    }
    for (const [label, actual, expected] of checks) expect(actual, label).toBe(expected);
  }, 900_000);

  // LibreOffice drops a block content control's wrapper on save, so the
  // paragraphs' text and field characters are compared, not the containers.
  test('resolves a field crossing a block container boundary to one field in each projection', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const fieldChar = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
    const opens = `<w:p>${run('Held clause, see ')}${fieldChar('begin')}`
      + `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>${fieldChar('separate')}${run('3')}</w:p>`;
    const closes = `<w:p>${run(' continued')}${fieldChar('end')}${run(' after.')}</w:p>`;
    const tailParagraph = paragraph('Tail');
    const customXml = (inner: string) => `<w:customXml w:uri="urn:test" w:element="clause">${inner}</w:customXml>`;
    const control = (inner: string) => `<w:sdt><w:sdtPr><w:tag w:val="clause"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const fieldText = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W_MAIN, 'p')).map((p) => {
      const tokens = Array.from(p.getElementsByTagNameNS(W_MAIN, '*')).flatMap((element) => {
        if (element.localName === 't') return [element.textContent ?? ''];
        if (element.localName === 'fldChar') return [`{${element.getAttributeNS(W_MAIN, 'fldCharType')}}`];
        if (element.localName === 'instrText') return [`[${(element.textContent ?? '').trim()}]`];
        return [];
      });
      return tokens.join('');
    }).filter((text) => text !== '').join(' / ');
    const jobs: Array<{ op: 'accept' | 'reject' | 'identity'; documentXml: string }> = [];
    const labels: string[] = [];
    for (const [kind, wrap] of [['customXml', customXml], ['sdt', control]] as const) {
      const original = await buildDocxFromBodyXml(wrap(opens) + closes + tailParagraph);
      const revised = await buildDocxFromBodyXml(opens + wrap(closes) + tailParagraph);
      const compared = await (await DocxArchive.load((await compareDocuments(original, revised)).document)).getDocumentXml();
      labels.push(kind);
      jobs.push(
        { op: 'identity', documentXml: await (await DocxArchive.load(original)).getDocumentXml() },
        { op: 'identity', documentXml: await (await DocxArchive.load(revised)).getDocumentXml() },
        { op: 'accept', documentXml: compared },
        { op: 'reject', documentXml: compared },
      );
    }
    const states = await runLibreOfficeOracle(jobs);
    const report: string[] = [];
    labels.forEach((label, index) => {
      const [originalState, revisedState, accepted, rejected] = states.slice(index * 4, index * 4 + 4) as [string, string, string, string];
      report.push(`${label}\n  original ${fieldText(originalState)}\n  revised  ${fieldText(revisedState)}`
        + `\n  accept   ${fieldText(accepted)}\n  reject   ${fieldText(rejected)}`);
      expect(fieldText(accepted), `${label} accept`).toBe(fieldText(revisedState));
      expect(fieldText(rejected), `${label} reject`).toBe(fieldText(originalState));
    });
    if (process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REPORT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.SAFE_DOCX_BLOCK_CONTAINER_READER_REPORT, `\n${report.join('\n')}`);
    }
  }, 900_000);
});
