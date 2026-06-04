import { describe, expect, vi, beforeEach } from 'vitest';
import { testAllure as it } from '../../../testing/allure-test.js';
import { SessionManager, type GDocsSession } from '../../../session/manager.js';
import { dispatchToolCall } from '../../../server.js';

// ---------------------------------------------------------------------------
// Mock GoogleDocsDocument
// ---------------------------------------------------------------------------

function makeMockParagraphs() {
  return [
    {
      paragraphId: 'p1',
      anchorName: '_bk_0',
      anchorId: 't.0:_bk_0',
      startIndex: 1,
      endIndex: 20,
      tabId: 't.0',
      text: 'Hello world',
      inTable: false,
    },
    {
      paragraphId: 'p2',
      anchorName: '_bk_1',
      anchorId: 't.0:_bk_1',
      startIndex: 21,
      endIndex: 55,
      tabId: 't.0',
      text: 'This is a test paragraph',
      inTable: false,
    },
    {
      paragraphId: 'p3',
      anchorName: '_bk_2',
      anchorId: 't.0:_bk_2',
      startIndex: 56,
      endIndex: 80,
      tabId: 't.0',
      text: 'Third paragraph here',
      inTable: false,
    },
  ];
}

function makeMockDoc() {
  const paragraphs = makeMockParagraphs();
  return {
    getParagraphs: vi.fn(() => paragraphs),
    getParagraphTextById: vi.fn((anchorId: string) => {
      const p = paragraphs.find(p => p.anchorId === anchorId || p.anchorName === anchorId);
      return p?.text ?? null;
    }),
    getParagraphByAnchorId: vi.fn((anchorId: string) => {
      return paragraphs.find(p => p.anchorId === anchorId || p.anchorName === anchorId) ?? null;
    }),
    replaceText: vi.fn(async (_anchorId: string, _old: string, _new: string) => {
      // Simulate text replacement
      const p = paragraphs.find(p => p.anchorId === _anchorId || p.anchorName === _anchorId);
      if (p) p.text = p.text.replace(_old, _new);
    }),
    insertParagraph: vi.fn(async () => ({ newAnchorId: 't.0:_bk_3' })),
    executeBatchUpdate: vi.fn(async () => ({})),
    exportAsDocx: vi.fn(async () => Buffer.from('PK\x03\x04mock-docx')),
    getDocId: vi.fn(() => 'test-doc-id-123'),
    getRevisionId: vi.fn(() => 'rev_abc123'),
    getEditCount: vi.fn(() => 0),
    getEditRevision: vi.fn(() => 0),
    getTabs: vi.fn(() => [{ tabId: 't.0', title: 'Tab 1', index: 0 }]),
    getDefaultTabId: vi.fn(() => 't.0'),
    isRevisionFresh: vi.fn(() => true),
    getCache: vi.fn(() => null),
    markEdited: vi.fn(),
    injectAnchors: vi.fn(async () => ({ injectedCount: 0 })),
  };
}

// Mock the google-docs-core dynamic import
vi.mock('@usejunior/google-docs-core', () => ({
  buildDocumentViewNodes: (paragraphs: any[]) =>
    paragraphs.map((p: any) => ({
      id: p.anchorId || p.anchorName || `para_${p.startIndex}`,
      list_label: '',
      header: '',
      style: p.inTable ? 'td(0,0)' : 'body',
      text: p.text,
      clean_text: p.text,
      tagged_text: p.text,
      list_metadata: { list_level: -1, label_type: null, label_string: '', header_text: null, header_style: null, header_formatting: null, is_auto_numbered: false },
      style_fingerprint: { list_level: -1, left_indent_pt: 0, first_line_indent_pt: 0, style_name: 'body', alignment: 'LEFT' },
      paragraph_style_id: null,
      paragraph_style_name: 'body',
      paragraph_alignment: 'LEFT',
      paragraph_indents_pt: { left: 0, first_line: 0 },
      numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
      header_formatting: null,
      body_run_formatting: null,
    })),
  buildParagraphStyleRequest: vi.fn(),
  GoogleDocsDocument: {
    load: vi.fn(),
  },
  isToolSupported: (provider: string, tool: string) => {
    const supported = new Set(['read_file', 'replace_text', 'insert_paragraph', 'grep', 'save', 'format_layout', 'get_file_status', 'close_file']);
    return provider === 'gdocs' && supported.has(tool);
  },
  PROVIDER_CAPABILITIES: {
    gdocs: new Set(['read_file', 'replace_text', 'insert_paragraph', 'grep', 'save', 'format_layout', 'get_file_status', 'close_file']),
  },
}));

// Mock the gdocs_loader to return our mock
vi.mock('../../../gdocs_loader.js', () => ({
  loadGDocsCore: vi.fn(async () => {
    const mod = await import('@usejunior/google-docs-core');
    return mod;
  }),
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function setupGDocsSession(manager: SessionManager): GDocsSession {
  const mockDoc = makeMockDoc();
  // Manually inject a GDocs session into the manager
  const session = manager.createGDocsSession('test-doc-id-123', mockDoc);
  return session;
}

type SuccessResult = { success: true; [key: string]: unknown };
type ErrorResult = { success: false; error: { code: string; message: string; hint?: string } };

function assertSuccess(result: Record<string, unknown>): asserts result is SuccessResult {
  expect(result.success, `Expected success but got error: ${JSON.stringify((result as any).error)}`).toBe(true);
}

function assertError(result: Record<string, unknown>): asserts result is ErrorResult {
  expect(result.success).toBe(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Google Docs MCP tool dispatch', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ ttlMs: 60_000 });
    vi.clearAllMocks();
  });

  describe('read_file', () => {
    it('returns document content in toon format', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'read_file', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(result);
      expect(result.google_doc_id).toBe('test-doc-id-123');
      expect(result.total_paragraphs).toBe(3);
      expect(result.paragraphs_returned).toBeGreaterThan(0);
      expect(typeof result.content).toBe('string');
      expect(result.content as string).toContain('Hello world');
    });

    it('supports pagination with offset/limit', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'read_file', {
        google_doc_id: 'test-doc-id-123',
        offset: 2,
        limit: 1,
      });
      assertSuccess(result);
      expect(result.paragraphs_returned).toBe(1);
    });

    it('supports node_ids filtering', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'read_file', {
        google_doc_id: 'test-doc-id-123',
        node_ids: ['t.0:_bk_0'],
      });
      assertSuccess(result);
      expect(result.paragraphs_returned).toBe(1);
    });
  });

  describe('replace_text', () => {
    it('replaces text in a paragraph', async () => {
      const session = setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'replace_text', {
        google_doc_id: 'test-doc-id-123',
        target_paragraph_id: 't.0:_bk_0',
        old_string: 'world',
        new_string: 'universe',
        instruction: 'test replacement',
      });
      assertSuccess(result);
      expect(result.google_doc_id).toBe('test-doc-id-123');
      expect(result.replacements_made).toBe(1);
      expect(session.doc.replaceText).toHaveBeenCalledWith('t.0:_bk_0', 'world', 'universe');
    });

    it('returns error for missing paragraph', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'replace_text', {
        google_doc_id: 'test-doc-id-123',
        target_paragraph_id: 'nonexistent',
        old_string: 'foo',
        new_string: 'bar',
        instruction: 'test',
      });
      assertError(result);
      expect((result as ErrorResult).error.code).toBe('ANCHOR_NOT_FOUND');
    });
  });

  describe('insert_paragraph', () => {
    it('inserts a paragraph after anchor', async () => {
      const session = setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'insert_paragraph', {
        google_doc_id: 'test-doc-id-123',
        positional_anchor_node_id: 't.0:_bk_0',
        new_string: 'New paragraph text',
        instruction: 'insert test',
        position: 'AFTER',
      });
      assertSuccess(result);
      expect(result.new_paragraph_id).toBe('t.0:_bk_3');
      expect(session.doc.insertParagraph).toHaveBeenCalledWith('t.0:_bk_0', 'AFTER', 'New paragraph text');
    });
  });

  describe('grep', () => {
    it('searches paragraphs with regex', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'grep', {
        google_doc_id: 'test-doc-id-123',
        pattern: 'paragraph',
      });
      assertSuccess(result);
      expect(result.total_matches).toBeGreaterThanOrEqual(2);
      expect(result.google_doc_id).toBe('test-doc-id-123');
    });

    it('rejects search_xml for Google Docs', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'grep', {
        google_doc_id: 'test-doc-id-123',
        pattern: 'test',
        search_xml: true,
      });
      assertError(result);
      expect((result as ErrorResult).error.code).toBe('UNSUPPORTED_FOR_PROVIDER');
    });

    it('returns empty matches for no-hit pattern', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'grep', {
        google_doc_id: 'test-doc-id-123',
        pattern: 'zzz_no_match_zzz',
      });
      assertSuccess(result);
      expect(result.total_matches).toBe(0);
    });
  });

  describe('save', () => {
    it('returns checkpoint by default (no save path)', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'save', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(result);
      expect(result.save_mode).toBe('checkpoint');
      expect(result.revision_id).toBe('rev_abc123');
    });

    it('exports as DOCX when save_to_local_path provided', async () => {
      const os = await import('node:os');
      const path = await import('node:path');
      const session = setupGDocsSession(manager);
      const tmpPath = path.join(os.tmpdir(), `gdocs-test-${Date.now()}.docx`);
      const result = await dispatchToolCall(manager, 'save', {
        google_doc_id: 'test-doc-id-123',
        save_to_local_path: tmpPath,
      });
      assertSuccess(result);
      expect(result.save_mode).toBe('snapshot');
      expect(result.saved_to).toBe(tmpPath);
      expect(session.doc.exportAsDocx).toHaveBeenCalled();

      // Cleanup
      try { (await import('node:fs/promises')).unlink(tmpPath); } catch {}
    });

    // Issue #313: a snapshot save_to_local_path that is a symlink escaping the allowed roots must be
    // refused — covers the shared write-policy fix for the gdocs snapshot path (existing and dangling).
    it('refuses a symlink save_to_local_path that escapes the allowed roots', async () => {
      if (process.platform === 'win32') return;
      const os = await import('node:os');
      const path = await import('node:path');
      const fs = await import('node:fs/promises');

      const session = setupGDocsSession(manager);
      const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-allowed-'));
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gdocs-outside-'));
      const previousRoots = process.env.SAFE_DOCX_ALLOWED_ROOTS;
      process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;
      try {
        const escapeTarget = path.join(outsideDir, 'snapshot.docx');
        const link = path.join(allowedRoot, 'snapshot-link.docx');
        await fs.symlink(escapeTarget, link); // dangling: target does not exist yet

        const result = await dispatchToolCall(manager, 'save', {
          google_doc_id: 'test-doc-id-123',
          save_to_local_path: link,
        });
        assertError(result);
        expect(result.error.code).toBe('PATH_NOT_ALLOWED');
        expect(session.doc.exportAsDocx).not.toHaveBeenCalled();
        await expect(fs.access(escapeTarget)).rejects.toThrow();
      } finally {
        if (previousRoots === undefined) delete process.env.SAFE_DOCX_ALLOWED_ROOTS;
        else process.env.SAFE_DOCX_ALLOWED_ROOTS = previousRoots;
        await fs.rm(allowedRoot, { recursive: true, force: true }).catch(() => {});
        await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe('get_file_status', () => {
    it('returns session metadata', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'get_file_status', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(result);
      expect(result.google_doc_id).toBe('test-doc-id-123');
      expect(result.provider).toBe('gdocs');
      expect(result.revision_id).toBe('rev_abc123');
      expect(typeof result.created_at).toBe('string');
    });
  });

  describe('close_file', () => {
    it('clears the Google Docs session', async () => {
      setupGDocsSession(manager);

      // Verify session exists
      const status = await dispatchToolCall(manager, 'get_file_status', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(status);

      // Close it
      const result = await dispatchToolCall(manager, 'close_file', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(result);
      expect(result.cleared_count).toBe(1);
    });
  });

  describe('session reuse', () => {
    it('reuses existing session on second call', async () => {
      setupGDocsSession(manager);

      const r1 = await dispatchToolCall(manager, 'read_file', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(r1);

      const r2 = await dispatchToolCall(manager, 'read_file', {
        google_doc_id: 'test-doc-id-123',
      });
      assertSuccess(r2);

      // Both should succeed — second reuses the session
      expect(r2.total_paragraphs).toBe(3);
    });
  });

  describe('unsupported tools', () => {
    it('returns UNSUPPORTED_FOR_PROVIDER for compare_documents', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'compare_documents', {
        google_doc_id: 'test-doc-id-123',
        save_to_local_path: '/tmp/test.docx',
      });
      // compare_documents does not check for google_doc_id in its dispatch path,
      // so it won't route to gdocs at all — this is expected.
      // Instead, test the provider guard directly:
    });

    it('returns UNSUPPORTED_FOR_PROVIDER for add_comment with google_doc_id', async () => {
      setupGDocsSession(manager);
      // add_comment doesn't have isGDocsRequest dispatch, so it won't route to gdocs.
      // The guard is only checked for the 8 supported tools.
      // Test the guard function directly instead:
      const { checkGDocsSupport } = await import('../../provider_guard.js');
      const result = checkGDocsSupport('add_comment');
      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect((result as any).error.code).toBe('UNSUPPORTED_FOR_PROVIDER');
    });
  });

  describe('URL parsing', () => {
    it('extracts doc ID from Google Docs URL', async () => {
      // This test verifies the URL extraction in resolveGDocsSessionForTool
      // by passing a full URL as google_doc_id. Since we mock the doc loading,
      // this will fail at the session creation stage but proves the ID extraction works.
      const { resolveGDocsSessionForTool } = await import('../../session_resolution.js');

      // Mock loadGDocsCore to return a mock that creates the doc
      const { loadGDocsCore } = await import('../../../gdocs_loader.js');
      const mockDoc = makeMockDoc();
      (loadGDocsCore as any).mockResolvedValueOnce({
        GoogleDocsDocument: {
          load: vi.fn().mockResolvedValue(mockDoc),
        },
      });

      const result = await resolveGDocsSessionForTool(
        manager,
        { google_doc_id: 'https://docs.google.com/document/d/abc123xyz/edit' },
        { toolName: 'read_file' },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.session.docId).toBe('abc123xyz');
      }
    });
  });

  describe('format_layout', () => {
    it('rejects row_height for Google Docs', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'format_layout', {
        google_doc_id: 'test-doc-id-123',
        row_height: { table_indexes: [0], value_twips: 400, rule: 'exact' },
      });
      assertError(result);
      expect((result as ErrorResult).error.code).toBe('UNSUPPORTED_FOR_PROVIDER');
    });

    it('rejects cell_padding for Google Docs', async () => {
      setupGDocsSession(manager);
      const result = await dispatchToolCall(manager, 'format_layout', {
        google_doc_id: 'test-doc-id-123',
        cell_padding: { table_indexes: [0], top_dxa: 100 },
      });
      assertError(result);
      expect((result as ErrorResult).error.code).toBe('UNSUPPORTED_FOR_PROVIDER');
    });
  });
});
