import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { PaginationProfile, PixelMeasurement, RenderRequest, RendererTools, RenderVerdict, TextBindingEvidence, ToolResult } from './types.js';

const execFileAsync = promisify(execFile);
const BLUE = [0, 0, 255] as const;
const RED = [255, 0, 0] as const;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL_PREFIX = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function tokenizeRenderedText(value: string): string[] {
  // PDF extraction is a content oracle, not a pagination oracle. Line
  // wrapping, page breaks, form feeds, and indentation legitimately vary by
  // renderer, so bind whitespace-delimited tokens while layout remains the
  // separate image-review domain.
  return value.split(/\s+/u).filter((token) => token.length > 0);
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

const PAGE_FIELD_INSTRUCTION = /\b(?:PAGE|NUMPAGES|SECTIONPAGES|PAGEREF)\b/u;
const NUMERIC_TOKEN = /^[0-9]+$/u;
const BINDING_SAMPLE_LIMIT = 8;

export function emptyPaginationProfile(pageCount: number): PaginationProfile {
  return { pageCount, headerFooterTokenCounts: new Map(), pageFieldCount: 0 };
}

/**
 * Story-scoped text binding: multiset containment with a pagination allowance.
 *
 * Invariant:
 * 1. Completeness lower bound — every whitespace-delimited token of the
 *    caller's logical markup projection must occur in the extracted PDF text
 *    at least as many times as it occurs in the projection. A render that
 *    drops any logical content therefore still fails.
 * 2. Bounded residue upper bound — every PDF token occurrence beyond the
 *    projection's count (the residue) must be attributable to renderer-created
 *    pagination artifacts with explicit occurrence bounds: a token drawn from
 *    a referenced header/footer story is allowed at most
 *    `pageCount x (its occurrence count in those stories)` residual
 *    occurrences, and purely numeric residue is allowed only when a
 *    PAGE-family field instruction exists in a rendered story, bounded in
 *    total by `pageCount x pageFieldCount`. Duplicated or hallucinated body
 *    content therefore also fails.
 *
 * The binding deliberately does not check reading order: LibreOffice emits
 * text in renderer-created page and float positions (repeated headers,
 * footers, anchored text boxes), which a logical DOCX projection cannot
 * predict without reimplementing pagination. Order and placement remain the
 * image-review domain; colour visibility is verified separately.
 *
 * The pagination profile is derived from the rendered artifact and the
 * rendered DOCX package only — never from the caller's projection or from any
 * Safe DOCX generator — so the binding stays an independent oracle.
 */
export function bindLogicalMarkupText(expectedMarkupText: string, pdfText: string, pagination: PaginationProfile): TextBindingEvidence {
  const expectedCounts = countTokens(tokenizeRenderedText(expectedMarkupText));
  const pdfCounts = countTokens(tokenizeRenderedText(pdfText));
  const missingTokens: string[] = [];
  for (const [token, expected] of expectedCounts) {
    if ((pdfCounts.get(token) ?? 0) < expected) missingTokens.push(token);
  }
  const unexplainedTokens: string[] = [];
  let numericResidueTotal = 0;
  for (const [token, rendered] of pdfCounts) {
    const residue = rendered - (expectedCounts.get(token) ?? 0);
    if (residue <= 0) continue;
    const storyAllowance = pagination.pageCount * (pagination.headerFooterTokenCounts.get(token) ?? 0);
    const beyondStories = residue - storyAllowance;
    if (beyondStories <= 0) continue;
    if (NUMERIC_TOKEN.test(token) && pagination.pageFieldCount > 0) {
      numericResidueTotal += beyondStories;
      continue;
    }
    unexplainedTokens.push(token);
  }
  if (numericResidueTotal > pagination.pageCount * pagination.pageFieldCount) {
    unexplainedTokens.push(`${numericResidueTotal} numeric token occurrence(s) beyond the page-field allowance`);
  }
  return {
    matched: missingTokens.length === 0 && unexplainedTokens.length === 0,
    pageCount: pagination.pageCount,
    missingTokenSample: missingTokens.slice(0, BINDING_SAMPLE_LIMIT),
    unexplainedTokenSample: unexplainedTokens.slice(0, BINDING_SAMPLE_LIMIT),
  };
}

function profileXml(mode: 'configured' | 'by-author'): string {
  // Writer reads redline display preferences from this user-profile subtree.
  // -1 asks Writer for its normal per-author color, giving us a same-input
  // negative control. Values are configuration, never DOCX run properties.
  const insertColor = mode === 'configured' ? '255' : '-1'; // #0000ff
  const deleteColor = mode === 'configured' ? '16711680' : '-1'; // #ff0000
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
 <item oor:path="/org.openoffice.Office.Writer/Revision/TextDisplay/Insert"><prop oor:name="Attribute" oor:op="fuse"><value>3</value></prop><prop oor:name="Color" oor:op="fuse"><value>${insertColor}</value></prop></item>
 <item oor:path="/org.openoffice.Office.Writer/Revision/TextDisplay/Delete"><prop oor:name="Attribute" oor:op="fuse"><value>3</value></prop><prop oor:name="Color" oor:op="fuse"><value>${deleteColor}</value></prop></item>
</oor:items>`;
}

export function defaultRendererTools(): RendererTools {
  const candidates: Record<'soffice' | 'pdftotext' | 'pdftoppm' | 'magick', string[]> = {
    soffice: [process.env.SAFE_DOCX_SOFFICE_BIN ?? '', '/opt/homebrew/bin/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice'],
    pdftotext: ['/opt/homebrew/bin/pdftotext', '/usr/bin/pdftotext', '/usr/local/bin/pdftotext'],
    pdftoppm: ['/opt/homebrew/bin/pdftoppm', '/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm'],
    magick: ['/opt/homebrew/bin/magick', '/usr/bin/magick', '/usr/local/bin/magick'],
  };
  return {
    resolve(name) { return candidates[name].find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null; },
    async run(command, args, cwd) {
      try {
        const result = await execFileAsync(command, args, { cwd, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
        return { code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
      } catch (error) {
        const failure = error as { code?: number; stdout?: unknown; stderr?: unknown; message?: string };
        return { code: typeof failure.code === 'number' ? failure.code : 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? failure.message ?? '') };
      }
    },
  };
}

function inColourBand(actual: readonly number[], expected: readonly number[]): boolean {
  // PDF antialiasing over a white page makes a blue glyph e.g. #a7a7ff rather
  // than #0000ff. Measure a saturated hue band instead of exact RGB points.
  if (expected === BLUE) return actual[2]! - Math.max(actual[0]!, actual[1]!) >= 40;
  return actual[0]! - Math.max(actual[1]!, actual[2]!) >= 40;
}

/** Parse ImageMagick txt:- output after bounded downsampling. */
export function measurePixelBands(pixelListing: string): PixelMeasurement {
  let sampledPixels = 0;
  let bluePixels = 0;
  let redPixels = 0;
  for (const line of pixelListing.split('\n')) {
    const match = /#([0-9a-fA-F]{6})\b/u.exec(line);
    if (!match?.[1]) continue;
    sampledPixels++;
    const hex = match[1];
    const rgb = [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
    if (inColourBand(rgb, BLUE)) bluePixels++;
    if (inColourBand(rgb, RED)) redPixels++;
  }
  return { sampledPixels, bluePixels, redPixels };
}

function configuredContrast(configured: PixelMeasurement, control: PixelMeasurement, floor: number): boolean {
  const blueFloor = Math.max(floor, Math.ceil(control.bluePixels * 1.5));
  const redFloor = Math.max(floor, Math.ceil(control.redPixels * 1.5));
  return configured.bluePixels >= blueFloor && configured.redPixels >= redFloor;
}

function revisionVisibility(configured: PixelMeasurement, control: PixelMeasurement, floor: number): NonNullable<RenderVerdict['revisionVisibility']> {
  const blueFloor = Math.max(floor, Math.ceil(control.bluePixels * 1.5));
  const redFloor = Math.max(floor, Math.ceil(control.redPixels * 1.5));
  if (configured.bluePixels >= blueFloor && configured.redPixels < redFloor) return 'hidden-deletions';
  if (configured.bluePixels >= blueFloor && configured.redPixels >= redFloor) return 'visible';
  return 'insufficient-contrast';
}

type RenderedStory = { name: string; kind: 'document' | 'header' | 'footer' | 'footnotes' | 'endnotes' };

type RenderedPackageEvidence = {
  revisionMarkup: { insertions: boolean; deletions: boolean };
  pagination: PaginationProfile;
};

async function analyzeRenderedPackage(bytes: Buffer, pageCount: number): Promise<RenderedPackageEvidence> {
  const fallback: RenderedPackageEvidence = { revisionMarkup: { insertions: false, deletions: false }, pagination: emptyPaginationProfile(pageCount) };
  try {
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (documentXml === undefined) return fallback;
    const renderedStories = await referencedRenderedStories(zip, documentXml);
    let insertions = false;
    let deletions = false;
    const headerFooterTokenCounts = new Map<string, number>();
    let pageFieldCount = 0;
    for (const story of renderedStories) {
      const xml = await zip.file(story.name)?.async('string');
      if (xml === undefined) continue;
      insertions ||= hasVisibleRevisionInStory(xml, ['ins', 'moveTo']);
      deletions ||= hasVisibleRevisionInStory(xml, ['del', 'moveFrom']);
      const document = parseStoryXml(xml);
      if (document === null) continue;
      pageFieldCount += pageFieldInstructionCount(document);
      if (story.kind !== 'header' && story.kind !== 'footer') continue;
      for (const localName of ['t', 'delText'] as const) {
        for (const text of Array.from(document.getElementsByTagNameNS(W_NS, localName))) {
          for (const token of tokenizeRenderedText(text.textContent ?? '')) {
            headerFooterTokenCounts.set(token, (headerFooterTokenCounts.get(token) ?? 0) + 1);
          }
        }
      }
    }
    return { revisionMarkup: { insertions, deletions }, pagination: { pageCount, headerFooterTokenCounts, pageFieldCount } };
  } catch {
    return fallback;
  }
}

function parseStoryXml(xml: string): ReturnType<DOMParser['parseFromString']> | null {
  try {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return document.getElementsByTagName('parsererror').length > 0 ? null : document;
  } catch {
    return null;
  }
}

function pageFieldInstructionCount(document: NonNullable<ReturnType<typeof parseStoryXml>>): number {
  let count = 0;
  for (const instruction of Array.from(document.getElementsByTagNameNS(W_NS, 'instrText'))) {
    if (PAGE_FIELD_INSTRUCTION.test(instruction.textContent ?? '')) count++;
  }
  for (const field of Array.from(document.getElementsByTagNameNS(W_NS, 'fldSimple'))) {
    if (PAGE_FIELD_INSTRUCTION.test(field.getAttributeNS(W_NS, 'instr') ?? '')) count++;
  }
  return count;
}

async function referencedRenderedStories(zip: JSZip, documentXml: string): Promise<RenderedStory[]> {
  const stories: RenderedStory[] = [{ name: 'word/document.xml', kind: 'document' }];
  const document = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) return stories;
  const referencedIds = new Set<string>();
  for (const localName of ['headerReference', 'footerReference'] as const) {
    for (const reference of Array.from(document.getElementsByTagNameNS(W_NS, localName))) {
      const id = reference.getAttributeNS(R_NS, 'id');
      if (id) referencedIds.add(id);
    }
  }
  const hasFootnotes = document.getElementsByTagNameNS(W_NS, 'footnoteReference').length > 0;
  const hasEndnotes = document.getElementsByTagNameNS(W_NS, 'endnoteReference').length > 0;
  const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (relationshipsXml === undefined) return stories;
  const relationships = new DOMParser().parseFromString(relationshipsXml, 'application/xml');
  if (relationships.getElementsByTagName('parsererror').length > 0) return stories;
  for (const relationship of Array.from(relationships.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))) {
    if (relationship.getAttribute('TargetMode') === 'External') continue;
    const id = relationship.getAttribute('Id');
    const type = relationship.getAttribute('Type');
    const target = relationship.getAttribute('Target');
    if (!id || !type || !target) continue;
    const kind = type.startsWith(OFFICE_REL_PREFIX) ? type.slice(OFFICE_REL_PREFIX.length) : '';
    if (kind !== 'header' && kind !== 'footer' && kind !== 'footnotes' && kind !== 'endnotes') continue;
    const referenced = (kind === 'header' || kind === 'footer') ? referencedIds.has(id)
      : kind === 'footnotes' ? hasFootnotes : hasEndnotes;
    if (!referenced) continue;
    const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('word', target));
    if (zip.file(resolved) && !stories.some((story) => story.name === resolved)) stories.push({ name: resolved, kind });
  }
  return stories;
}

function hasVisibleRevisionInStory(xml: string, wrapperNames: readonly string[]): boolean {
  try {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) return false;
    const wrappers = wrapperNames.flatMap((localName) => Array.from(document.getElementsByTagNameNS(W_NS, localName)));
    return wrappers.some((wrapper) => hasVisibleRevisionPayload(wrapper));
  } catch {
    return false;
  }
}

function hasVisibleRevisionPayload(wrapper: XmlElement): boolean {
  for (const localName of ['t', 'delText'] as const) {
    for (const text of Array.from(wrapper.getElementsByTagNameNS(W_NS, localName))) {
      const value = text.textContent ?? '';
      const preserve = text.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space') === 'preserve';
      if ((preserve ? value : value.replace(/^[\u0009\u000a\u000d\u0020]+|[\u0009\u000a\u000d\u0020]+$/gu, '')) !== '') return true;
    }
  }
  return ['tab', 'br', 'cr'].some((localName) => wrapper.getElementsByTagNameNS(W_NS, localName).length > 0);
}

async function configureProfile(profile: string, mode: 'configured' | 'by-author'): Promise<void> {
  const user = path.join(profile, 'user');
  await mkdir(user, { recursive: true });
  await writeFile(path.join(user, 'registrymodifications.xcu'), profileXml(mode));
}

async function renderPdf(tools: RendererTools, soffice: string, profile: string, docx: string, output: string): Promise<ToolResult> {
  await mkdir(output, { recursive: true });
  return tools.run(soffice, ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(profile).href}`, '--convert-to', 'pdf:writer_pdf_Export', '--outdir', output, docx]);
}

async function renderOne(
  tools: RendererTools,
  soffice: string,
  docx: string,
  workspace: string,
  mode: 'configured' | 'by-author',
): Promise<{ pdfPath: string; profile: string }> {
  const profile = path.join(workspace, `${mode}-profile`);
  const output = path.join(workspace, `${mode}-pdf`);
  await configureProfile(profile, mode);
  const result = await renderPdf(tools, soffice, profile, docx, output);
  const pdfPath = path.join(output, `${path.basename(docx, path.extname(docx))}.pdf`);
  if (result.code !== 0 || !existsSync(pdfPath)) throw new Error(`LibreOffice ${mode} render failed: ${(result.stderr || result.stdout).trim() || 'no PDF output'}`);
  return { pdfPath, profile };
}

async function extractPdfText(tools: RendererTools, command: string, pdfPath: string): Promise<string> {
  const result = await tools.run(command, ['-layout', pdfPath, '-']);
  if (result.code !== 0) throw new Error(`pdftotext failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

async function measurePdf(tools: RendererTools, pdftoppm: string, magick: string, pdfPath: string, workspace: string, name: string): Promise<{ pixels: PixelMeasurement; pageCount: number }> {
  const prefix = path.join(workspace, name);
  const raster = await tools.run(pdftoppm, ['-png', '-r', '96', pdfPath, prefix]);
  if (raster.code !== 0) throw new Error(`pdftoppm failed: ${(raster.stderr || raster.stdout).trim()}`);
  const directory = path.dirname(prefix);
  const stem = `${path.basename(prefix)}-`;
  const pages = (await readdir(directory))
    .filter((entry) => entry.startsWith(stem) && entry.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (pages.length === 0) throw new Error('pdftoppm produced no page images');
  const total: PixelMeasurement = { sampledPixels: 0, bluePixels: 0, redPixels: 0 };
  for (const page of pages) {
    // Process pages independently so a long agreement cannot overflow the
    // subprocess buffer merely because its revisions begin after page one.
    const pixels = await tools.run(magick, [path.join(directory, page), '-resize', '10%', 'txt:-']);
    if (pixels.code !== 0) throw new Error(`ImageMagick failed: ${(pixels.stderr || pixels.stdout).trim()}`);
    const measured = measurePixelBands(pixels.stdout);
    total.sampledPixels += measured.sampledPixels;
    total.bluePixels += measured.bluePixels;
    total.redPixels += measured.redPixels;
  }
  return { pixels: total, pageCount: pages.length };
}

async function reviewPages(tools: RendererTools, pdftoppm: string, pdfPath: string, outputDir: string, pages: number[]): Promise<string[]> {
  const result: string[] = [];
  for (const page of [...new Set(pages)].filter((entry) => Number.isInteger(entry) && entry > 0).sort((a, b) => a - b)) {
    const prefix = path.join(outputDir, `review-page-${page}`);
    const rendered = await tools.run(pdftoppm, ['-png', '-r', '144', '-f', String(page), '-l', String(page), pdfPath, prefix]);
    const candidates = (await readdir(outputDir))
      .filter((entry) => entry.startsWith(`${path.basename(prefix)}-`) && entry.endsWith('.png'));
    const png = candidates.length === 1 ? path.join(outputDir, candidates[0]!) : '';
    if (rendered.code !== 0 || png.length === 0 || !existsSync(png)) throw new Error(`review-page ${page} rasterization failed`);
    result.push(png);
  }
  return result;
}

/**
 * Render a finished DOCX in two disposable Writer profiles. This module never
 * loads or saves the authoritative DOCX; rendering always consumes a copied or
 * explicitly transformed workspace-only path.
 */
export async function verifyRenderedMarkup(request: RenderRequest): Promise<RenderVerdict> {
  const tools = request.tools ?? defaultRendererTools();
  const trackedBytes = await readFile(request.trackedDocxPath);
  const trackedSha256 = sha256(trackedBytes);
  const missing = (['soffice', 'pdftotext', 'pdftoppm', 'magick'] as const).filter((tool) => !tools.resolve(tool));
  if (missing.length > 0) return { status: 'not_run', reason: `Missing renderer tool(s): ${missing.join(', ')}`, trackedSha256, reviewPngs: [] };

  const soffice = tools.resolve('soffice')!;
  const pdftotext = tools.resolve('pdftotext')!;
  const pdftoppm = tools.resolve('pdftoppm')!;
  const magick = tools.resolve('magick')!;
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'safe-docx-render-'));
  try {
    await mkdir(request.outputDir, { recursive: true });
    const inputPath = path.join(workspace, `tracked${path.extname(request.trackedDocxPath) || '.docx'}`);
    await copyFile(request.trackedDocxPath, inputPath);
    let renderInput = inputPath;
    let transform: RenderVerdict['transform'];
    if (request.transform) {
      const before = sha256(await readFile(request.trackedDocxPath));
      renderInput = await request.transform.apply(inputPath, workspace);
      const after = sha256(await readFile(request.trackedDocxPath));
      const workspaceRoot = `${path.resolve(workspace)}${path.sep}`;
      if (before !== after || !path.resolve(renderInput).startsWith(workspaceRoot) || !(await stat(renderInput)).isFile()) {
        return { status: 'fail', reason: 'Render-only transform attempted to escape its disposable workspace or mutate authoritative DOCX.', trackedSha256, reviewPngs: [] };
      }
      transform = { id: request.transform.id, version: request.transform.version, inputSha256: sha256(await readFile(inputPath)), outputSha256: sha256(await readFile(renderInput)) };
    }
    const renderedInputBytes = await readFile(renderInput);
    const configured = await renderOne(tools, soffice, renderInput, workspace, 'configured');
    const control = await renderOne(tools, soffice, renderInput, workspace, 'by-author');
    const pdfText = await extractPdfText(tools, pdftotext, configured.pdfPath);
    const [configuredMeasured, controlMeasured, reviewPngs] = await Promise.all([
      measurePdf(tools, pdftoppm, magick, configured.pdfPath, workspace, 'configured'),
      measurePdf(tools, pdftoppm, magick, control.pdfPath, workspace, 'control'),
      reviewPages(tools, pdftoppm, configured.pdfPath, request.outputDir, request.reviewPages ?? [1]),
    ]);
    const configuredPixels = configuredMeasured.pixels;
    const controlPixels = controlMeasured.pixels;
    const packageEvidence = await analyzeRenderedPackage(renderedInputBytes, configuredMeasured.pageCount);
    const textBinding = bindLogicalMarkupText(request.expectedMarkupText, pdfText, packageEvidence.pagination);
    const markupTextMatchesPdf = textBinding.matched;
    const configuredContrastPassed = configuredContrast(configuredPixels, controlPixels, request.configuredPixelFloor ?? 4);
    const measuredVisibility = revisionVisibility(configuredPixels, controlPixels, request.configuredPixelFloor ?? 4);
    const revisionMarkup = packageEvidence.revisionMarkup;
    // Colour visibility is classified from pixel and revision-markup evidence
    // only. A text-binding failure is reported as its own reason and never
    // relabels calibrated colour evidence as insufficient-contrast.
    const visibility = measuredVisibility !== 'hidden-deletions' || (revisionMarkup.insertions && revisionMarkup.deletions)
      ? measuredVisibility
      : 'insufficient-contrast';
    const reasons: string[] = [];
    if (!markupTextMatchesPdf) {
      reasons.push(textBinding.missingTokenSample.length > 0
        ? 'PDF text binding failed: expected logical markup content is missing from the rendered PDF.'
        : 'PDF text binding failed: rendered text is not attributable to logical markup or pagination artifacts.');
    }
    if (visibility === 'hidden-deletions') reasons.push('LibreOffice rendered configured insertions but hid configured deletions.');
    else if (!configuredContrastPassed) reasons.push('Configured render did not exceed by-author control colour bands.');
    const pdfOut = path.join(request.outputDir, 'tracked-configured.pdf');
    await copyFile(configured.pdfPath, pdfOut);
    return {
      status: markupTextMatchesPdf && configuredContrastPassed ? 'pass' : 'fail',
      reason: reasons.length > 0 ? reasons.join(' ') : undefined,
      trackedSha256,
      renderedInputSha256: sha256(renderedInputBytes),
      transform,
      pdfPath: pdfOut,
      reviewPngs,
      markupTextMatchesPdf,
      textBinding,
      configured: configuredPixels,
      byAuthorControl: controlPixels,
      configuredContrastPassed,
      revisionVisibility: visibility,
    };
  } catch (error) {
    return { status: 'not_run', reason: `Renderer invocation unavailable: ${(error as Error).message}`, trackedSha256, reviewPngs: [] };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
