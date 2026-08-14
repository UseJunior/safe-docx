import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import JSZip from 'jszip';
import { measurePixelBands, verifyRenderedMarkup } from './render.js';
import type { RendererTools } from './types.js';

function fakeTools(markup = 'Visible markup text', profiles?: string[], hiddenDeletion = false): RendererTools {
  return {
    resolve: () => 'fake-tool',
    async run(_command, args) {
      if (args.includes('--convert-to')) {
        const out = args[args.indexOf('--outdir') + 1]!;
        const input = args[args.length - 1]!;
        const profile = args.find((argument) => argument.startsWith('-env:UserInstallation='));
        if (profile && profiles) {
          const directory = fileURLToPath(profile.slice('-env:UserInstallation='.length));
          profiles.push(await readFile(path.join(directory, 'user', 'registrymodifications.xcu'), 'utf8'));
        }
        await writeFile(path.join(out, `${path.basename(input, path.extname(input))}.pdf`), '%PDF-fake');
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === '-layout') return { code: 0, stdout: markup, stderr: '' };
      if (args.includes('-png')) {
        await writeFile(`${args[args.length - 1]}-1.png`, 'synthetic png');
        return { code: 0, stdout: '', stderr: '' };
      }
      const control = args[0]?.includes('control') ?? false;
      const pixels = control
        ? '0,0: #000000\n1,0: #000000\n'
        : hiddenDeletion
          ? '0,0: #0000ff\n1,0: #0000ff\n2,0: #000000\n3,0: #000000\n'
          : '0,0: #0000ff\n1,0: #ff0000\n2,0: #0000ff\n3,0: #ff0000\n';
      return { code: 0, stdout: pixels, stderr: '' };
    },
  };
}

async function trackedFixture(pathname: string, revision: 'ins' | 'del'): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:${revision} w:id="1"><w:r><w:${revision === 'del' ? 'delText' : 't'}>revision</w:${revision === 'del' ? 'delText' : 't'}></w:r></w:${revision}></w:p></w:body></w:document>`);
  await writeFile(pathname, await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('renderer verifier', () => {
  itAllure('counts broad blue and red pixel bands rather than requiring exact antialiasing pixels', () => {
    expect(measurePixelBands('0,0: #0a10ef\n1,0: #ef120c\n2,0: #202020\n')).toEqual({ sampledPixels: 3, bluePixels: 1, redPixels: 1 });
  });

  itAllure('returns not_run rather than green when a required external tool is missing', async () => {
    const file = path.join(os.tmpdir(), `render-missing-${Date.now()}.docx`);
    await writeFile(file, 'tracked');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: file,
      expectedMarkupText: 'text',
      outputDir: path.join(os.tmpdir(), `render-missing-out-${Date.now()}`),
      tools: { ...fakeTools(), resolve: () => null },
    });
    expect(result).toMatchObject({ status: 'not_run', reason: expect.stringContaining('Missing renderer tool') });
  });

  itAllure('binds caller markup text and calibrated configured/control colour measurements using fake tools', async () => {
    const root = path.join(os.tmpdir(), `render-fake-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'del');
    const profiles: string[] = [];
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source,
      expectedMarkupText: 'Visible markup text',
      outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', profiles),
      configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true, configuredContrastPassed: true, revisionVisibility: 'visible' });
    expect(result.reviewPngs).toHaveLength(1);
    expect(profiles).toEqual(expect.arrayContaining([
      expect.stringContaining('/org.openoffice.Office.Writer/Revision/TextDisplay/Insert'),
      expect.stringContaining('<value>255</value>'),
      expect.stringContaining('<value>16711680</value>'),
      expect.stringContaining('<value>-1</value>'),
    ]));
  });

  itAllure('does not diagnose hidden deletions when the tracked document has insertions only', async () => {
    const root = path.join(os.tmpdir(), `render-insertion-only-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'ins');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'insufficient-contrast' });
    expect(result.reason).not.toContain('hid configured deletions');
  });

  itAllure('prioritizes a PDF text mismatch over a hidden-deletion pixel pattern', async () => {
    const root = path.join(os.tmpdir(), `render-text-mismatch-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'del');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Different expected text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({
      status: 'fail', revisionVisibility: 'insufficient-contrast',
      reason: expect.stringContaining('PDF text does not equal'),
    });
  });

  itAllure('classifies blue-only revision output as hidden deletions and never passes it', async () => {
    const root = path.join(os.tmpdir(), `render-hidden-delete-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'del');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({
      status: 'fail', revisionVisibility: 'hidden-deletions', configuredContrastPassed: false,
      reason: expect.stringContaining('hid configured deletions'),
    });
  });

  itAllure('refuses a transform that mutates the authoritative DOCX', async () => {
    const root = path.join(os.tmpdir(), `render-transform-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await writeFile(source, 'tracked content');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source,
      expectedMarkupText: 'Visible markup text',
      outputDir: path.join(root, 'out'),
      tools: fakeTools(),
      transform: {
        id: 'bad-transform', version: '1',
        async apply(_input, workspace) {
          await writeFile(source, 'mutated');
          const output = path.join(workspace, 'render-only.docx');
          await writeFile(output, 'mutated');
          return output;
        },
      },
    });
    expect(result).toMatchObject({ status: 'fail', reason: expect.stringContaining('mutate authoritative') });
    expect(await readFile(source, 'utf8')).toBe('mutated');
  });
});
