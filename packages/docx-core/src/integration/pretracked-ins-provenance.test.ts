/**
 * Integration Tests — Original-side pre-tracked insertion provenance (#358)
 *
 * When the ORIGINAL input carries a pre-tracked insertion (an inline run-level
 * `w:ins`, or an inserted paragraph whose runs sit inside `w:ins` under a
 * PPR-INS paragraph mark), the comparison must thread that provenance through
 * to the combined output instead of flattening it:
 *
 * - matched content keeps its original-author `w:ins` wrapper, and
 * - comparison-deleted content nests `w:del(Comparison)` INSIDE the restored
 *   `w:ins(original-author)`.
 *
 * That shape is what keeps the INV-RT-001 projection law intact on both
 * projections: reject-all removes the restored `w:ins` subtrees exactly like
 * reject(original) drops the pre-tracked insertion, while accept-all resolves
 * the inner deletion and unwraps the emptied `w:ins` exactly like
 * accept(revised). Before the fix, the inserted text entered the combined
 * output as plain matched content or bare `w:delText`, so reject(combined)
 * kept text reject(original) drops — on the inplace path AND the rebuild
 * fallback (issue #226's screening surfaced but could not repair it).
 *
 * The run-level mechanism mirrors the paragraph-mark precedent (stacked
 * PPR-DEL(Comparison) + PPR-INS(original-author)) from the G4/G5 fixes.
 *
 * Revised-side provenance collisions remain pinned separately (issue #359,
 * lean-spec-bridge.test.ts).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/358
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments, type ReconstructionMode } from '@usejunior/docx-compare';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
} from '@usejunior/docx-compare';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { DocxDocument } from '../primitives/document.js';
import { getParagraphBookmarkId } from '../primitives/bookmarks.js';
import { replaceParagraphTextRange } from '../primitives/text.js';
import {
  createRevisionContext,
  createRevisionIdState,
} from '../primitives/track-changes-emitter.js';
import { buildSyntheticDocx } from './synthetic-docx-fixture.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Pre-tracked Insertion Provenance (#358)' });

const ORIGINAL_AUTHOR = 'Lean Bridge';
const ORIGINAL_DATE = '2026-05-11T00:00:00Z';
const BOOKMARK_ATTACHMENT_ID = 'pretracked-ins-provenance';

async function getDocumentXml(document: Buffer): Promise<string> {
  const archive = await DocxArchive.load(document);
  return await archive.getDocumentXml();
}

function normalizeDocumentXmlText(documentXml: string): string {
  return normalizeText(extractTextWithParagraphs(documentXml));
}

function createOriginalRevisionCtx() {
  return createRevisionContext({
    author: ORIGINAL_AUTHOR,
    date: ORIGINAL_DATE,
    idState: createRevisionIdState(),
  });
}

function getParagraphIds(document: DocxDocument): string[] {
  return document.getParagraphs().map((paragraph) => {
    const paragraphId = getParagraphBookmarkId(paragraph);
    if (!paragraphId) {
      throw new Error('Paragraph bookmark missing after insertParagraphBookmarks');
    }
    return paragraphId;
  });
}

/** Original with an inline run-level pre-tracked `w:ins` splice. */
async function buildInlineInsOriginal(
  paragraphs: string[],
  paragraphIndex: number,
  offset: number,
  insertedText: string,
): Promise<Buffer> {
  const document = await DocxDocument.load(await buildSyntheticDocx({ paragraphs }));
  document.insertParagraphBookmarks(BOOKMARK_ATTACHMENT_ID);
  const ids = getParagraphIds(document);
  const paragraph = document.getParagraphElementById(ids[paragraphIndex]!);
  if (!paragraph) {
    throw new Error(`Paragraph not found for tracked insertion: ${paragraphIndex}`);
  }
  replaceParagraphTextRange(paragraph, offset, offset, insertedText, createOriginalRevisionCtx());
  const { buffer } = await document.toBuffer({ cleanBookmarks: true });
  return buffer;
}

/** Original with a pre-tracked inserted paragraph (PPR-INS mark + w:ins runs). */
async function buildParagraphInsertOriginal(
  paragraphs: string[],
  anchorIndex: number,
  relativePosition: 'BEFORE' | 'AFTER',
  newParagraphText: string,
): Promise<Buffer> {
  const document = await DocxDocument.load(await buildSyntheticDocx({ paragraphs }));
  document.insertParagraphBookmarks(BOOKMARK_ATTACHMENT_ID);
  const ids = getParagraphIds(document);
  document.insertParagraph(
    {
      positionalAnchorNodeId: ids[anchorIndex]!,
      relativePosition,
      newText: newParagraphText,
    },
    createOriginalRevisionCtx(),
  );
  const { buffer } = await document.toBuffer({ cleanBookmarks: true });
  return buffer;
}

interface ProvenanceCase {
  name: string;
  build: () => Promise<{ original: Buffer; revised: Buffer }>;
}

// The issue's repro matrix: every revised counterpart of the inline-ins
// original used to violate the reject projection (matched, reverted,
// identical-to-accept, unrelated), plus both paragraph-insert shapes and the
// shrunk fast-check counterexample from #347's discovery run.
const CASES: ProvenanceCase[] = [
  {
    name: 'inline-ins original vs revised extending the insertion',
    build: async () => ({
      original: await buildInlineInsOriginal(['Alpha'], 0, 'Alpha'.length, ' beta'),
      revised: await buildSyntheticDocx({ paragraphs: ['Alpha beta tail'] }),
    }),
  },
  {
    name: 'inline-ins original vs revised equal to reject(original)',
    build: async () => ({
      original: await buildInlineInsOriginal(['Alpha'], 0, 'Alpha'.length, ' beta'),
      revised: await buildSyntheticDocx({ paragraphs: ['Alpha'] }),
    }),
  },
  {
    name: 'inline-ins original vs revised equal to accept(original)',
    build: async () => ({
      original: await buildInlineInsOriginal(['Alpha'], 0, 'Alpha'.length, ' beta'),
      revised: await buildSyntheticDocx({ paragraphs: ['Alpha beta'] }),
    }),
  },
  {
    name: 'inline-ins original vs unrelated revised',
    build: async () => ({
      original: await buildInlineInsOriginal(['Alpha'], 0, 'Alpha'.length, ' beta'),
      revised: await buildSyntheticDocx({ paragraphs: ['Gamma delta'] }),
    }),
  },
  {
    name: 'shrunk #347 counterexample: !-ins original vs !-paragraph-insert revised',
    build: async () => ({
      original: await buildInlineInsOriginal(['!'], 0, 0, '!'),
      revised: await buildParagraphInsertOriginal(['!'], 0, 'BEFORE', '!'),
    }),
  },
  {
    name: 'paragraph-insert original deleted by the comparison',
    build: async () => ({
      original: await buildParagraphInsertOriginal(['Alpha text.'], 0, 'AFTER', 'Added para.'),
      revised: await buildSyntheticDocx({ paragraphs: ['Alpha text.'] }),
    }),
  },
  {
    name: 'paragraph-insert original appearing plain mid-document in the revised',
    build: async () => ({
      original: await buildParagraphInsertOriginal(
        ['Alpha text.', 'Omega end.'],
        0,
        'AFTER',
        'Added para.',
      ),
      revised: await buildSyntheticDocx({
        paragraphs: ['Alpha text.', 'Added para.', 'Omega end.'],
      }),
    }),
  },
  {
    name: 'inline-ins original with edits in both paragraphs of a two-paragraph document',
    build: async () => ({
      original: await buildInlineInsOriginal(['Alpha one', 'Second para'], 1, 'Second'.length, ' inserted'),
      revised: await buildSyntheticDocx({ paragraphs: ['Alpha one more', 'Second altered para'] }),
    }),
  },
  {
    // Whole-paragraph deletion of a pre-tracked inserted HYPERLINK paragraph.
    // The rebuild path routes hyperlink-bearing paragraphs through
    // buildWholeParagraphRevisionContent, which needs its own provenance
    // nesting (peer-review finding on the initial #358 fix): the w:del chunk
    // nests inside the restored w:ins, both inside the hyperlink wrapper.
    name: 'pre-tracked inserted hyperlink paragraph deleted by the comparison',
    build: async () => ({
      original: await buildDocxFromBodyXml(
        paragraphWithText('Alpha') +
          '<w:p>' +
          `<w:pPr><w:rPr><w:ins w:id="90" w:author="${ORIGINAL_AUTHOR}" w:date="${ORIGINAL_DATE}"/></w:rPr></w:pPr>` +
          '<w:hyperlink w:anchor="target">' +
          `<w:ins w:id="91" w:author="${ORIGINAL_AUTHOR}" w:date="${ORIGINAL_DATE}">` +
          '<w:r><w:t>LinkText</w:t></w:r>' +
          '</w:ins>' +
          '</w:hyperlink>' +
          '</w:p>',
      ),
      revised: await buildDocxFromBodyXml(paragraphWithText('Alpha')),
    }),
  },
];

interface ProjectionReport {
  modeUsed: ReconstructionMode | undefined;
  fallbackReason: string | undefined;
  combinedXml: string;
  acceptCombined: string;
  acceptRevised: string;
  rejectCombined: string;
  rejectOriginal: string;
}

async function runComparison(
  original: Buffer,
  revised: Buffer,
  reconstructionMode: ReconstructionMode,
): Promise<ProjectionReport> {
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode,
  });
  const [combinedXml, originalXml, revisedXml] = await Promise.all([
    getDocumentXml(result.document),
    getDocumentXml(original),
    getDocumentXml(revised),
  ]);
  return {
    modeUsed: result.reconstructionModeUsed,
    fallbackReason: result.fallbackReason,
    combinedXml,
    acceptCombined: normalizeDocumentXmlText(acceptAllChanges(combinedXml)),
    acceptRevised: normalizeDocumentXmlText(acceptAllChanges(revisedXml)),
    rejectCombined: normalizeDocumentXmlText(rejectAllChanges(combinedXml)),
    rejectOriginal: normalizeDocumentXmlText(rejectAllChanges(originalXml)),
  };
}

describe('Original-side pre-tracked insertion provenance (issue #358)', () => {
  test(
    'inplace comparison stays inplace and satisfies both INV-RT-001 projections across the repro matrix',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const reports: Record<string, unknown>[] = [];

      await given('original documents carrying inline and paragraph-level pre-tracked insertions', async () => {});

      await when('each pair runs through the live inplace-requested comparison', async () => {});

      await then('no pair falls back and accept/reject both project to their inputs', async () => {
        for (const provenanceCase of CASES) {
          const { original, revised } = await provenanceCase.build();
          const report = await runComparison(original, revised, 'inplace');
          reports.push({
            name: provenanceCase.name,
            modeUsed: report.modeUsed,
            fallbackReason: report.fallbackReason ?? null,
          });

          expect
            .soft(report.modeUsed, `${provenanceCase.name}: reconstruction mode`)
            .toBe('inplace');
          expect(report.acceptCombined, `${provenanceCase.name}: accept projection`).toBe(
            report.acceptRevised,
          );
          expect(report.rejectCombined, `${provenanceCase.name}: reject projection`).toBe(
            report.rejectOriginal,
          );
        }
        await attachPrettyJson('inplace-provenance-reports', reports);
      });
    },
  );

  test(
    'rebuild comparison output satisfies both INV-RT-001 projections across the repro matrix',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const reports: Record<string, unknown>[] = [];

      await given('the same pre-tracked-insertion pairs as the inplace matrix', async () => {});

      await when('each pair runs through the rebuild-requested comparison', async () => {});

      await then('the rebuilt output projects to its inputs on accept and reject', async () => {
        for (const provenanceCase of CASES) {
          const { original, revised } = await provenanceCase.build();
          const report = await runComparison(original, revised, 'rebuild');
          reports.push({ name: provenanceCase.name, modeUsed: report.modeUsed });

          expect(report.acceptCombined, `${provenanceCase.name}: accept projection`).toBe(
            report.acceptRevised,
          );
          expect(report.rejectCombined, `${provenanceCase.name}: reject projection`).toBe(
            report.rejectOriginal,
          );
        }
        await attachPrettyJson('rebuild-provenance-reports', reports);
      });
    },
  );

  test(
    'combined output preserves the original author on the restored w:ins and nests the comparison w:del inside it',
    async ({ given, when, then, and }: AllureBddContext) => {
      let matchedXml = '';
      let deletedXml = '';

      await given('an inline-ins original compared against matched and reverted revised texts', async () => {
        const original = await buildInlineInsOriginal(['Alpha'], 0, 'Alpha'.length, ' beta');
        matchedXml = (
          await runComparison(
            original,
            await buildSyntheticDocx({ paragraphs: ['Alpha beta'] }),
            'inplace',
          )
        ).combinedXml;
        deletedXml = (
          await runComparison(
            original,
            await buildSyntheticDocx({ paragraphs: ['Alpha'] }),
            'inplace',
          )
        ).combinedXml;
      });

      await when('the combined markup is inspected', async () => {});

      await then('matched pre-tracked content keeps an original-author w:ins wrapper', async () => {
        expect(matchedXml).toMatch(
          new RegExp(`<w:ins[^>]*w:author="${ORIGINAL_AUTHOR}"[^>]*>(?:(?!</w:ins>).)*beta`),
        );
      });

      await and(
        'comparison-deleted pre-tracked content nests w:del(Comparison) inside w:ins(original-author)',
        async () => {
          expect(deletedXml).toMatch(
            new RegExp(
              `<w:ins[^>]*w:author="${ORIGINAL_AUTHOR}"[^>]*>` +
                `(?:(?!</w:ins>).)*<w:del[^>]*w:author="Comparison"[^>]*>` +
                `(?:(?!</w:del>).)*<w:delText[^>]*>[^<]*beta`,
            ),
          );
        },
      );
    },
  );
});
