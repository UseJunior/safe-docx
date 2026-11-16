/**
 * One revision-grouping default across compare surfaces (#1494).
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

const TEST_FEATURE = 'unify-compare-revision-grouping-default';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'Compare surfaces share one revision-grouping default' })
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

async function mcpXml(pair: Pair, name: string): Promise<string> {
  const output = path.join(pair.dir, `${name}.mcp.docx`);
  const result = await compareDocuments_tool(createTestSessionManager(), {
    original_file_path: pair.originalPath,
    revised_file_path: pair.revisedPath,
    save_to_local_path: output,
  });
  assertSuccess(result, 'compare_documents');
  return documentXml(await fs.readFile(output));
}

function revisionWrappers(xml: string): string[] {
  const body = parseXml(xml).getElementsByTagNameNS(W_NS, 'body')[0]!;
  const paragraph = Array.from(body.getElementsByTagNameNS(W_NS, 'p'))[0]!;
  return Array.from(paragraph.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .map((node) => node.localName)
    .filter((name) => name === 'ins' || name === 'del');
}

function hasMoveMarkup(xml: string): boolean {
  const doc = parseXml(xml);
  return ['moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart']
    .some((name) => doc.getElementsByTagNameNS(W_NS, name).length > 0);
}

describe('compare surfaces share one revision-grouping default', () => {
  test.openspec('Every compare surface gives the same default redline')(
    'library, both CLIs and the MCP tool give byte-identical readable-semantic redlines by default',
    async ({ given, when, then, and }: AllureBddContext) => {
      const pair = await given('a three-word phrase replaced by four words', () =>
        writePair(PHRASE_ORIGINAL, PHRASE_REVISED));
      const outputs = await when('each surface compares the pair with no grouping option', async () => ({
        library: await libraryXml(pair),
        docxComparison: await docxComparisonCliXml(pair, 'default'),
        safeDocx: await safeDocxCliXml(pair, 'default'),
        mcp: await mcpXml(pair, 'default'),
      }));

      await then('every surface produces the same document XML', () => {
        expect(outputs.docxComparison).toBe(outputs.library);
        expect(outputs.safeDocx).toBe(outputs.library);
        expect(outputs.mcp).toBe(outputs.library);
      });
      await and('the default is the explicit readable-semantic output', async () => {
        expect(outputs.library).toBe(await libraryXml(pair, { revisionGrouping: 'readable-semantic' }));
      });
      await and('the replacement is one deletion followed by one insertion', () => {
        expect(revisionWrappers(outputs.library)).toEqual(['del', 'ins']);
      });
    },
  );

  test.openspec('The grouping flag selects token-minimal output')(
    'both CLIs honour --grouping token-minimal',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('the phrase-replacement pair', () => writePair(PHRASE_ORIGINAL, PHRASE_REVISED));
      const outputs = await when('each CLI runs with --grouping token-minimal', async () => ({
        expected: await libraryXml(pair, { revisionGrouping: 'token-minimal' }),
        docxComparison: await docxComparisonCliXml(pair, 'minimal', ['--grouping', 'token-minimal']),
        safeDocx: await safeDocxCliXml(pair, 'minimal', ['--grouping', 'token-minimal']),
        readable: await libraryXml(pair),
      }));

      await then('each CLI output equals the library token-minimal output and differs from the default', () => {
        expect(outputs.docxComparison).toBe(outputs.expected);
        expect(outputs.safeDocx).toBe(outputs.expected);
        expect(outputs.expected).not.toBe(outputs.readable);
      });
    },
  );

  test.openspec('An unknown grouping value fails cleanly')(
    'both CLIs reject an unsupported --grouping value without writing output',
    async ({ given, when, then }: AllureBddContext) => {
      const pair = await given('the phrase-replacement pair', () => writePair(PHRASE_ORIGINAL, PHRASE_REVISED));
      const output = path.join(pair.dir, 'never.docx');
      await when('each CLI runs with --grouping readable-whitespace', async () => {
        await expect(runCompareCli([pair.originalPath, pair.revisedPath, output, '--grouping', 'readable-whitespace']))
          .rejects.toThrow('Expected one of: token-minimal, readable-semantic');
        await expect(createProgram({ write: () => undefined, writeError: () => undefined }).parseAsync([
          'node', 'safe-docx', 'compare', pair.originalPath, pair.revisedPath, output, '--grouping', 'readable-whitespace',
        ])).rejects.toThrow('Invalid value for --grouping: "readable-whitespace"');
      });
      await then('no output file is written', async () => {
        await expect(fs.access(output)).rejects.toThrow();
      });
    },
  );

  test.openspec('The no-moves flag suppresses move markup')(
    'both CLIs emit no move markup with --no-moves on a reordered pair',
    async ({ given, when, then, and }: AllureBddContext) => {
      const pair = await given('three paragraphs with the first moved to the end', () =>
        writePair(REORDER_ORIGINAL, REORDER_REVISED));
      const outputs = await when('each CLI compares the pair with and without --no-moves', async () => ({
        defaultRun: await docxComparisonCliXml(pair, 'moves'),
        docxComparison: await docxComparisonCliXml(pair, 'nomoves', ['--no-moves']),
        safeDocx: await safeDocxCliXml(pair, 'nomoves', ['--no-moves']),
        expected: await libraryXml(pair, { detectMoves: false }),
      }));

      await then('the default run marks the reordered paragraph as a move', () => {
        expect(hasMoveMarkup(outputs.defaultRun)).toBe(true);
      });
      await and('--no-moves output carries no move markup and equals the library detectMoves: false output', () => {
        expect(hasMoveMarkup(outputs.docxComparison)).toBe(false);
        expect(hasMoveMarkup(outputs.safeDocx)).toBe(false);
        expect(outputs.docxComparison).toBe(outputs.expected);
        expect(outputs.safeDocx).toBe(outputs.expected);
      });
    },
  );
});
