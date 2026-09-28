import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { acceptChanges, DocxArchive, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { compareDocuments, formatUnrepresentedChangeWarnings } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison')
  .withLabels({ feature: 'Block Container Revisions' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );
const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const sdt = (properties: string, inner: string) =>
  `<w:sdt>${properties === '' ? '' : `<w:sdtPr>${properties}</w:sdtPr>`}<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const TAG1 = '<w:tag w:val="t1"/><w:id w:val="5"/>';
const TAG2 = '<w:tag w:val="t2"/><w:id w:val="5"/>';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-sdtpr-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const serializeElement = (element: Element): string => new XMLSerializer().serializeToString(element);
const documentXml = async (buffer: Buffer) => (await DocxArchive.load(buffer)).getDocumentXml();
const REVISION_TAGS = ['ins', 'del', 'moveFrom', 'moveTo'];
const hasAncestor = (element: Element, names: readonly string[]): boolean => {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && names.includes((node as Element).localName)) return true;
  }
  return false;
};
/** Every revision wrapper touching a property element, in either direction. */
const propertyRevisions = (xml: string): string[] => {
  const document = parseXml(xml);
  const inside = REVISION_TAGS.flatMap((tag) => Array.from(document.getElementsByTagNameNS(W, tag)))
    .filter((wrapper) => hasAncestor(wrapper, ['sdtPr', 'sdtEndPr']))
    .map((wrapper) => `inside:${serializeElement(wrapper)}`);
  const around = ['sdtPr', 'sdtEndPr']
    .flatMap((name) => Array.from(document.getElementsByTagNameNS(W, name)))
    .filter((properties) => hasAncestor(properties, REVISION_TAGS))
    .map((properties) => `wrapped:${serializeElement(properties)}`);
  return [...inside, ...around];
};
const controlProperties = (xml: string): string[] => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'sdt'))
  .map((control) => Array.from(control.childNodes)
    .filter((child) => child.nodeType === 1 && ['sdtPr', 'sdtEndPr'].includes((child as Element).localName))
    .map((child) => serializeElement(child as Element).replace(/ xmlns:w="[^"]*"/g, ''))
    .join(''));
const controlText = (xml: string): string[] => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'sdtContent'))
  .map((content) => Array.from(content.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join(''));

const cases = [
  {
    name: 'block control tag changed, content unchanged (#1095 row 2)',
    original: P('Out') + sdt(TAG1, P('Inside text')),
    revised: P('Out') + sdt(TAG2, P('Inside text')),
    kind: 'changed', control: { index: 0, id: '5', tag: 't2' }, text: { insertions: 0, deletions: 0 },
  },
  {
    name: 'block control tag changed, inner text edited (#1095 row 3)',
    original: P('Out') + sdt(TAG1, P('Inside text')),
    revised: P('Out') + sdt(TAG2, P('Inside text edited')),
    kind: 'changed', control: { index: 0, id: '5', tag: 't2' }, text: { insertions: 1, deletions: 0 },
  },
  {
    name: 'block control alias added (#1095 row 4)',
    original: P('Out') + sdt('<w:id w:val="5"/>', P('Inside text')),
    revised: P('Out') + sdt('<w:alias w:val="Clause"/><w:id w:val="5"/>', P('Inside text')),
    kind: 'changed', control: { index: 0, id: '5', alias: 'Clause' }, text: { insertions: 0, deletions: 0 },
  },
  {
    name: 'block control w:sdtPr added',
    original: P('Out') + sdt('', P('Inside text')),
    revised: P('Out') + sdt(TAG1, P('Inside text')),
    kind: 'added', control: { index: 0, id: '5', tag: 't1' }, text: { insertions: 0, deletions: 0 },
  },
  {
    name: 'block control w:sdtPr removed',
    original: P('Out') + sdt(TAG1, P('Inside text')),
    revised: P('Out') + sdt('', P('Inside text')),
    kind: 'removed', control: { index: 0, id: '5', tag: 't1' }, text: { insertions: 0, deletions: 0 },
  },
  {
    name: 'inline (run-level) control tag changed',
    original: `<w:p><w:r><w:t>Out </w:t></w:r>${sdt(TAG1, '<w:r><w:t>Inside text</w:t></w:r>')}</w:p>`,
    revised: `<w:p><w:r><w:t>Out </w:t></w:r>${sdt(TAG2, '<w:r><w:t>Inside text</w:t></w:r>')}</w:p>`,
    kind: 'changed', control: { index: 0, id: '5', tag: 't2' }, text: { insertions: 0, deletions: 0 },
  },
  {
    name: 'inline (run-level) control tag changed and its text edited',
    original: `<w:p><w:r><w:t>Out </w:t></w:r>${sdt(TAG1, '<w:r><w:t>Inside text</w:t></w:r>')}</w:p>`,
    revised: `<w:p><w:r><w:t>Out </w:t></w:r>${sdt(TAG2, '<w:r><w:t>Inside text edited</w:t></w:r>')}</w:p>`,
    kind: 'changed', control: { index: 0, id: '5', tag: 't2' }, text: { insertions: 1, deletions: 0 },
  },
] as const;

describe('content-control property differences (#1095)', () => {
  for (const scenario of cases) {
    test(`${scenario.name}: schema-valid, disclosed, projections intact`, async () => {
      const original = await buildDocxFromBodyXml(scenario.original);
      const revised = await buildDocxFromBodyXml(scenario.revised);
      const result = await compareDocuments(original, revised, { author: 'C' });

      // AC 1: the output passes the ECMA-376 schema gate, and no revision
      // markup sits inside or around a property element.
      await assertSchema(result.document);
      const xml = await documentXml(result.document);
      expect(propertyRevisions(xml)).toEqual([]);

      // The redline carries the revised properties whole, and the property
      // difference is not counted as a text revision.
      const revisedXml = await documentXml(revised);
      expect(controlProperties(xml)).toEqual(controlProperties(revisedXml));
      expect({ insertions: result.stats.insertions, deletions: result.stats.deletions }).toEqual(scenario.text);

      // AC 2: never silent — the difference is disclosed with the control's identity.
      expect(result.unrepresentedChanges).toEqual([
        { scope: 'contentControl', kind: scenario.kind, sectionIndex: 0, contentControl: scenario.control },
      ]);
      const [warning] = formatUnrepresentedChangeWarnings(result.unrepresentedChanges);
      expect(warning).toContain(`${scenario.kind} properties (w:sdtPr) of content control #1`);
      expect(warning).toContain('has no tracked-change markup');

      // AC 3: accept-all and reject-all still project the revised and original
      // control text, through both the AST projector and the native one.
      const originalXml = await documentXml(original);
      for (const [astProject, nativeProject, expected] of [
        [acceptAllChanges, acceptChanges, revisedXml],
        [rejectAllChanges, rejectChanges, originalXml],
      ] as const) {
        expect(controlText(astProject(xml))).toEqual(controlText(expected));
        const native = parseXml(xml);
        nativeProject(native);
        expect(controlText(serializeXml(native))).toEqual(controlText(expected));
      }
    });
  }

  test('an aligned control with unchanged properties is not reported', async () => {
    const original = await buildDocxFromBodyXml(P('Out') + sdt(TAG1, P('Inside text')));
    const revised = await buildDocxFromBodyXml(P('Out') + sdt(TAG1, P('Inside text edited')));
    const result = await compareDocuments(original, revised, { author: 'C' });
    await assertSchema(result.document);
    expect(result.unrepresentedChanges).toBeUndefined();
    expect(propertyRevisions(await documentXml(result.document))).toEqual([]);
    expect(result.stats.insertions).toBe(1);
  });

  test('reports the containing section and the control ordinal', async () => {
    const sectionBreak = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>';
    const first = (tag: string) => sdt(`<w:tag w:val="${tag}"/><w:id w:val="1"/>`, P('First control'));
    const second = (tag: string) => sdt(`<w:tag w:val="${tag}"/><w:id w:val="2"/>`, P('Second control'));
    const original = await buildDocxFromBodyXml(first('a') + sectionBreak + P('Out') + second('b'));
    const revised = await buildDocxFromBodyXml(first('a') + sectionBreak + P('Out') + second('b2'));
    const result = await compareDocuments(original, revised, { author: 'C' });
    await assertSchema(result.document);
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'contentControl', kind: 'changed', sectionIndex: 1, contentControl: { index: 1, id: '2', tag: 'b2' } },
    ]);
    expect(formatUnrepresentedChangeWarnings(result.unrepresentedChanges)[0])
      .toContain('content control #2 (tag "b2", id 2) in section 2');
  });
});
