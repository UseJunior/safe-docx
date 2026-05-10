import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { addFootnote } from './add_footnote.js';
import { DEFAULT_CONTENT_TOKEN_BUDGET, estimateTokens } from './pagination.js';
import { readFile } from './read_file.js';

const test = testAllure.epic('Document Reading');
const FIRST_NODE_BUDGET_WARNING = 'budget_exceeded_by_first_node';

describe('read_file footnotes', () => {
  registerCleanup();

  async function readWithOversizedFirstNode(params: {
    format?: 'toon' | 'json';
    limit?: number;
  }) {
    const opened = await openSession(['P'.repeat(80_000)]);

    const note = await addFootnote(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.firstParaId,
      text: 'Footnote body',
    });
    assertSuccess(note, 'add_footnote');

    const read = await readFile(opened.mgr, {
      file_path: opened.inputPath,
      format: params.format,
      limit: params.limit,
    });
    assertSuccess(read, 'read_file');

    return { opened, read };
  }

  test('oversized first paragraph with a footnote emits a budget warning in toon format', async ({ when, then }: AllureBddContext) => {
    const rendered = await when('read_file returns an oversized first paragraph that also carries a footnote marker in toon format', async () => {
      return readWithOversizedFirstNode({ format: 'toon' });
    });

    await then('the response preserves the content and surfaces the structured warning', async () => {
      expect(Number(rendered.read.paragraphs_returned)).toBe(1);
      expect(estimateTokens(String(rendered.read.content))).toBeGreaterThan(DEFAULT_CONTENT_TOKEN_BUDGET);
      expect(rendered.read.warnings).toEqual([FIRST_NODE_BUDGET_WARNING]);
      expect(String(rendered.read.content)).toContain(rendered.opened.firstParaId);
      expect(String(rendered.read.content)).toContain('[^1]');
    });
  });

  test('oversized first paragraph with a footnote emits a budget warning in json format', async ({ when, then }: AllureBddContext) => {
    const rendered = await when('read_file returns an oversized first paragraph that also carries a footnote marker in json format', async () => {
      return readWithOversizedFirstNode({ format: 'json' });
    });

    await then('the JSON response remains intact and carries the warning', async () => {
      expect(Number(rendered.read.paragraphs_returned)).toBe(1);
      expect(estimateTokens(String(rendered.read.content))).toBeGreaterThan(DEFAULT_CONTENT_TOKEN_BUDGET);
      expect(rendered.read.warnings).toEqual([FIRST_NODE_BUDGET_WARNING]);
      const parsed = JSON.parse(String(rendered.read.content));
      expect(parsed).toHaveLength(1);
      expect(String(parsed[0].text)).toContain('[^1]');
    });
  });

  test('explicit limit disables the first-node overflow warning even when the paragraph has a footnote', async ({ when, then }: AllureBddContext) => {
    const rendered = await when('a caller provides an explicit limit for the oversized first-node read', async () => {
      return readWithOversizedFirstNode({ format: 'toon', limit: 1 });
    });

    await then('the oversized content is returned without the budget warning', async () => {
      expect(Number(rendered.read.paragraphs_returned)).toBe(1);
      expect(estimateTokens(String(rendered.read.content))).toBeGreaterThan(DEFAULT_CONTENT_TOKEN_BUDGET);
      expect(rendered.read.warnings).toBeUndefined();
    });
  });
});
