import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { createZipBuffer } from '@usejunior/docx-core';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Archive Guard' });

async function makeZipBuffer(
  files: Record<string, string>,
  opts?: { compression?: 'STORE' | 'DEFLATE' }
): Promise<Buffer> {
  return createZipBuffer(files, {
    compression: opts?.compression ?? 'STORE',
    compressionLevel: 9,
  });
}

async function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void>
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (typeof v === 'undefined') delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function getErrorCode(value: { response?: unknown }): string | undefined {
  const payload = value.response as { error?: { code?: string } } | undefined;
  return payload?.error?.code;
}

describe('docx archive safety guard', () => {
  test('rejects invalid non-zip buffers', async ({ given, when, then }: AllureBddContext) => {
    let res: Awaited<ReturnType<typeof validateDocxArchiveSafety>>;

    await given('a buffer that is not a valid zip archive', () => {});
    await when('validateDocxArchiveSafety is called', async () => {
      res = await validateDocxArchiveSafety(Buffer.from('not a zip archive'));
    });
    await then('it fails with INVALID_DOCX_ARCHIVE', () => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(getErrorCode(res)).toBe('INVALID_DOCX_ARCHIVE');
    });
  });

  test('rejects archives with too many entries', async ({ given, when, then }: AllureBddContext) => {
    let buf: Buffer;

    await given('a zip archive with 3 entries and a max-entries limit of 2', async () => {
      buf = await makeZipBuffer({
        'word/document.xml': '<doc/>',
        'word/styles.xml': '<styles/>',
        'word/numbering.xml': '<num/>',
      });
    });
    await when('validateDocxArchiveSafety is called with SAFE_DOCX_MAX_ARCHIVE_ENTRIES=2', async () => {});
    await then('it fails with DOCX_ARCHIVE_TOO_MANY_ENTRIES', async () => {
      await withEnv({ SAFE_DOCX_MAX_ARCHIVE_ENTRIES: '2' }, async () => {
        const res = await validateDocxArchiveSafety(buf);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(getErrorCode(res)).toBe('DOCX_ARCHIVE_TOO_MANY_ENTRIES');
      });
    });
  });

  test('rejects entries that exceed single-entry and total uncompressed limits', async ({ given, when, then, and }: AllureBddContext) => {
    let oneBig: Buffer;
    let totalBig: Buffer;

    await given('zip buffers that exceed size limits', async () => {
      oneBig = await makeZipBuffer({ 'word/document.xml': 'X'.repeat(32) });
      totalBig = await makeZipBuffer({
        'word/document.xml': 'A'.repeat(12),
        'word/styles.xml': 'B'.repeat(12),
      });
    });
    await when('validateDocxArchiveSafety is called with a per-entry limit smaller than the entry', async () => {});
    await then('it fails with DOCX_ARCHIVE_ENTRY_TOO_LARGE', async () => {
      await withEnv({ SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES: '16' }, async () => {
        const res = await validateDocxArchiveSafety(oneBig);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(getErrorCode(res)).toBe('DOCX_ARCHIVE_ENTRY_TOO_LARGE');
      });
    });
    await and('it fails with DOCX_ARCHIVE_UNCOMPRESSED_TOO_LARGE when total exceeds the limit', async () => {
      await withEnv(
        {
          SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES: '1000',
          SAFE_DOCX_MAX_UNCOMPRESSED_BYTES: '20',
        },
        async () => {
          const res = await validateDocxArchiveSafety(totalBig);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(getErrorCode(res)).toBe('DOCX_ARCHIVE_UNCOMPRESSED_TOO_LARGE');
        }
      );
    });
  });

  test('rejects suspiciously high compression ratio entries', async ({ given, when, then }: AllureBddContext) => {
    let highlyCompressible: Buffer;

    await given('a highly-compressible DEFLATE-compressed zip entry', async () => {
      highlyCompressible = await makeZipBuffer(
        { 'word/document.xml': 'A'.repeat(32_000) },
        { compression: 'DEFLATE' }
      );
    });
    await when('validateDocxArchiveSafety is called with a max compression ratio of 2', async () => {});
    await then('it fails with DOCX_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH', async () => {
      await withEnv(
        {
          SAFE_DOCX_MAX_ARCHIVE_ENTRIES: '100',
          SAFE_DOCX_MAX_UNCOMPRESSED_BYTES: '500000',
          SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES: '500000',
          SAFE_DOCX_MAX_COMPRESSION_RATIO: '2',
        },
        async () => {
          const res = await validateDocxArchiveSafety(highlyCompressible);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(getErrorCode(res)).toBe('DOCX_ARCHIVE_COMPRESSION_RATIO_TOO_HIGH');
        }
      );
    });
  });

  test('accepts sane archives under configured thresholds', async ({ given, when, then }: AllureBddContext) => {
    let buf: Buffer;
    let res: Awaited<ReturnType<typeof validateDocxArchiveSafety>>;

    await given('a small valid zip archive', async () => {
      buf = await makeZipBuffer({
        'word/document.xml': '<w:document/>',
        'word/styles.xml': '<w:styles/>',
      });
    });
    await when('validateDocxArchiveSafety is called with default limits', async () => {
      res = await validateDocxArchiveSafety(buf);
    });
    await then('it passes with ok: true', () => { expect(res).toEqual({ ok: true }); });
  });

  test('falls back to defaults for invalid numeric guard env values', async ({ given, when, then }: AllureBddContext) => {
    let buf: Buffer;

    await given('a small valid zip archive', async () => {
      buf = await makeZipBuffer({
        'word/document.xml': '<w:document/>',
        'word/styles.xml': '<w:styles/>',
      });
    });
    await when('validateDocxArchiveSafety is called with invalid numeric env values', async () => {});
    await then('it falls back to defaults and accepts the archive', async () => {
      await withEnv(
        {
          SAFE_DOCX_MAX_ARCHIVE_ENTRIES: '0',
          SAFE_DOCX_MAX_UNCOMPRESSED_BYTES: '-1',
          SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES: 'not-a-number',
          SAFE_DOCX_MAX_COMPRESSION_RATIO: '',
        },
        async () => {
          const res = await validateDocxArchiveSafety(buf);
          expect(res).toEqual({ ok: true });
        },
      );
    });
  });
});
