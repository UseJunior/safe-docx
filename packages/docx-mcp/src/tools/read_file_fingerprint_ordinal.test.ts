import { describe, expect, vi } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { readFile } from './read_file.js';
import { dispatchToolCall } from '../server.js';
import { SessionManager } from '../session/manager.js';

const TEST_FEATURE = 'add-read-file-fingerprint-ordinal';

type JsonNode = Record<string, unknown>;

function parseNodes(content: unknown): JsonNode[] {
  return JSON.parse(String(content)) as JsonNode[];
}

describe('add-read-file-fingerprint-ordinal — Optional Fingerprint Ordinal Disambiguation on read_file JSON', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });

  registerCleanup();

  test.openspec('opt-in ordinal adds disambiguation fields on JSON output')(
    'opt-in ordinal adds disambiguation fields on JSON output',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['First paragraph.', 'Second paragraph.'], { mgr }),
      );

      const nodes = await when(
        'read_file is called with include_fingerprint and include_fingerprint_ordinal',
        async () => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'json',
            include_fingerprint: true,
            include_fingerprint_ordinal: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          return parseNodes(result.content);
        },
      );

      await then(
        'each node carries integer content_fingerprint_ordinal/count and a portable_paragraph_ref',
        async () => {
          expect(nodes.length).toBeGreaterThan(0);
          for (const node of nodes) {
            expect(Number.isInteger(node.content_fingerprint_ordinal)).toBe(true);
            expect(Number.isInteger(node.content_fingerprint_count_in_document)).toBe(true);
            expect(node.portable_paragraph_ref).toBe(
              `${node.content_fingerprint}#${node.content_fingerprint_ordinal}`,
            );
          }
        },
      );
    },
  );

  test.openspec('unique paragraph fingerprint reports ordinal 1 and count 1')(
    'unique paragraph fingerprint reports ordinal 1 and count 1',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session with all-distinct paragraphs', () =>
        openSession(['Alpha clause.', 'Beta clause.', 'Gamma clause.'], { mgr }),
      );

      const nodes = await when('reading with ordinal disambiguation enabled', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'json',
          include_fingerprint: true,
          include_fingerprint_ordinal: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return parseNodes(result.content);
      });

      await then('every paragraph reports ordinal 1 and count 1', async () => {
        for (const node of nodes) {
          expect(node.content_fingerprint_ordinal).toBe(1);
          expect(node.content_fingerprint_count_in_document).toBe(1);
        }
      });
    },
  );

  test.openspec('duplicate normalized text receives deterministic document-order ordinals')(
    'duplicate normalized text receives deterministic document-order ordinals',
    async ({ given, when, then }: AllureBddContext) => {
      const dup = 'WHEREAS the parties agree.';
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session with the same text three times', () =>
        openSession([dup, 'Filler one.', dup, 'Filler two.', dup], { mgr }),
      );

      const nodes = await when('reading with ordinal disambiguation enabled', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'json',
          include_fingerprint: true,
          include_fingerprint_ordinal: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return parseNodes(result.content);
      });

      await then('the duplicates get ordinals 1,2,3 in document order with count 3', async () => {
        const dupFp = nodes[0]!.content_fingerprint;
        const dupNodes = nodes.filter((n) => n.content_fingerprint === dupFp);
        expect(dupNodes.map((n) => n.content_fingerprint_ordinal)).toEqual([1, 2, 3]);
        for (const node of dupNodes) {
          expect(node.content_fingerprint_count_in_document).toBe(3);
        }
      });
    },
  );

  test.openspec('whitespace-only variants share fingerprint and get distinct ordinals')(
    'whitespace-only variants share fingerprint and get distinct ordinals',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      // Same words; the second copy has a collapsible double space. The
      // fingerprint algorithm collapses runs of whitespace, so both hash equal.
      const { filePath } = await given('a DOCX with two whitespace-variant paragraphs', () =>
        openSession(['Reserved section text.', 'Reserved section  text.'], { mgr }),
      );

      const nodes = await when('reading with ordinal disambiguation enabled', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'json',
          include_fingerprint: true,
          include_fingerprint_ordinal: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return parseNodes(result.content);
      });

      await then('they share one fingerprint and receive ordinals 1 and 2', async () => {
        expect(nodes[0]!.content_fingerprint).toBe(nodes[1]!.content_fingerprint);
        expect(nodes[0]!.content_fingerprint_ordinal).toBe(1);
        expect(nodes[1]!.content_fingerprint_ordinal).toBe(2);
        expect(nodes[0]!.content_fingerprint_count_in_document).toBe(2);
      });
    },
  );

  test.openspec('ordinal fields require include_fingerprint')(
    'ordinal fields require include_fingerprint',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Only paragraph.'], { mgr }),
      );

      const nodes = await when(
        'reading with include_fingerprint_ordinal but no include_fingerprint',
        async () => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'json',
            include_fingerprint_ordinal: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          return parseNodes(result.content);
        },
      );

      await then('no ordinal disambiguation fields are emitted', async () => {
        for (const node of nodes) {
          expect(node.content_fingerprint_ordinal).toBeUndefined();
          expect(node.content_fingerprint_count_in_document).toBeUndefined();
          expect(node.portable_paragraph_ref).toBeUndefined();
        }
      });
    },
  );

  test.openspec('portable_paragraph_ref composes fingerprint and ordinal')(
    'portable_paragraph_ref composes fingerprint and ordinal',
    async ({ given, when, then }: AllureBddContext) => {
      const dup = 'Identical recital text.';
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session with a duplicated paragraph', () =>
        openSession([dup, dup], { mgr }),
      );

      const nodes = await when('reading with ordinal disambiguation enabled', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'json',
          include_fingerprint: true,
          include_fingerprint_ordinal: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return parseNodes(result.content);
      });

      await then('portable_paragraph_ref equals "<fingerprint>#<ordinal>"', async () => {
        expect(nodes[0]!.portable_paragraph_ref).toBe(`${nodes[0]!.content_fingerprint}#1`);
        expect(nodes[1]!.portable_paragraph_ref).toBe(`${nodes[1]!.content_fingerprint}#2`);
      });
    },
  );

  test.openspec('counts are document-wide across paginated windows')(
    'counts are document-wide across paginated windows',
    async ({ given, when, then }: AllureBddContext) => {
      const dup = 'Repeated boilerplate clause.';
      const mgr = createTestSessionManager();
      const opened = await given('a DOCX with a paragraph repeated three times', () =>
        openSession([dup, 'Middle one.', dup, 'Middle two.', dup], { mgr }),
      );

      const node = await when(
        'reading only the third duplicate via node_ids',
        async () => {
          const thirdDupId = opened.paraIds[4]!;
          const result = await readFile(mgr, {
            file_path: opened.filePath,
            format: 'json',
            include_fingerprint: true,
            include_fingerprint_ordinal: true,
            node_ids: [thirdDupId],
          });
          assertSuccess(result, 'read');
          const nodes = parseNodes(result.content);
          expect(nodes.length).toBe(1);
          return nodes[0]!;
        },
      );

      await then(
        'the windowed node reports document-order ordinal 3 and document-wide count 3',
        async () => {
          expect(node.content_fingerprint_ordinal).toBe(3);
          expect(node.content_fingerprint_count_in_document).toBe(3);
        },
      );
    },
  );

  test.openspec('default JSON output omits ordinal fields')(
    'default JSON output omits ordinal fields',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Some text.'], { mgr }),
      );

      const nodes = await when(
        'reading with include_fingerprint but no include_fingerprint_ordinal',
        async () => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'json',
            include_fingerprint: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          return parseNodes(result.content);
        },
      );

      await then('content_fingerprint is present but the ordinal fields are not', async () => {
        for (const node of nodes) {
          expect(typeof node.content_fingerprint).toBe('string');
          expect(node.content_fingerprint_ordinal).toBeUndefined();
          expect(node.content_fingerprint_count_in_document).toBeUndefined();
          expect(node.portable_paragraph_ref).toBeUndefined();
        }
      });
    },
  );

  test.openspec('TOON format ignores include_fingerprint_ordinal')(
    'TOON format ignores include_fingerprint_ordinal',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Alpha.', 'Alpha.'], { mgr }),
      );

      const baseline = await when('reading TOON with no fingerprint flags', async () => {
        const result = await readFile(mgr, { file_path: filePath, format: 'toon', limit: 100 });
        assertSuccess(result, 'read');
        return String(result.content);
      });

      const withFlags = await when(
        'reading TOON with include_fingerprint and include_fingerprint_ordinal',
        async () => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'toon',
            include_fingerprint: true,
            include_fingerprint_ordinal: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          return String(result.content);
        },
      );

      await then('TOON output is byte-identical', async () => {
        expect(withFlags).toBe(baseline);
      });
    },
  );

  test.openspec('simple format ignores include_fingerprint_ordinal')(
    'simple format ignores include_fingerprint_ordinal',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Alpha.', 'Alpha.'], { mgr }),
      );

      const baseline = await when('reading simple with no fingerprint flags', async () => {
        const result = await readFile(mgr, { file_path: filePath, format: 'simple', limit: 100 });
        assertSuccess(result, 'read');
        return String(result.content);
      });

      const withFlags = await when(
        'reading simple with include_fingerprint and include_fingerprint_ordinal',
        async () => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'simple',
            include_fingerprint: true,
            include_fingerprint_ordinal: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          return String(result.content);
        },
      );

      await then('simple output is byte-identical', async () => {
        expect(withFlags).toBe(baseline);
      });
    },
  );

  test.openspec('Google Docs ignores include_fingerprint_ordinal')(
    'Google Docs ignores include_fingerprint_ordinal',
    async ({ given, when, then }: AllureBddContext) => {
      // The gdocs read_file handler is a separate code path that builds its own
      // nodes; the disambiguation flag must not error and must not add any
      // ordinal fields. Mocks mirror the gdocs fingerprint test so this needs no
      // real Google Docs credentials.
      let manager: SessionManager;

      await given('a mocked Google Docs session', async () => {
        vi.doMock('@usejunior/google-docs-core', () => ({
          buildDocumentViewNodes: (paragraphs: any[]) =>
            paragraphs.map((p: any) => ({
              id: p.anchorId,
              list_label: '',
              header: '',
              style: 'body',
              text: p.text,
              clean_text: p.text,
              tagged_text: p.text,
              list_metadata: {
                list_level: -1,
                label_type: null,
                label_string: '',
                header_text: null,
                header_style: null,
                header_formatting: null,
                is_auto_numbered: false,
              },
              style_fingerprint: {
                list_level: -1,
                left_indent_pt: 0,
                first_line_indent_pt: 0,
                style_name: 'body',
                alignment: 'LEFT',
              },
              paragraph_style_id: null,
              paragraph_style_name: 'body',
              paragraph_alignment: 'LEFT',
              paragraph_indents_pt: { left: 0, first_line: 0 },
              numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
              header_formatting: null,
              body_run_formatting: null,
            })),
          buildParagraphStyleRequest: vi.fn(),
          GoogleDocsDocument: { load: vi.fn() },
          isToolSupported: (provider: string, tool: string) =>
            provider === 'gdocs' && tool === 'read_file',
          PROVIDER_CAPABILITIES: { gdocs: new Set(['read_file']) },
        }));
        vi.doMock('../gdocs_loader.js', () => ({
          loadGDocsCore: vi.fn(async () => await import('@usejunior/google-docs-core')),
        }));

        manager = new SessionManager({ ttlMs: 60_000 });
        const mockParagraphs = [
          {
            paragraphId: 'p1',
            anchorName: '_bk_0',
            anchorId: 't.0:_bk_0',
            startIndex: 1,
            endIndex: 20,
            tabId: 't.0',
            text: 'Repeated line',
            inTable: false,
          },
          {
            paragraphId: 'p2',
            anchorName: '_bk_1',
            anchorId: 't.0:_bk_1',
            startIndex: 21,
            endIndex: 40,
            tabId: 't.0',
            text: 'Repeated line',
            inTable: false,
          },
        ];
        const mockDoc = {
          getParagraphs: vi.fn(() => mockParagraphs),
          getParagraphTextById: vi.fn(),
          getParagraphByAnchorId: vi.fn(),
          replaceText: vi.fn(),
          insertParagraph: vi.fn(),
          executeBatchUpdate: vi.fn(),
          exportAsDocx: vi.fn(),
          getDocId: vi.fn(() => 'gdocs-test-id'),
          getRevisionId: vi.fn(() => 'rev_xyz'),
          getEditCount: vi.fn(() => 0),
          getEditRevision: vi.fn(() => 0),
          getTabs: vi.fn(() => [{ tabId: 't.0', title: 'Tab 1', index: 0 }]),
          getDefaultTabId: vi.fn(() => 't.0'),
          isRevisionFresh: vi.fn(() => true),
          getCache: vi.fn(() => null),
          markEdited: vi.fn(),
          injectAnchors: vi.fn(),
        };
        manager.createGDocsSession('gdocs-test-id', mockDoc as any);
      });

      const result = await when(
        'dispatching read_file with google_doc_id and both fingerprint flags',
        async () => {
          return dispatchToolCall(manager!, 'read_file', {
            google_doc_id: 'gdocs-test-id',
            format: 'json',
            include_fingerprint: true,
            include_fingerprint_ordinal: true,
            limit: 100,
          });
        },
      );

      await then('the call succeeds and gdocs nodes carry no ordinal fields', async () => {
        expect(result.success, JSON.stringify((result as any).error)).toBe(true);
        const nodes = parseNodes((result as any).content);
        expect(nodes.length).toBeGreaterThan(0);
        for (const node of nodes) {
          expect(node.content_fingerprint_ordinal).toBeUndefined();
          expect(node.content_fingerprint_count_in_document).toBeUndefined();
          expect(node.portable_paragraph_ref).toBeUndefined();
        }
      });

      vi.doUnmock('@usejunior/google-docs-core');
      vi.doUnmock('../gdocs_loader.js');
    },
  );
});
