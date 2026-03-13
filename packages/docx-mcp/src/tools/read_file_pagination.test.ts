import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { openSession, assertSuccess, registerCleanup, createTestSessionManager } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { readFile } from './read_file.js';
import { estimateTokens, DEFAULT_CONTENT_TOKEN_BUDGET } from './pagination.js';

const FEATURE = 'read-file-pagination';
const TEST_FEATURE = 'add-table-context-to-document-view';

describe('read_file pagination', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: FEATURE });

  registerCleanup();

  test('token budget truncates large documents', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(20); // ~560 chars each
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc with 200 long paragraphs', () => openSession(paragraphs, { mgr }));

    const read = await when('Read file with default params (budget active)', async () => {
      const result = await readFile(mgr, { session_id: sessionId });
      assertSuccess(result, 'read');
      await attachPrettyJson('read_response_meta', {
        total_paragraphs: result.total_paragraphs,
        paragraphs_returned: result.paragraphs_returned,
        has_more: result.has_more,
        next_offset: result.next_offset,
      });
      return result;
    });

    await then('Verify truncation', async () => {
      expect(Number(read.paragraphs_returned)).toBeLessThan(Number(read.total_paragraphs));
      expect(read.has_more).toBe(true);
      expect(typeof read.next_offset).toBe('number');
      expect(Number(read.next_offset)).toBe(Number(read.paragraphs_returned) + 1);
      expect(estimateTokens(String(read.content))).toBeLessThanOrEqual(DEFAULT_CONTENT_TOKEN_BUDGET);
    });
  });

  test('explicit limit bypasses budget', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc with 200 long paragraphs', () => openSession(paragraphs, { mgr }));

    const read = await when('Read with explicit limit=200', async () => {
      const result = await readFile(mgr, { session_id: sessionId, limit: 200 });
      assertSuccess(result, 'read');
      await attachPrettyJson('read_response_meta', {
        total_paragraphs: result.total_paragraphs,
        paragraphs_returned: result.paragraphs_returned,
        has_more: result.has_more,
      });
      return result;
    });

    await then('Verify all returned', async () => {
      expect(Number(read.paragraphs_returned)).toBe(200);
      expect(read.has_more).toBe(false);
    });
  });

  test('node_ids bypasses budget', async ({ given, when, then }: AllureBddContext) => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
    const mgr = createTestSessionManager();
    const { sessionId, paraIds } = await given('Create doc and read specific nodes', () => openSession(paragraphs, { mgr }));

    const targetIds = paraIds.slice(0, 5);
    const read = await when('Read with node_ids', async () => {
      const result = await readFile(mgr, { session_id: sessionId, node_ids: targetIds });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Verify all specified nodes returned', async () => {
      expect(Number(read.paragraphs_returned)).toBe(5);
    });
  });

  test('small doc under budget returns all paragraphs', async ({ given, when, then }: AllureBddContext) => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Short paragraph ${i + 1}`);
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create small doc', () => openSession(paragraphs, { mgr }));

    const read = await when('Read file', async () => {
      const result = await readFile(mgr, { session_id: sessionId });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Verify all returned with no pagination', async () => {
      expect(Number(read.paragraphs_returned)).toBe(10);
      expect(read.has_more).toBe(false);
      expect(read.next_offset).toBeUndefined();
    });
  });

  test('paragraph_ids field is absent', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc', () => openSession(['Test paragraph'], { mgr }));

    const read = await when('Read file', async () => {
      const result = await readFile(mgr, { session_id: sessionId });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Verify paragraph_ids removed', async () => {
      expect((read as Record<string, unknown>).paragraph_ids).toBeUndefined();
    });
  });

  test('offset continuation produces no overlap or gaps', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Read with pagination continuation', () => openSession(paragraphs, { mgr }));

    const firstPage = await when('Read first page', async () => {
      const result = await readFile(mgr, { session_id: sessionId });
      assertSuccess(result, 'read');
      expect(result.has_more).toBe(true);
      expect(typeof result.next_offset).toBe('number');
      await attachPrettyJson('first_page', {
        paragraphs_returned: result.paragraphs_returned,
        next_offset: result.next_offset,
      });
      return result;
    });

    const secondPage = await when('Read second page using next_offset', async () => {
      const result = await readFile(mgr, { session_id: sessionId, offset: Number(firstPage.next_offset) });
      assertSuccess(result, 'read');
      await attachPrettyJson('second_page', {
        paragraphs_returned: result.paragraphs_returned,
        has_more: result.has_more,
      });
      return result;
    });

    await then('Verify no overlap', async () => {
      const firstContent = String(firstPage.content);
      const secondContent = String(secondPage.content);

      // Extract paragraph identifiers from toon content
      const firstIds = firstContent.split('\n')
        .filter(l => l.startsWith('_bk_'))
        .map(l => l.split('|')[0]!.trim());
      const secondIds = secondContent.split('\n')
        .filter(l => l.startsWith('_bk_'))
        .map(l => l.split('|')[0]!.trim());

      // No IDs should appear in both pages
      const overlap = firstIds.filter(id => secondIds.includes(id));
      expect(overlap).toHaveLength(0);

      // Second page should start right after first page
      expect(Number(firstPage.paragraphs_returned) + Number(secondPage.paragraphs_returned))
        .toBeLessThanOrEqual(Number(firstPage.total_paragraphs));
    });
  });

  test('budget works for simple format', async ({ given, when, then }: AllureBddContext) => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create large doc and read as simple', () => openSession(paragraphs, { mgr }));

    const read = await when('Read with format=simple', async () => {
      const result = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Verify budget enforced', async () => {
      expect(Number(read.paragraphs_returned)).toBeLessThan(200);
      expect(read.has_more).toBe(true);
      expect(estimateTokens(String(read.content))).toBeLessThanOrEqual(DEFAULT_CONTENT_TOKEN_BUDGET);
    });
  });

  test('budget works for json format', async ({ given, when, then }: AllureBddContext) => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create large doc and read as json', () => openSession(paragraphs, { mgr }));

    const read = await when('Read with format=json', async () => {
      const result = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Verify budget enforced and valid JSON', async () => {
      expect(Number(read.paragraphs_returned)).toBeLessThan(200);
      expect(read.has_more).toBe(true);
      expect(estimateTokens(String(read.content))).toBeLessThanOrEqual(DEFAULT_CONTENT_TOKEN_BUDGET);
      // Verify it's valid JSON
      const parsed = JSON.parse(String(read.content));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(Number(read.paragraphs_returned));
    });
  });

  // ── Table marker tests (openspec traceability below) ────────────────

  test.openspec('SDX-TABLE-09')
    ('table markers appear in toon output', async ({ given, when, then }: AllureBddContext) => {
    const tableXml =
      `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>H2</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>D1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>D2</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      `<w:p><w:r><w:t>After</w:t></w:r></w:p>`;
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${tableXml}</w:body></w:document>`;
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc with a table', () => openSession([], { mgr, xml }));

    const read = await when('Read file in toon format', async () => {
      const result = await readFile(mgr, { session_id: sessionId });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Verify #TABLE and #END_TABLE markers', async () => {
      const content = String(read.content);
      const lines = content.split('\n');
      expect(lines.some((l) => l.startsWith('#TABLE _tbl_0'))).toBe(true);
      expect(lines.some((l) => l === '#END_TABLE')).toBe(true);
      expect(lines.some((l) => l.includes('th(0,0)'))).toBe(true);
      expect(lines.some((l) => l.includes('td(1,0)'))).toBe(true);
    });
  });

  test.openspec('SDX-TABLE-10')
    ('#TABLE markers do not inflate paragraphsReturned', async ({ given, when, then }: AllureBddContext) => {
    const tableXml =
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>D1</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>`;
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${tableXml}</w:body></w:document>`;
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc with small table', () => openSession([], { mgr, xml }));

    const read = await when('Read file', async () => {
      const result = await readFile(mgr, { session_id: sessionId });
      assertSuccess(result, 'read');
      return result;
    });

    await then('paragraphsReturned matches node count, not line count', async () => {
      // 2 paragraphs (H1, D1), but content has #TABLE + #END_TABLE extra lines
      expect(Number(read.paragraphs_returned)).toBe(2);
      const content = String(read.content);
      expect(content).toContain('#TABLE');
      expect(content).toContain('#END_TABLE');
    });
  });

  test.openspec('SDX-TABLE-11')
    ('table markers in simple format', async ({ given, when, then }: AllureBddContext) => {
    const tableXml =
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Col</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Val</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>`;
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${tableXml}</w:body></w:document>`;
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc with table', () => openSession([], { mgr, xml }));

    const read = await when('Read file in simple format', async () => {
      const result = await readFile(mgr, { session_id: sessionId, format: 'simple' });
      assertSuccess(result, 'read');
      return result;
    });

    await then('Simple format includes table markers', async () => {
      const content = String(read.content);
      expect(content).toContain('#TABLE _tbl_0');
      expect(content).toContain('#END_TABLE');
    });
  });

  test.openspec('SDX-TABLE-12')
    ('table_context in JSON format', async ({ given, when, then }: AllureBddContext) => {
    const tableXml =
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>H</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>`;
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${tableXml}</w:body></w:document>`;
    const mgr = createTestSessionManager();
    const { sessionId } = await given('Create doc with table', () => openSession([], { mgr, xml }));

    const read = await when('Read file in JSON format', async () => {
      const result = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(result, 'read');
      return result;
    });

    await then('JSON output includes table_context', async () => {
      const parsed = JSON.parse(String(read.content));
      expect(parsed[0].table_context).toBeDefined();
      expect(parsed[0].table_context.table_id).toBe('_tbl_0');
      expect(parsed[0].table_context.is_header_row).toBe(true);
      expect(parsed[1].table_context.is_header_row).toBe(false);
    });
  });
});
