/**
 * Dateless comparison revisions on every compare surface (#1495): `--no-date`
 * on both CLIs and `revision_date: "none"` on the MCP tool omit `w:date` from
 * the revisions the comparison creates, matching library `date: null`.
 * Adapted from the #1494 surface-parity harness.
 *
 * The library `compareDocuments`, the `docx-comparison` CLI, the
 * `safe-docx compare` CLI and the MCP `compare_documents` tool must give the
 * same redline for the same pair, and both CLIs must expose `--grouping` and
 * `--no-moves`. Date is frozen so the generated `w:date` values match and the
 * outputs can be compared byte for byte.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1494
 */

import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { compareDocuments, type CompareOptions } from '@usejunior/docx-compare';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { compareDocuments_tool } from '../tools/compare_documents.js';
import { createProgram } from './index.js';

// Core's test fixtures and the docx-comparison CLI module are not part of the
// published builds MCP depends on; load their sources at test runtime.
const { buildDocxFromBodyXml }: {
  buildDocxFromBodyXml(body: string): Promise<Buffer>;
} = await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);
const { runCompareCli }: {
  runCompareCli(argv: string[]): Promise<{ help?: boolean; output?: string }>;
} = await import(new URL('../../../docx-compare/src/cli/compare-two.ts', import.meta.url).href);

const TEST_FEATURE = 'add-dateless-compare-revisions';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Compare surfaces can omit revision dates' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

const W_NS = OOXML.W_NS;
const FROZEN_NOW = new Date('2026-11-16T00:00:00.000Z');

registerCleanup();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: FROZEN_NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

// A three-word phrase replaced by four words (the issue's synthetic repro).
const PHRASE_ORIGINAL = paragraph('The buyer is Alpha Holdings LLC under this agreement.');
const PHRASE_REVISED = paragraph('The buyer is Gamma Fund Limited Partnership under this agreement.');

const MOVED_A = 'The Seller shall deliver all closing certificates, consents and releases to the Buyer at the Closing.';
const MOVED_B = 'Each party shall bear its own legal, accounting and advisory expenses incurred in connection with this Agreement.';
const MOVED_C = 'This Agreement shall be governed by the laws of the State of Delaware without regard to conflict principles.';
const REORDER_ORIGINAL = [MOVED_A, MOVED_B, MOVED_C].map(paragraph).join('');
const REORDER_REVISED = [MOVED_B, MOVED_C, MOVED_A].map(paragraph).join('');

interface Pair {
  dir: string;
  originalPath: string;
  revisedPath: string;
  original: Buffer;
  revised: Buffer;
}

async function writePair(originalBody: string, revisedBody: string): Promise<Pair> {
  const dir = await createTrackedTempDir();
  const originalPath = path.join(dir, 'original.docx');
  const revisedPath = path.join(dir, 'revised.docx');
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  await fs.writeFile(originalPath, new Uint8Array(original));
  await fs.writeFile(revisedPath, new Uint8Array(revised));
  return { dir, originalPath, revisedPath, original, revised };
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

async function libraryXml(pair: Pair, options: CompareOptions = {}): Promise<string> {
  return documentXml((await compareDocuments(pair.original, pair.revised, options)).document);
}

async function docxComparisonCliXml(pair: Pair, name: string, flags: string[] = []): Promise<string> {
  const output = path.join(pair.dir, `${name}.docx-comparison.docx`);
  await runCompareCli([pair.originalPath, pair.revisedPath, output, ...flags]);
  return documentXml(await fs.readFile(output));
}

async function safeDocxCliXml(pair: Pair, name: string, flags: string[] = []): Promise<string> {
  const output = path.join(pair.dir, `${name}.safe-docx.docx`);
  await createProgram({ write: () => undefined, writeError: () => undefined })
    .parseAsync(['node', 'safe-docx', 'compare', pair.originalPath, pair.revisedPath, output, ...flags]);
  return documentXml(await fs.readFile(output));
}

async function mcpXml(pair: Pair, name: string, revisionDate?: string): Promise<string> {
  const output = path.join(pair.dir, `${name}.mcp.docx`);
  const result = await compareDocuments_tool(createTestSessionManager(), {
    original_file_path: pair.originalPath,
    revised_file_path: pair.revisedPath,
    save_to_local_path: output,
    ...(revisionDate === undefined ? {} : { revision_date: revisionDate }),
  });
  assertSuccess(result, 'compare_documents');
  return documentXml(await fs.readFile(output));
}

function dateCount(xml: string): number {
  return xml.match(/w:date="/g)?.length ?? 0;
}

function revisionCount(xml: string): number {
  return xml.match(/<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange)\b/g)?.length ?? 0;
}

describe('compare surfaces can omit revision dates', () => {
  test.openspec('Every compare surface can omit revision dates')(
    '--no-date on both CLIs and revision_date none on MCP equal the library date: null output',
    async ({ given, when, then, and }: AllureBddContext) => {
      const pair = await given('a phrase replacement plus a reordered paragraph', () =>
        writePair(PHRASE_ORIGINAL + REORDER_ORIGINAL, PHRASE_REVISED + REORDER_REVISED));
      const outputs = await when('each surface compares the pair without dates and with the default date', async () => ({
        library: await libraryXml(pair, { date: null }),
        dated: await libraryXml(pair),
        docxComparison: await docxComparisonCliXml(pair, 'nodate', ['--no-date']),
        safeDocx: await safeDocxCliXml(pair, 'nodate', ['--no-date']),
        mcp: await mcpXml(pair, 'nodate', 'none'),
        mcpNow: await mcpXml(pair, 'now', 'now'),
      }));

      await then('every dateless surface produces the library date: null XML with no w:date', () => {
        expect(dateCount(outputs.library)).toBe(0);
        expect(outputs.docxComparison).toBe(outputs.library);
        expect(outputs.safeDocx).toBe(outputs.library);
        expect(outputs.mcp).toBe(outputs.library);
      });
      await and('the dated default keeps its dates and the same revisions', () => {
        expect(dateCount(outputs.dated)).toBeGreaterThan(0);
        expect(revisionCount(outputs.library)).toBe(revisionCount(outputs.dated));
        expect(outputs.mcpNow).toBe(outputs.dated);
      });
    },
  );

  test.openspec('An invalid revision_date fails cleanly')(
    'the MCP tool rejects an unsupported revision_date and accepts an ISO date-time',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('the phrase-replacement pair', () => writePair(PHRASE_ORIGINAL, PHRASE_REVISED));
      const results = await when('compare_documents runs with a bad and an ISO revision_date', async () => ({
        bad: await compareDocuments_tool(createTestSessionManager(), {
          original_file_path: pair.originalPath,
          revised_file_path: pair.revisedPath,
          save_to_local_path: path.join(pair.dir, 'bad.docx'),
          revision_date: 'yesterday',
        }),
        iso: await mcpXml(pair, 'iso', '2025-02-03T04:05:06Z'),
      }));
      await then('the bad value is INVALID_PARAMS with no output and the ISO value stamps revisions', async () => {
        expect(results.bad).toMatchObject({ success: false, error: { code: 'INVALID_PARAMS' } });
        await expect(fs.access(path.join(pair.dir, 'bad.docx'))).rejects.toThrow();
        expect(results.iso).toContain('w:date="2025-02-03T04:05:06Z"');
      });
    },
  );
});
