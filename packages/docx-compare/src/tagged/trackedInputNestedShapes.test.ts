/**
 * Characterization of the nested revision shapes the tagged engine emits when
 * a comparison input already carries tracked changes (#742).
 *
 * Each shape below was validated against the vendored ECMA-376 Transitional
 * WML schema and opened in Word for Mac without a repair prompt (2026-11-22,
 * word-fidelity-check probe). These tests pin the shape, its schema validity
 * and the PRESERVE laws under both acceptors: Accept All of the output equals
 * Accept All of the revised input, and Reject All of the output equals Reject
 * All of the original input.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/742
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

const TEST_FEATURE = 'Tracked-input nested revision shapes';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SCHEMA_SCRIPT = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const REVISION = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
const DATE = 'w:date="2026-01-01T00:00:00Z"';

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const dt = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: number, author: string, xml: string) => `<w:ins w:id="${id}" w:author="${author}" ${DATE}>${xml}</w:ins>`;
const del = (id: number, author: string, xml: string) => `<w:del w:id="${id}" w:author="${author}" ${DATE}>${xml}</w:del>`;
const p = (xml: string, pPr = '') => `<w:p>${pPr}${xml}</w:p>`;

const CLEAN = p(t('Kept text Deleted text and more.'));
const TRACKED = p(t('Kept text ') + del(2, 'Reviewer', dt('Deleted text')) + ins(3, 'Reviewer', t('Inserted text')) + t(' and more.'));
const NESTED_PRIOR = p(t('A ') + ins(4, 'R1', t('keep ') + del(5, 'R2', dt('gone'))) + t(' B'));

/** `author>author>…` chains of directly nested revision wrappers, outermost first. */
function revisionChains(xml: string): string[] {
  const chains = new Set<string>();
  for (const element of Array.from(parseXml(xml).getElementsByTagNameNS(W, '*'))) {
    if (!REVISION.has(element.localName)) continue;
    const children = Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
    if (children.some(child => child.namespaceURI === W && REVISION.has(child.localName))) continue;
    const chain: string[] = [];
    for (let node: Node | null = element; node && node.nodeType === 1; node = node.parentNode) {
      const el = node as Element;
      if (el.namespaceURI === W && REVISION.has(el.localName)) chain.unshift(`${el.localName}(${el.getAttributeNS(W, 'author')})`);
    }
    if (chain.length > 1) chains.add(chain.join('>'));
  }
  return [...chains].sort();
}

/** Visible text of each body paragraph. */
function paragraphTexts(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map(paragraph =>
    Array.from(paragraph.getElementsByTagNameNS(W, 't')).map(node => node.textContent ?? '').join(''));
}

async function nativeDocumentXml(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<string> {
  const document = await DocxDocument.load(docx);
  await document[operation]();
  return (await DocxArchive.load((await document.toBuffer()).buffer)).getDocumentXml();
}

async function expectSchemaValid(docx: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sdx-742-'));
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
async function compareAndCheck(originalBody: string, revisedBody: string): Promise<{ xml: string; chains: string[] }> {
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
  return { xml, chains: revisionChains(xml) };
}

describe('tracked-input nested revision shapes are schema-valid and keep PRESERVE exact', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' })('wraps prior insertions and deletions in a comparison insertion (ins>ins, ins>del)', async () => {
    const { chains } = await compareAndCheck(CLEAN, TRACKED);
    expect(chains).toEqual(['ins(cmp)>del(Reviewer)', 'ins(cmp)>ins(Reviewer)']);
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' })('wraps prior insertions and deletions in a comparison deletion (del>del, del>ins>delText)', async () => {
    const { xml, chains } = await compareAndCheck(TRACKED, CLEAN);
    expect(chains).toEqual(['del(cmp)>del(Reviewer)', 'del(cmp)>ins(Reviewer)']);
    const priorInsertion = Array.from(parseXml(xml).getElementsByTagNameNS(W, 'ins'))
      .find(element => element.getAttributeNS(W, 'author') === 'Reviewer')!;
    expect(priorInsertion.getElementsByTagNameNS(W, 't')).toHaveLength(0);
    expect(priorInsertion.getElementsByTagNameNS(W, 'delText')[0]?.textContent).toBe('Inserted text');
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' })('nests comparison revisions inside a prior insertion edited by the revised side (ins>ins, ins>del)', async () => {
    const editedInside = p(t('Kept text ') + del(2, 'Reviewer', dt('Deleted text')) + ins(3, 'Reviewer', t('Inserted fresh text')) + t(' and more.'));
    const { chains } = await compareAndCheck(TRACKED, editedInside);
    expect(chains).toEqual(['ins(Reviewer)>del(cmp)', 'ins(Reviewer)>ins(cmp)']);
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' })('deletes a prior multi-author stack as a three-level del>ins>del chain', async () => {
    const { chains } = await compareAndCheck(NESTED_PRIOR, p(t('A keep  B')));
    expect(chains).toEqual(['del(cmp)>ins(R1)>del(R2)']);
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' })('inserts a prior multi-author stack as a three-level ins>ins>del chain', async () => {
    const { chains } = await compareAndCheck(p(t('A keep  B')), NESTED_PRIOR);
    expect(chains).toEqual(['ins(cmp)>ins(R1)>del(R2)']);
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' })('wraps a prior move source without range markers in a comparison insertion (ins>moveFrom)', async () => {
    const moved = p(`<w:moveFrom w:id="13" w:author="Reviewer" ${DATE}>${t('Moved')}</w:moveFrom>` + t(' stay '));
    const { chains } = await compareAndCheck(p(t('Moved stay ')), moved);
    expect(chains).toEqual(['ins(cmp)>moveFrom(Reviewer)']);
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' })('keeps a prior deleted paragraph mark beside a comparison property change', async () => {
    const markDeleted = `<w:p><w:pPr><w:rPr><w:del w:id="11" w:author="Reviewer" ${DATE}/></w:rPr></w:pPr>${t('First ')}${del(12, 'Reviewer', dt('half'))}</w:p>` + p(t('Second'));
    const base = p(t('First ')) + p(t('Second'));
    for (const [original, revised] of <[string, string][]>[[base, markDeleted], [markDeleted, base]]) {
      const { xml } = await compareAndCheck(original, revised);
      const markRPr = parseXml(xml).getElementsByTagNameNS(W, 'pPr')[0]!.getElementsByTagNameNS(W, 'rPr')[0]!;
      const markRevisions = Array.from(markRPr.getElementsByTagNameNS(W, 'del')).map(element => element.getAttributeNS(W, 'author'));
      expect(markRevisions).toEqual(['Reviewer']);
      expect(markRPr.getElementsByTagNameNS(W, 'rPrChange')).toHaveLength(1);
    }
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' })('never stacks a second rPrChange on a run that carries a prior one', async () => {
    const priorFormat = p(`<w:r><w:rPr><w:b/><w:rPrChange w:id="7" w:author="Reviewer" ${DATE}><w:rPr/></w:rPrChange></w:rPr><w:t>Bold now</w:t></w:r>`);
    for (const [original, revised] of <[string, string][]>[
      [p('<w:r><w:t>Bold now</w:t></w:r>'), priorFormat],
      [priorFormat, p('<w:r><w:t>Bold now</w:t></w:r>')],
      [priorFormat, p('<w:r><w:rPr><w:i/></w:rPr><w:t>Bold now</w:t></w:r>')],
    ]) {
      const { xml } = await compareAndCheck(original, revised);
      for (const rPr of Array.from(parseXml(xml).getElementsByTagNameNS(W, 'rPr'))) {
        const direct = Array.from(rPr.childNodes).filter(node => node.nodeType === 1 && (node as Element).localName === 'rPrChange');
        expect(direct.length).toBeLessThanOrEqual(1);
      }
    }
  });
});
