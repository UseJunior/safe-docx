import { expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocxArchive, parseXml, OOXML } from '@usejunior/docx-core';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '@usejunior/docx-compare';

import { compareDocuments_tool } from './compare_documents.js';
import { MCP_TOOLS } from '../server.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';

// Core's test fixtures are excluded from its published build. Resolve the
// source at test runtime so MCP's composite build does not require unpublished
// declarations; keep package shapes owned by the shared fixtures.
const { buildDocxFromBodyXml }: {
  buildDocxFromBodyXml(body: string): Promise<Buffer>;
} = await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);

const TEST_FEATURE = 'add-readable-semantic-revision-grouping';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, story: 'compare_documents revision_grouping' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

const W_NS = OOXML.W_NS;

registerCleanup();

const ORIGINAL =
  'This Agreement is made by Alpha Holdings LLC, a Texas limited liability company located at 1 Main Street, and Beta Fund, LP, a Texas limited partnership.';
const REVISED_RUNS = [
  'This Agreement is made by Gamma Fund LP, a Delaware limited partnership, ',
  '[NAME OF GENERAL PARTNER]',
  ', a Delaware limited liability company, and Alpha Holdings LLC, a Delaware limited liability company located at 1 Main Street.',
];

function run(text: string, properties = ''): string {
  return `<w:r>${properties}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function writeFixturePair(): Promise<{ dir: string; originalPath: string; revisedPath: string }> {
  const dir = await createTrackedTempDir();
  const originalPath = path.join(dir, 'original.docx');
  const revisedPath = path.join(dir, 'revised.docx');
  await fs.writeFile(originalPath, new Uint8Array(await buildDocxFromBodyXml(`<w:p>${run(ORIGINAL)}</w:p>`)));
  await fs.writeFile(revisedPath, new Uint8Array(await buildDocxFromBodyXml(
    `<w:p>${run(REVISED_RUNS[0]!)}${run(REVISED_RUNS[1]!, '<w:rPr><w:highlight w:val="yellow"/></w:rPr>')}${run(REVISED_RUNS[2]!)}</w:p>`,
  )));
  return { dir, originalPath, revisedPath };
}

async function readDocumentXml(docxPath: string): Promise<string> {
  return (await DocxArchive.load(await fs.readFile(docxPath))).getDocumentXml();
}

function paragraphChildNames(xml: string): string[] {
  const paragraph = parseXml(xml).getElementsByTagNameNS(W_NS, 'p')[0]!;
  return Array.from(paragraph.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .map((node) => node.localName)
    .filter((name) => name !== 'pPr');
}

test.openspec('compare_documents defaults to readable semantic grouping')(
  'groups a rewritten paragraph into one deletion and one insertion by default',
  async ({ given, when, then, and }: AllureBddContext) => {
    const { dir, originalPath, revisedPath } = await given('a party paragraph and its heavy rewrite', writeFixturePair);
    const outputPath = path.join(dir, 'readable.docx');
    const result = await when('compare_documents runs without revision_grouping', () =>
      compareDocuments_tool(createTestSessionManager(), {
        original_file_path: originalPath,
        revised_file_path: revisedPath,
        save_to_local_path: outputPath,
      }));

    await then('the response reports the readable default', () => {
      assertSuccess(result, 'compare_documents');
      expect(result.revision_grouping).toBe('readable-semantic');
    });
    await and('the rewrite is one deletion followed by one insertion with exact projections', async () => {
      const tracked = await readDocumentXml(outputPath);
      expect(paragraphChildNames(tracked)).toEqual(['r', 'del', 'ins', 'r']);
      expect(extractTextWithParagraphs(acceptAllChanges(tracked))).toBe(REVISED_RUNS.join(''));
      expect(extractTextWithParagraphs(rejectAllChanges(tracked))).toBe(ORIGINAL);
    });
    await and('the tool schema advertises the parameter', () => {
      const tool = MCP_TOOLS.find((entry) => entry.name === 'compare_documents')!;
      expect(tool.inputSchema.properties).toHaveProperty('revision_grouping');
    });
  },
);

test.openspec('compare_documents honors token-minimal grouping on request')(
  'keeps the word-level redline when token-minimal grouping is requested',
  async ({ given, when, then, and }: AllureBddContext) => {
    const { dir, originalPath, revisedPath } = await given('a party paragraph and its heavy rewrite', writeFixturePair);
    const outputPath = path.join(dir, 'minimal.docx');
    const result = await when('compare_documents runs with revision_grouping token-minimal', () =>
      compareDocuments_tool(createTestSessionManager(), {
        original_file_path: originalPath,
        revised_file_path: revisedPath,
        save_to_local_path: outputPath,
        revision_grouping: 'token-minimal',
      }));

    await then('the response reports token-minimal grouping', () => {
      assertSuccess(result, 'compare_documents');
      expect(result.revision_grouping).toBe('token-minimal');
    });
    await and('the redline alternates word by word with exact projections', async () => {
      const tracked = await readDocumentXml(outputPath);
      const names = paragraphChildNames(tracked);
      expect(names.filter((name) => name === 'del').length).toBeGreaterThan(10);
      expect(extractTextWithParagraphs(acceptAllChanges(tracked))).toBe(REVISED_RUNS.join(''));
      expect(extractTextWithParagraphs(rejectAllChanges(tracked))).toBe(ORIGINAL);
    });
  },
);

test.openspec('compare_documents rejects an unsupported revision grouping')(
  'fails with INVALID_PARAMS and writes nothing for an unsupported grouping',
  async ({ given, when, then, and }: AllureBddContext) => {
    const { dir, originalPath, revisedPath } = await given('a valid document pair', writeFixturePair);
    const outputPath = path.join(dir, 'unsupported.docx');
    const result = await when('compare_documents runs with an unsupported revision_grouping', () =>
      compareDocuments_tool(createTestSessionManager(), {
        original_file_path: originalPath,
        revised_file_path: revisedPath,
        save_to_local_path: outputPath,
        revision_grouping: 'readable-whitespace' as 'token-minimal',
      }));

    await then('the tool fails with INVALID_PARAMS', () => {
      assertFailure(result, 'INVALID_PARAMS', 'compare_documents');
    });
    await and('no output file is written', async () => {
      await expect(fs.access(outputPath)).rejects.toThrow();
    });
  },
);
