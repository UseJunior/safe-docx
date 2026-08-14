import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { verifyRelease } from './verifier.js';
import type { ReleaseManifest } from './types.js';
import { compileMarkdoc, importDocxToMarkdoc, requireMarkdoc } from '../../docx-markdoc/src/index.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function documentXml(body: string): string {
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
}

async function writeDocx(path: string, body: string, commentsXml?: string): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', documentXml(body));
  if (commentsXml) zip.file('word/comments.xml', commentsXml);
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function fixture(): Promise<{ directory: string; manifest: ReleaseManifest }> {
  const directory = await mkdtemp(join(tmpdir(), 'release-verifier-'));
  const originalPath = join(directory, 'original.docx');
  const intendedCleanPath = join(directory, 'clean.docx');
  const trackedPath = join(directory, 'tracked.docx');
  await writeDocx(originalPath, '<w:p><w:r><w:t>Hello old</w:t></w:r></w:p>');
  await writeDocx(intendedCleanPath, '<w:p><w:r><w:t>Hello new</w:t></w:r></w:p>');
  await writeDocx(trackedPath, '<w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:del w:id="1"><w:r><w:delText>old</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>new</w:t></w:r></w:ins></w:p>');
  return { directory, manifest: { version: 1, originalPath, intendedCleanPath, trackedPath, literalCounts: [{ text: 'Hello new', count: 1 }], presentOnlyInAccept: ['new'], absentFromAccept: ['old'], mutationControl: { projection: 'accept', expected: 'intendedClean' } } };
}

describe('independent release verifier', () => {
  itAllure('verifies one surgical edit against the public OpenAgreements Letter of Intent', async () => {
    const fixturePath = fileURLToPath(new URL('../../../tests/test_documents/open-agreements/letter-of-intent.docx', import.meta.url));
    const original = await readFile(fixturePath);
    const imported = await importDocxToMarkdoc(original);
    const paragraph = requireMarkdoc(imported.markdoc).scaffold.find((entry) => entry.originalText === 'Letter of Intent');
    if (!paragraph) throw new Error('Public LOI title paragraph missing');
    const block = new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`);
    const replacement = [
      `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="clarify-title" format="inherit-source-paragraph" %}`,
      '{% before %}', 'Letter of Intent', '{% /before %}',
      '{% after %}', 'Mutual Letter of Intent', '{% /after %}', '{% /change %}',
    ].join('\n');
    const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc.replace(block, replacement));
    const directory = await mkdtemp(join(tmpdir(), 'release-loi-public-'));
    const originalPath = join(directory, 'anchored.docx');
    const intendedCleanPath = join(directory, 'clean.docx');
    const trackedPath = join(directory, 'tracked.docx');
    await Promise.all([
      writeFile(originalPath, imported.anchoredSource), writeFile(intendedCleanPath, compiled.clean), writeFile(trackedPath, compiled.tracked),
    ]);
    const beforeTracked = await readFile(trackedPath);
    const result = await verifyRelease({
      version: 1, originalPath, intendedCleanPath, trackedPath,
      presentOnlyInAccept: ['Mutual Letter of Intent'],
      mutationControl: { projection: 'accept', expected: 'intendedClean' },
    });
    expect(result.gates.semantic.status).toBe('pass');
    expect(result.gates.minimality).toMatchObject({ status: 'pass', details: { evidence: { lostTokens: 0 } } });
    expect(result.gates.package.status).toBe('pass');
    expect(result.gates.mutationControl.status).toBe('pass');
    expect(result.exitCode).toBe(0);
    expect(await readFile(trackedPath)).toEqual(beforeTracked);
    expect(await readFile(fixturePath)).toEqual(original);
  });

  itAllure('projects namespace-aware visible OOXML without indentation or run-fragmentation noise', async () => {
    const { manifest } = await fixture();
    await writeDocx(manifest.originalPath, `
      <w:p>
        <w:pPr><w:spacing w:before="120"/></w:pPr>
        <w:r><w:t>Hello</w:t></w:r>
        <w:r><w:t xml:space="preserve"> old</w:t></w:r>
      </w:p>`);
    await writeDocx(manifest.intendedCleanPath, `
      <w:p>
        <w:r><w:t>Hello</w:t></w:r>
        <w:r><w:t xml:space="preserve"> new</w:t></w:r>
      </w:p>`);
    await writeDocx(manifest.trackedPath, `
      <w:p>
        <w:r><w:t>Hello</w:t></w:r>
        <w:r><w:t xml:space="preserve"> </w:t></w:r>
        <w:del w:id="1"><w:r><w:delText>old</w:delText></w:r></w:del>
        <w:ins w:id="2"><w:r><w:t>new</w:t></w:r></w:ins>
      </w:p>`);
    const result = await verifyRelease(manifest);
    expect(result.projections).toMatchObject({
      original: { paragraphs: ['Hello old'] }, intendedClean: { paragraphs: ['Hello new'] },
      accept: { paragraphs: ['Hello new'] }, reject: { paragraphs: ['Hello old'] },
    });
    expect(result.gates.semantic.status).toBe('pass');
    expect(result.gates.minimality.status).toBe('pass');
  });

  itAllure('derives exact accept/reject projections and proves mutation sensitivity without changing inputs', async () => {
    const { manifest } = await fixture();
    const before = await readFile(manifest.trackedPath);
    const result = await verifyRelease(manifest);
    expect(result.gates.semantic.status).toBe('pass');
    expect(result.gates.expectations.status).toBe('pass');
    expect(result.gates.mutationControl.status).toBe('pass');
    expect(result.exitCode).toBe(0);
    expect(await readFile(manifest.trackedPath)).toEqual(before);
  });

  itAllure('fails exact replay when an expected projection is changed', async () => {
    const { manifest } = await fixture();
    await writeDocx(manifest.intendedCleanPath, '<w:p><w:r><w:t>Hello changed</w:t></w:r></w:p>');
    const result = await verifyRelease(manifest);
    expect(result.gates.semantic.status).toBe('fail');
    expect(result.exitCode).toBe(1);
  });

  itAllure('binds separate renderer evidence to the exact tracked bytes', async () => {
    const { directory, manifest } = await fixture();
    const evidencePath = join(directory, 'renderer.json');
    const trackedSha256 = createHash('sha256').update(await readFile(manifest.trackedPath)).digest('hex');
    await writeFile(evidencePath, JSON.stringify({ status: 'pass', trackedSha256, markupTextMatchesPdf: true, configuredContrastPassed: true }));
    const passed = await verifyRelease({ ...manifest, requireRenderer: true, rendererEvidencePath: evidencePath });
    expect(passed.gates.renderer.status).toBe('pass');
    expect(passed.exitCode).toBe(0);
    await writeFile(evidencePath, JSON.stringify({ status: 'pass', trackedSha256: '0'.repeat(64), markupTextMatchesPdf: true, configuredContrastPassed: true }));
    const failed = await verifyRelease({ ...manifest, requireRenderer: true, rendererEvidencePath: evidencePath });
    expect(failed.gates.renderer.status).toBe('fail');
    expect(failed.exitCode).toBe(1);
  });

  itAllure('fails native comment integrity when OOXML comment IDs disagree', async () => {
    const { manifest } = await fixture();
    await writeDocx(manifest.trackedPath,
      '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:del w:id="1"><w:r><w:delText>old</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>new</w:t></w:r></w:ins><w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="1"/></w:r></w:p>',
      `<w:comments xmlns:w="${W}"><w:comment w:id="1"/></w:comments>`);
    const result = await verifyRelease({ ...manifest, requireNativeComments: true });
    expect(result.gates.comments.status).toBe('fail');
    expect(result.exitCode).toBe(1);
  });

  itAllure('fails corrupt packages independently of semantic text', async () => {
    const { manifest } = await fixture();
    await writeFile(manifest.trackedPath, 'not a zip');
    const result = await verifyRelease(manifest);
    expect(result.gates.package.status).toBe('fail');
    expect(result.exitCode).toBe(1);
  });
});
