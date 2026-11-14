/**
 * Every revision in a compared document has its own identifier, across the
 * main story, headers, footers and notes together (#1466).
 *
 * A partial edit of a run splits the run into fragments, and each fragment
 * repeats the run's properties, including a pending `w:rPrChange` the
 * original carries. The run kept from the revised document carries the same
 * pending record, and a header or footer compared on its own can hold a
 * pending identifier the main story also holds from the other document. Each
 * copy is still its own revision record.
 *
 * Each case checks identifier uniqueness over every story part, the
 * emitted-document schema gate, Accept All against the revised document and
 * Reject All against the original with docx-compare's applier and docx-core's
 * `acceptChanges`/`rejectChanges`, and that resolving only the comparison's
 * revisions (selected by identifier) gives back each input with its pending
 * records.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @see https://github.com/UseJunior/safe-docx/issues/1466
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { acceptChanges, DocxArchive, OOXML, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  duplicateRevisionIdsInPackage,
  duplicateRevisionIdsInXml,
  revisionIdOccurrences,
} from '../testing/revisionIdUniqueness.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { renumberDuplicateRevisionIds } from './revisionMarkup.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Revision identifier uniqueness', severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-14T00:00:00.000Z') };
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

const prior = (id: number): string =>
  `<w:rPrChange w:id="${id}" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange>`;
const run = (text: string, rPr = ''): string => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string): string => `<w:p>${content}</w:p>`;
const pendingRun = (text: string, id = 71, live = '<w:b/>'): string => run(text, `<w:rPr>${live}${prior(id)}</w:rPr>`);

const isW = (node: Node | null | undefined, name: string): boolean =>
  !!node && node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === name;
const childrenOf = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);

/** A property element with its pending records (author and snapshot; never IDs or dates). */
function describeElement(element: Element, withRecords: boolean): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !['id', 'date', 'space'].includes(attribute.localName ?? '') &&
      !(attribute.localName ?? '').startsWith('rsid'))
    .map((attribute) => `${attribute.localName}=${attribute.value}`).sort().join(',');
  const children = childrenOf(element)
    .filter((child) => withRecords || child.localName !== 'rPrChange')
    .map((child) => describeElement(child, withRecords)).join('');
  return `${element.localName}[${attributes}](${children})`;
}

/**
 * Each paragraph of a story part as segments of equal run properties, so a
 * different run split reads the same.
 */
function storyView(xml: string, withRecords = false): string[] {
  const root = parseXml(xml).documentElement;
  return Array.from(root.getElementsByTagNameNS(W_NS, 'p')).map((p) => {
    const segments: Array<[string, string]> = [];
    for (const r of Array.from(p.getElementsByTagNameNS(W_NS, 'r'))) {
      const rPr = childrenOf(r).find((child) => isW(child, 'rPr'));
      const signature = rPr ? childrenOf(rPr)
        .filter((child) => withRecords || child.localName !== 'rPrChange')
        .map((child) => describeElement(child, withRecords)).join('') : '';
      const content = childrenOf(r)
        .filter((child) => isW(child, 't') || isW(child, 'delText'))
        .map((child) => child.textContent ?? '').join('');
      if (!content) continue;
      const last = segments[segments.length - 1];
      if (last && last[0] === signature) last[1] += content;
      else segments.push([signature, content]);
    }
    return segments.map(([rPr, content]) => `<${rPr}>${content}`).join('|');
  }).filter((line) => line !== '');
}

type Applier = 'ast' | 'core';
function project(xml: string, projection: 'accept' | 'reject', applier: Applier): string {
  if (applier === 'ast') return projection === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml);
  const document = parseXml(xml);
  if (projection === 'accept') acceptChanges(document);
  else rejectChanges(document);
  return serializeXml(document);
}

/**
 * Resolve only the comparison's revisions with docx-core's selective
 * applier, selected by identifier: unique identifiers make each selection
 * name exactly one revision.
 */
function projectComparisonLayerById(xml: string, projection: 'accept' | 'reject'): string {
  const ids = new Set(Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => element.getAttributeNS(W_NS, 'author') === COMPARE_OPTIONS.author)
    .map((element) => element.getAttributeNS(W_NS, 'id')));
  const document = parseXml(xml);
  const filter = (element: Element): boolean => ids.has(element.getAttributeNS(W_NS, 'id'));
  if (projection === 'accept') acceptChanges(document, { filter });
  else rejectChanges(document, { filter });
  return serializeXml(document);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1466-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A one-section document whose default footer holds `footerXml` paragraphs. */
async function buildWithFooter(bodyXml: string, footerXml: string): Promise<Buffer> {
  const base = await buildDocxFromBodyXml(bodyXml, [], { namespaces: { r: R_NS } });
  const archive = await DocxArchive.load(base);
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdFooter" Type="${R_NS}/footer" Target="footer1.xml"/></Relationships>`,
  );
  archive.setFile('word/footer1.xml', `<?xml version="1.0"?><w:ftr xmlns:w="${W_NS}">${footerXml}</w:ftr>`);
  return archive.save();
}

const STORY_PARTS = ['word/document.xml', 'word/footer1.xml'] as const;

interface Case {
  name: string;
  original: () => Promise<Buffer>;
  revised: () => Promise<Buffer>;
}

const cases: readonly Case[] = [
  {
    name: 'one word in the middle of a run with a pending record is replaced',
    original: () => buildDocxFromBodyXml(paragraph(pendingRun('The quick brown fox jumps'))),
    revised: () => buildDocxFromBodyXml(paragraph(pendingRun('The quick red fox jumps'))),
  },
  {
    name: 'two separate words of a run with a pending record are replaced',
    original: () => buildDocxFromBodyXml(paragraph(pendingRun('Alpha beta gamma delta epsilon', 71, ''))),
    revised: () => buildDocxFromBodyXml(paragraph(pendingRun('Alpha BETA gamma DELTA epsilon', 71, ''))),
  },
  {
    name: 'a footer run with a pending record is partly edited beside an ordinary body edit',
    original: () => buildWithFooter(paragraph(run('Body one')), paragraph(pendingRun('Footer quick brown fox'))),
    revised: () => buildWithFooter(paragraph(run('Body two')), paragraph(pendingRun('Footer quick red fox'))),
  },
  {
    name: 'the body and the footer each split a run with its own pending record',
    original: () => buildWithFooter(paragraph(pendingRun('Body quick brown')), paragraph(pendingRun('Footer quick brown fox', 72))),
    revised: () => buildWithFooter(paragraph(pendingRun('Body quick red')), paragraph(pendingRun('Footer quick red fox', 72))),
  },
  {
    name: 'the revised body and the deleted original footer text hold the same pending identifier',
    original: () => buildWithFooter(paragraph(run('Body keep')), paragraph(pendingRun('Footer old words'))),
    revised: () => buildWithFooter(paragraph(run('Body keep')) + paragraph(pendingRun('New text')), paragraph(run('Footer new'))),
  },
];

async function partXml(buffer: Buffer, part: string): Promise<string | null> {
  return (await DocxArchive.load(buffer)).getFile(part);
}

describe('revision identifiers stay unique when the comparison splits or combines pending revisions (#1466)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const item of cases) {
    test(`gives every revision its own identifier when ${item.name}`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given(item.name, async () => {
        const inputs = [await item.original(), await item.revised()] as const;
        for (const input of inputs) expect(await duplicateRevisionIdsInPackage(input)).toEqual([]);
        return inputs;
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

      await then('no two revisions in any story part share an identifier, and the package passes the schema gate', async () => {
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(await duplicateRevisionIdsInPackage(result.document)).toEqual([]);
        await assertSchema(result.document);
      });

      await then('Accept All gives the revised document and Reject All the original, with both appliers', async () => {
        for (const part of STORY_PARTS) {
          const comparedXml = await partXml(result.document, part);
          if (comparedXml === null) continue;
          const originalXml = (await partXml(original, part))!;
          const revisedXml = (await partXml(revised, part))!;
          for (const applier of ['ast', 'core'] as const) {
            expect(storyView(project(comparedXml, 'accept', applier)), `${part} ${applier}`)
              .toEqual(storyView(project(revisedXml, 'accept', applier)));
            expect(storyView(project(comparedXml, 'reject', applier)), `${part} ${applier}`)
              .toEqual(storyView(project(originalXml, 'reject', applier)));
          }
        }
      });

      await then('resolving only the comparison revisions, selected by identifier, gives each input with its pending records', async () => {
        for (const part of STORY_PARTS) {
          const comparedXml = await partXml(result.document, part);
          if (comparedXml === null) continue;
          expect(storyView(projectComparisonLayerById(comparedXml, 'reject'), true), part)
            .toEqual(storyView((await partXml(original, part))!, true));
          expect(storyView(projectComparisonLayerById(comparedXml, 'accept'), true), part)
            .toEqual(storyView((await partXml(revised, part))!, true));
        }
      });
    });
  }

  test('renumbers a repeated revision and the range end that closes it, keeping the first copy', async ({ given, when, then }: AllureBddContext) => {
    const xml = await given('a story holding a repeated rPrChange identifier and a repeated move range identifier', () =>
      `<w:body xmlns:w="${W_NS}">` +
      paragraph(pendingRun('one') + pendingRun('two')) +
      paragraph('<w:moveFromRangeStart w:id="5" w:name="m"/><w:moveFrom w:id="6">' + run('moved') + '</w:moveFrom><w:moveFromRangeEnd w:id="5"/>') +
      paragraph('<w:moveToRangeStart w:id="5" w:name="m"/><w:moveTo w:id="7">' + run('moved') + '</w:moveTo><w:moveToRangeEnd w:id="5"/>') +
      '</w:body>');
    const renumbered = await when('the repeated identifiers are renumbered', () => {
      const document = parseXml(xml);
      let next = 100;
      const count = renumberDuplicateRevisionIds(document.documentElement, () => next++);
      return { count, xml: serializeXml(document) };
    });
    await then('each copy after the first gets a fresh identifier and each range stays paired by start and end', () => {
      expect(duplicateRevisionIdsInXml(xml)).not.toEqual([]);
      expect(renumbered.count).toBe(2);
      expect(duplicateRevisionIdsInXml(renumbered.xml)).toEqual([]);
      expect(revisionIdOccurrences(renumbered.xml).map(({ name, id }) => `${name}#${id}`)).toEqual([
        'rPrChange#71', 'rPrChange#100', 'moveFromRangeStart#5', 'moveFrom#6', 'moveToRangeStart#101', 'moveTo#7',
      ]);
      const document = parseXml(renumbered.xml);
      expect(document.getElementsByTagNameNS(W_NS, 'moveFromRangeEnd')[0]!.getAttributeNS(W_NS, 'id')).toBe('5');
      expect(document.getElementsByTagNameNS(W_NS, 'moveToRangeEnd')[0]!.getAttributeNS(W_NS, 'id')).toBe('101');
    });
  });
});
