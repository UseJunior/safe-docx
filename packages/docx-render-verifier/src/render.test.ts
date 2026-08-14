import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../docx-core/src/testing/ooxml-fixtures.js';
import JSZip from 'jszip';
import { defaultRendererTools, measurePixelBands, verifyRenderedMarkup } from './render.js';
import type { RendererTools } from './types.js';

function fakeTools(markup = 'Visible markup text', profiles?: string[], hiddenDeletion = false, pageCount = 1): RendererTools {
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
        // Review rasterization passes -f/-l for a single page; full-document
        // rasterization emits one PNG per simulated rendered page.
        const pages = args.includes('-f') ? 1 : pageCount;
        for (let page = 1; page <= pages; page++) await writeFile(`${args[args.length - 1]}-${page}.png`, 'synthetic png');
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

async function trackedFixture(pathname: string, revision: 'ins' | 'del' | 'ins-del' | 'empty-del', headerDeletion: 'none' | 'orphan' | 'referenced' = 'none'): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const markup = revision === 'empty-del'
    ? '<w:del w:id="1"><w:r><w:rPr><w:b/></w:rPr></w:r></w:del>'
    : revision === 'ins-del'
      ? '<w:ins w:id="1"><w:r><w:t>insertion</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>deletion</w:delText></w:r></w:del>'
    : `<w:${revision} w:id="1"><w:r><w:${revision === 'del' ? 'delText' : 't'}>revision</w:${revision === 'del' ? 'delText' : 't'}></w:r></w:${revision}>`;
  const headerReference = headerDeletion === 'referenced' ? '<w:sectPr><w:headerReference r:id="rIdHeader1"/></w:sectPr>' : '';
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p>${markup}</w:p>${headerReference}</w:body></w:document>`);
  if (headerDeletion !== 'none') {
    zip.file('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:del w:id="2"><w:r><w:delText>header deletion</w:delText></w:r></w:del></w:p></w:hdr>');
  }
  if (headerDeletion === 'referenced') {
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>');
  }
  await writeFile(pathname, await zip.generateAsync({ type: 'nodebuffer' }));
}

const W_XMLNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

async function fixtureFragment(name: string): Promise<string> {
  return (await readFile(path.join(FIXTURES_DIR, name), 'utf8')).trim();
}

function storyPartXml(fragment: string): string {
  return fragment.replace(/^<w:(hdr|ftr)>/u, `<w:$1 xmlns:w="${W_XMLNS}">`);
}

async function paginatedFixture(pathname: string, parts: { body: string; header?: string; footer?: string; pgNumStart?: number }): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const references = `${parts.header ? '<w:headerReference r:id="rIdHeader1"/>' : ''}${parts.footer ? '<w:footerReference r:id="rIdFooter1"/>' : ''}${parts.pgNumStart === undefined ? '' : `<w:pgNumType w:start="${parts.pgNumStart}"/>`}`;
  const sectPr = references.length > 0 ? `<w:sectPr>${references}</w:sectPr>` : '';
  zip.file('word/document.xml', `<w:document xmlns:w="${W_XMLNS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${parts.body}${sectPr}</w:body></w:document>`);
  const relationships: string[] = [];
  if (parts.header) {
    zip.file('word/header1.xml', storyPartXml(parts.header));
    relationships.push('<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
  }
  if (parts.footer) {
    zip.file('word/footer1.xml', storyPartXml(parts.footer));
    relationships.push('<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
  }
  if (relationships.length > 0) {
    zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  }
  await writeFile(pathname, await zip.generateAsync({ type: 'nodebuffer' }));
}

const ALNUM_EXPECTED = 'Synthetic clause prefix OldTerm NewTerm synthetic suffix.';
const ALNUM_JOINED_PDF = 'Synthetic clause prefix OldTermNewTerm synthetic suffix.';
const ORDINARY_RUN_SPLIT_RENDERED = 'Synthetic unchanged fragmented clause inserted-alpha and removed-beta synthetic tail.';

const MULTI_PAGE_EXPECTED = 'Synthetic first page opening text. inserted-alpha Synthetic second page closing text. removed-beta';
const MULTI_PAGE_PDF = [
  'Synthetic Neutral Draft Header',
  'Synthetic first page opening text. inserted-alpha',
  'Page 1',
  '\f',
  'Synthetic Neutral Draft Header',
  'Synthetic second page closing text. removed-beta',
  'Page 2',
].join('\n');

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
    await trackedFixture(source, 'ins-del');
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

  itAllure('does not infer visible configured insertions from blue pixels in a deletion-only document', async () => {
    const root = path.join(os.tmpdir(), `render-deletion-only-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'del');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'insufficient-contrast' });
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

  itAllure('reports a text-binding failure alongside, not instead of, pixel-derived colour evidence', async () => {
    const root = path.join(os.tmpdir(), `render-text-mismatch-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'del');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Different expected text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({
      status: 'fail', revisionVisibility: 'insufficient-contrast', markupTextMatchesPdf: false,
      reason: expect.stringContaining('PDF text binding failed'),
    });
    expect(result.reason).toContain('colour bands');
  });

  itAllure('does not diagnose hidden deletions from an empty property-only deletion wrapper', async () => {
    const root = path.join(os.tmpdir(), `render-empty-deletion-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'empty-del');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'insufficient-contrast' });
    expect(result.reason).not.toContain('hid configured deletions');
  });

  itAllure('recognizes visible deletion payload in a rendered header story', async () => {
    const root = path.join(os.tmpdir(), `render-header-deletion-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'ins', 'referenced');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'hidden-deletions' });
  });

  itAllure('ignores deletion payload in an orphaned unreferenced header part', async () => {
    const root = path.join(os.tmpdir(), `render-orphan-header-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'ins', 'orphan');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'insufficient-contrast' });
  });

  itAllure('classifies deletion evidence from the disposable transformed input', async () => {
    const root = path.join(os.tmpdir(), `render-transform-add-deletion-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'ins');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
      transform: {
        id: 'add-visible-deletion', version: '1',
        async apply(_input, workspace) {
          const output = path.join(workspace, 'render-only.docx');
          await trackedFixture(output, 'ins-del');
          return output;
        },
      },
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'hidden-deletions' });
  });

  itAllure('does not use authoritative-source deletion evidence removed by a render transform', async () => {
    const root = path.join(os.tmpdir(), `render-transform-remove-deletion-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'del');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text', undefined, true), configuredPixelFloor: 2,
      transform: {
        id: 'remove-visible-deletion', version: '1',
        async apply(_input, workspace) {
          const output = path.join(workspace, 'render-only.docx');
          await trackedFixture(output, 'ins');
          return output;
        },
      },
    });
    expect(result).toMatchObject({ status: 'fail', revisionVisibility: 'insufficient-contrast' });
  });

  itAllure('classifies blue-only revision output as hidden deletions and never passes it', async () => {
    const root = path.join(os.tmpdir(), `render-hidden-delete-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await trackedFixture(source, 'ins-del');
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

  itAllure('binds exact single-page text through the fixture body without pagination residue', async () => {
    const root = path.join(os.tmpdir(), `render-single-page-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const text = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    await paginatedFixture(source, { body: await fixtureFragment('single-page-body.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: text, outputDir: path.join(root, 'out'),
      tools: fakeTools(text), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true, revisionVisibility: 'visible' });
    expect(result.textBinding).toMatchObject({ matched: true, pageCount: 1, missingTokenSample: [], unexplainedTokenSample: [] });
  });

  itAllure('passes multi-page renders whose repeated header, footer, and page numbers are pagination artifacts', async () => {
    const root = path.join(os.tmpdir(), `render-multi-page-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, {
      body: await fixtureFragment('multi-page-body.xml'),
      header: await fixtureFragment('repeated-header.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
    });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: MULTI_PAGE_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools(MULTI_PAGE_PDF, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true, revisionVisibility: 'visible' });
    expect(result.textBinding).toMatchObject({ matched: true, pageCount: 2 });
  });

  itAllure('fails text binding when logical content is missing while keeping colour visibility truthful', async () => {
    const root = path.join(os.tmpdir(), `render-missing-content-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, {
      body: await fixtureFragment('multi-page-body.xml'),
      header: await fixtureFragment('repeated-header.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
    });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: MULTI_PAGE_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools(MULTI_PAGE_PDF.replace('removed-beta', ''), undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({
      status: 'fail', markupTextMatchesPdf: false, revisionVisibility: 'visible',
      reason: expect.stringContaining('missing from the rendered PDF'),
    });
    expect(result.textBinding?.missingTokenSample).toContain('removed-beta');
    expect(result.reason).not.toContain('colour bands');
  });

  itAllure('fails rendered residue that no header, footer, or page field can account for', async () => {
    const root = path.join(os.tmpdir(), `render-unexplained-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, {
      body: await fixtureFragment('multi-page-body.xml'),
      header: await fixtureFragment('repeated-header.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
    });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: MULTI_PAGE_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools(`${MULTI_PAGE_PDF}\nleaked-residue-sentence`, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({
      status: 'fail', markupTextMatchesPdf: false,
      reason: expect.stringContaining('not attributable'),
    });
    expect(result.textBinding?.unexplainedTokenSample).toContain('leaked-residue-sentence');
  });

  itAllure('bounds repeated header residue by the rendered page count', async () => {
    const root = path.join(os.tmpdir(), `render-header-bound-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    await paginatedFixture(source, {
      body: await fixtureFragment('single-page-body.xml'),
      header: await fixtureFragment('repeated-header.xml'),
    });
    const doubledHeader = `Synthetic Neutral Draft Header\n${body}\nSynthetic Neutral Draft Header`;
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out'),
      tools: fakeTools(doubledHeader), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.unexplainedTokenSample).toContain('Neutral');
  });

  itAllure('rejects numeric residue when no rendered story declares a page field', async () => {
    const root = path.join(os.tmpdir(), `render-no-page-field-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    await paginatedFixture(source, { body: await fixtureFragment('single-page-body.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out'),
      tools: fakeTools(`${body}\n7`), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.unexplainedTokenSample).toContain('7');
  });

  itAllure('rejects numeric residue outside the rendered page-number range even when page fields exist', async () => {
    const root = path.join(os.tmpdir(), `render-numeric-cap-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, {
      body: await fixtureFragment('multi-page-body.xml'),
      header: await fixtureFragment('repeated-header.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
    });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: MULTI_PAGE_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools(`${MULTI_PAGE_PDF}\n3 4 5 6 7`, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.unexplainedTokenSample).toContain('7');
  });

  itAllure('does not let a PAGE field launder a meaningful out-of-range number such as an amount', async () => {
    const root = path.join(os.tmpdir(), `render-numeric-smuggle-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    await paginatedFixture(source, {
      body: await fixtureFragment('single-page-body.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
    });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out'),
      tools: fakeTools(`${body}\nPage 1\n999`), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.unexplainedTokenSample).toContain('999');
  });

  itAllure('fails when repeated header vocabulary would otherwise mask a missing body token', async () => {
    const root = path.join(os.tmpdir(), `render-header-mask-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    await paginatedFixture(source, {
      body: await fixtureFragment('single-page-body.xml'),
      header: await fixtureFragment('repeated-header.xml'),
    });
    // The caller's projection requires a body occurrence of "Draft"; the body
    // dropped it, and only the per-page repeated header supplies that token.
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: `${body} Draft`, outputDir: path.join(root, 'out'),
      tools: fakeTools(`Synthetic Neutral Draft Header\n${body}\f\nSynthetic Neutral Draft Header`, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.missingTokenSample).toContain('Draft');
  });

  itAllure('grants a body PAGE field one rendered occurrence rather than one per page', async () => {
    const root = path.join(os.tmpdir(), `render-body-field-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    const bodyWithField = `${await fixtureFragment('single-page-body.xml')}<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`;
    await paginatedFixture(source, { body: bodyWithField });
    const oneRendering = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out-one'),
      tools: fakeTools(`${body}\f\n2`, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(oneRendering).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    const twoRenderings = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out-two'),
      tools: fakeTools(`${body} 1\f\n2`, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(twoRenderings).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(twoRenderings.textBinding?.unexplainedTokenSample).toContain('2');
  });

  itAllure('reserves offset page numbers when the section declares an explicit numbering start', async () => {
    const root = path.join(os.tmpdir(), `render-pgnum-start-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = 'Synthetic single page opening clause. inserted-alpha removed-beta';
    await paginatedFixture(source, {
      body: await fixtureFragment('single-page-body.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
      pgNumStart: 5,
    });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out'),
      tools: fakeTools(`${body}\nPage 5`), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
  });

  itAllure('accepts an insertion and deletion order swap as the documented order-insensitivity limitation', async () => {
    const root = path.join(os.tmpdir(), `render-order-swap-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('single-page-body.xml') });
    // Placement is deliberately outside the automated text-binding verdict;
    // the review PNGs exist for optional human placement review.
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic single page opening clause. inserted-alpha removed-beta', outputDir: path.join(root, 'out'),
      tools: fakeTools('removed-beta Synthetic single page opening clause. inserted-alpha'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
  });

  itAllure('accepts renderer-reordered text-box content because binding is order-independent', async () => {
    const root = path.join(os.tmpdir(), `render-text-box-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('reordered-text-box.xml') });
    const logicalOrder = 'Anchor paragraph before floating content. inserted-alpha Floating box narrative sentence. removed-beta';
    const rendererOrder = 'Floating box narrative sentence. removed-beta\nAnchor paragraph before floating content. inserted-alpha';
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: logicalOrder, outputDir: path.join(root, 'out'),
      tools: fakeTools(rendererOrder), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true, revisionVisibility: 'visible' });
  });

  itAllure('tolerates renderer-concatenated output at an OOXML-declared adjacent deletion/insertion junction', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-merge-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: ALNUM_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools(ALNUM_JOINED_PDF), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true, revisionVisibility: 'visible' });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 1 });
  });

  itAllure('binds separated renderer output at a declared junction without spending any normalization', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-separated-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: ALNUM_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools(ALNUM_EXPECTED), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 0 });
  });

  itAllure('tolerates a renderer-created separator where the caller projection concatenates the junction', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-split-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: ALNUM_JOINED_PDF, outputDir: path.join(root, 'out'),
      tools: fakeTools(ALNUM_EXPECTED), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, revisionBoundaryNormalizationCount: 1 });
  });

  itAllure('extends the junction tolerance through punctuation attached immediately after the insertion', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-punct-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-punctuation.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic filing reference Formation Charter, synthetic continuation.', outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic filing reference FormationCharter, synthetic continuation.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 1 });
  });

  itAllure('normalizes only the junction-adjacent word of a multiword deletion against a single-word insertion', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-multidel-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-multiword-deletion.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic instrument label Certificate of Formation Charter synthetic closing.', outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic instrument label Certificate of FormationCharter synthetic closing.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 1 });
  });

  itAllure('normalizes only the junction-adjacent word of a multiword insertion against a single-word deletion', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-multiins-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-multiword-insertion.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic venue label StateAlpha State Beta synthetic tail.', outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic venue label StateAlphaState Beta synthetic tail.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 1 });
  });

  itAllure('declares no optional boundary at an unchanged ordinary-run split', async () => {
    const root = path.join(os.tmpdir(), `render-run-split-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('ordinary-run-split.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic unchanged frag mented clause inserted-alpha and removed-beta synthetic tail.', outputDir: path.join(root, 'out'),
      tools: fakeTools(ORDINARY_RUN_SPLIT_RENDERED), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding).toMatchObject({ declaredRevisionBoundaryCount: 0, revisionBoundaryNormalizationCount: 0 });
    expect(result.textBinding?.missingTokenSample).toContain('frag');
    expect(result.textBinding?.unexplainedTokenSample).toContain('fragmented');
  });

  itAllure('declares no optional boundary between adjacent same-family insertion wrappers', async () => {
    const root = path.join(os.tmpdir(), `render-same-family-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = '<w:p><w:r><w:t xml:space="preserve">Synthetic opening </w:t></w:r><w:ins w:id="1"><w:r><w:t>AlphaOne</w:t></w:r></w:ins><w:ins w:id="2"><w:r><w:t>AlphaTwo</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:del w:id="3"><w:r><w:delText>removed-beta</w:delText></w:r></w:del><w:r><w:t xml:space="preserve"> tail.</w:t></w:r></w:p>';
    await paginatedFixture(source, { body });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic opening AlphaOne AlphaTwo and removed-beta tail.', outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic opening AlphaOneAlphaTwo and removed-beta tail.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding).toMatchObject({ declaredRevisionBoundaryCount: 0, revisionBoundaryNormalizationCount: 0 });
  });

  itAllure('still fails a junction render that drops the insertion word entirely', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-dropped-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: ALNUM_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic clause prefix OldTerm synthetic suffix.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.missingTokenSample).toContain('NewTerm');
    expect(result.textBinding).toMatchObject({ revisionBoundaryNormalizationCount: 0 });
  });

  itAllure('still fails a junction render that duplicates the insertion word alongside the merge', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-duplicated-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: ALNUM_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic clause prefix OldTermNewTerm NewTerm synthetic suffix.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.unexplainedTokenSample).toContain('OldTermNewTerm');
    expect(result.textBinding).toMatchObject({ revisionBoundaryNormalizationCount: 0 });
  });

  itAllure('still fails a punctuation change hidden inside a junction merge', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-punct-change-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-punctuation.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Synthetic filing reference Formation Charter, synthetic continuation.', outputDir: path.join(root, 'out'),
      tools: fakeTools('Synthetic filing reference FormationCharter. synthetic continuation.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding).toMatchObject({ revisionBoundaryNormalizationCount: 0 });
  });

  itAllure('spends at most one whitespace normalization per declared junction occurrence', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-budget-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: `${ALNUM_EXPECTED} OldTerm NewTerm`, outputDir: path.join(root, 'out'),
      tools: fakeTools(`${ALNUM_JOINED_PDF} OldTermNewTerm`), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding).toMatchObject({ declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 1 });
    expect(result.textBinding?.unexplainedTokenSample).toContain('OldTermNewTerm');
  });

  itAllure('keeps the junction tolerance from excusing an ordinary-run whitespace change elsewhere', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-elsewhere-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await paginatedFixture(source, { body: await fixtureFragment('adjacent-revision-alnum.xml') });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: ALNUM_EXPECTED, outputDir: path.join(root, 'out'),
      tools: fakeTools('Syntheticclause prefix OldTermNewTerm synthetic suffix.'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding?.missingTokenSample).toContain('Synthetic');
    expect(result.textBinding?.unexplainedTokenSample).toContain('Syntheticclause');
  });

  itAllure('reports junction normalization separately from multi-page pagination reservation', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-multipage-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const body = `${await fixtureFragment('adjacent-revision-alnum.xml')}<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Synthetic second page closing text.</w:t></w:r></w:p>`;
    await paginatedFixture(source, {
      body,
      header: await fixtureFragment('repeated-header.xml'),
      footer: await fixtureFragment('page-field-footer.xml'),
    });
    const pdf = [
      'Synthetic Neutral Draft Header',
      ALNUM_JOINED_PDF,
      'Page 1',
      '\f',
      'Synthetic Neutral Draft Header',
      'Synthetic second page closing text.',
      'Page 2',
    ].join('\n');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: `${ALNUM_EXPECTED} Synthetic second page closing text.`, outputDir: path.join(root, 'out'),
      tools: fakeTools(pdf, undefined, false, 2), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, pageCount: 2, declaredRevisionBoundaryCount: 1, revisionBoundaryNormalizationCount: 1 });
  });

  itAllure('does not declare junctions from pagination-owned header stories', async () => {
    const root = path.join(os.tmpdir(), `render-boundary-header-story-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    const junctionHeader = '<w:hdr><w:p><w:del w:id="7"><w:r><w:delText>HeadOld</w:delText></w:r></w:del><w:ins w:id="8"><w:r><w:t>HeadNew</w:t></w:r></w:ins></w:p></w:hdr>';
    const body = 'Synthetic unchanged fragmented clause inserted-alpha and removed-beta synthetic tail.';
    await paginatedFixture(source, { body: await fixtureFragment('ordinary-run-split.xml'), header: junctionHeader });
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: body, outputDir: path.join(root, 'out'),
      tools: fakeTools(body), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ declaredRevisionBoundaryCount: 0, revisionBoundaryNormalizationCount: 0 });
  });

  itAllure('falls back to strict zero-allowance binding when the rendered package is unreadable', async () => {
    const root = path.join(os.tmpdir(), `render-unreadable-${Date.now()}`);
    const source = path.join(root, 'tracked.docx');
    await mkdir(root, { recursive: true });
    await writeFile(source, 'not a zip package');
    const result = await verifyRenderedMarkup({
      trackedDocxPath: source, expectedMarkupText: 'Visible markup text', outputDir: path.join(root, 'out'),
      tools: fakeTools('Visible markup text\nRepeated Header Residue'), configuredPixelFloor: 2,
    });
    expect(result).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(result.textBinding).toMatchObject({ pageCount: 1 });
    expect(result.textBinding?.unexplainedTokenSample).toContain('Residue');
  });
});

// ── Real-LibreOffice boundary fixtures ──────────────────────────────────────
// These tests exercise the shipped fixtures through an actual LibreOffice and
// poppler toolchain when one is installed. CI has neither; the verifier's own
// `resolve() -> null` discipline reports `not_run` there and each test accepts
// exactly that outcome (and only that outcome) as a skip.

const REAL_MACOS_SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

function realRendererTools(): RendererTools {
  const base = defaultRendererTools();
  return {
    resolve: (name) => base.resolve(name) ?? (name === 'soffice' && existsSync(REAL_MACOS_SOFFICE) ? REAL_MACOS_SOFFICE : null),
    run: (command, args, cwd) => base.run(command, args, cwd),
  };
}

async function verifyRealBoundaryFixture(fixture: string, expectedMarkupText: string) {
  const root = path.join(os.tmpdir(), `render-real-${fixture}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const source = path.join(root, 'tracked.docx');
  await writeFile(source, await buildDocxFromBodyXml(await fixtureFragment(`${fixture}.xml`)));
  return verifyRenderedMarkup({
    trackedDocxPath: source,
    expectedMarkupText,
    outputDir: path.join(root, 'out'),
    tools: realRendererTools(),
    configuredPixelFloor: 2,
  });
}

const REAL_RENDER_TIMEOUT_MS = 300_000;

describe('renderer verifier real LibreOffice adjacent revision boundaries', () => {
  itAllure('binds an independently derived projection across a real alphanumeric deletion/insertion junction', async () => {
    const result = await verifyRealBoundaryFixture('adjacent-revision-alnum', ALNUM_EXPECTED);
    if (result.status === 'not_run') { expect(result.reason).toContain('Missing renderer tool'); return; }
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true, revisionVisibility: 'visible' });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1 });
  }, REAL_RENDER_TIMEOUT_MS);

  itAllure('binds a real junction whose insertion is immediately followed by punctuation', async () => {
    const result = await verifyRealBoundaryFixture('adjacent-revision-punctuation', 'Synthetic filing reference Formation Charter, synthetic continuation.');
    if (result.status === 'not_run') { expect(result.reason).toContain('Missing renderer tool'); return; }
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1 });
  }, REAL_RENDER_TIMEOUT_MS);

  itAllure('binds a real multiword deletion adjacent to a single-word insertion', async () => {
    const result = await verifyRealBoundaryFixture('adjacent-revision-multiword-deletion', 'Synthetic instrument label Certificate of Formation Charter synthetic closing.');
    if (result.status === 'not_run') { expect(result.reason).toContain('Missing renderer tool'); return; }
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1 });
  }, REAL_RENDER_TIMEOUT_MS);

  itAllure('binds a real single-word deletion adjacent to a multiword insertion', async () => {
    const result = await verifyRealBoundaryFixture('adjacent-revision-multiword-insertion', 'Synthetic venue label StateAlpha State Beta synthetic tail.');
    if (result.status === 'not_run') { expect(result.reason).toContain('Missing renderer tool'); return; }
    expect(result).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(result.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 1 });
  }, REAL_RENDER_TIMEOUT_MS);

  itAllure('keeps ordinary-run splits strict in a real render while declaring no optional boundary', async () => {
    const correct = await verifyRealBoundaryFixture('ordinary-run-split', ORDINARY_RUN_SPLIT_RENDERED);
    if (correct.status === 'not_run') { expect(correct.reason).toContain('Missing renderer tool'); return; }
    expect(correct).toMatchObject({ status: 'pass', markupTextMatchesPdf: true });
    expect(correct.textBinding).toMatchObject({ matched: true, declaredRevisionBoundaryCount: 0, revisionBoundaryNormalizationCount: 0 });
    const whitespaceChanged = await verifyRealBoundaryFixture('ordinary-run-split', 'Synthetic unchanged frag mented clause inserted-alpha and removed-beta synthetic tail.');
    expect(whitespaceChanged).toMatchObject({ status: 'fail', markupTextMatchesPdf: false });
    expect(whitespaceChanged.textBinding?.missingTokenSample).toContain('frag');
  }, REAL_RENDER_TIMEOUT_MS);
});
