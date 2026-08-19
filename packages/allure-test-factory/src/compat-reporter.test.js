import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import Reporter from './compat-reporter.js';

/**
 * Regression coverage for the Allure tree-grouping normalization in
 * `normalizeResultLabels`. The exercised shapes are the *raw* labels
 * allure-vitest emits; the assertions are the rewritten display-name tree.
 *
 * allure-vitest >=3.6 prepends a project-scope segment (the nearest
 * package.json `name`) ahead of the source directory — `package` becomes
 * `@scope/pkg.src.foo.test.ts` and `fullName` becomes
 * `@scope/pkg:src/foo.test.ts#test`. The pre-3.6 shape had the source root at
 * index 0. Both must normalize to the same `<display>.<file>` tree so the
 * report grouping is stable across the version bump.
 */

const DOCX_CORE_OPTS = {
  innerReporterPath: '',
  packageName: 'DOCX Comparison',
  packageNameOverrides: { 'test-primitives': 'DOCX Primitives' },
};

let resultsDir;

beforeEach(async () => {
  resultsDir = await mkdtemp(join(tmpdir(), 'allure-compat-'));
});

afterEach(async () => {
  await rm(resultsDir, { recursive: true, force: true });
});

async function writeResult(name, result) {
  await writeFile(join(resultsDir, name), JSON.stringify(result));
}

async function normalize(opts = DOCX_CORE_OPTS) {
  const reporter = new Reporter({ ...opts, resultsDir });
  await reporter.normalizeResultLabels();
  const entries = (await readdir(resultsDir)).filter((e) => e.endsWith('-result.json'));
  const out = {};
  for (const entry of entries) {
    out[entry] = JSON.parse(await readFile(join(resultsDir, entry), 'utf-8'));
  }
  return out;
}

describe('compat-reporter normalizeResultLabels', () => {
  it('rewrites the allure-vitest >=3.6 project-scoped shape to the display-name tree', async () => {
    await writeResult('a-result.json', {
      labels: [{ name: 'package', value: '@usejunior/docx-core.src.atomizer-rpr.test.ts' }],
      fullName: '@usejunior/docx-core:src/atomizer-rpr.test.ts#ComparisonUnitAtom.rPr sets rPr',
      titlePath: ['@usejunior/docx-core', 'src', 'atomizer-rpr.test.ts', 'ComparisonUnitAtom.rPr'],
    });

    const { 'a-result.json': r } = await normalize();

    expect(r.labels.find((l) => l.name === 'package').value).toBe('DOCX Comparison.atomizer-rpr.test.ts');
    expect(r.fullName).toBe('DOCX Comparison/atomizer-rpr.test.ts#ComparisonUnitAtom.rPr sets rPr');
    // Source file is stripped from titlePath so the tree matches the breadcrumb.
    expect(r.titlePath).toEqual(['DOCX Comparison', 'ComparisonUnitAtom.rPr']);
  });

  it('applies packageNameOverrides to the source-root segment (test-primitives)', async () => {
    await writeResult('b-result.json', {
      labels: [{ name: 'package', value: '@usejunior/docx-core.test-primitives.bookmarks.test.ts' }],
      fullName: '@usejunior/docx-core:test-primitives/bookmarks.test.ts#Paragraph Bookmarks mints IDs',
      titlePath: ['@usejunior/docx-core', 'test-primitives', 'bookmarks.test.ts', 'Paragraph Bookmarks'],
    });

    const { 'b-result.json': r } = await normalize();

    expect(r.labels.find((l) => l.name === 'package').value).toBe('DOCX Primitives.bookmarks.test.ts');
    expect(r.fullName).toBe('DOCX Primitives/bookmarks.test.ts#Paragraph Bookmarks mints IDs');
    expect(r.titlePath).toEqual(['DOCX Primitives', 'Paragraph Bookmarks']);
  });

  it('keeps nested source directories below the source root', async () => {
    await writeResult('c-result.json', {
      labels: [
        {
          name: 'package',
          value: '@usejunior/docx-core.src.tagged.pipeline.field-validation.test.ts',
        },
      ],
      fullName:
        '@usejunior/docx-core:src/tagged/pipeline.field-validation.test.ts#validateFieldStructure rejects',
      titlePath: [
        '@usejunior/docx-core',
        'src',
        'tagged',
        'pipeline.field-validation.test.ts',
        'validateFieldStructure',
      ],
    });

    const { 'c-result.json': r } = await normalize();

    expect(r.labels.find((l) => l.name === 'package').value).toBe(
      'DOCX Comparison.tagged.pipeline.field-validation.test.ts',
    );
    expect(r.fullName).toBe(
      'DOCX Comparison/tagged/pipeline.field-validation.test.ts#validateFieldStructure rejects',
    );
    // Only a top-level source file (index 1) is stripped; nested dirs are kept.
    expect(r.titlePath).toEqual([
      'DOCX Comparison',
      'tagged',
      'pipeline.field-validation.test.ts',
      'validateFieldStructure',
    ]);
  });

  it('stays backward compatible with the pre-3.6 unscoped shape', async () => {
    await writeResult('d-result.json', {
      labels: [{ name: 'package', value: 'src.atomizer-rpr.test.ts' }],
      fullName: 'src/atomizer-rpr.test.ts#ComparisonUnitAtom.rPr sets rPr',
      titlePath: ['src', 'atomizer-rpr.test.ts', 'ComparisonUnitAtom.rPr'],
    });

    const { 'd-result.json': r } = await normalize();

    expect(r.labels.find((l) => l.name === 'package').value).toBe('DOCX Comparison.atomizer-rpr.test.ts');
    expect(r.fullName).toBe('DOCX Comparison/atomizer-rpr.test.ts#ComparisonUnitAtom.rPr sets rPr');
    expect(r.titlePath).toEqual(['DOCX Comparison', 'ComparisonUnitAtom.rPr']);
  });

  it('de-duplicates suite labels, keeping the last value', async () => {
    await writeResult('e-result.json', {
      labels: [
        { name: 'parentSuite', value: 'auto-derived' },
        { name: 'parentSuite', value: 'from-setup' },
        { name: 'suite', value: 'auto' },
        { name: 'suite', value: 'final' },
        { name: 'package', value: '@usejunior/docx-core.src.foo.test.ts' },
      ],
      fullName: '@usejunior/docx-core:src/foo.test.ts#t',
      titlePath: ['@usejunior/docx-core', 'src', 'foo.test.ts', 'suite'],
    });

    const { 'e-result.json': r } = await normalize();

    expect(r.labels.filter((l) => l.name === 'parentSuite').map((l) => l.value)).toEqual(['from-setup']);
    expect(r.labels.filter((l) => l.name === 'suite').map((l) => l.value)).toEqual(['final']);
  });

  it('leaves labels untouched when no packageName is configured', async () => {
    await writeResult('f-result.json', {
      labels: [{ name: 'package', value: '@usejunior/docx-core.src.foo.test.ts' }],
      fullName: '@usejunior/docx-core:src/foo.test.ts#t',
      titlePath: ['@usejunior/docx-core', 'src', 'foo.test.ts', 'suite'],
    });

    const { 'f-result.json': r } = await normalize({ innerReporterPath: '' });

    expect(r.labels.find((l) => l.name === 'package').value).toBe('@usejunior/docx-core.src.foo.test.ts');
    expect(r.titlePath).toEqual(['@usejunior/docx-core', 'src', 'foo.test.ts', 'suite']);
  });
});
