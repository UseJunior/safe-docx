import { describe, expect } from 'vitest';
import { compareDocuments } from '../index.js';
import { generateDocx } from '../generation/compile.js';
import type { BorderSpec, DocumentSpec, TableRowSpec, TableSpec } from '../generation/types.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const TEST_FEATURE = 'Inplace Reconstruction Cross-Run Recovery';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

/** A plain horizontal-rules label/value table — enough run-bearing table cells to exercise
 *  cross-run fragmentation recovery, with no dependency on any agreement-domain recipe. */
function labelValueTable(rows: Array<{ group: string } | { label: string; value: string }>): TableSpec {
  const rule: BorderSpec = { style: 'single' };
  const none: BorderSpec = { style: 'none' };
  return {
    kind: 'table',
    layout: 'fixed',
    columnWidthsTwips: [3600, 6000],
    borders: { top: rule, bottom: rule, insideH: rule, left: none, right: none, insideV: none },
    rows: rows.map((r): TableRowSpec =>
      'group' in r
        ? { cells: [{ gridSpan: 2, blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: r.group, bold: true }] }] }] }
        : {
            cells: [
              { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: r.label }] }] },
              { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: r.value }] }] },
            ],
          },
    ),
  };
}

function tableHeavyTemplate(governingLaw: string): DocumentSpec {
  return {
    meta: { title: 'Run-fragmented table template', author: 'safe-docx tests', createdIso: '2026-06-20T00:00:00Z' },
    sections: [
      {
        blocks: [
          labelValueTable([
            { group: 'Parties' },
            { label: 'Disclosing Party', value: 'Acme Holdings, Inc.' },
            { label: 'Receiving Party', value: 'Northeast Logistics LLC' },
            { label: 'Affiliate', value: 'Acme Services Group' },
            { group: 'Commercial Terms' },
            { label: 'Effective Date', value: 'June 20, 2026' },
            { label: 'Term', value: 'Three years' },
            { label: 'Notice Period', value: 'Thirty days' },
            { group: 'Legal Terms' },
            { label: 'Governing Law', value: governingLaw },
            { label: 'Venue', value: 'State and federal courts' },
            { label: 'Confidential Materials', value: 'Technical, financial, and customer information' },
          ]),
          {
            kind: 'paragraph',
            runs: [{ kind: 'text', text: 'Only the governing-law value changes between revisions.' }],
          },
        ],
      },
    ],
  };
}

async function fragmentRevisedTableRuns(buffer: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(buffer);
  const originalXml = await archive.getDocumentXml();
  const fragmentedXml = originalXml
    .replace('<w:t xml:space="preserve">New York</w:t>', '<w:t xml:space="preserve">New </w:t></w:r><w:r><w:t>York</w:t>')
    .replace(
      '<w:t xml:space="preserve">Acme Holdings, Inc.</w:t>',
      '<w:t xml:space="preserve">Acme </w:t></w:r><w:r><w:t>Holdings, Inc.</w:t>',
    )
    .replace(
      '<w:t xml:space="preserve">Technical, financial, and customer information</w:t>',
      '<w:t xml:space="preserve">Technical, financial, </w:t></w:r><w:r><w:t>and customer information</w:t>',
    );

  expect(fragmentedXml, 'fixture mutation should split table text into additional runs').not.toBe(originalXml);
  archive.setDocumentXml(fragmentedXml);
  return archive.save();
}

/**
 * A single-run paragraph whose revised copy splits one run at a formatting
 * boundary (a bold fragment mid-phrase) and edits a nearby word. The word-split
 * inplace pass cannot reconstruct this safely — splitting the bold run corrupts
 * the reject-side round-trip text — so it fails, and the run-level pass (which
 * deletes/inserts whole runs) rescues the output while keeping inplace mode.
 * This is a genuine fail-then-rescue that exercises the pass-supersession
 * machinery and the `inplaceSuccessDiagnostics` reporting.
 */
async function fragmentAtFormattingBoundary(original: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(original);
  const xml = await archive.getDocumentXml();
  const target = 'The Receiving Party shall protect Confidential Information carefully.';
  // Edit "Receiving" -> "Reviewing" and split the run after "The" into a bold fragment.
  const edited = target.replace('Receiving', 'Reviewing');
  const cut = 'The'.length;
  const fragmented =
    `${edited.slice(0, cut)}</w:t></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${edited.slice(cut)}`;
  const revisedXml = xml.replace(`>${target}<`, `>${fragmented}<`);
  expect(revisedXml, 'fixture mutation should split the run at a formatting boundary').not.toBe(xml);
  archive.setDocumentXml(revisedXml);
  return archive.save();
}

describe('Inplace reconstruction pass selection', () => {
  test.openspec('Inplace reconstruction reports the pass that produced the output')(
    'reports the winning pass and the earlier pass it superseded',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result!: Awaited<ReturnType<typeof compareDocuments>>;

      await given(
        'a single-run paragraph whose revised copy splits a run at a bold formatting boundary and edits a nearby word',
        async () => {
          original = await generateDocx({
            meta: { title: 'Formatting-boundary fragmentation', author: 'safe-docx tests', createdIso: '2026-06-20T00:00:00Z' },
            sections: [{ blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'The Receiving Party shall protect Confidential Information carefully.' }] }] }],
          });
          revised = await fragmentAtFormattingBoundary(original);
        },
      );

      await when('the fragmented pair is compared in inplace mode with run premerge disabled', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          premergeRuns: false,
        });
        await attachPrettyJson('inplace-pass-diagnostics.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          passUsed: result.inplaceSuccessDiagnostics?.passUsed ?? null,
          precedingFailedAttempts: result.inplaceSuccessDiagnostics?.precedingFailedAttempts?.map((a) => ({
            pass: a.pass,
            failedChecks: a.failedChecks,
          })) ?? null,
        });
      });

      await then('inplace output is kept and the diagnostics name the winning pass and the pass it superseded', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.fallbackReason).toBeUndefined();

        const diagnostics = result.inplaceSuccessDiagnostics;
        expect(diagnostics).toBeDefined();
        // The run-level pass rescued output that word-split could not reconstruct safely.
        expect(diagnostics!.passUsed).toBe('inplace_run_level');
        expect(diagnostics!.precedingFailedAttempts.length).toBeGreaterThan(0);
        expect(diagnostics!.precedingFailedAttempts[0]!.pass).toBe('inplace_word_split');
        // Every superseded attempt records at least one failed safety check, in evaluation order.
        for (const attempt of diagnostics!.precedingFailedAttempts) {
          expect(attempt.failedChecks.length).toBeGreaterThan(0);
        }
      });
    },
  );
});

describe('Inplace reconstruction on table-heavy run-fragmented templates', () => {
  test.openspec('Table-heavy run-fragmented templates preserve tracked table structure')(
    'table-heavy run-fragmented template preserves w:tbl without rebuild fallback',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original!: Buffer;
      let revised!: Buffer;
      let result!: Awaited<ReturnType<typeof compareDocuments>>;

      await given(
        'a table-heavy label/value template whose revised table values are split across different run boundaries',
        async () => {
          original = await generateDocx(tableHeavyTemplate('Delaware'));
          revised = await fragmentRevisedTableRuns(await generateDocx(tableHeavyTemplate('New York')));
        },
      );

      await when('the small table-cell text edit is compared in inplace mode with run premerge disabled', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          premergeRuns: false,
        });
        await attachPrettyJson('table-heavy-inplace-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason ?? null,
          fallbackAttempts: result.fallbackDiagnostics?.attempts?.map((attempt) => ({
            pass: attempt.pass,
            failedChecks: attempt.failedChecks,
          })) ?? null,
        });
      });

      await then('download-equivalent output succeeds without rebuild fallback and preserves table XML', async () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.fallbackReason).toBeUndefined();
        expect(result.fallbackDiagnostics).toBeUndefined();

        const resultArchive = await DocxArchive.load(result.document);
        const resultXml = await resultArchive.getDocumentXml();
        expect(resultXml).toContain('<w:tbl>');
        expect((resultXml.match(/<w:tbl>/g) ?? []).length).toBe(1);
        expect(resultXml).toContain('Delaware');
        expect(resultXml).toContain('<w:t xml:space="preserve">New </w:t></w:r><w:r><w:t>York</w:t>');
      });
    },
  );
});
