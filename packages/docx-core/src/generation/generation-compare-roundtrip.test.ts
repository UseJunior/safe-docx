/**
 * Author->compare round-trip guarantee (issue #483).
 *
 * docx-core owns both halves of the contract lifecycle: it authors documents
 * from scratch (`generateDocx`) and compares/redlines them (`compareDocuments`).
 * The strategic value of owning both is that an authored document and a
 * comparable document share one AST/OOXML model, so a freshly generated
 * contract should be a first-class citizen of the redline workflow with no
 * impedance mismatch. The generation skeleton suite proves determinism and
 * clone-stability; this suite proves the synergy: authored output flows cleanly
 * through compare + accept/reject, and a deliberately malformed authored field
 * is caught by the reconstruction safety checks rather than passing silently.
 *
 * No mocks: every assertion runs against the real `generateDocx` and
 * `compareDocuments`.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { compareDocuments } from '@usejunior/docx-compare';
import type { CompareResult, ReconstructionMode } from '@usejunior/docx-compare';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  compareTexts,
} from '@usejunior/docx-compare';
import type { BlockSpec, BorderSpec, DocumentSpec, HeaderFooterSpec, TableSpec } from './types.js';

/** Plain two-column label/value table (no agreement-domain recipe). */
function labelValueTable(rows: Array<{ label: string; value: string }>): TableSpec {
  const rule: BorderSpec = { style: 'single' };
  const none: BorderSpec = { style: 'none' };
  return {
    kind: 'table',
    layout: 'fixed',
    columnWidthsTwips: [3600, 6000],
    borders: { top: rule, bottom: rule, insideH: rule, left: none, right: none, insideV: none },
    rows: rows.map((r) => ({
      cells: [
        { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: r.label }] }] },
        { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: r.value }] }] },
      ],
    })),
  };
}

/** Plain signature lines: a party header paragraph plus a bottom-bordered signing-line cell
 *  and name/title/date rows — table-and-border richness without any signature recipe. */
function signatureLines(parties: Array<{ party: string; name: string; title: string; dateLabel?: string }>): BlockSpec[] {
  const line: BorderSpec = { style: 'single' };
  const blocks: BlockSpec[] = [];
  for (const p of parties) {
    blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: p.party, bold: true }] });
    blocks.push({
      kind: 'table',
      layout: 'fixed',
      columnWidthsTwips: [5760],
      rows: [
        { cells: [{ borders: { bottom: line }, blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: '' }] }] }] },
      ],
    });
    blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: `Name: ${p.name}` }] });
    blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: `Title: ${p.title}` }] });
    blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: p.dateLabel ?? 'Date:' }] });
  }
  return blocks;
}

const TEST_FEATURE = 'add-generation-compare-roundtrip';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

const MODES: ReconstructionMode[] = ['rebuild', 'inplace'];

// --- Spec builders ----------------------------------------------------------

/** A two-paragraph contract body whose first paragraph names a date we can edit. */
function datedSpec(month: string): DocumentSpec {
  return {
    meta: { title: 'Round-trip', author: 'safe-docx tests', createdIso: '2026-06-13T00:00:00Z' },
    sections: [
      {
        blocks: [
          { kind: 'paragraph', runs: [{ kind: 'text', text: `The Effective Date is ${month} 1, 2026.` }] },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'This Agreement is governed by the laws of Delaware.' }] },
        ],
      },
    ],
  };
}

/** Same text in both, but one run's bold differs — a format-only edit. */
function emphasisSpec(bold: boolean): DocumentSpec {
  return {
    meta: { title: 'Round-trip format', author: 'safe-docx tests', createdIso: '2026-06-13T00:00:00Z' },
    sections: [
      {
        blocks: [
          {
            kind: 'paragraph',
            runs: [
              { kind: 'text', text: 'Status: ' },
              { kind: 'text', text: 'Confidential', ...(bold ? { bold: true } : {}) },
            ],
          },
        ],
      },
    ],
  };
}

function pageXofYFooter(): HeaderFooterSpec {
  return {
    blocks: [
      {
        kind: 'paragraph',
        alignment: 'center',
        runs: [
          { kind: 'text', text: 'Page ' },
          { kind: 'field', field: 'PAGE', cachedResult: '1' },
          { kind: 'text', text: ' of ' },
          { kind: 'field', field: 'NUMPAGES', cachedResult: '1' },
        ],
      },
    ],
  };
}

/**
 * A feature-rich contract: a cover-terms table, a body "Page X of Y" line
 * (so the field-structure safety path is exercised through compare — the check
 * runs over document.xml, not headers/footers), a Page-X-of-Y footer, and a
 * signature block. `effectiveDate` is the one value we edit between revisions.
 */
function fieldsAndTablesSpec(effectiveDate: string): DocumentSpec {
  const blocks: BlockSpec[] = [
    labelValueTable([
      { label: 'Disclosing Party', value: 'Acme Manufacturing, Inc.' },
      { label: 'Receiving Party', value: 'Northeast Logistics LLC' },
      { label: 'Effective Date', value: effectiveDate },
    ]),
    {
      kind: 'paragraph',
      runs: [
        { kind: 'text', text: 'Page ' },
        { kind: 'field', field: 'PAGE', cachedResult: '1' },
        { kind: 'text', text: ' of ' },
        { kind: 'field', field: 'NUMPAGES', cachedResult: '1' },
      ],
    },
    { kind: 'paragraph', runs: [{ kind: 'text', text: 'IN WITNESS WHEREOF, the parties execute this Agreement.' }] },
    ...signatureLines([
      { party: 'Acme Manufacturing, Inc.', name: 'Jane Doe', title: 'CEO' },
      { party: 'Northeast Logistics LLC', name: 'John Smith', title: 'Managing Member', dateLabel: 'Dated:' },
    ]),
  ];
  return {
    meta: { title: 'Round-trip fields+tables', author: 'safe-docx tests', createdIso: '2026-06-13T00:00:00Z' },
    sections: [{
      headers: {
        default: {
          blocks: [{
            kind: 'paragraph',
            borders: { bottom: { style: 'single', sizeEighthPt: 8, colorHex: '2F75B5' } },
            runs: [{ kind: 'text', text: 'CONFIDENTIAL' }],
          }],
        },
      },
      footers: { default: pageXofYFooter() },
      blocks,
    }],
  };
}

/** A single body PAGE field — the subject of the negative-control mutation. */
function bodyFieldSpec(): DocumentSpec {
  return {
    meta: { title: 'Round-trip field guard', author: 'safe-docx tests', createdIso: '2026-06-13T00:00:00Z' },
    sections: [
      {
        blocks: [
          {
            kind: 'paragraph',
            runs: [
              { kind: 'text', text: 'Page ' },
              { kind: 'field', field: 'PAGE', cachedResult: '1' },
            ],
          },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Body follows the field.' }] },
        ],
      },
    ],
  };
}

// --- Round-trip harness -----------------------------------------------------

interface RoundTripArtifacts {
  result: CompareResult;
  originalArchive: DocxArchive;
  revisedArchive: DocxArchive;
  resultArchive: DocxArchive;
  acceptedArchive: DocxArchive;
  rejectedArchive: DocxArchive;
}

/**
 * Mirror of the file-local helper in
 * integration/roundtrip-structural-invariants.test.ts, extended to also return
 * the CompareResult so callers can assert stats and reconstruction diagnostics.
 */
async function buildRoundTripArtifacts(
  originalBuffer: Buffer,
  revisedBuffer: Buffer,
  mode: ReconstructionMode,
): Promise<RoundTripArtifacts> {
  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: mode,
  });

  const originalArchive = await DocxArchive.load(originalBuffer);
  const revisedArchive = await DocxArchive.load(revisedBuffer);
  const resultArchive = await DocxArchive.load(result.document);

  const resultDocumentXml = await resultArchive.getDocumentXml();
  const acceptedArchive = await resultArchive.clone();
  acceptedArchive.setDocumentXml(acceptAllChanges(resultDocumentXml));
  const rejectedArchive = await resultArchive.clone();
  rejectedArchive.setDocumentXml(rejectAllChanges(resultDocumentXml));

  return { result, originalArchive, revisedArchive, resultArchive, acceptedArchive, rejectedArchive };
}

async function readText(archive: DocxArchive): Promise<string> {
  return extractTextWithParagraphs(await archive.getDocumentXml());
}

async function assertAcceptRejectParity(artifacts: RoundTripArtifacts, context: string): Promise<void> {
  const [revisedText, originalText, acceptedText, rejectedText] = await Promise.all([
    readText(artifacts.revisedArchive),
    readText(artifacts.originalArchive),
    readText(artifacts.acceptedArchive),
    readText(artifacts.rejectedArchive),
  ]);
  expect(compareTexts(revisedText, acceptedText).normalizedIdentical, `${context}: accept-all should equal revised`).toBe(true);
  expect(compareTexts(originalText, rejectedText).normalizedIdentical, `${context}: reject-all should equal original`).toBe(true);
}

// --- Scenarios --------------------------------------------------------------

describe('Author->compare round-trip guarantee', () => {
  test.openspec('[SDX-GEN-100] self-compare of an authored document is empty')(
    'Scenario: self-compare of an authored document is empty',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original!: Buffer;
      let copy!: Buffer;
      await given('an authored document compiled twice (generation is deterministic)', async () => {
        const spec = datedSpec('January');
        original = await generateDocx(spec);
        copy = await generateDocx(spec);
        expect(copy.equals(original)).toBe(true);
      });

      let result!: CompareResult;
      await when('the two authored buffers are compared', async () => {
        result = await compareDocuments(original, copy, { engine: 'atomizer' });
        await attachPrettyJson('self-compare-stats', result.stats);
      });

      await then('the comparison reports no changes', async () => {
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(0);
        expect(result.stats.modifications).toBe(0);
        expect(result.stats.formatChanges).toBe(0);
        expect(result.stats.insertedAtoms).toBe(0);
        expect(result.stats.deletedAtoms).toBe(0);
      });
    },
  );

  test.openspec('[SDX-GEN-101] a known single-paragraph edit produces exactly that redline')(
    'Scenario: a known single-paragraph edit produces exactly that redline',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      await given('two authored documents differing by one paragraph word (a replacement)', async () => {
        original = await generateDocx(datedSpec('January'));
        revised = await generateDocx(datedSpec('February'));
      });

      let result!: CompareResult;
      let artifacts!: RoundTripArtifacts;
      await when('they are compared and round-tripped', async () => {
        artifacts = await buildRoundTripArtifacts(original, revised, 'rebuild');
        result = artifacts.result;
        await attachPrettyJson('known-edit-stats', result.stats);
      });

      await then('the redline is confined to one paragraph with no spurious changes', async () => {
        // A word replacement trips both insert and delete on the same paragraph.
        expect(result.stats.modifiedParagraphs).toBe(1);
        expect(result.stats.insertions).toBe(1);
        expect(result.stats.deletions).toBe(1);
      });

      await then('accept-all yields the revised text and reject-all yields the original text', async () => {
        await assertAcceptRejectParity(artifacts, 'SDX-GEN-101');
      });

      await then('a format-only edit reports a format change and no text atoms', async () => {
        const formatOriginal = await generateDocx(emphasisSpec(false));
        const formatRevised = await generateDocx(emphasisSpec(true));
        const formatResult = await compareDocuments(formatOriginal, formatRevised, { engine: 'atomizer' });
        await attachPrettyJson('format-edit-stats', formatResult.stats);
        expect(formatResult.stats.formatChanges).toBeGreaterThanOrEqual(1);
        expect(formatResult.stats.insertedAtoms).toBe(0);
        expect(formatResult.stats.deletedAtoms).toBe(0);
      });
    },
  );

  for (const mode of MODES) {
    test.openspec('[SDX-GEN-102] accept-all equals revised and reject-all equals original')(
      `Scenario: accept-all equals revised and reject-all equals original (${mode})`,
      async ({ given, when, then }: AllureBddContext) => {
        let original!: Buffer;
        let revised!: Buffer;
        await given(`an authored original and revised document compared in '${mode}' mode`, async () => {
          original = await generateDocx(datedSpec('January'));
          revised = await generateDocx(datedSpec('February'));
        });

        let artifacts!: RoundTripArtifacts;
        await when('all changes are accepted, and separately all are rejected', async () => {
          artifacts = await buildRoundTripArtifacts(original, revised, mode);
        });

        await then('accepted text matches revised and rejected text matches original', async () => {
          await assertAcceptRejectParity(artifacts, `SDX-GEN-102/${mode}`);
        });
      },
    );
  }

  for (const mode of MODES) {
    test.openspec('[SDX-GEN-103] authored fields and tables survive the compare round-trip')(
      `Scenario: authored fields and tables survive the compare round-trip (${mode})`,
      async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
        let original!: Buffer;
        let revised!: Buffer;
        await given('an authored document with a bordered header, a Page X of Y field, a cover-terms table, and a signature block', async () => {
          original = await generateDocx(fieldsAndTablesSpec('June 11, 2026'));
          revised = await generateDocx(fieldsAndTablesSpec('July 11, 2026'));
        });

        let artifacts!: RoundTripArtifacts;
        await when(`it is edited, compared, and round-tripped in '${mode}' mode`, async () => {
          artifacts = await buildRoundTripArtifacts(original, revised, mode);
          await attachPrettyJson('fields-tables-diagnostics', {
            failedChecks: artifacts.result.rebuildSafetyDiagnostics?.failedChecks ?? null,
            fallbackReason: artifacts.result.fallbackReason ?? null,
          });
        });

        await then('paragraph borders, field structure, and table-cell text round-trip', async () => {
          await assertAcceptRejectParity(artifacts, `SDX-GEN-103/${mode}`);
          // A clean round-trip surfaces no safety failures (field structure included).
          expect(artifacts.result.rebuildSafetyDiagnostics?.failedChecks ?? []).not.toContain('fieldStructure');
          for (const archive of [artifacts.resultArchive, artifacts.acceptedArchive, artifacts.rejectedArchive]) {
            const headerXml = await archive.getFile('word/header1.xml');
            expect(headerXml).toContain(
              '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="0" w:color="2F75B5"/></w:pBdr>',
            );
          }
        });
      },
    );
  }

  for (const mode of MODES) {
    test.openspec('[SDX-GEN-104] a malformed authored field is caught by the round-trip guard')(
      `Scenario: a malformed authored field is caught by the round-trip guard (${mode})`,
      async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
        let original!: Buffer;
        let malformed!: Buffer;
        await given('an authored document whose body field has a dropped fldChar end marker', async () => {
          original = await generateDocx(bodyFieldSpec());
          const archive = await DocxArchive.load(original);
          const documentXml = await archive.getDocumentXml();
          const broken = documentXml.replace(/<w:fldChar w:fldCharType="end"\s*\/>/, '');
          expect(broken, 'mutation should remove a fldChar end marker').not.toBe(documentXml);
          archive.setDocumentXml(broken);
          malformed = await archive.save();
        });

        let result: CompareResult | undefined;
        let rejectionMessage: string | undefined;
        await when(`the original is compared against the malformed revision in '${mode}' mode`, async () => {
          try {
            result = await compareDocuments(original, malformed, {
              engine: 'atomizer',
              comparisonStrategy: 'legacy',
              reconstructionMode: mode,
            });
          } catch (error) {
            rejectionMessage = error instanceof Error ? error.message : String(error);
          }
          await attachPrettyJson(
            'guard-diagnostics',
            result
              ? {
                  used: result.reconstructionModeUsed,
                  fallbackReason: result.fallbackReason ?? null,
                  fallbackAttempts: result.fallbackDiagnostics?.attempts?.map((a) => a.failedChecks) ?? null,
                  rebuild: result.rebuildSafetyDiagnostics?.failedChecks ?? null,
                }
              : { rejectionMessage },
          );
        });

        await then('the reconstruction guard reports a fieldStructure failure rather than passing silently', async () => {
          if (mode === 'rebuild') {
            expect(result).toBeUndefined();
            expect(rejectionMessage).toMatch(
              /Opaque passthrough: complex field has unmatched begin marker/,
            );
            return;
          }

          expect(result).toBeDefined();
          expect(result?.rebuildSafetyDiagnostics?.failedChecks ?? []).toContain('fieldStructure');
          expect(result?.fallbackReason).toBe('round_trip_safety_check_failed');
          const attempts = result?.fallbackDiagnostics?.attempts ?? [];
          expect(attempts.length).toBeGreaterThan(0);
          expect(attempts.every((a) => a.failedChecks.includes('fieldStructure'))).toBe(true);
        });

        await then('a well-formed revision in the same mode surfaces no safety failures (control)', async () => {
          const goodRevised = await generateDocx(bodyFieldSpec());
          const goodResult = await compareDocuments(original, goodRevised, { engine: 'atomizer', reconstructionMode: mode });
          expect(goodResult.rebuildSafetyDiagnostics).toBeUndefined();
        });
      },
    );
  }
});
