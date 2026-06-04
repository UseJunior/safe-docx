import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { exportDocument } from './export.js';

const TEST_FEATURE = 'add-markdown-export';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function mdPathFor(inputPath: string): string {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.md`);
}

describe('OpenSpec traceability: add-markdown-export (export tool)', () => {
  registerCleanup();

  test.openspec('markdown export writes a file and returns its path and content')(
    'markdown export writes a file and returns its path and content',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Hello world.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath });
      await then('the response carries the rendering and the file is on disk', async () => {
        assertSuccess(result, 'export');
        expect(result.format).toBe('markdown');
        expect(typeof result.markdown).toBe('string');
        expect(result.bytes_written).toBeGreaterThan(0);
        const onDisk = await fs.readFile(String(result.output_path), 'utf8');
        expect(onDisk).toBe(result.markdown);
        expect(onDisk).toContain('Hello world.');
      });
    },
  );

  test.openspec('default output path derives from the source path')(
    'default output path derives from the source path',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath });
      await then('the .docx extension is swapped for .md', async () => {
        assertSuccess(result, 'export');
        const expected = mdPathFor(opened.inputPath);
        const exists = await fs.access(expected).then(() => true).catch(() => false);
        expect(exists).toBe(true);
        expect(path.resolve(String(result.output_path))).toBe(path.resolve(expected));
      });
    },
  );

  test.openspec('explicit output_path is honored')(
    'explicit output_path is honored',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const target = path.join(opened.tmpDir, 'custom-name.md');
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, output_path: target });
      await then('the Markdown is written to the explicit path', async () => {
        assertSuccess(result, 'export');
        const exists = await fs.access(target).then(() => true).catch(() => false);
        expect(exists).toBe(true);
        expect(path.resolve(String(result.output_path))).toBe(path.resolve(target));
      });
    },
  );

  test.openspec('overwrite of an existing output file is blocked by default')(
    'overwrite of an existing output file is blocked by default',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const target = path.join(opened.tmpDir, 'taken.md');
      await fs.writeFile(target, 'PRE-EXISTING');
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, output_path: target });
      await then('export refuses and leaves the file untouched', async () => {
        assertFailure(result, 'OVERWRITE_BLOCKED', 'export');
        expect(await fs.readFile(target, 'utf8')).toBe('PRE-EXISTING');
      });
    },
  );

  test.openspec('allow_overwrite permits replacing an existing output file')(
    'allow_overwrite permits replacing an existing output file',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Fresh body.']);
      const target = path.join(opened.tmpDir, 'taken.md');
      await fs.writeFile(target, 'PRE-EXISTING');
      const result = await exportDocument(opened.mgr, {
        file_path: opened.inputPath,
        output_path: target,
        allow_overwrite: true,
      });
      await then('the file is replaced with the rendering', async () => {
        assertSuccess(result, 'export');
        const onDisk = await fs.readFile(target, 'utf8');
        expect(onDisk).not.toBe('PRE-EXISTING');
        expect(onDisk).toContain('Fresh body.');
      });
    },
  );

  test.openspec('unknown export format is rejected')(
    'unknown export format is rejected',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, {
        file_path: opened.inputPath,
        format: 'pdf',
      });
      await then('an INVALID_FORMAT error is returned', async () => {
        assertFailure(result, 'INVALID_FORMAT', 'export');
      });
    },
  );

  test.openspec('include_markdown false omits the rendered content')(
    'include_markdown false omits the rendered content',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, {
        file_path: opened.inputPath,
        include_markdown: false,
      });
      await then('path and byte count are present but markdown is not', async () => {
        assertSuccess(result, 'export');
        expect(result.output_path).toBeTruthy();
        expect(result.bytes_written).toBeGreaterThan(0);
        expect(result.markdown).toBeUndefined();
      });
    },
  );

  test.openspec('export resolves a session from file_path')(
    'export resolves a session from file_path',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Resolvable.']);
      // Call with file_path only (no session_id); resolution should still find the session.
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath });
      await then('the export succeeds via file-path resolution', async () => {
        assertSuccess(result, 'export');
        expect(String(result.markdown)).toContain('Resolvable.');
      });
    },
  );

  test.openspec('export rejects a Google Docs source')(
    'export rejects a Google Docs source',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, { google_doc_id: 'some-google-doc-id' });
      await then('a provider-unsupported error is returned', async () => {
        assertFailure(result, 'UNSUPPORTED_FOR_PROVIDER', 'export');
      });
    },
  );
});
