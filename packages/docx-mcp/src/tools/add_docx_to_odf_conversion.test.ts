import { describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OdfArchive, OdfDocument, validateOdfArchiveSafety } from '@usejunior/odf-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { convertToOdt } from './convert_to_odt.js';

const TEST_FEATURE = 'add-docx-to-odf-conversion';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

describe('OpenSpec traceability: add-docx-to-odf-conversion (convert_to_odt tool)', () => {
  registerCleanup();

  test.openspec('[OCNV-01] convert_to_odt writes a valid .odt and reports lossiness')(
    '[OCNV-01] convert_to_odt writes a valid .odt and reports lossiness',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Hello ODF world.', 'Second paragraph.']);
      const target = path.join(opened.tmpDir, 'converted.odt');
      const result = await convertToOdt(opened.mgr, { file_path: opened.inputPath, output_path: target });
      await then('a safe .odt with the document text is on disk and lossiness is reported', async () => {
        assertSuccess(result, 'convert_to_odt');
        expect(path.resolve(String(result.output_path))).toBe(path.resolve(target));
        expect(result.bytes_written).toBeGreaterThan(0);
        expect(Array.isArray(result.lossiness)).toBe(true);

        const odt = await fs.readFile(target);
        const safety = await validateOdfArchiveSafety(odt);
        expect(safety.ok).toBe(true);
        const archive = await OdfArchive.load(odt);
        const doc = OdfDocument.fromContentXml(await archive.getContentXml());
        expect(doc.getParagraphs().map((b) => b.text)).toEqual(['Hello ODF world.', 'Second paragraph.']);
      });
    },
  );

  test.openspec('[OCNV-02] convert_to_odt defaults the output path to the source with .odt')(
    '[OCNV-02] convert_to_odt defaults the output path to the source with .odt',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Default path body.']);
      const result = await convertToOdt(opened.mgr, { file_path: opened.inputPath });
      await then('the .docx extension is swapped for .odt', async () => {
        assertSuccess(result, 'convert_to_odt');
        const parsed = path.parse(opened.inputPath);
        const expected = path.join(parsed.dir, `${parsed.name}.odt`);
        expect(path.resolve(String(result.output_path))).toBe(path.resolve(expected));
        const exists = await fs.access(expected).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });
    },
  );

  test.openspec('[OCNV-03] convert_to_odt refuses to overwrite without allow_overwrite')(
    '[OCNV-03] convert_to_odt refuses to overwrite without allow_overwrite',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Overwrite guard body.']);
      const target = path.join(opened.tmpDir, 'taken.odt');
      await fs.writeFile(target, 'sentinel');
      const blocked = await convertToOdt(opened.mgr, { file_path: opened.inputPath, output_path: target });
      await then('the existing file is untouched until allow_overwrite is set', async () => {
        assertFailure(blocked, 'OVERWRITE_BLOCKED');
        expect(await fs.readFile(target, 'utf8')).toBe('sentinel');

        const allowed = await convertToOdt(opened.mgr, {
          file_path: opened.inputPath,
          output_path: target,
          allow_overwrite: true,
        });
        assertSuccess(allowed, 'convert_to_odt');
        const safety = await validateOdfArchiveSafety(await fs.readFile(target));
        expect(safety.ok).toBe(true);
      });
    },
  );

  test.openspec('[OCNV-04] convert_to_odt refuses to clobber the source document')(
    '[OCNV-04] convert_to_odt refuses to clobber the source document',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Source guard body.']);
      const before = await fs.readFile(opened.inputPath);
      const result = await convertToOdt(opened.mgr, {
        file_path: opened.inputPath,
        output_path: opened.inputPath,
      });
      await then('the source .docx is byte-identical after the blocked call', async () => {
        assertFailure(result, 'OVERWRITE_BLOCKED');
        expect((await fs.readFile(opened.inputPath)).equals(before)).toBe(true);
      });
    },
  );

  test.openspec('[OCNV-05] convert_to_odt returns ODF_UNAVAILABLE when the provider is missing')(
    '[OCNV-05] convert_to_odt returns ODF_UNAVAILABLE when the provider is missing',
    async ({ then }: AllureBddContext) => {
      // Re-import the tool with the loader mocked to null — the real odf-core IS installed in
      // the workspace, so the unavailable path is only reachable through the loader seam.
      vi.resetModules();
      vi.doMock('../odf_loader.js', () => ({ loadOdfCore: async () => null }));
      try {
        const { convertToOdt: convertWithoutOdf } = await import('./convert_to_odt.js');
        const opened = await openSession(['Provider missing body.']);
        const target = path.join(opened.tmpDir, 'never-written.odt');
        const result = await convertWithoutOdf(opened.mgr, { file_path: opened.inputPath, output_path: target });
        await then('a structured ODF_UNAVAILABLE error is returned and nothing is written', async () => {
          assertFailure(result, 'ODF_UNAVAILABLE');
          const exists = await fs.access(target).then(() => true).catch(() => false);
          expect(exists).toBe(false);
        });
      } finally {
        vi.doUnmock('../odf_loader.js');
        vi.resetModules();
      }
    },
  );
});
