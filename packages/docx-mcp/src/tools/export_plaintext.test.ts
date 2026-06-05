import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { exportDocument } from './export.js';

// A separate test file (not export.test.ts) on purpose: the spec-coverage validator maps one
// TEST_FEATURE per file, so the new feature's scenarios must live in their own file.
const TEST_FEATURE = 'add-text-export';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function txtPathFor(inputPath: string): string {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.txt`);
}

describe('OpenSpec traceability: add-text-export (export tool)', () => {
  registerCleanup();

  test.openspec('plaintext export writes a .txt file and returns its content')(
    'plaintext export writes a .txt file and returns its content',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Hello world.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, format: 'plaintext' });
      await then('the response carries content and the file is on disk', async () => {
        assertSuccess(result, 'export');
        expect(result.format).toBe('plaintext');
        expect(typeof result.content).toBe('string');
        expect(result.bytes_written).toBeGreaterThan(0);
        const onDisk = await fs.readFile(String(result.output_path), 'utf8');
        expect(onDisk).toBe(result.content);
        expect(onDisk).toContain('Hello world.');
      });
    },
  );

  test.openspec('plaintext export does not return a markdown field')(
    'plaintext export does not return a markdown field',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, format: 'plaintext' });
      await then('only the generic content field is present', async () => {
        assertSuccess(result, 'export');
        expect(result.content).toBeTruthy();
        expect(result.markdown).toBeUndefined();
      });
    },
  );

  test.openspec('plaintext default output path swaps the extension for .txt')(
    'plaintext default output path swaps the extension for .txt',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, format: 'plaintext' });
      await then('the .docx extension is swapped for .txt', async () => {
        assertSuccess(result, 'export');
        const expected = txtPathFor(opened.inputPath);
        const exists = await fs.access(expected).then(() => true).catch(() => false);
        expect(exists).toBe(true);
        expect(path.resolve(String(result.output_path))).toBe(path.resolve(expected));
      });
    },
  );

  test.openspec('plaintext export strips inline formatting')(
    'plaintext export strips inline formatting',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Plain body paragraph.']);
      const result = await exportDocument(opened.mgr, { file_path: opened.inputPath, format: 'plaintext' });
      await then('the rendering carries no inline tags', async () => {
        assertSuccess(result, 'export');
        expect(String(result.content)).not.toMatch(/<[^>]+>/);
        expect(String(result.content)).toContain('Plain body paragraph.');
      });
    },
  );

  test.openspec('plaintext overwrite is blocked by default')(
    'plaintext overwrite is blocked by default',
    async ({ then }: AllureBddContext) => {
      const opened = await openSession(['Body text.']);
      const target = path.join(opened.tmpDir, 'taken.txt');
      await fs.writeFile(target, 'PRE-EXISTING');
      const result = await exportDocument(opened.mgr, {
        file_path: opened.inputPath,
        format: 'plaintext',
        output_path: target,
      });
      await then('export refuses and leaves the file untouched', async () => {
        assertFailure(result, 'OVERWRITE_BLOCKED', 'export');
        expect(await fs.readFile(target, 'utf8')).toBe('PRE-EXISTING');
      });
    },
  );
});
