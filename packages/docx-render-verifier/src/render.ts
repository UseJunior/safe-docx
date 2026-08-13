import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { PixelMeasurement, RenderRequest, RendererTools, RenderVerdict, ToolResult } from './types.js';

const execFileAsync = promisify(execFile);
const BLUE = [0, 0, 255] as const;
const RED = [255, 0, 0] as const;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeText(value: string): string {
  // PDF extraction is a reading-order oracle, not a pagination oracle. Line
  // wrapping, page breaks, and indentation legitimately vary by renderer, so
  // bind the complete non-whitespace character sequence while layout remains
  // the separate image-review domain.
  return value.replace(/\s+/gu, ' ').trim();
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

async function measurePdf(tools: RendererTools, pdftoppm: string, magick: string, pdfPath: string, workspace: string, name: string): Promise<PixelMeasurement> {
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
  return total;
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
    const configured = await renderOne(tools, soffice, renderInput, workspace, 'configured');
    const control = await renderOne(tools, soffice, renderInput, workspace, 'by-author');
    const pdfText = await extractPdfText(tools, pdftotext, configured.pdfPath);
    const [configuredPixels, controlPixels, reviewPngs] = await Promise.all([
      measurePdf(tools, pdftoppm, magick, configured.pdfPath, workspace, 'configured'),
      measurePdf(tools, pdftoppm, magick, control.pdfPath, workspace, 'control'),
      reviewPages(tools, pdftoppm, configured.pdfPath, request.outputDir, request.reviewPages ?? [1]),
    ]);
    const markupTextMatchesPdf = normalizeText(pdfText) === normalizeText(request.expectedMarkupText);
    const configuredContrastPassed = configuredContrast(configuredPixels, controlPixels, request.configuredPixelFloor ?? 4);
    const pdfOut = path.join(request.outputDir, 'tracked-configured.pdf');
    await copyFile(configured.pdfPath, pdfOut);
    return {
      status: markupTextMatchesPdf && configuredContrastPassed ? 'pass' : 'fail',
      reason: markupTextMatchesPdf ? (configuredContrastPassed ? undefined : 'Configured render did not exceed by-author control colour bands.') : 'PDF text does not equal caller-supplied independent markup text.',
      trackedSha256,
      renderedInputSha256: sha256(await readFile(renderInput)),
      transform,
      pdfPath: pdfOut,
      reviewPngs,
      markupTextMatchesPdf,
      configured: configuredPixels,
      byAuthorControl: controlPixels,
      configuredContrastPassed,
    };
  } catch (error) {
    return { status: 'not_run', reason: `Renderer invocation unavailable: ${(error as Error).message}`, trackedSha256, reviewPngs: [] };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
