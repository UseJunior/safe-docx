import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { addFootnote } from './add_footnote.js';
import { getFootnotes } from './get_footnotes.js';
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

  test('a paragraph whose only content is a footnote reference is surfaced in the document view (#185)', async ({ given, when, then, and }: AllureBddContext) => {
    const W_DOC_OPEN = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      W_DOC_OPEN +
      `<w:body>` +
      `<w:p><w:r><w:t>Body before the note.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>` +
      `<w:p><w:r><w:t>Body after the note.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const footnotesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:id="1"><w:p><w:r><w:t>Drafting guidance lives here.</w:t></w:r></w:p></w:footnote>` +
      `</w:footnotes>`;

    let opened: Awaited<ReturnType<typeof openSession>>;
    let anchorId: string;
    let nodes: Array<{ id: string; text: string; clean_text: string }>;

    await given('a document whose middle paragraph contains only a footnote reference run', async () => {
      opened = await openSession([], {
        xml: documentXml,
        extraFiles: { 'word/footnotes.xml': footnotesXml },
      });
      const notes = await getFootnotes(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(notes, 'get_footnotes');
      const all = notes.footnotes as Array<{ id: number; anchored_paragraph_id: string | null }>;
      expect(all).toHaveLength(1);
      expect(all[0]!.anchored_paragraph_id).not.toBeNull();
      anchorId = all[0]!.anchored_paragraph_id!;
    });

    await when('read_file renders the full document as JSON', async () => {
      const read = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
      assertSuccess(read, 'read_file');
      nodes = JSON.parse(String(read.content));
    });

    await then('the footnote-only paragraph appears in the view with its marker', async () => {
      expect(nodes).toHaveLength(3);
      const anchorNode = nodes.find((n) => n.id === anchorId);
      expect(anchorNode).toBeDefined();
      // The node is pure marker: the view renders the footnote reference and
      // nothing else. The optional second [^1] tolerates the pre-existing
      // marker doubling (view-level injection + read_file suffix, #382)
      // without letting zero or triple markers pass.
      expect(anchorNode!.text).toMatch(/^\[\^1\](?:\[\^1\])?$/);
      expect(anchorNode!.clean_text).toBe('[^1]');
    });

    await and('a node_ids probe for the anchor paragraph resolves it', async () => {
      const probe = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        format: 'json',
        node_ids: [anchorId],
      });
      assertSuccess(probe, 'read_file node_ids probe');
      const probed = JSON.parse(String(probe.content));
      expect(probed).toHaveLength(1);
      expect(probed[0].id).toBe(anchorId);
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
