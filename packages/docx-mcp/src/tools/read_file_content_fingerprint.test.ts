import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { readFile } from './read_file.js';

const TEST_FEATURE = 'document-paragraph-id-stability-and-fingerprint';

describe('document-paragraph-id-stability-and-fingerprint — Optional Content Fingerprint on read_file JSON', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });

  registerCleanup();

  test.openspec('opt-in fingerprint adds field on JSON output')(
    'opt-in fingerprint adds field on JSON output',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['First paragraph.', 'Second paragraph.'], { mgr }),
      );

      const read = await when('read_file is called with format=json and include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return result;
      });

      await then('each paragraph carries a sha256:nfkc:<32hex> fingerprint', async () => {
        const nodes = JSON.parse(String(read.content)) as Array<Record<string, unknown>>;
        expect(nodes.length).toBeGreaterThan(0);
        for (const node of nodes) {
          expect(typeof node.content_fingerprint).toBe('string');
          expect(String(node.content_fingerprint)).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        }
      });
    },
  );

  test.openspec('default JSON output omits fingerprint')(
    'default JSON output omits fingerprint',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Some text.'], { mgr }),
      );

      const read = await when('read_file is called with format=json and no include_fingerprint', async () => {
        const result = await readFile(mgr, { file_path: filePath, format: 'json', limit: 100 });
        assertSuccess(result, 'read');
        return result;
      });

      await then('paragraph objects do not contain content_fingerprint', async () => {
        const nodes = JSON.parse(String(read.content)) as Array<Record<string, unknown>>;
        for (const node of nodes) {
          expect(node.content_fingerprint).toBeUndefined();
        }
      });
    },
  );

  test.openspec('TOON format ignores include_fingerprint')(
    'TOON format ignores include_fingerprint',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Alpha.', 'Beta.'], { mgr }),
      );

      const baseline = await when('read_file is called with format=toon and no include_fingerprint', async () => {
        const result = await readFile(mgr, { file_path: filePath, format: 'toon', limit: 100 });
        assertSuccess(result, 'read');
        return String(result.content);
      });

      const withFlag = await when('read_file is called with format=toon and include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'toon',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return String(result.content);
      });

      await then('TOON output is byte-identical', async () => {
        expect(withFlag).toBe(baseline);
      });
    },
  );

  test.openspec('same paragraph text produces same fingerprint across documents')(
    'same paragraph text produces same fingerprint across documents',
    async ({ given, when, then }: AllureBddContext) => {
      const sharedText = 'The Company shall indemnify the Customer against all claims.';
      const mgr = createTestSessionManager();

      const docA = await given('two DOCX files containing the same paragraph text', () =>
        openSession([sharedText, 'Doc A unique tail.'], { mgr }),
      );
      const docB = await given('a second DOCX file with the same paragraph text', () =>
        openSession(['Doc B unique head.', sharedText], { mgr }),
      );

      const fingerprintsA = await when('reading doc A with include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: docA.filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        const nodes = JSON.parse(String(result.content)) as Array<Record<string, unknown>>;
        return nodes.map((n) => String(n.content_fingerprint));
      });

      const fingerprintsB = await when('reading doc B with include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: docB.filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        const nodes = JSON.parse(String(result.content)) as Array<Record<string, unknown>>;
        return nodes.map((n) => String(n.content_fingerprint));
      });

      await then('the corresponding paragraphs receive byte-identical fingerprints', async () => {
        const shared = fingerprintsA.filter((fp) => fingerprintsB.includes(fp));
        expect(shared.length).toBeGreaterThanOrEqual(1);
        for (const fp of shared) {
          expect(fp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        }
      });
    },
  );

  test('content_fingerprint matches paragraph visible text', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const { filePath } = await given('a DOCX session with one paragraph', () =>
      openSession(['Section 5: Termination clause.'], { mgr }),
    );

    const fingerprint = await when('reading with include_fingerprint=true', async () => {
      const result = await readFile(mgr, {
        file_path: filePath,
        format: 'json',
        include_fingerprint: true,
        limit: 100,
      });
      assertSuccess(result, 'read');
      const nodes = JSON.parse(String(result.content)) as Array<Record<string, unknown>>;
      return String(nodes[0].content_fingerprint);
    });

    await then('the fingerprint matches the sha256:nfkc hash of the visible text', async () => {
      const { computeContentFingerprint } = await import('@usejunior/docx-core');
      expect(fingerprint).toBe(computeContentFingerprint('Section 5: Termination clause.'));
    });
  });
});
