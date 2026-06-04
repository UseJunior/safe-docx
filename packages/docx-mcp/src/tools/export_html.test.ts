import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { exportDocument } from './export.js';

const TEST_FEATURE = 'add-html-export';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function htmlPathFor(inputPath: string): string {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.html`);
}

describe('OpenSpec traceability: add-html-export (export tool)', () => {
  registerCleanup();

  test.openspec('html export writes a file and returns its path and content')(
    'html export writes a file and returns its path and content',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Hello world.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, format: 'html' });
      await then('the response carries the HTML under content and the file is on disk', async () => {
        assertSuccess(result, 'export');
        expect(result.format).toBe('html');
        expect(typeof result.content).toBe('string');
        expect(String(result.content)).toContain('<!DOCTYPE html>');
        expect(result.bytes_written).toBeGreaterThan(0);
        const onDisk = await fs.readFile(String(result.output_path), 'utf8');
        expect(onDisk).toBe(result.content);
        expect(onDisk).toContain('Hello world.');
      });
    },
  );

  test.openspec('default html output path derives from the source path')(
    'default html output path derives from the source path',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, format: 'html' });
      await then('the .docx extension is swapped for .html', async () => {
        assertSuccess(result, 'export');
        const expected = htmlPathFor(opened.inputPath);
        const exists = await fs.access(expected).then(() => true).catch(() => false);
        expect(exists).toBe(true);
        expect(path.resolve(String(result.output_path))).toBe(path.resolve(expected));
      });
    },
  );

  test.openspec('html overwrite of an existing output file is blocked by default')(
    'html overwrite of an existing output file is blocked by default',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const target = path.join(opened.tmpDir, 'taken.html');
      await fs.writeFile(target, 'PRE-EXISTING');
      const result = await exportDocument(opened.mgr, {
        file_path: opened.inputPath,
        format: 'html',
        output_path: target,
      });
      await then('export refuses and leaves the file untouched', async () => {
        assertFailure(result, 'OVERWRITE_BLOCKED', 'export');
        expect(await fs.readFile(target, 'utf8')).toBe('PRE-EXISTING');
      });
    },
  );

  test.openspec('include_markdown false omits the rendered html content')(
    'include_markdown false omits the rendered html content',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, {
        file_path: opened.inputPath,
        format: 'html',
        include_markdown: false,
      });
      await then('path and byte count are present but content is not', async () => {
        assertSuccess(result, 'export');
        expect(result.output_path).toBeTruthy();
        expect(result.bytes_written).toBeGreaterThan(0);
        expect(result.content).toBeUndefined();
      });
    },
  );

  test.openspec('html export rejects a Google Docs source')(
    'html export rejects a Google Docs source',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, { google_doc_id: 'some-google-doc-id', format: 'html' });
      await then('a provider-unsupported error is returned', async () => {
        assertFailure(result, 'UNSUPPORTED_FOR_PROVIDER', 'export');
      });
    },
  );
});
