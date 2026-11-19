/**
 * `CompareOptions.date: null` omits `w:date` from the revisions a comparison
 * creates (#1495). ECMA-376 Part 1 §17.13.5.14 / §17.13.5.18: "If this
 * attribute is omitted, then no date information shall be associated with the
 * parent annotation type." Revisions already present in an input keep their
 * own dates.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1495
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, buildSyntheticDocx, parseXml } from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
import { describe, expect } from 'vitest';
import { compareDocuments, type CompareOptions } from './index.js';
import { MOVE_RANGE_NEUTRAL_DATE } from './revisionDateOmission.js';
import { acceptAllChanges, rejectAllChanges } from './tagged/trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { buildDocxWithDefaultFooter } from './testing/footer-story-fixture.js';

const TEST_FEATURE = 'add-dateless-compare-revisions';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Comparison revisions may omit w:date' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

const FIXED_DATE = new Date('2026-03-04T05:06:07Z');
const FIXED_STAMP = '2026-03-04T05:06:07Z';
const PRIOR_STAMP = '2019-08-01T10:00:00Z';
const SCHEMA_SCRIPT = fileURLToPath(new URL('../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const REDLINE_DIR = new URL('../../../tests/test_documents/redline/', import.meta.url);
const MOVE_RANGE_START = /<w:(moveFromRangeStart|moveToRangeStart)\b[^>]*>/g;
const STORY_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const REVISION_ELEMENT =
  /<w:(ins|del|moveFrom|moveTo|moveFromRangeStart|moveToRangeStart|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|tblGridChange|numberingChange|cellIns|cellDel|cellMerge)\b/g;

async function storyParts(docx: Buffer): Promise<Map<string, string>> {
  const archive = await DocxArchive.load(docx);
  const parts = new Map<string, string>();
  for (const path of archive.listFiles().filter((name) => STORY_PART.test(name)).sort()) {
    parts.set(path, (await archive.getFile(path)) ?? '');
  }
  return parts;
}

function count(xml: string, pattern: RegExp): number {
  return xml.match(pattern)?.length ?? 0;
}

/** Neutral dates on move-range start markers, which the schema requires (#1528). */
function neutralMoveDates(xml: string): number {
  return count(xml, new RegExp(`w:date="${MOVE_RANGE_NEUTRAL_DATE}"`, 'g'));
}

function stripDates(xml: string): string {
  return xml.replace(/\s+w:date="[^"]*"/g, '');
}

/** A body edit, a footnote and an endnote edit, a moved paragraph, and a pre-dated insertion kept from the revised input. */
async function notesPair(): Promise<{ original: Buffer; revised: Buffer }> {
  const moved = 'The Seller shall deliver all closing certificates and consents to the Buyer at the Closing.';
  const other = 'Each party shall bear its own legal, accounting and advisory expenses in connection herewith.';
  const original = await buildSyntheticDocx({
    paragraphs: ['The purchase price is ten dollars.', moved, other, 'Governing law is Delaware.'],
    footnoteOnParagraph: 0,
    footnoteText: 'Original footnote text.',
    endnoteOnParagraph: 3,
    endnoteText: 'Original endnote text.',
  });
  const revisedBase = await buildSyntheticDocx({
    paragraphs: ['The purchase price is twenty dollars.', other, moved, 'Governing law is Delaware.'],
    footnoteOnParagraph: 0,
    footnoteText: 'Revised footnote text.',
    endnoteOnParagraph: 3,
    endnoteText: 'Revised endnote text.',
  });
  const archive = await DocxArchive.load(revisedBase);
  const documentXml = await archive.getDocumentXml();
  const withPrior = documentXml.replace(
    '<w:r><w:t>Governing law is Delaware.</w:t></w:r>',
    '<w:r><w:t>Governing law is Delaware.</w:t></w:r>' +
      `<w:ins w:id="900" w:author="Prior Reviewer" w:date="${PRIOR_STAMP}"><w:r><w:t xml:space="preserve"> Venue is Wilmington.</w:t></w:r></w:ins>`,
  );
  expect(withPrior).not.toBe(documentXml);
  archive.setDocumentXml(withPrior);
  return { original, revised: await archive.save() };
}

async function footerPair(): Promise<{ original: Buffer; revised: Buffer }> {
  return {
    original: await buildDocxWithDefaultFooter('Body text stays the same here.', 'Confidential draft footer'),
    revised: await buildDocxWithDefaultFooter('Body text changes here.', 'Final executed footer'),
  };
}

async function runBoth(pair: { original: Buffer; revised: Buffer }, extra: CompareOptions = {}) {
  const dated = await compareDocuments(pair.original, pair.revised, { ...extra, date: FIXED_DATE });
  const dateless = await compareDocuments(pair.original, pair.revised, { ...extra, date: null });
  return { dated, dateless, datedParts: await storyParts(dated.document), datelessParts: await storyParts(dateless.document) };
}

describe('compareDocuments date: null', () => {
  test.openspec('Dateless comparison omits w:date from every revision it creates')(
    'date: null leaves no generated w:date in body, notes or footer and keeps the revision count',
    async ({ given, when, then, and }: AllureBddContext) => {
      const notes = await given('a pair with body, footnote, endnote and move changes', () => notesPair());
      const footer = await given('a pair whose footer text changes', () => footerPair());

      const notesRun = await when('the notes pair is compared dated and with date: null', () => runBoth(notes));
      const footerRun = await when('the footer pair is compared dated and with date: null', () => runBoth(footer));

      for (const [label, run, expectedParts] of [
        ['notes', notesRun, ['word/document.xml', 'word/endnotes.xml', 'word/footnotes.xml']],
        ['footer', footerRun, ['word/document.xml', 'word/footer1.xml']],
      ] as const) {
        await then(`${label}: every story part changed and the dated run carries the fixed date`, () => {
          for (const path of expectedParts) {
            expect(count(run.datedParts.get(path) ?? '', REVISION_ELEMENT), path).toBeGreaterThan(0);
            expect(run.datedParts.get(path), path).toContain(`w:date="${FIXED_STAMP}"`);
          }
        });
        await and(`${label}: the dateless output has no generated w:date and is otherwise identical`, () => {
          expect([...run.datelessParts.keys()]).toEqual([...run.datedParts.keys()]);
          for (const [path, xml] of run.datelessParts) {
            const datedXml = run.datedParts.get(path)!;
            const generated = count(xml, /w:date="/g)
              - count(xml, new RegExp(`w:date="${PRIOR_STAMP}"`, 'g'))
              - count(xml, new RegExp(`w:date="${MOVE_RANGE_NEUTRAL_DATE}"`, 'g'));
            expect(generated, path).toBe(0);
            expect(count(xml, REVISION_ELEMENT), path).toBe(count(datedXml, REVISION_ELEMENT));
            expect(stripDates(xml), path).toBe(stripDates(datedXml));
          }
          expect(run.dateless.stats).toEqual(run.dated.stats);
        });
      }

      await and('the move pair produced move markup, so moves were exercised', () => {
        expect(notesRun.datelessParts.get('word/document.xml')).toMatch(/<w:moveFrom\b/);
      });
    },
  );

  test.openspec('Dateless move-range markers keep a neutral date')(
    'date: null gives move-range start markers the neutral date and the ILPA output passes the schema check',
    async ({ given, when, then, and }: AllureBddContext) => {
      const pairs = await given('the synthetic move pair and the ILPA Deal-By-Deal v1 / WOF v2 pair', async () => ({
        notes: await notesPair(),
        ilpa: {
          original: await readFile(new URL('ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx', REDLINE_DIR)),
          revised: await readFile(new URL('ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx', REDLINE_DIR)),
        },
      }));
      const outputs = await when('both pairs are compared with date: null', async () => ({
        notes: (await compareDocuments(pairs.notes.original, pairs.notes.revised, { date: null })).document,
        ilpa: (await compareDocuments(pairs.ilpa.original, pairs.ilpa.revised, { date: null, revisionFidelity: false })).document,
      }));
      for (const label of ['notes', 'ilpa'] as const) {
        await then(`${label}: every move-range start marker carries exactly the neutral date`, async () => {
          const xml = (await storyParts(outputs[label])).get('word/document.xml')!;
          const markers = xml.match(MOVE_RANGE_START) ?? [];
          expect(markers.length).toBeGreaterThan(0);
          for (const marker of markers) expect(marker).toContain(`w:date="${MOVE_RANGE_NEUTRAL_DATE}"`);
          expect(count(xml, new RegExp(`w:date="${MOVE_RANGE_NEUTRAL_DATE}"`, 'g'))).toBe(markers.length);
        });
        await and(`${label}: the dateless output passes the emitted-document schema check`, async () => {
          const dir = await mkdtemp(join(tmpdir(), 'dateless-moves-'));
          try {
            const path = join(dir, `${label}.docx`);
            await writeFile(path, outputs[label]);
            const check = spawnSync(process.execPath, [SCHEMA_SCRIPT, path], { encoding: 'utf8' });
            expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        });
      }
    },
    400_000, // ~60 s locally; over 120 s under CI coverage instrumentation
  );

  test.openspec('Dateless comparison keeps the dates of pre-existing revisions')(
    'a pre-dated insertion in the revised input keeps its w:date under date: null',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('a revised input holding an insertion dated 2019', () => notesPair());
      const result = await when('the pair is compared with date: null', () => compareDocuments(pair.original, pair.revised, { date: null }));
      await then('the preserved insertion still carries its own author and date', async () => {
        const xml = (await storyParts(result.document)).get('word/document.xml')!;
        expect(xml).toMatch(new RegExp(`w:author="Prior Reviewer"[^>]*w:date="${PRIOR_STAMP}"|w:date="${PRIOR_STAMP}"[^>]*w:author="Prior Reviewer"`));
        expect(count(xml, /w:date="/g) - neutralMoveDates(xml)).toBe(count(xml, new RegExp(`w:date="${PRIOR_STAMP}"`, 'g')));
      });
    },
  );

  test.openspec('Dateless comparison keeps the dates of pre-existing revisions')(
    'a pre-existing date written with a character reference is not mistaken for a generated one',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('a revised input whose insertion date encodes Z as &#90;', async () => {
        const base = await notesPair();
        const archive = await DocxArchive.load(base.revised);
        const xml = await archive.getDocumentXml();
        archive.setDocumentXml(xml.replace(`w:date="${PRIOR_STAMP}"`, 'w:date="1901-01-01T00:00:00&#90;"'));
        return { original: base.original, revised: await archive.save() };
      });
      const result = await when('the pair is compared with date: null', () => compareDocuments(pair.original, pair.revised, { date: null }));
      await then('the preserved insertion keeps that date', async () => {
        const xml = (await storyParts(result.document)).get('word/document.xml')!;
        expect(xml).toMatch(/w:date="1901-01-01T00:00:00(Z|&#90;)"/);
        expect(count(xml, /w:date="/g) - neutralMoveDates(xml)).toBe(1);
      });
    },
  );

  test.openspec('Dateless comparison omits w:date from every revision it creates')(
    'an out-of-range character reference inside an XML comment does not break the collision scan',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('a revised document.xml holding a comment with literal &#x110000;', async () => {
        const base = await footerPair();
        const archive = await DocxArchive.load(base.revised);
        const xml = await archive.getDocumentXml();
        archive.setDocumentXml(xml.replace('<w:body>', '<w:body><!-- literal &#x110000; -->'));
        return { original: base.original, revised: await archive.save() };
      });
      const result = await when('the pair is compared with date: null', () => compareDocuments(pair.original, pair.revised, { date: null }));
      await then('the comparison succeeds with no w:date', async () => {
        expect(count((await storyParts(result.document)).get('word/document.xml')!, /w:date="/g)).toBe(0);
      });
    },
  );

  test.openspec('Dateless comparison omits w:date from every revision it creates')(
    'an author whose name spells the placeholder date attribute is kept intact',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('the footer pair', () => footerPair());
      const author = "Reviewer w:date='1901-01-01T00:00:00Z'";
      const result = await when('it is compared with date: null and that author', () =>
        compareDocuments(pair.original, pair.revised, { date: null, author }));
      await then('every generated revision keeps the full author and has no w:date attribute', async () => {
        const archive = await DocxArchive.load(result.document);
        const doc = parseXml((await archive.getDocumentXml()));
        const revisions = Array.from(doc.getElementsByTagNameNS(W_NS, 'ins')).concat(Array.from(doc.getElementsByTagNameNS(W_NS, 'del')));
        expect(revisions.length).toBeGreaterThan(0);
        for (const revision of revisions) {
          expect(revision.getAttributeNS(W_NS, 'author')).toBe(author);
          expect(revision.hasAttributeNS(W_NS, 'date')).toBe(false);
        }
      });
    },
  );

  test.openspec('Dateless comparison projects exactly like a dated comparison')(
    'Accept All and Reject All of the dateless output equal the dated output',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('the notes pair', () => notesPair());
      const run = await when('it is compared dated and with date: null', () => runBoth(pair));
      await then('both projections of the main story are identical', () => {
        const dated = run.datedParts.get('word/document.xml')!;
        const dateless = run.datelessParts.get('word/document.xml')!;
        expect(acceptAllChanges(dateless)).toBe(stripDates(acceptAllChanges(dated)));
        expect(rejectAllChanges(dateless)).toBe(rejectAllChanges(stripDates(dated)));
      });
    },
  );

  test.openspec('An omitted or explicit date still stamps comparison revisions')(
    'undefined dates revisions now and an explicit Date uses that Date',
    async ({ given, when, then, and }: AllureBddContext) => {
      const pair = await given('the footer pair', () => footerPair());
      const before = Date.now();
      const implicit = await when('it is compared without a date option', () => compareDocuments(pair.original, pair.revised));
      const explicit = await when('it is compared with an explicit Date', () => compareDocuments(pair.original, pair.revised, { date: FIXED_DATE }));
      await then('the implicit run stamps revisions with the current time', async () => {
        const xml = (await storyParts(implicit.document)).get('word/document.xml')!;
        const stamps = [...xml.matchAll(/w:date="([^"]+)"/g)].map((match) => Date.parse(match[1]!));
        expect(stamps.length).toBeGreaterThan(0);
        for (const stamp of stamps) {
          expect(stamp).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
          expect(stamp).toBeLessThanOrEqual(Date.now());
        }
      });
      await and('the explicit run stamps every revision with that Date', async () => {
        const xml = (await storyParts(explicit.document)).get('word/document.xml')!;
        expect(count(xml, /w:date="/g)).toBe(count(xml, new RegExp(`w:date="${FIXED_STAMP}"`, 'g')));
        expect(count(xml, /w:date="/g)).toBeGreaterThan(0);
      });
      await and('an invalid Date is rejected', async () => {
        await expect(compareDocuments(pair.original, pair.revised, { date: new Date('nope') })).rejects.toThrow(TypeError);
      });
    },
  );
});
