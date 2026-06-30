import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDocumentOutline } from './get_document_outline.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-document-outline-tool';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type OutlineEntry = {
  paragraph_id: string;
  text: string;
  level: number | null;
  source: string;
};

function outlineEntries(value: unknown): OutlineEntry[] {
  return ((value as { outline?: OutlineEntry[] }).outline ?? []);
}

/** A long lowercase body sentence that triggers no heuristic heading detection. */
const BODY_PROSE =
  'This agreement sets forth the terms and conditions governing the relationship between the parties hereto.';

/** Document with two Word HeadingN-styled paragraphs and one body paragraph. */
const STYLED_HEADINGS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W_NS}">` +
  `<w:body>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>${BODY_PROSE}</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Scope of Services</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

/** Document whose only heading is heuristic (a short bare title, no Word style). */
const HEURISTIC_HEADING_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W_NS}">` +
  `<w:body>` +
  `<w:p><w:r><w:t>Indemnification</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>${BODY_PROSE}</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

async function writeTestDocx(tmpDir: string, xml: string, filename = 'input.docx'): Promise<string> {
  const inputPath = path.join(tmpDir, filename);
  const buf = await makeDocxWithDocumentXml(xml);
  await fs.writeFile(inputPath, new Uint8Array(buf));
  return inputPath;
}

describe('Traceability: Document Outline Tool', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });
  registerCleanup();

  // ── ADDED: Document Outline Tool ────────────────────────────────────

  humanReadableTest.openspec('word-style headings are projected with level and paragraph id')('Scenario: word-style headings are projected with level and paragraph id', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('outline-styled-');
    let inputPath = '';
    await given('a document with Word HeadingN-styled paragraphs', async () => {
      inputPath = await writeTestDocx(tmpDir, STYLED_HEADINGS_XML);
    });

    const result = await when('get_document_outline is called', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath });
      assertSuccess(r, 'get_document_outline');
      await attachPrettyJson('get_document_outline response', r);
      return r;
    });

    await then('the outline SHALL include one entry per heading with text, level, source, and paragraph_id', () => {
      const outline = outlineEntries(result);
      expect(outline).toHaveLength(2);
      const [first, second] = outline;
      expect(first!.text).toBe('Introduction');
      expect(first!.level).toBe(1);
      expect(first!.source).toBe('word_style');
      expect(first!.paragraph_id.startsWith('_bk_')).toBe(true);
      expect(second!.text).toBe('Scope of Services');
      expect(second!.level).toBe(2);
    });
  });

  humanReadableTest.openspec('heuristic headings are excluded by default and included on opt-in')('Scenario: heuristic headings are excluded by default and included on opt-in', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('outline-heuristic-');
    let inputPath = '';
    await given('a document whose only heading is heuristic (a bare title, not a Word style)', async () => {
      inputPath = await writeTestDocx(tmpDir, HEURISTIC_HEADING_XML);
    });

    const byDefault = await when('get_document_outline is called without include_heuristic_headings', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath });
      assertSuccess(r, 'get_document_outline');
      await attachPrettyJson('default response', r);
      return r;
    });

    const optedIn = await when('get_document_outline is called with include_heuristic_headings=true', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath, include_heuristic_headings: true });
      assertSuccess(r, 'get_document_outline');
      await attachPrettyJson('opt-in response', r);
      return r;
    });

    await then('the default outline SHALL omit the heuristic heading but the opt-in outline SHALL include it', () => {
      expect(outlineEntries(byDefault)).toHaveLength(0);
      const optedInOutline = outlineEntries(optedIn);
      expect(optedInOutline).toHaveLength(1);
      expect(optedInOutline[0]!.text).toBe('Indemnification');
      expect(optedInOutline[0]!.source).not.toBe('word_style');
    });
  });

  humanReadableTest.openspec('markdown format renders an indented outline')('Scenario: markdown format renders an indented outline', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('outline-markdown-');
    let inputPath = '';
    await given('a document with Heading1 and Heading2 paragraphs', async () => {
      inputPath = await writeTestDocx(tmpDir, STYLED_HEADINGS_XML);
    });

    const result = await when('get_document_outline is called with format="markdown"', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath, format: 'markdown' });
      assertSuccess(r, 'get_document_outline');
      await attachPrettyJson('markdown response', r);
      return r;
    });

    await then('the content SHALL render headings as an indented Markdown outline reflecting level', () => {
      const content = (result as { content?: string }).content ?? '';
      const lines = content.split('\n');
      // Exact lines: Heading1 renders at depth 1, Heading2 at depth 2, and the
      // body prose paragraph (not a heading) contributes no line.
      expect(lines).toEqual(['# Introduction', '## Scope of Services']);
    });
  });
});
