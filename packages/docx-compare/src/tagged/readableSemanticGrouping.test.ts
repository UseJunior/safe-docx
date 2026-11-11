/**
 * Readable semantic revision grouping (`revisionGrouping: 'readable-semantic'`).
 *
 * A heavily rewritten paragraph must read as one deletion followed by one
 * insertion per change cluster instead of alternating word by word, even when
 * the paragraph mixes run formatting, while moves, fields, bookmarks and note
 * references stay barriers. Every case checks that Accept All yields the
 * revised text, Reject All the original text, and that the tracked output and
 * both projections validate against the ECMA-376 schema.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1411
 */

import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLSerializer } from '@xmldom/xmldom';
import { buildSyntheticDocx, DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml, completeField } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments, type CompareRevisionGrouping } from '../index.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const W_NS = OOXML.W_NS;
const SCHEMA_GATE = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
const DATE = new Date('2026-11-10T00:00:00Z');

const TEST_FEATURE = 'add-readable-semantic-revision-grouping';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Readable semantic revision grouping', severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

const HIGHLIGHT = '<w:rPr><w:highlight w:val="yellow"/></w:rPr>';
const BOLD = '<w:rPr><w:b/></w:rPr>';
const ITALIC = '<w:rPr><w:i/></w:rPr>';

function run(text: string, properties = ''): string {
  return `<w:r>${properties}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraph(...runs: string[]): string {
  return `<w:p>${runs.join('')}</w:p>`;
}

/**
 * A package with footnote scaffolding from `buildSyntheticDocx` whose single
 * body paragraph is replaced by `bodyXml` (which carries the reference).
 */
async function footnotedDocx(bodyXml: string): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildSyntheticDocx({
    paragraphs: ['placeholder'],
    footnoteOnParagraph: 0,
    footnoteText: 'Note text.',
  }));
  const document = parseXml(await archive.getDocumentXml());
  const body = document.getElementsByTagNameNS(W_NS, 'body')[0]!;
  const replacement = parseXml(`<w:body xmlns:w="${W_NS}">${bodyXml}</w:body>`).documentElement;
  const original = body.getElementsByTagNameNS(W_NS, 'p')[0]!;
  for (const child of Array.from(replacement.childNodes)) {
    body.insertBefore(document.importNode(child, true), original);
  }
  body.removeChild(original);
  archive.setDocumentXml(new XMLSerializer().serializeToString(document));
  return archive.save();
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

function bodyParagraphs(xml: string): Element[] {
  const body = parseXml(xml).getElementsByTagNameNS(W_NS, 'body')[0]!;
  return Array.from(body.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'p');
}

function childLocalNames(element: Element): string[] {
  return Array.from(element.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .map((node) => node.localName)
    .filter((name) => name !== 'pPr');
}

function wrapperCount(xml: string): number {
  const document = parseXml(xml);
  return document.getElementsByTagNameNS(W_NS, 'ins').length + document.getElementsByTagNameNS(W_NS, 'del').length;
}

function wrapperTexts(element: Element, localName: 'del' | 'ins'): string[] {
  return Array.from(element.getElementsByTagNameNS(W_NS, localName)).map((wrapper) => wrapper.textContent ?? '');
}

/** Text of runs carrying the given direct run property, in document order. */
function formattedRunTexts(xml: string, property: 'b' | 'i' | 'highlight'): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'r'))
    .filter((runElement) => Array.from(runElement.childNodes).some((child) =>
      child.nodeType === 1 && (child as Element).localName === 'rPr' &&
      Array.from(child.childNodes).some((grand) =>
        grand.nodeType === 1 && (grand as Element).localName === property)))
    .map((runElement) => runElement.textContent ?? '');
}

function isInsideRevision(element: Element): boolean {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && ['ins', 'del'].includes((node as Element).localName)) return true;
  }
  return false;
}

function expectSchemaValid(variants: Array<[string, string]>): void {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-1411-readable-semantic-'));
  try {
    for (const [name, xml] of variants) writeFileSync(join(dir, `${name}.xml`), xml);
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain(`${variants.length} of ${variants.length} document.xml instances validate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface ComparedPair {
  tracked: string;
  accepted: string;
  rejected: string;
  originalXml: string;
  revisedXml: string;
}

async function compareGrouped(
  originalDocx: Buffer,
  revisedDocx: Buffer,
  revisionGrouping: CompareRevisionGrouping = 'readable-semantic',
): Promise<ComparedPair> {
  const result = await compareDocuments(originalDocx, revisedDocx, { date: DATE, revisionGrouping });
  const tracked = await documentXml(result.document);
  return {
    tracked,
    accepted: acceptAllChanges(tracked),
    rejected: rejectAllChanges(tracked),
    originalXml: await documentXml(originalDocx),
    revisedXml: await documentXml(revisedDocx),
  };
}

/**
 * Accept All must reproduce the revised document's accepted text and Reject
 * All the original document's rejected text (identical to the plain text when
 * an input carries no tracked changes of its own).
 */
function expectExactProjections(pair: ComparedPair): void {
  expect(extractTextWithParagraphs(pair.accepted)).toBe(extractTextWithParagraphs(acceptAllChanges(pair.revisedXml)));
  expect(extractTextWithParagraphs(pair.rejected)).toBe(extractTextWithParagraphs(rejectAllChanges(pair.originalXml)));
  expectSchemaValid([['tracked', pair.tracked], ['accepted', pair.accepted], ['rejected', pair.rejected]]);
}

const ISSUE_ORIGINAL =
  'This Agreement is made by Alpha Holdings LLC, a Texas limited liability company located at 1 Main Street, and Beta Fund, LP, a Texas limited partnership.';
const ISSUE_REVISED_RUNS = [
  run('This Agreement is made by Gamma Fund LP, a Delaware limited partnership, '),
  run('[NAME OF GENERAL PARTNER]', HIGHLIGHT),
  run(', a Delaware limited liability company, and Alpha Holdings LLC, a Delaware limited liability company located at 1 Main Street.'),
];

describe('readable semantic revision grouping (#1411)', () => {
  test.openspec('A rewritten paragraph with a highlighted placeholder groups into one deletion and one insertion')(
    'groups the issue repro into one deletion followed by one insertion',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalDocx = await given('a one-run original party paragraph', () =>
        buildDocxFromBodyXml(paragraph(run(ISSUE_ORIGINAL))));
      const revisedDocx = await given('a rewritten paragraph with a yellow-highlighted placeholder run', () =>
        buildDocxFromBodyXml(paragraph(...ISSUE_REVISED_RUNS)));
      const minimal = await when('the pair is compared token-minimally', () =>
        compareGrouped(originalDocx, revisedDocx, 'token-minimal'));
      const readable = await when('the pair is compared with readable semantic grouping', () =>
        compareGrouped(originalDocx, revisedDocx));

      await then('the token-minimal redline alternates word by word', () => {
        expect(wrapperCount(minimal.tracked)).toBeGreaterThan(20);
      });
      await and('the readable redline is anchor, one deletion, one insertion, anchor', () => {
        const [p] = bodyParagraphs(readable.tracked);
        expect(childLocalNames(p!)).toEqual(['r', 'del', 'ins', 'r']);
        expect(wrapperTexts(p!, 'del')).toEqual([
          'Alpha Holdings LLC, a Texas limited liability company located at 1 Main Street, and Beta Fund, LP, a Texas limited partnership',
        ]);
        expect(wrapperTexts(p!, 'ins')).toEqual([
          'Gamma Fund LP, a Delaware limited partnership, [NAME OF GENERAL PARTNER], a Delaware limited liability company, and Alpha Holdings LLC, a Delaware limited liability company located at 1 Main Street',
        ]);
      });
      await and('the placeholder keeps its highlight inside the insertion', () => {
        expect(formattedRunTexts(readable.tracked, 'highlight')).toEqual(['[NAME OF GENERAL PARTNER]']);
        expect(formattedRunTexts(readable.accepted, 'highlight')).toEqual(['[NAME OF GENERAL PARTNER]']);
        expect(formattedRunTexts(readable.rejected, 'highlight')).toEqual([]);
      });
      await and('both projections are exact and schema-valid', () => {
        expectExactProjections(minimal);
        expectExactProjections(readable);
      });
    },
  );

  test.openspec('Mixed run formatting does not disable grouping')(
    'groups a cluster spanning bold defined terms and keeps each run formatting',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalDocx = await given('a party paragraph with a bold defined term', () =>
        buildDocxFromBodyXml(paragraph(
          run('This Agreement is made by Alpha Holdings LLC (the “'),
          run('Company', BOLD),
          run('”), a Texas limited liability company, on the date below.'),
        )));
      const revisedDocx = await given('the party and its bold defined term rewritten', () =>
        buildDocxFromBodyXml(paragraph(
          run('This Agreement is made by Gamma Fund LP (the “'),
          run('Partnership', BOLD),
          run('”), a Delaware limited partnership, on the date below.'),
        )));
      const readable = await when('the pair is compared with readable semantic grouping', () =>
        compareGrouped(originalDocx, revisedDocx));

      await then('the rewrite is one deletion followed by one insertion', () => {
        const [p] = bodyParagraphs(readable.tracked);
        expect(childLocalNames(p!)).toEqual(['r', 'del', 'ins', 'r']);
        expect(wrapperTexts(p!, 'del')).toEqual(['Alpha Holdings LLC (the “Company”), a Texas limited liability company']);
        expect(wrapperTexts(p!, 'ins')).toEqual(['Gamma Fund LP (the “Partnership”), a Delaware limited partnership']);
      });
      await and('each side keeps its own bold run', () => {
        expect(formattedRunTexts(readable.tracked, 'b')).toEqual(['Company', 'Partnership']);
        expect(formattedRunTexts(readable.accepted, 'b')).toEqual(['Partnership']);
        expect(formattedRunTexts(readable.rejected, 'b')).toEqual(['Company']);
      });
      await and('both projections are exact and schema-valid', () => {
        expectExactProjections(readable);
      });
    },
  );

  test.openspec('Mixed run formatting does not disable grouping')(
    'absorbs an unchanged word whose formatting changed, keeping each side formatting',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalDocx = await given('two replaced names joined by a plain "and"', () =>
        buildDocxFromBodyXml(paragraph(
          run('Signed by Alpha Holdings '),
          run('and'),
          run(' Beta Fund today.'),
        )));
      const revisedDocx = await given('the names replaced and "and" italicized', () =>
        buildDocxFromBodyXml(paragraph(
          run('Signed by Gamma Partners '),
          run('and', ITALIC),
          run(' Delta Trust today.'),
        )));
      const readable = await when('the pair is compared with readable semantic grouping', () =>
        compareGrouped(originalDocx, revisedDocx));

      await then('the names and the joining word form one cluster', () => {
        const [p] = bodyParagraphs(readable.tracked);
        expect(childLocalNames(p!)).toEqual(['r', 'del', 'ins', 'r']);
        expect(wrapperTexts(p!, 'del')).toEqual(['Alpha Holdings and Beta Fund']);
        expect(wrapperTexts(p!, 'ins')).toEqual(['Gamma Partners and Delta Trust']);
        expect(parseXml(readable.tracked).getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(0);
      });
      await and('only the revised side italicizes the joining word', () => {
        expect(formattedRunTexts(readable.accepted, 'i')).toEqual(['and']);
        expect(formattedRunTexts(readable.rejected, 'i')).toEqual([]);
      });
      await and('both projections are exact and schema-valid', () => {
        expectExactProjections(readable);
      });
    },
  );

  test.openspec('Short common words between replacements are absorbed while real anchors stay plain')(
    'absorbs a, an, the and as between replacements but keeps a multi-word anchor',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalDocx = await given('a rewritten obligation with short common words between replacements', () =>
        buildDocxFromBodyXml(paragraph(run(
          'The Seller shall deliver a notice to the Buyer as agent for an Affiliate, and the parties agree to the terms set out in this Agreement.',
        ))));
      const revisedDocx = await given('the revised obligation sharing only the short words and the closing sentence', () =>
        buildDocxFromBodyXml(paragraph(run(
          'The Purchaser must provide a statement to the Vendor as trustee for an Investor, and the parties agree to the terms set out in this Agreement.',
        ))));
      const minimal = await when('the pair is compared token-minimally', () =>
        compareGrouped(originalDocx, revisedDocx, 'token-minimal'));
      const readable = await when('the pair is compared with readable semantic grouping', () =>
        compareGrouped(originalDocx, revisedDocx));

      await then('the token-minimal redline splits around the short words', () => {
        const [p] = bodyParagraphs(minimal.tracked);
        const plain = Array.from(p!.childNodes)
          .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'r')
          .map((node) => node.textContent ?? '');
        expect(plain).toEqual(expect.arrayContaining([' a ', ' to the ', ' as ', ' for an ']));
      });
      await and('the readable redline is one cluster before the unchanged closing clause', () => {
        const [p] = bodyParagraphs(readable.tracked);
        expect(childLocalNames(p!)).toEqual(['r', 'del', 'ins', 'r']);
        expect(wrapperTexts(p!, 'del')).toEqual(['Seller shall deliver a notice to the Buyer as agent for an Affiliate']);
        expect(wrapperTexts(p!, 'ins')).toEqual(['Purchaser must provide a statement to the Vendor as trustee for an Investor']);
        const anchors = Array.from(p!.childNodes)
          .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'r')
          .map((node) => node.textContent ?? '');
        expect(anchors).toEqual(['The ', ', and the parties agree to the terms set out in this Agreement.']);
      });
      await and('both projections are exact and schema-valid', () => {
        expectExactProjections(readable);
      });
    },
  );

  test.openspec('Non-text atoms are barriers that grouping never crosses')(
    'keeps a bookmark, a field and a note reference outside the grouped clusters',
    async ({ given, when, then, and }: AllureBddContext) => {
      const barrierCases: Array<{ name: string; barrier: string; localName: string; build: (body: string) => Promise<Buffer> }> = [
        {
          name: 'bookmark',
          barrier: '<w:bookmarkStart w:id="0" w:name="Parties"/><w:bookmarkEnd w:id="0"/>',
          localName: 'bookmarkStart',
          build: (body) => buildDocxFromBodyXml(body),
        },
        {
          name: 'field',
          barrier: completeField(' PAGE ', '1'),
          localName: 'fldChar',
          build: (body) => buildDocxFromBodyXml(body),
        },
        {
          name: 'note reference',
          barrier: '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>',
          localName: 'footnoteReference',
          build: footnotedDocx,
        },
      ];
      for (const barrierCase of barrierCases) {
        const originalDocx = await given(`an original with a ${barrierCase.name} between two rewritten phrases`, () =>
          barrierCase.build(paragraph(run('Alpha Holdings LLC, a Texas company'), barrierCase.barrier, run('Beta Fund LP, a Texas partnership'))));
        const revisedDocx = await given(`the revised phrases around the same ${barrierCase.name}`, () =>
          barrierCase.build(paragraph(run('Gamma Fund LP, a Delaware partnership'), barrierCase.barrier, run('Delta Trust, a Delaware trust'))));
        const readable = await when(`the ${barrierCase.name} pair is compared with readable semantic grouping`, () =>
          compareGrouped(originalDocx, revisedDocx));

        await then(`the ${barrierCase.name} stays live between two separate clusters`, () => {
          const [p] = bodyParagraphs(readable.tracked);
          const barriers = Array.from(p!.getElementsByTagNameNS(W_NS, barrierCase.localName));
          expect(barriers.length).toBeGreaterThan(0);
          for (const barrier of barriers) expect(isInsideRevision(barrier)).toBe(false);
          expect(wrapperTexts(p!, 'del')).toEqual(['Alpha Holdings LLC, a Texas company', 'Beta Fund LP, a Texas partnership']);
          expect(wrapperTexts(p!, 'ins')).toEqual(['Gamma Fund LP, a Delaware partnership', 'Delta Trust, a Delaware trust']);
        });
        await and(`the ${barrierCase.name} projections are exact and schema-valid`, () => {
          expectExactProjections(readable);
        });
      }
    },
  );

  test.openspec('Non-text atoms are barriers that grouping never crosses')(
    'keeps a pre-existing tracked insertion outside the grouped clusters',
    async ({ given, when, then, and }: AllureBddContext) => {
      const preserved = '<w:ins w:id="90" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve"> and </w:t></w:r></w:ins>';
      const originalDocx = await given('an original with an authored insertion between two rewritten phrases', () =>
        buildDocxFromBodyXml(paragraph(run('Alpha Holdings LLC, a Texas company'), preserved, run('Beta Fund LP, a Texas partnership'))));
      const revisedDocx = await given('the revised phrases around the same authored insertion', () =>
        buildDocxFromBodyXml(paragraph(run('Gamma Fund LP, a Delaware partnership'), preserved, run('Delta Trust, a Delaware trust'))));
      const readable = await when('the pair is compared with readable semantic grouping', () =>
        compareGrouped(originalDocx, revisedDocx));

      await then('the authored insertion keeps its own author and text', () => {
        const [p] = bodyParagraphs(readable.tracked);
        const authored = Array.from(p!.getElementsByTagNameNS(W_NS, 'ins'))
          .filter((wrapper) => wrapper.getAttributeNS(W_NS, 'author') === 'Alice');
        expect(authored.map((wrapper) => wrapper.textContent)).toEqual([' and ']);
        expect((authored[0]!.parentNode as Element).localName).toBe('p');
        expect(wrapperTexts(p!, 'del')).toEqual(['Alpha Holdings LLC, a Texas company', 'Beta Fund LP, a Texas partnership']);
      });
      await and('both projections are exact and schema-valid', () => {
        expectExactProjections(readable);
      });
    },
  );

  test.openspec('Mixed run formatting does not disable grouping')(
    'keeps Accept All and Reject All exact for random mixed-format rewrites',
    async ({ given, then }: AllureBddContext) => {
      const words = ['a', 'an', 'the', 'as', 'Alpha', 'Beta', 'Fund', 'LLC', 'Texas', 'Delaware', 'company', ',', '.', 'shall', 'notice'];
      const word = fc.constantFrom(...words);
      const segment = fc.record({
        text: fc.array(word, { minLength: 1, maxLength: 4 }).map((parts) => parts.join(' ')),
        format: fc.constantFrom('', BOLD, ITALIC, HIGHLIGHT),
      });
      const side = fc.array(segment, { minLength: 1, maxLength: 6 });
      const pairs = await given('random paragraphs built from short legal words in mixed formatting', () =>
        fc.sample(fc.tuple(side, side), { numRuns: 25, seed: 1411 }));
      await then('every pair projects exactly and validates', async () => {
        for (const [before, after] of pairs) {
          const body = (segments: typeof before): string =>
            paragraph(...segments.map(({ text, format }, index) => run(`${index > 0 ? ' ' : ''}${text}`, format)));
          const pair = await compareGrouped(
            await buildDocxFromBodyXml(body(before)),
            await buildDocxFromBodyXml(body(after)),
          );
          expect(extractTextWithParagraphs(pair.accepted)).toBe(extractTextWithParagraphs(pair.revisedXml));
          expect(extractTextWithParagraphs(pair.rejected)).toBe(extractTextWithParagraphs(pair.originalXml));
          for (const property of ['b', 'i', 'highlight'] as const) {
            expect(formattedRunTexts(pair.accepted, property).join('')).toBe(formattedRunTexts(pair.revisedXml, property).join(''));
            expect(formattedRunTexts(pair.rejected, property).join('')).toBe(formattedRunTexts(pair.originalXml, property).join(''));
          }
        }
      });
    },
  );

  test.openspec('A rewritten paragraph with a highlighted placeholder groups into one deletion and one insertion')(
    'treats a rendered page-break cache marker as part of the text it sits in',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalDocx = await given('a one-run original party paragraph', () =>
        buildDocxFromBodyXml(paragraph(run(ISSUE_ORIGINAL))));
      const revisedDocx = await given('the rewrite with a w:lastRenderedPageBreak inside the placeholder run', () =>
        buildDocxFromBodyXml(paragraph(
          ISSUE_REVISED_RUNS[0]!,
          `<w:r>${HIGHLIGHT}<w:lastRenderedPageBreak/><w:t>[NAME OF GENERAL PARTNER]</w:t></w:r>`,
          ISSUE_REVISED_RUNS[2]!,
        )));
      const readable = await when('the pair is compared with readable semantic grouping', () =>
        compareGrouped(originalDocx, revisedDocx));

      await then('the marker run is grouped with its neighbours into one insertion', () => {
        const markers = Array.from(parseXml(readable.tracked).getElementsByTagNameNS(W_NS, 'lastRenderedPageBreak'));
        expect(markers).toHaveLength(1);
        const wrapper = markers[0]!.parentNode!.parentNode as Element;
        expect(wrapper.localName).toBe('ins');
        expect(wrapper.textContent).toContain('Gamma Fund LP, a Delaware limited partnership, [NAME OF GENERAL PARTNER], a Delaware');
      });
      await and('no wrapper is immediately followed by another of the same kind', () => {
        const names = childLocalNames(bodyParagraphs(readable.tracked)[0]!);
        for (let index = 1; index < names.length; index++) {
          if (['ins', 'del'].includes(names[index]!)) expect(names[index]).not.toBe(names[index - 1]);
        }
      });
      await and('both projections are exact and schema-valid', () => {
        expectExactProjections(readable);
      });
    },
  );

  test.openspec('Token-minimal grouping remains the library default')(
    'keeps the token-minimal redline when no grouping is requested and rejects unknown values',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalDocx = await given('the issue repro original', () =>
        buildDocxFromBodyXml(paragraph(run(ISSUE_ORIGINAL))));
      const revisedDocx = await given('the issue repro revision', () =>
        buildDocxFromBodyXml(paragraph(...ISSUE_REVISED_RUNS)));
      const defaulted = await when('the pair is compared without a grouping option', async () =>
        documentXml((await compareDocuments(originalDocx, revisedDocx, { date: DATE })).document));
      const minimal = await when('the pair is compared token-minimally', () =>
        compareGrouped(originalDocx, revisedDocx, 'token-minimal'));

      await then('the default output equals the explicit token-minimal output', () => {
        expect(defaulted).toBe(minimal.tracked);
      });
      await and('an unknown grouping value is rejected before comparison', async () => {
        await expect(compareDocuments(originalDocx, revisedDocx, {
          revisionGrouping: 'readable-whitespace' as CompareRevisionGrouping,
        })).rejects.toThrow(TypeError);
      });
    },
  );
});
