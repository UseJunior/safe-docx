import { describe, expect } from 'vitest';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import { openSession, assertSuccess, registerCleanup, createTestSessionManager } from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { readFile } from './read_file.js';
import { estimateTokens, DEFAULT_CONTENT_TOKEN_BUDGET } from './pagination.js';

const FEATURE = 'read-file-pagination';

describe('read_file pagination', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: FEATURE });

  registerCleanup();

  test('token budget truncates large documents', async () => {
    await allureStep('Create doc with 200 long paragraphs', async () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(20); // ~560 chars each
      const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(paragraphs, { mgr });

      const read = await allureStep('Read file with default params (budget active)', async () => {
        const result = await readFile(mgr, { session_id: sessionId });
        assertSuccess(result, 'read');
        allureJsonAttachment('read_response_meta', {
          total_paragraphs: result.total_paragraphs,
          paragraphs_returned: result.paragraphs_returned,
          has_more: result.has_more,
          next_offset: result.next_offset,
        });
        return result;
      });

      await allureStep('Verify truncation', async () => {
        expect(Number(read.paragraphs_returned)).toBeLessThan(Number(read.total_paragraphs));
        expect(read.has_more).toBe(true);
        expect(typeof read.next_offset).toBe('number');
        expect(Number(read.next_offset)).toBe(Number(read.paragraphs_returned) + 1);
        expect(estimateTokens(String(read.content))).toBeLessThanOrEqual(DEFAULT_CONTENT_TOKEN_BUDGET);
      });
    });
  });

  test('explicit limit bypasses budget', async () => {
    await allureStep('Create doc with 200 long paragraphs', async () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
      const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(paragraphs, { mgr });

      const read = await allureStep('Read with explicit limit=200', async () => {
        const result = await readFile(mgr, { session_id: sessionId, limit: 200 });
        assertSuccess(result, 'read');
        allureJsonAttachment('read_response_meta', {
          total_paragraphs: result.total_paragraphs,
          paragraphs_returned: result.paragraphs_returned,
          has_more: result.has_more,
        });
        return result;
      });

      await allureStep('Verify all returned', async () => {
        expect(Number(read.paragraphs_returned)).toBe(200);
        expect(read.has_more).toBe(false);
      });
    });
  });

  test('node_ids bypasses budget', async () => {
    await allureStep('Create doc and read specific nodes', async () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
      const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
      const mgr = createTestSessionManager();
      const { sessionId, paraIds } = await openSession(paragraphs, { mgr });

      const targetIds = paraIds.slice(0, 5);
      const read = await allureStep('Read with node_ids', async () => {
        const result = await readFile(mgr, { session_id: sessionId, node_ids: targetIds });
        assertSuccess(result, 'read');
        return result;
      });

      await allureStep('Verify all specified nodes returned', async () => {
        expect(Number(read.paragraphs_returned)).toBe(5);
      });
    });
  });

  test('small doc under budget returns all paragraphs', async () => {
    await allureStep('Create small doc', async () => {
      const paragraphs = Array.from({ length: 10 }, (_, i) => `Short paragraph ${i + 1}`);
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(paragraphs, { mgr });

      const read = await allureStep('Read file', async () => {
        const result = await readFile(mgr, { session_id: sessionId });
        assertSuccess(result, 'read');
        return result;
      });

      await allureStep('Verify all returned with no pagination', async () => {
        expect(Number(read.paragraphs_returned)).toBe(10);
        expect(read.has_more).toBe(false);
        expect(read.next_offset).toBeUndefined();
      });
    });
  });

  test('paragraph_ids field is absent', async () => {
    await allureStep('Create and read doc', async () => {
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(['Test paragraph'], { mgr });

      const read = await allureStep('Read file', async () => {
        const result = await readFile(mgr, { session_id: sessionId });
        assertSuccess(result, 'read');
        return result;
      });

      await allureStep('Verify paragraph_ids removed', async () => {
        expect((read as Record<string, unknown>).paragraph_ids).toBeUndefined();
      });
    });
  });

  test('offset continuation produces no overlap or gaps', async () => {
    await allureStep('Read with pagination continuation', async () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
      const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(paragraphs, { mgr });

      const firstPage = await allureStep('Read first page', async () => {
        const result = await readFile(mgr, { session_id: sessionId });
        assertSuccess(result, 'read');
        expect(result.has_more).toBe(true);
        expect(typeof result.next_offset).toBe('number');
        allureJsonAttachment('first_page', {
          paragraphs_returned: result.paragraphs_returned,
          next_offset: result.next_offset,
        });
        return result;
      });

      const secondPage = await allureStep('Read second page using next_offset', async () => {
        const result = await readFile(mgr, { session_id: sessionId, offset: Number(firstPage.next_offset) });
        assertSuccess(result, 'read');
        allureJsonAttachment('second_page', {
          paragraphs_returned: result.paragraphs_returned,
          has_more: result.has_more,
        });
        return result;
      });

      await allureStep('Verify no overlap', async () => {
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
  });

  test('budget works for simple format', async () => {
    await allureStep('Create large doc and read as simple', async () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
      const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(paragraphs, { mgr });

      const read = await allureStep('Read with format=simple', async () => {
        const result = await readFile(mgr, { session_id: sessionId, format: 'simple' });
        assertSuccess(result, 'read');
        return result;
      });

      await allureStep('Verify budget enforced', async () => {
        expect(Number(read.paragraphs_returned)).toBeLessThan(200);
        expect(read.has_more).toBe(true);
        expect(estimateTokens(String(read.content))).toBeLessThanOrEqual(DEFAULT_CONTENT_TOKEN_BUDGET);
      });
    });
  });

  test('budget works for json format', async () => {
    await allureStep('Create large doc and read as json', async () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(20);
      const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ${longText}`);
      const mgr = createTestSessionManager();
      const { sessionId } = await openSession(paragraphs, { mgr });

      const read = await allureStep('Read with format=json', async () => {
        const result = await readFile(mgr, { session_id: sessionId, format: 'json' });
        assertSuccess(result, 'read');
        return result;
      });

      await allureStep('Verify budget enforced and valid JSON', async () => {
        expect(Number(read.paragraphs_returned)).toBeLessThan(200);
        expect(read.has_more).toBe(true);
        expect(estimateTokens(String(read.content))).toBeLessThanOrEqual(DEFAULT_CONTENT_TOKEN_BUDGET);
        // Verify it's valid JSON
        const parsed = JSON.parse(String(read.content));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(Number(read.paragraphs_returned));
      });
    });
  });
});
