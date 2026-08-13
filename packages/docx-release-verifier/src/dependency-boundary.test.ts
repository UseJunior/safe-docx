import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
const prohibited = /from\s+['"](?:@usejunior\/(?:docx-core|docx-compare|docx-markdoc)|.*(?:docx-core|docx-compare|docx-markdoc).*)['"]|require\(\s*['"](?:@usejunior\/(?:docx-core|docx-compare|docx-markdoc))/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  }));
  return nested.flat();
}

describe('independence boundary', () => {
  itAllure('does not import generator, mutation, comparison, or replay packages', async () => {
    const files = await sourceFiles(sourceDirectory);
    await expect(Promise.all(files.map(async (file) => ({ file, contents: await readFile(file, 'utf8') })))).resolves.toSatisfy((sources) => sources.every(({ contents }) => !prohibited.test(contents)));
  });
});
