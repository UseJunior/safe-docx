import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { runPrivateCorpus } from './corpus.js';

const testId = `render-corpus-test-${process.pid}-${Date.now()}`;
const externalDir = path.join(os.tmpdir(), testId);
const manifestPath = path.join(externalDir, 'manifest.json');
const outputDir = path.join(externalDir, 'output', testId);
const trackedRepositoryFile = fileURLToPath(new URL('../../../package.json', import.meta.url));

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

afterEach(async () => {
  await rm(manifestPath, { force: true });
  await rm(outputDir, { recursive: true, force: true });
  await rm(externalDir, { recursive: true, force: true });
});

describe('private renderer corpus', () => {
  itAllure('accepts only an ignored manifest/output and emits no markup text', async () => {
    await mkdir(externalDir, { recursive: true });
    const docx = path.join(externalDir, 'tracked.docx');
    const expected = path.join(externalDir, 'expected.txt');
    await writeFile(docx, 'private binary surrogate');
    await writeFile(expected, 'private expected markup must not appear in summary');
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      outputDir: `output/${testId}`,
      cases: [{ label: 'opaque-case', trackedDocxPath: docx, expectedMarkupTextPath: expected, expectedTrackedSha256: sha256('private binary surrogate'), requireRender: false }],
    }));

    const summary = await runPrivateCorpus(manifestPath);
    expect(summary).toEqual({ version: 1, cases: [{ label: 'opaque-case', trackedSha256: sha256('private binary surrogate'), status: 'not_run', reason: 'renderer not required for this case' }] });
    expect(await readFile(path.join(outputDir, 'summary.json'), 'utf8')).not.toContain('private expected markup');
  });

  itAllure('rejects a Git-tracked repository artifact as a private corpus input', async () => {
    await mkdir(externalDir, { recursive: true });
    const expected = path.join(externalDir, 'expected.txt');
    await writeFile(expected, 'not used');
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      outputDir: `output/${testId}`,
      cases: [{ label: 'tracked-input', trackedDocxPath: trackedRepositoryFile, expectedMarkupTextPath: expected, expectedTrackedSha256: '0'.repeat(64), requireRender: false }],
    }));

    await expect(runPrivateCorpus(manifestPath)).rejects.toThrow('must not be Git-tracked');
  });

  itAllure('fails empty expectations without stopping other corpus cases', async () => {
    await mkdir(externalDir, { recursive: true });
    const docx = path.join(externalDir, 'tracked.docx');
    const empty = path.join(externalDir, 'empty.txt');
    const whitespace = path.join(externalDir, 'whitespace.txt');
    const valid = path.join(externalDir, 'valid.txt');
    await writeFile(docx, 'private binary surrogate');
    await writeFile(empty, '');
    await writeFile(whitespace, ' \n\t');
    await writeFile(valid, 'private expected markup');
    const baseCase = {
      trackedDocxPath: docx,
      expectedTrackedSha256: sha256('private binary surrogate'),
      requireRender: false,
    };
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      outputDir: `output/${testId}`,
      cases: [
        { ...baseCase, label: 'empty-case', expectedMarkupTextPath: empty },
        { ...baseCase, label: 'whitespace-case', expectedMarkupTextPath: whitespace },
        { ...baseCase, label: 'valid-case', expectedMarkupTextPath: valid },
      ],
    }));

    const summary = await runPrivateCorpus(manifestPath);
    expect(summary.cases).toEqual([
      { label: 'empty-case', trackedSha256: sha256('private binary surrogate'), status: 'fail', reason: 'expected markup text is empty' },
      { label: 'whitespace-case', trackedSha256: sha256('private binary surrogate'), status: 'fail', reason: 'expected markup text is empty' },
      { label: 'valid-case', trackedSha256: sha256('private binary surrogate'), status: 'not_run', reason: 'renderer not required for this case' },
    ]);
  });

  itAllure('fails an unreadable expectation without stopping other corpus cases', async () => {
    await mkdir(externalDir, { recursive: true });
    const docx = path.join(externalDir, 'tracked.docx');
    const missing = path.join(externalDir, 'missing.txt');
    const valid = path.join(externalDir, 'valid.txt');
    await writeFile(docx, 'private binary surrogate');
    await writeFile(valid, 'private expected markup');
    const baseCase = {
      trackedDocxPath: docx,
      expectedTrackedSha256: sha256('private binary surrogate'),
      requireRender: false,
    };
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      outputDir: `output/${testId}`,
      cases: [
        { ...baseCase, label: 'missing-case', expectedMarkupTextPath: missing },
        { ...baseCase, label: 'valid-case', expectedMarkupTextPath: valid },
      ],
    }));

    const summary = await runPrivateCorpus(manifestPath);
    expect(summary.cases).toEqual([
      { label: 'missing-case', trackedSha256: sha256('private binary surrogate'), status: 'fail', reason: 'expected markup text unreadable' },
      { label: 'valid-case', trackedSha256: sha256('private binary surrogate'), status: 'not_run', reason: 'renderer not required for this case' },
    ]);
    expect(await readFile(path.join(outputDir, 'summary.json'), 'utf8')).not.toContain(missing);
  });

  itAllure('checks an optional expectation hash without exposing expectation text', async () => {
    await mkdir(externalDir, { recursive: true });
    const docx = path.join(externalDir, 'tracked.docx');
    const expected = path.join(externalDir, 'expected.txt');
    const expectedText = 'private expectation that must stay out of the summary';
    await writeFile(docx, 'private binary surrogate');
    await writeFile(expected, expectedText);
    const baseCase = {
      trackedDocxPath: docx,
      expectedMarkupTextPath: expected,
      expectedTrackedSha256: sha256('private binary surrogate'),
      requireRender: false,
    };
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      outputDir: `output/${testId}`,
      cases: [
        { ...baseCase, label: 'matching-pin', expectedMarkupTextSha256: sha256(expectedText) },
        { ...baseCase, label: 'mismatched-pin', expectedMarkupTextSha256: '0'.repeat(64) },
        { ...baseCase, label: 'no-pin' },
      ],
    }));

    const summary = await runPrivateCorpus(manifestPath);
    expect(summary.cases).toEqual([
      { label: 'matching-pin', trackedSha256: sha256('private binary surrogate'), status: 'not_run', reason: 'renderer not required for this case' },
      { label: 'mismatched-pin', trackedSha256: sha256('private binary surrogate'), status: 'fail', reason: 'expected markup text SHA-256 mismatch' },
      { label: 'no-pin', trackedSha256: sha256('private binary surrogate'), status: 'not_run', reason: 'renderer not required for this case' },
    ]);
    expect(await readFile(path.join(outputDir, 'summary.json'), 'utf8')).not.toContain(expectedText);
  });
});
