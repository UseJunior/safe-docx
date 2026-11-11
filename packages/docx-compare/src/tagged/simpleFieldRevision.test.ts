/**
 * A simple field (`w:fldSimple`) is paragraph content, but `w:ins` and `w:del`
 * admit only run content. When a simple field is inserted, deleted, or its
 * instruction changes (` PAGE ` becomes ` NUMPAGES `), the comparison must not
 * wrap the `w:fldSimple` element itself in a revision: it re-expresses the
 * field as complex-field runs inside the revision instead, so the tracked
 * output stays schema-valid and Accept All / Reject All still yield the
 * revised / original instruction and cached result.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 * @see https://github.com/UseJunior/safe-docx/issues/1422
 */

import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SCHEMA_GATE = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
const FOOTER_PATH = 'word/footer1.xml';

const TEST_FEATURE = 'Simple field revisions';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Track changed simple fields as complex fields', severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.13' },
  );

interface FieldValue {
  instruction: string;
  result: string;
}

const simpleField = (instruction: string, result: string, attributes = '', resultRun = 'w:r'): string =>
  `<w:fldSimple w:instr=" ${instruction} "${attributes}>` +
  (resultRun === 'w:r' ? `<w:r><w:t>${result}</w:t></w:r>` : resultRun.replace('$RESULT', result)) +
  '</w:fldSimple>';
const text = (value: string): string => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const paragraph = (content: string): string => `<w:p>${content}</w:p>`;
const table = (cell: string): string =>
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl>`;

/**
 * Fields in document order of their end, whether simple or complex. A field's
 * result includes the results of fields nested in it, so a nested simple field
 * and its complex re-expression compare equal.
 */
function fieldValues(xml: string): FieldValue[] {
  type OpenField = FieldValue & { phase: 'instruction' | 'result' };
  const fields: FieldValue[] = [];
  const open: OpenField[] = [];
  const close = (): void => {
    const { instruction, result } = open.pop()!;
    fields.push({ instruction: instruction.trim(), result });
  };
  const visit = (node: Element): void => {
    if (node.namespaceURI === W_NS) {
      if (node.localName === 'fldSimple') {
        open.push({ instruction: node.getAttributeNS(W_NS, 'instr') ?? '', result: '', phase: 'result' });
        for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) visit(child as Element);
        close();
        return;
      }
      if (node.localName === 'fldChar') {
        const type = node.getAttributeNS(W_NS, 'fldCharType');
        if (type === 'begin') open.push({ instruction: '', result: '', phase: 'instruction' });
        else if (type === 'separate' && open.length) open[open.length - 1]!.phase = 'result';
        else if (type === 'end' && open.length) close();
        return;
      }
      const current = open[open.length - 1];
      if (['instrText', 'delInstrText'].includes(node.localName)) {
        if (current?.phase === 'instruction') current.instruction += node.textContent ?? '';
        return;
      }
      if (['t', 'delText'].includes(node.localName)) {
        for (const field of open) if (field.phase === 'result') field.result += node.textContent ?? '';
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) visit(child as Element);
  };
  visit(parseXml(xml).documentElement);
  return fields;
}

/** Simple fields whose parent is a run revision wrapper (the #1422 shape). */
function revisionWrappedSimpleFields(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'fldSimple'))
    .map((field) => field.parentNode as Element)
    .filter((parent) => ['ins', 'del', 'moveFrom', 'moveTo'].includes(parent.localName))
    .map((parent) => parent.localName);
}

/** Validate story XML with the emitted-document gate; non-document roots are rehosted in a body. */
function expectSchemaValid(variants: Array<[string, string]>): void {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-1422-simple-field-'));
  try {
    for (const [name, xml] of variants) {
      const root = parseXml(xml).documentElement.tagName;
      // Header and footer stories hold the same block content as w:body.
      const open = xml.indexOf(`<${root}`);
      const openEnd = xml.indexOf('>', open) + 1;
      const instance = root === 'w:document'
        ? xml
        : xml.slice(0, open) + '<w:document' + xml.slice(open + root.length + 1, openEnd) + '<w:body>' +
          xml.slice(openEnd, xml.lastIndexOf(`</${root}>`)) + '</w:body></w:document>';
      writeFileSync(join(dir, `${name}.xml`), instance);
    }
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain(`${variants.length} of ${variants.length} document.xml instances validate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function packageWithFooter(footerContent: string): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(
    paragraph(text('Body text.')),
    [],
    { namespaces: { r: R_NS } },
  ));
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdFooter1" Type="${R_NS}/footer" Target="footer1.xml"/></Relationships>`,
  );
  archive.setFile(FOOTER_PATH, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}">${footerContent}</w:ftr>`);
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace(
    '</Types>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
  ));
  return archive.save();
}

async function storyXml(docx: Buffer, path: string): Promise<string> {
  const xml = await (await DocxArchive.load(docx)).getFile(path);
  if (xml === null) throw new Error(`missing ${path}`);
  return xml;
}

async function docxCoreProjection(docx: Buffer, mode: 'accept' | 'reject', path: string): Promise<string> {
  const document = await DocxDocument.load(docx);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return storyXml((await document.toBuffer()).buffer, path);
}

interface Scenario {
  name: string;
  original: string;
  revised: string;
}

const PAGE = (attributes = ''): string => simpleField('PAGE', '1', attributes);
const NUMPAGES = (attributes = ''): string => simpleField('NUMPAGES', '3', attributes);
const BOLD_RESULT = '<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>$RESULT</w:t></w:r>';

const SCENARIOS: Scenario[] = [
  {
    name: 'a changed instruction in a body paragraph',
    original: paragraph(text('Page ') + PAGE()),
    revised: paragraph(text('Page ') + NUMPAGES()),
  },
  {
    name: 'a changed instruction in a table cell',
    original: table(paragraph(PAGE())),
    revised: table(paragraph(NUMPAGES())),
  },
  {
    name: 'a changed instruction inside a hyperlink',
    original: paragraph(`<w:hyperlink w:anchor="Top">${text('See ')}${PAGE()}</w:hyperlink>`),
    revised: paragraph(`<w:hyperlink w:anchor="Top">${text('See ')}${NUMPAGES()}</w:hyperlink>`),
  },
  {
    name: 'a changed instruction with a formatted, locked and dirty result',
    original: paragraph(simpleField('PAGE', '1', ' w:fldLock="1" w:dirty="1"', BOLD_RESULT)),
    revised: paragraph(simpleField('NUMPAGES', '3', ' w:fldLock="1"', BOLD_RESULT)),
  },
  {
    name: 'a simple field nested in another simple field result',
    original: paragraph(`<w:fldSimple w:instr=" IF 1 = 1 &quot;x&quot; "><w:r><w:t>x </w:t></w:r>${PAGE()}</w:fldSimple>`),
    revised: paragraph(`<w:fldSimple w:instr=" IF 2 = 2 &quot;y&quot; "><w:r><w:t>y </w:t></w:r>${PAGE()}</w:fldSimple>`),
  },
  {
    name: 'an inserted and a deleted paragraph holding a simple field',
    original: paragraph(text('Kept.')) + paragraph(text('Old page ') + PAGE()),
    revised: paragraph(text('Kept.')) + paragraph(text('Total ') + NUMPAGES()) + paragraph(text('Added ') + PAGE()),
  },
];

describe('changed simple fields (#1422)', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name}: tracks the field as complex-field runs, schema-valid, projecting both sides`, async ({ given, when, then, and }: AllureBddContext) => {
      const path = 'word/document.xml';
      const build = (content: string): Promise<Buffer> => buildDocxFromBodyXml(content);
      const originalDocx = await given('an original document with a simple field', () => build(scenario.original));
      const revisedDocx = await given('a revised document whose simple field differs', () => build(scenario.revised));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(originalDocx, revisedDocx, { date: new Date('2026-11-11T00:00:00Z') }));
      const tracked = await storyXml(result.document, path);
      const accepted = acceptAllChanges(tracked);
      const rejected = rejectAllChanges(tracked);
      const originalXml = await storyXml(originalDocx, path);
      const revisedXml = await storyXml(revisedDocx, path);

      await then('the comparison records revisions for the field change', () => {
        const document = parseXml(tracked);
        expect(document.getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
        expect(document.getElementsByTagNameNS(W_NS, 'del').length).toBeGreaterThan(0);
      });
      await and('no w:fldSimple is a direct child of a revision wrapper', () => {
        expect(revisionWrappedSimpleFields(tracked)).toEqual([]);
      });
      await and('the tracked story and both projections pass the emitted-document schema gate', () => {
        expectSchemaValid([['tracked', tracked], ['accepted', accepted], ['rejected', rejected]]);
      });
      await and('Accept All yields the revised fields and Reject All the original fields', async () => {
        expect(fieldValues(accepted)).toEqual(fieldValues(revisedXml));
        expect(fieldValues(rejected)).toEqual(fieldValues(originalXml));
        expect(fieldValues(await docxCoreProjection(result.document, 'accept', path))).toEqual(fieldValues(revisedXml));
        expect(fieldValues(await docxCoreProjection(result.document, 'reject', path))).toEqual(fieldValues(originalXml));
      });
    });
  }

  test('keeps the complex-field begin flags, field data and result formatting', async ({ given, when, then }: AllureBddContext) => {
    const originalDocx = await given('a locked, dirty simple field with field data and a formatted result', () =>
      buildDocxFromBodyXml(paragraph(
        '<w:fldSimple w:instr=" PAGE " w:fldLock="1" w:dirty="true"><w:fldData>AQID</w:fldData>' +
        BOLD_RESULT.replace('$RESULT', '1') + '</w:fldSimple>',
      )));
    const revisedDocx = await given('the same field with a different instruction', () =>
      buildDocxFromBodyXml(paragraph(simpleField('NUMPAGES', '3', '', BOLD_RESULT))));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(originalDocx, revisedDocx, { date: new Date('2026-11-11T00:00:00Z') }));
    const tracked = parseXml(await storyXml(result.document, 'word/document.xml'));

    await then('the deleted begin character carries the lock, dirty flag and field data', () => {
      const deletion = Array.from(tracked.getElementsByTagNameNS(W_NS, 'del'))
        .find((element) => element.getElementsByTagNameNS(W_NS, 'delInstrText').length > 0)!;
      const begin = deletion.getElementsByTagNameNS(W_NS, 'fldChar')[0]!;
      expect(begin.getAttributeNS(W_NS, 'fldCharType')).toBe('begin');
      expect(begin.getAttributeNS(W_NS, 'fldLock')).toBe('1');
      expect(begin.getAttributeNS(W_NS, 'dirty')).toBe('true');
      expect(begin.getElementsByTagNameNS(W_NS, 'fldData')[0]?.textContent).toBe('AQID');
      expect(deletion.getElementsByTagNameNS(W_NS, 'delInstrText')[0]?.textContent).toBe(' PAGE ');
      for (const run of Array.from(deletion.getElementsByTagNameNS(W_NS, 'r'))) {
        expect(run.getElementsByTagNameNS(W_NS, 'b')).toHaveLength(1);
      }
    });
  });

  test('emits a schema-valid footer when its PAGE simple field changes', async ({ given, when, then }: AllureBddContext) => {
    // Header/footer stories are compared only when their field scaffold is
    // unchanged; a changed field instruction keeps the revised story live and
    // is reported through unrepresentedChanges. Either way, the emitted footer
    // must not hold a revision-wrapped w:fldSimple.
    const originalDocx = await given('a footer with a PAGE simple field', () =>
      packageWithFooter(paragraph(text('Page ') + PAGE())));
    const revisedDocx = await given('the same footer with a NUMPAGES simple field', () =>
      packageWithFooter(paragraph(text('Page ') + NUMPAGES())));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(originalDocx, revisedDocx, { date: new Date('2026-11-11T00:00:00Z') }));
    const footer = await storyXml(result.document, FOOTER_PATH);

    await then('the footer and its projections pass the schema gate with no revision-wrapped simple field', () => {
      expect(revisionWrappedSimpleFields(footer)).toEqual([]);
      expectSchemaValid([['tracked', footer], ['accepted', acceptAllChanges(footer)], ['rejected', rejectAllChanges(footer)]]);
    });
  });

  test('leaves an unchanged simple field as w:fldSimple', async ({ given, when, then }: AllureBddContext) => {
    const originalDocx = await given('a PAGE simple field beside text', () =>
      buildDocxFromBodyXml(paragraph(text('Page ') + PAGE()) + paragraph(text('Old text.'))));
    const revisedDocx = await given('the same field with only the other paragraph edited', () =>
      buildDocxFromBodyXml(paragraph(text('Page ') + PAGE()) + paragraph(text('New text.'))));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(originalDocx, revisedDocx, { date: new Date('2026-11-11T00:00:00Z') }));
    const tracked = await storyXml(result.document, 'word/document.xml');

    await then('the field stays a live simple field and no complex field is introduced', () => {
      const document = parseXml(tracked);
      const fields = Array.from(document.getElementsByTagNameNS(W_NS, 'fldSimple'));
      expect(fields).toHaveLength(1);
      expect(fields[0]!.getAttributeNS(W_NS, 'instr')).toBe(' PAGE ');
      expect(revisionWrappedSimpleFields(tracked)).toEqual([]);
      expect(document.getElementsByTagNameNS(W_NS, 'fldChar')).toHaveLength(0);
    });
  });
});
