import { describe, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { addFootnote } from './add_footnote.js';
import { getFootnotes } from './get_footnotes.js';
import { openDocument } from './open_document.js';
import { DEFAULT_CONTENT_TOKEN_BUDGET, estimateTokens } from './pagination.js';
import { readFile } from './read_file.js';

const TEST_FEATURE = 'add-read-file-inline-footnotes';
const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NVCA_SOURCE = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');

type InlineFootnote = { id: number; display_number: number; text: string };
type JsonNode = {
  id: string;
  text: string;
  clean_text: string;
  footnote_refs?: Array<{ id: number; display: number }>;
  footnotes?: InlineFootnote[];
};

function parseNodes(read: Record<string, unknown>): JsonNode[] {
  return JSON.parse(String(read.content)) as JsonNode[];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

async function openTwoFootnoteFixture() {
  const opened = await openSession(['First anchor paragraph.', 'Middle paragraph.', 'Last anchor paragraph.']);
  const first = await addFootnote(opened.mgr, {
    file_path: opened.inputPath,
    target_paragraph_id: opened.paraIds[0],
    text: 'First drafting note.',
  });
  assertSuccess(first, 'add_footnote');
  const second = await addFootnote(opened.mgr, {
    file_path: opened.inputPath,
    target_paragraph_id: opened.paraIds[2],
    text: 'Second drafting note.',
  });
  assertSuccess(second, 'add_footnote');
  return opened;
}

async function openNvcaSession() {
  const mgr = createTestSessionManager();
  const open = await openDocument(mgr, { file_path: NVCA_SOURCE });
  expect(open.success).toBe(true);
  const filePath = String(open.file_path ?? NVCA_SOURCE);
  return { mgr, filePath };
}

async function walkNvcaJsonNodes(
  mgr: ReturnType<typeof createTestSessionManager>,
  filePath: string,
): Promise<JsonNode[]> {
  const CHUNK = 400;
  const nodes: JsonNode[] = [];
  let offset = 1;
  let total = Number.POSITIVE_INFINITY;
  while (offset <= total) {
    const read = await readFile(mgr, {
      file_path: filePath,
      format: 'json',
      include_footnotes: true,
      offset,
      limit: CHUNK,
    });
    assertSuccess(read, 'read_file');
    total = Number(read.total_paragraphs);
    const page = parseNodes(read);
    if (page.length === 0) break;
    nodes.push(...page);
    offset += CHUNK;
  }
  expect(nodes.length).toBe(total);
  return nodes;
}

describe('OpenSpec traceability: add-read-file-inline-footnotes (read_file tool)', () => {
  registerCleanup();

  test.openspec('include_footnotes attaches anchored footnote bodies to json paragraph nodes')(
    'include_footnotes attaches anchored footnote bodies to json paragraph nodes',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with footnotes on the first and last paragraphs', async () =>
        openTwoFootnoteFixture());

      const nodes = await when('read_file renders the document as json with include_footnotes', async () => {
        const read = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(read, 'read_file');
        return parseNodes(read);
      });

      await then('anchoring nodes carry the footnote bodies and the bare node carries none', async () => {
        expect(nodes).toHaveLength(3);
        // add_footnote stores the body with Word's conventional leading space
        // after the reference mark, so match on the substantive text.
        expect(nodes[0]!.footnotes).toEqual([
          { id: expect.any(Number), display_number: 1, text: expect.stringContaining('First drafting note.') },
        ]);
        expect(nodes[2]!.footnotes).toEqual([
          { id: expect.any(Number), display_number: 2, text: expect.stringContaining('Second drafting note.') },
        ]);
        expect('footnotes' in nodes[1]!).toBe(false);
      });
    },
  );

  test.openspec('include_footnotes defaults off and existing json output is unchanged')(
    'include_footnotes defaults off and existing json output is unchanged',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with footnotes on the first and last paragraphs', async () =>
        openTwoFootnoteFixture());

      const nodes = await when('read_file renders the document as json without the flag', async () => {
        const read = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
        assertSuccess(read, 'read_file');
        return parseNodes(read);
      });

      await then('no node carries a footnotes key', async () => {
        expect(nodes).toHaveLength(3);
        for (const node of nodes) {
          expect('footnotes' in node).toBe(false);
        }
      });
    },
  );

  test.openspec('a paginated json walk returns each inline footnote exactly once')(
    'a paginated json walk returns each inline footnote exactly once',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with footnotes on the first and last paragraphs', async () =>
        openTwoFootnoteFixture());

      const pages = await when('the document is read as three single-paragraph json slices', async () => {
        const slices: JsonNode[][] = [];
        for (let offset = 1; offset <= 3; offset++) {
          const read = await readFile(opened.mgr, {
            file_path: opened.inputPath,
            format: 'json',
            include_footnotes: true,
            offset,
            limit: 1,
          });
          assertSuccess(read, 'read_file');
          slices.push(parseNodes(read));
        }
        return slices;
      });

      await then('each footnote appears only on the page anchoring it', async () => {
        expect(pages[0]![0]!.footnotes?.map((f) => f.text.trim())).toEqual(['First drafting note.']);
        expect('footnotes' in pages[1]![0]!).toBe(false);
        expect(pages[2]![0]!.footnotes?.map((f) => f.text.trim())).toEqual(['Second drafting note.']);
        const inlineTexts = pages.flat().flatMap((node) => node.footnotes ?? []).map((f) => f.text.trim());
        expect(inlineTexts.sort()).toEqual(['First drafting note.', 'Second drafting note.']);
      });
    },
  );

  test.openspec('inline footnote payload counts toward the read token budget')(
    'inline footnote payload counts toward the read token budget',
    async ({ given, when, then, and }: AllureBddContext) => {
      const opened = await given('a small paragraph anchoring a footnote far larger than the read budget', async () => {
        const session = await openSession(['Anchor paragraph.', 'Second paragraph.']);
        const note = await addFootnote(session.mgr, {
          file_path: session.inputPath,
          target_paragraph_id: session.firstParaId,
          text: 'F'.repeat(80_000),
        });
        assertSuccess(note, 'add_footnote');
        return session;
      });

      const reads = await when('budgeted json reads run with and without include_footnotes', async () => {
        const withFootnotes = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(withFootnotes, 'read_file include_footnotes');
        const withoutFootnotes = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
        assertSuccess(withoutFootnotes, 'read_file baseline');
        return { withFootnotes, withoutFootnotes };
      });

      await then('the footnote payload pushes the read over budget and truncates the slice', async () => {
        expect(Number(reads.withFootnotes.paragraphs_returned)).toBe(1);
        expect(reads.withFootnotes.has_more).toBe(true);
        expect(reads.withFootnotes.warnings).toEqual(['budget_exceeded_by_first_node']);
        expect(estimateTokens(String(reads.withFootnotes.content))).toBeGreaterThan(DEFAULT_CONTENT_TOKEN_BUDGET);
        const nodes = parseNodes(reads.withFootnotes);
        expect(nodes[0]!.footnotes?.[0]?.text.trim()).toHaveLength(80_000);
      });

      await and('the same read without the flag fits both paragraphs in one page', async () => {
        expect(Number(reads.withoutFootnotes.paragraphs_returned)).toBe(2);
        expect(reads.withoutFootnotes.has_more).toBeFalsy();
      });
    },
  );

  test.openspec('scaffolding and orphaned footnotes are excluded from inline output')(
    'scaffolding and orphaned footnotes are excluded from inline output',
    async ({ given, when, then, and }: AllureBddContext) => {
      const documentXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p><w:r><w:t>Anchor sentence.</w:t></w:r>` +
        `<w:r><w:footnoteReference w:id="1"/></w:r>` +
        `<w:r><w:footnoteReference w:id="2"/></w:r></w:p>` +
        `</w:body></w:document>`;
      const footnotesXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Real drafting note.</w:t></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="2"><w:p/></w:footnote>` +
        `<w:footnote w:id="3"><w:p><w:r><w:t>Orphaned note.</w:t></w:r></w:p></w:footnote>` +
        `</w:footnotes>`;

      const opened = await given('a footnotes part with one real, one empty-body, and one orphaned note', async () =>
        openSession([], { xml: documentXml, extraFiles: { 'word/footnotes.xml': footnotesXml } }));

      const nodes = await when('read_file renders the document as json with include_footnotes', async () => {
        const read = await readFile(opened.mgr, {
          file_path: opened.inputPath,
          format: 'json',
          include_footnotes: true,
        });
        assertSuccess(read, 'read_file');
        return parseNodes(read);
      });

      await then('only the real anchored note attaches inline', async () => {
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.footnotes).toEqual([{ id: 1, display_number: 1, text: 'Real drafting note.' }]);
      });

      await and('get_footnotes still enumerates the empty and orphaned notes', async () => {
        const listing = await getFootnotes(opened.mgr, { file_path: opened.inputPath });
        assertSuccess(listing, 'get_footnotes');
        const all = listing.footnotes as Array<{ id: number; text: string; anchored_paragraph_id: string | null }>;
        expect(all.map((f) => f.id).sort()).toEqual([1, 2, 3]);
        const orphan = all.find((f) => f.id === 3)!;
        expect(orphan.anchored_paragraph_id).toBeNull();
        const empty = all.find((f) => f.id === 2)!;
        expect(empty.text.trim()).toBe('');
      });
    },
  );

  test.openspec('include_footnotes has no effect on toon and simple output')(
    'include_footnotes has no effect on toon and simple output',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a document with footnotes on the first and last paragraphs', async () =>
        openTwoFootnoteFixture());

      const rendered = await when('toon and simple reads run with and without include_footnotes', async () => {
        const out: Record<string, string> = {};
        for (const format of ['toon', 'simple'] as const) {
          for (const flag of [true, false]) {
            const read = await readFile(opened.mgr, {
              file_path: opened.inputPath,
              format,
              include_footnotes: flag,
            });
            assertSuccess(read, 'read_file');
            out[`${format}:${flag}`] = String(read.content);
          }
        }
        return out;
      });

      await then('the rendered content is byte-identical with and without the flag', async () => {
        expect(rendered['toon:true']).toBe(rendered['toon:false']);
        expect(rendered['simple:true']).toBe(rendered['simple:false']);
        expect(rendered['toon:true']).not.toContain('"footnotes"');
      });
    },
  );

  test.openspec('footnote markers stay single-rendered when bodies are inlined')(
    'footnote markers stay single-rendered when bodies are inlined',
    async ({ given, when, then }: AllureBddContext) => {
      const nvca = await given('the NVCA SPA regression fixture', async () => openNvcaSession());

      const nodes = await when('the full document is walked as json with include_footnotes', async () =>
        walkNvcaJsonNodes(nvca.mgr, nvca.filePath));

      await then('every marker derived from footnote_refs renders exactly once per field', async () => {
        const nodesWithRefs = nodes.filter((node) => (node.footnote_refs?.length ?? 0) > 0);
        expect(nodesWithRefs.length).toBeGreaterThan(50);
        let inlineReferenceSeen = false;
        for (const node of nodesWithRefs) {
          const expectedByDisplay = new Map<number, number>();
          for (const ref of node.footnote_refs!) {
            expectedByDisplay.set(ref.display, (expectedByDisplay.get(ref.display) ?? 0) + 1);
          }
          for (const [display, expected] of expectedByDisplay) {
            const marker = `[^${display}]`;
            expect(countOccurrences(node.text, marker)).toBe(expected);
            expect(countOccurrences(node.clean_text, marker)).toBe(expected);
            const markerIndex = node.text.indexOf(marker);
            if (markerIndex !== -1 && markerIndex + marker.length < node.text.length) {
              inlineReferenceSeen = true;
            }
          }
        }
        // The duplicate-marker bug (#382) only manifested on paragraphs whose
        // references sit mid-text, so the guard is vacuous unless the fixture
        // actually exercises that shape.
        expect(inlineReferenceSeen).toBe(true);
      });
    },
  );

  test.openspec('the NVCA fixture round-trips all anchored footnotes inline')(
    'the NVCA fixture round-trips all anchored footnotes inline',
    async ({ given, when, then }: AllureBddContext) => {
      const nvca = await given('the NVCA SPA regression fixture', async () => openNvcaSession());

      const collected = await when('get_footnotes and a full include_footnotes walk both run', async () => {
        const listing = await getFootnotes(nvca.mgr, { file_path: nvca.filePath });
        assertSuccess(listing, 'get_footnotes');
        const all = listing.footnotes as Array<{
          id: number;
          display_number: number;
          text: string;
          anchored_paragraph_id: string | null;
        }>;
        const nodes = await walkNvcaJsonNodes(nvca.mgr, nvca.filePath);
        return { all, nodes };
      });

      await then('the inline union equals the eligible set, each footnote exactly once', async () => {
        const eligibleIds = collected.all
          .filter((f) => f.display_number > 0 && f.text.trim().length > 0 && f.anchored_paragraph_id != null)
          .map((f) => f.id)
          .sort((a, b) => a - b);
        expect(eligibleIds.length).toBeGreaterThanOrEqual(100);

        const inlineIds = collected.nodes
          .flatMap((node) => node.footnotes ?? [])
          .map((f) => f.id)
          .sort((a, b) => a - b);
        expect(inlineIds).toEqual(eligibleIds);
      });
    },
  );
});
