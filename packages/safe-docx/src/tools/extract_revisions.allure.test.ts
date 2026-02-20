import { describe, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compareDocuments } from '@usejunior/docx-comparison';

import { extractRevisions_tool } from './extract_revisions.js';
import { openDocument } from './open_document.js';
import { smartEdit } from './smart_edit.js';
import { MCP_TOOLS } from '../server.js';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
  openSession,
} from '../testing/session-test-utils.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';

const TEST_FEATURE = 'add-extract-revisions-tool';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SIMPLE_FIXTURE_DIR = path.resolve(
  TEST_DIR,
  '../../../docx-comparison/src/testing/fixtures/simple-word-change',
);

async function createRealTrackedChangesFixture(): Promise<string> {
  const [original, revised] = await Promise.all([
    fs.readFile(path.join(SIMPLE_FIXTURE_DIR, 'original.docx')),
    fs.readFile(path.join(SIMPLE_FIXTURE_DIR, 'revised.docx')),
  ]);
  const compared = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'rebuild',
  });
  const tmpDir = await createTrackedTempDir('extract-revisions-real-redline-');
  const outputPath = path.join(tmpDir, 'simple-word-change.tracked.docx');
  await fs.writeFile(outputPath, compared.document);
  return outputPath;
}

describe('extract_revisions tool', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });
  registerCleanup();

  // ── Insertion + deletion extraction ──────────────────────────────

  test.openspec('extracting revisions from a document with insertions and deletions')(
    'Scenario: extracting revisions from a document with insertions and deletions',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p>` +
            `<w:r><w:t>Original</w:t></w:r>` +
            `<w:ins w:author="Alice" w:date="2024-01-01T00:00:00Z">` +
              `<w:r><w:t> added</w:t></w:r>` +
            `</w:ins>` +
            `<w:del w:author="Bob" w:date="2024-01-01T00:00:00Z">` +
              `<w:r><w:delText> removed</w:delText></w:r>` +
            `</w:del>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify extraction results', () => {
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        const change = changes[0];
        expect(change.before_text).toBe('Original removed');
        expect(change.after_text).toBe('Original added');
        expect(change.revisions.length).toBeGreaterThanOrEqual(2);
        const types = change.revisions.map((r: any) => r.type);
        expect(types).toContain('INSERTION');
        expect(types).toContain('DELETION');
      });
    },
  );

  // ── No tracked changes ──────────────────────────────────────────

  test.openspec('extracting revisions from a document with no tracked changes')(
    'Scenario: extracting revisions from a document with no tracked changes',
    async () => {
      const { mgr, sessionId } = await openSession(['Hello world', 'Second paragraph']);

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify no changes', () => {
        expect(result.total_changes).toBe(0);
        expect(result.changes).toEqual([]);
        expect(result.has_more).toBe(false);
      });
    },
  );

  // ── Format changes ──────────────────────────────────────────────

  test.openspec('property-only changes are included in extraction')(
    'Scenario: property-only changes are included in extraction',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r>` +
            `<w:rPr>` +
              `<w:b/>` +
              `<w:rPrChange w:author="Carol" w:date="2024-01-01T00:00:00Z">` +
                `<w:rPr><w:i/></w:rPr>` +
              `</w:rPrChange>` +
            `</w:rPr>` +
            `<w:t>Formatted text</w:t>` +
          `</w:r></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify FORMAT_CHANGE', () => {
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        const formatRevisions = changes[0].revisions.filter((r: any) => r.type === 'FORMAT_CHANGE');
        expect(formatRevisions.length).toBeGreaterThanOrEqual(1);
        expect(formatRevisions[0].author).toBe('Carol');
      });
    },
  );

  // ── Pagination ──────────────────────────────────────────────────

  test.openspec('paginating through revisions with offset and limit')(
    'Scenario: paginating through revisions with offset and limit',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const page1 = await allureStep('Page 1: offset=0, limit=2', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 0, limit: 2 }),
      );
      assertSuccess(page1, 'page1');
      await allureJsonAttachment('page1', page1);

      const page2 = await allureStep('Page 2: offset=2, limit=2', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 2, limit: 2 }),
      );
      assertSuccess(page2, 'page2');
      await allureJsonAttachment('page2', page2);

      await allureStep('Verify pagination', () => {
        expect(page1.total_changes).toBe(3);
        expect((page1.changes as any[]).length).toBe(2);
        expect(page1.has_more).toBe(true);

        expect(page2.total_changes).toBe(3);
        expect((page2.changes as any[]).length).toBe(1);
        expect(page2.has_more).toBe(false);
      });
    },
  );

  // ── Session unchanged after extraction ──────────────────────────

  test.openspec('session document is unchanged after extraction')(
    'Scenario: session document is unchanged after extraction',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Text</w:t></w:r><w:ins w:author="X"><w:r><w:t> added</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const revisionBefore = await allureStep('Get edit_revision before', () => {
        const session = mgr.getSession(sessionId);
        return session.editRevision;
      });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify edit_revision unchanged', () => {
        const session = mgr.getSession(sessionId);
        expect(session.editRevision).toBe(revisionBefore);
        expect(result.edit_revision).toBe(revisionBefore);
      });
    },
  );

  // ── Missing session context ─────────────────────────────────────

  test.openspec('missing session context returns error')(
    'Scenario: missing session context returns error',
    async () => {
      const mgr = createTestSessionManager();

      const result = await allureStep('Call extract_revisions with no params', () =>
        extractRevisions_tool(mgr, {}),
      );
      assertFailure(result, 'MISSING_SESSION_CONTEXT', 'extract_revisions');
      await allureJsonAttachment('result', result);
    },
  );

  // ── Validation errors ───────────────────────────────────────────

  test.openspec('invalid limit is rejected')(
    'Scenario: invalid limit is rejected',
    async () => {
      const { mgr, sessionId } = await openSession(['Hello']);

      const result = await allureStep('Call with limit=0', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, limit: 0 }),
      );
      assertFailure(result, 'INVALID_LIMIT', 'extract_revisions');
      await allureJsonAttachment('result', result);

      const result2 = await allureStep('Call with limit=501', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, limit: 501 }),
      );
      assertFailure(result2, 'INVALID_LIMIT', 'extract_revisions');
    },
  );

  test.openspec('invalid offset is rejected')(
    'Scenario: invalid offset is rejected',
    async () => {
      const { mgr, sessionId } = await openSession(['Hello']);

      const result = await allureStep('Call with offset=-1', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: -1 }),
      );
      assertFailure(result, 'INVALID_OFFSET', 'extract_revisions');
      await allureJsonAttachment('result', result);
    },
  );

  // ── Cache behavior ─────────────────────────────────────────────

  test.openspec('repeated extraction at same revision uses cache')(
    'Scenario: repeated extraction at same revision uses cache',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Text</w:t></w:r><w:ins w:author="X"><w:r><w:t> added</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result1 = await allureStep('First extraction', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result1, 'first extraction');

      await allureStep('Verify cache populated', () => {
        const session = mgr.getSession(sessionId);
        const cache = mgr.getExtractionCache(session);
        expect(cache).not.toBeNull();
      });

      const result2 = await allureStep('Second extraction (from cache)', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result2, 'second extraction');

      await allureStep('Verify consistent results', () => {
        expect(result2.total_changes).toBe(result1.total_changes);
      });
    },
  );

  // ── Empty structural paragraphs ─────────────────────────────────

  test.openspec('structurally-empty inserted paragraphs are filtered out')(
    'Scenario: structurally-empty inserted paragraphs are filtered out',
    async () => {
      // A paragraph with only pPr/rPr/ins (paragraph-level insertion marker)
      // and no text content — should be excluded from results.
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Normal paragraph</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="Comparison" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>` +
          `<w:p><w:r><w:t>Another </w:t></w:r><w:ins w:author="X"><w:r><w:t>edited</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify empty structural paragraph is filtered', () => {
        // Only the third paragraph (with real content changes) should appear
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].after_text).toContain('edited');
      });
    },
  );

  // ── Real DOCX regression guard ────────────────────────────────

  test.openspec('real DOCX redline with tracked changes extracts correctly')(
    'Scenario: real DOCX redline with tracked changes extracts correctly',
    async () => {
      const fixturePath = await createRealTrackedChangesFixture();

      const mgr = createTestSessionManager();

      const opened = await allureStep('Open real DOCX fixture', () =>
        openDocument(mgr, { file_path: fixturePath }),
      );
      assertSuccess(opened, 'open fixture');
      const sessionId = opened.session_id as string;

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      const changes = result.changes as any[];
      const totalChanges = result.total_changes as number;

      await allureStep('Verify changes were extracted', () => {
        expect(totalChanges).toBeGreaterThan(0);
      });

      await allureStep('Verify each change has valid structure', () => {
        const validTypes = new Set(['INSERTION', 'DELETION', 'MOVE_FROM', 'MOVE_TO', 'FORMAT_CHANGE']);
        for (const c of changes) {
          expect(c.para_id).toBeTruthy();
          expect(c.revisions.length).toBeGreaterThan(0);
          for (const r of c.revisions) {
            expect(validTypes.has(r.type)).toBe(true);
          }
        }
      });

      await allureStep('Verify pagination metadata is consistent', () => {
        expect(totalChanges).toBeGreaterThanOrEqual(changes.length);
        if (result.has_more) {
          expect(changes.length).toBe(50); // default limit
        }
      });
    },
  );

  // ── Inserted-only paragraph ────────────────────────────────────

  test.openspec('inserted-only paragraph has empty before text')(
    'Scenario: inserted-only paragraph has empty before text',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Existing</w:t></w:r></w:p>` +
          `<w:p>` +
            `<w:pPr><w:rPr><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr>` +
            `<w:ins w:author="A"><w:r><w:t>New paragraph</w:t></w:r></w:ins>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify inserted paragraph has empty before_text', () => {
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].before_text).toBe('');
        expect(changes[0].after_text).toBe('New paragraph');
      });
    },
  );

  // ── Deleted-only paragraph ────────────────────────────────────

  test.openspec('deleted-only paragraph has empty after text')(
    'Scenario: deleted-only paragraph has empty after text',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Kept</w:t></w:r></w:p>` +
          `<w:p>` +
            `<w:del w:author="A" w:date="2024-01-01T00:00:00Z">` +
              `<w:r><w:delText>Deleted paragraph</w:delText></w:r>` +
            `</w:del>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify deleted paragraph has empty after_text', () => {
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].before_text).toBe('Deleted paragraph');
        expect(changes[0].after_text).toBe('');
      });
    },
  );

  // ── Table cells ───────────────────────────────────────────────

  test.openspec('changed paragraphs inside table cells are extracted')(
    'Scenario: changed paragraphs inside table cells are extracted',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:tbl><w:tr><w:tc>` +
            `<w:p><w:r><w:t>Cell </w:t></w:r>` +
            `<w:ins w:author="X"><w:r><w:t>edited</w:t></w:r></w:ins></w:p>` +
          `</w:tc></w:tr></w:tbl>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify table cell changes extracted', () => {
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        expect(changes[0].after_text).toContain('edited');
      });
    },
  );

  // ── Comments ──────────────────────────────────────────────────

  test.openspec('extracting revisions includes associated comments')(
    'Scenario: extracting revisions includes associated comments',
    async () => {
      const commentsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="${W_NS}" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
          `<w:comment w:id="1" w:author="Reviewer" w:date="2024-01-01T00:00:00Z">` +
            `<w:p><w:r><w:t>Please review this change</w:t></w:r></w:p>` +
          `</w:comment>` +
        `</w:comments>`;

      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p>` +
            `<w:commentRangeStart w:id="1"/>` +
            `<w:r><w:t>Original</w:t></w:r>` +
            `<w:ins w:author="X"><w:r><w:t> added</w:t></w:r></w:ins>` +
            `<w:commentRangeEnd w:id="1"/>` +
            `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], {
        xml: docXml,
        extraFiles: { 'word/comments.xml': commentsXml },
      });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify comments are associated', () => {
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].comments.length).toBeGreaterThanOrEqual(1);
        expect(changes[0].comments[0].author).toBe('Reviewer');
        expect(changes[0].comments[0].text).toContain('Please review');
      });
    },
  );

  // ── Offset beyond total ───────────────────────────────────────

  test.openspec('offset beyond total returns empty page')(
    'Scenario: offset beyond total returns empty page',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call with offset=100', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 100 }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify empty page', () => {
        expect(result.total_changes).toBe(1);
        expect((result.changes as any[]).length).toBe(0);
        expect(result.has_more).toBe(false);
      });
    },
  );

  // ── Subsequent pages ──────────────────────────────────────────

  test.openspec('retrieving subsequent pages with offset')(
    'Scenario: retrieving subsequent pages with offset',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>D</w:t></w:r><w:ins w:author="X"><w:r><w:t>4</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const page1 = await allureStep('Page 1', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 0, limit: 2 }),
      );
      assertSuccess(page1, 'page1');

      const page2 = await allureStep('Page 2', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 2, limit: 2 }),
      );
      assertSuccess(page2, 'page2');

      await allureStep('Verify no overlap between pages', () => {
        const p1Ids = new Set((page1.changes as any[]).map((c: any) => c.para_id));
        for (const c of page2.changes as any[]) {
          expect(p1Ids.has(c.para_id)).toBe(false);
        }
      });
    },
  );

  // ── Cache invalidation on edit ────────────────────────────────

  test.openspec('new edit invalidates extraction cache')(
    'Scenario: new edit invalidates extraction cache',
    async () => {
      // Use a clean document — extraction still caches the empty result
      const { mgr, sessionId, firstParaId } = await openSession(['Hello world', 'Second paragraph']);

      // First extraction — populates cache (0 changes, but cache is still created)
      const result1 = await allureStep('First extraction', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result1, 'first extraction');
      const rev1 = result1.edit_revision;

      await allureStep('Verify cache is populated', () => {
        const session = mgr.getSession(sessionId);
        expect(mgr.getExtractionCache(session)).not.toBeNull();
      });

      // Make an edit to increment edit_revision
      await allureStep('Make an edit via smart_edit', async () => {
        const editResult = await smartEdit(mgr, {
          session_id: sessionId,
          target_paragraph_id: firstParaId,
          old_string: 'Hello world',
          new_string: 'Hi world',
          instruction: 'cache invalidation test',
        });
        assertSuccess(editResult, 'smart_edit');
      });

      await allureStep('Verify cache was invalidated', () => {
        const session = mgr.getSession(sessionId);
        expect(mgr.getExtractionCache(session)).toBeNull();
      });

      // Second extraction — must recompute
      const result2 = await allureStep('Second extraction after edit', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result2, 'second extraction');

      await allureStep('Verify new edit_revision', () => {
        expect(result2.edit_revision).not.toBe(rev1);
      });
    },
  );

  // ── Two-file comparison then extraction ────────────────────────

  test.openspec('two-file comparison then extraction workflow')(
    'Scenario: two-file comparison then extraction workflow',
    async () => {
      const fixturePath = await createRealTrackedChangesFixture();

      const mgr = createTestSessionManager();

      const opened = await allureStep('Open redline DOCX via file_path', () =>
        openDocument(mgr, { file_path: fixturePath }),
      );
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const result = await allureStep('Extract revisions from redline', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify structured diff is returned', () => {
        expect(result.total_changes).toBeGreaterThan(0);
        expect(result.changes).toBeDefined();
        expect(Array.isArray(result.changes)).toBe(true);
      });
    },
  );

  // ── Tool registration ───────────────────────────────────────────

  test(
    'extract_revisions tool is registered in MCP_TOOLS',
    async () => {
      const tool = MCP_TOOLS.find((t) => t.name === 'extract_revisions');
      expect(tool).toBeTruthy();
      expect(tool!.annotations.readOnlyHint).toBe(true);
      expect(tool!.annotations.destructiveHint).toBe(false);
      expect(tool!.inputSchema.properties).toHaveProperty('session_id');
      expect(tool!.inputSchema.properties).toHaveProperty('file_path');
      expect(tool!.inputSchema.properties).toHaveProperty('offset');
      expect(tool!.inputSchema.properties).toHaveProperty('limit');
    },
  );
});
