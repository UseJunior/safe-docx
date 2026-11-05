/**
 * A run can hold both text and a complex-field character, for example
 * `<w:r><w:t>See </w:t><w:fldChar w:fldCharType="begin"/></w:r>`. Word splits
 * runs at field characters, but other producers do not. When the text in such
 * a run changes, the comparison must not nest `w:del`/`w:ins` inside `w:r`
 * (CT_R has no revision particle): the run is split at the marker so the
 * revision wraps a run fragment, and the field markers stay live and balanced
 * in the tracked output and in both projections.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.25
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see https://github.com/UseJunior/safe-docx/issues/1283
 */

import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const W_NS = OOXML.W_NS;
const SCHEMA_GATE = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

const TEST_FEATURE = 'Shared field-marker run revisions';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Split runs at field characters', severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.25' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
  );

const BOLD = '<w:rPr><w:b/></w:rPr>';
const TARGET = '<w:p><w:bookmarkStart w:id="0" w:name="_Ref1"/><w:r><w:t>Target</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>';

function t(text: string): string {
  return text ? `<w:t xml:space="preserve">${text}</w:t>` : '';
}

interface FieldParagraph {
  before: string;
  result: string;
  after: string;
}

/** Every field character shares its run with text: begin+before, separate+result, end+after. */
function sharedMarkerParagraph({ before, result, after }: FieldParagraph): string {
  return TARGET + '<w:p>' +
    `<w:r>${BOLD}${t(before)}<w:fldChar w:fldCharType="begin"/></w:r>` +
    '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
    `<w:r><w:fldChar w:fldCharType="separate"/>${t(result)}</w:r>` +
    `<w:r>${BOLD}<w:fldChar w:fldCharType="end"/>${t(after)}</w:r>` +
    '</w:p>';
}

const BASE: FieldParagraph = { before: 'See ', result: 'Target', after: ' for details.' };

const CASES: Array<{ name: string; revised: FieldParagraph }> = [
  { name: 'deletes text before a begin marker', revised: { ...BASE, before: '' } },
  { name: 'deletes text after an end marker', revised: { ...BASE, after: '' } },
  { name: 'replaces text on both sides of the field', revised: { ...BASE, before: 'Look at ', after: ' later.' } },
  { name: 'replaces the cached result sharing a run with the separate marker', revised: { ...BASE, result: 'Other' } },
];

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function revisionsInsideRuns(xml: string): string[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'r'))
    .flatMap((run) => Array.from(run.childNodes))
    .filter((child) => child.nodeType === 1 && (child as Element).namespaceURI === W_NS &&
      ['ins', 'del', 'moveFrom', 'moveTo'].includes((child as Element).localName))
    .map((child) => (child as Element).localName);
}

/** Field characters in document order, skipping those inside deletions. */
function liveFieldSequence(xml: string): string[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'fldChar'))
    .filter((field) => {
      for (let node = field.parentNode; node; node = node.parentNode) {
        if (node.nodeType === 1 && (node as Element).localName === 'del') return false;
      }
      return true;
    })
    .map((field) => field.getAttributeNS(W_NS, 'fldCharType') ?? '');
}

function boldRunTexts(xml: string): string[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'r'))
    .filter((run) => run.getElementsByTagNameNS(W_NS, 'b').length > 0)
    .map((run) => Array.from(run.getElementsByTagNameNS(W_NS, 'delText'))
      .concat(Array.from(run.getElementsByTagNameNS(W_NS, 't')))
      .map((node) => node.textContent ?? '').join(''))
    .filter(Boolean);
}

function expectSchemaValid(variants: Array<[string, string]>): void {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-1283-shared-marker-'));
  try {
    for (const [name, xml] of variants) writeFileSync(join(dir, `${name}.xml`), xml);
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain(`${variants.length} of ${variants.length} document.xml instances validate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('text sharing a run with a field character (#1283)', () => {
  for (const { name, revised } of CASES) {
    test(`${name}: splits the run instead of nesting a revision in w:r`, async ({ given, when, then, and }) => {
      const originalDocx = await given('a REF field whose begin, separate and end markers share runs with text', () =>
        buildDocxFromBodyXml(sharedMarkerParagraph(BASE)));
      const revisedDocx = await given('the same field with the neighbouring text edited', () =>
        buildDocxFromBodyXml(sharedMarkerParagraph(revised)));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(originalDocx, revisedDocx, { date: new Date('2026-11-05T00:00:00Z') }));
      const tracked = await documentXml(result.document);
      const accepted = acceptAllChanges(tracked);
      const rejected = rejectAllChanges(tracked);

      await then('no revision wrapper is a child of w:r', () => {
        expect(revisionsInsideRuns(tracked)).toEqual([]);
      });
      await and('the tracked output and both projections validate against the schema', () => {
        expectSchemaValid([['tracked', tracked], ['accepted', accepted], ['rejected', rejected]]);
      });
      await and('Accept All yields the revised text and Reject All the original text', async () => {
        expect(extractTextWithParagraphs(accepted)).toBe(extractTextWithParagraphs(await documentXml(revisedDocx)));
        expect(extractTextWithParagraphs(rejected)).toBe(extractTextWithParagraphs(await documentXml(originalDocx)));
      });
      await and('begin, separate and end stay live and balanced everywhere', () => {
        for (const xml of [tracked, accepted, rejected]) {
          expect(liveFieldSequence(xml)).toEqual(['begin', 'separate', 'end']);
        }
      });
      await and('split run fragments keep the source run properties', () => {
        expect(boldRunTexts(rejected).join('|')).toBe('See | for details.');
        expect(boldRunTexts(accepted).join('|')).toBe([revised.before, revised.after].filter(Boolean).join('|'));
      });
    });
  }
});
