import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { createZipBuffer } from '@usejunior/docx-core';
import { validateDocxArchiveSafety } from './docx_archive_guard.js';

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
  it('rejects invalid non-zip buffers', async () => {
    const res = await validateDocxArchiveSafety(Buffer.from('not a zip archive'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(getErrorCode(res)).toBe('INVALID_DOCX_ARCHIVE');
  });

  it('rejects archives with too many entries', async () => {
    const buf = await makeZipBuffer({
      'word/document.xml': '<doc/>',
      'word/styles.xml': '<styles/>',
      'word/numbering.xml': '<num/>',
    });
    await withEnv({ SAFE_DOCX_MAX_ARCHIVE_ENTRIES: '2' }, async () => {
      const res = await validateDocxArchiveSafety(buf);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(getErrorCode(res)).toBe('DOCX_ARCHIVE_TOO_MANY_ENTRIES');
    });
  });

  it('rejects entries that exceed single-entry and total uncompressed limits', async () => {
    const oneBig = await makeZipBuffer({
      'word/document.xml': 'X'.repeat(32),
    });
    await withEnv({ SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES: '16' }, async () => {
      const res = await validateDocxArchiveSafety(oneBig);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(getErrorCode(res)).toBe('DOCX_ARCHIVE_ENTRY_TOO_LARGE');
    });

    const totalBig = await makeZipBuffer({
      'word/document.xml': 'A'.repeat(12),
      'word/styles.xml': 'B'.repeat(12),
    });
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

  it('rejects suspiciously high compression ratio entries', async () => {
    const highlyCompressible = await makeZipBuffer(
      {
        'word/document.xml': 'A'.repeat(32_000),
      },
      { compression: 'DEFLATE' }
    );

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

  it('accepts sane archives under configured thresholds', async () => {
    const buf = await makeZipBuffer({
      'word/document.xml': '<w:document/>',
      'word/styles.xml': '<w:styles/>',
    });
    const res = await validateDocxArchiveSafety(buf);
    expect(res).toEqual({ ok: true });
  });

  it('falls back to defaults for invalid numeric guard env values', async () => {
    const buf = await makeZipBuffer({
      'word/document.xml': '<w:document/>',
      'word/styles.xml': '<w:styles/>',
    });
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
