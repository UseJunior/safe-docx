import { constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultPdfRenderTools } from './tools.js';
import type { PdfRenderTools } from './tools.js';

export type PlainPdfRequest = {
  /** Finished DOCX to render; never modified. */
  docxPath: string;
  /** Where the rendered PDF is copied on success. */
  outputPdfPath: string;
  /**
   * Text the PDF text layer must contain, compared after collapsing
   * whitespace. Each entry must occur within a single rendered page; it may
   * match anywhere on that page, headers and footers included. No other
   * normalization is applied (hyphenation, ligatures and quote styles in the
   * extracted text must match as written).
   */
  requiredText: readonly string[];
  tools?: PdfRenderTools;
};

export type PlainPdfVerdict = {
  status: 'passed' | 'failed' | 'not_run';
  reason?: string;
  /** Pages delimited by form feeds in the pdftotext output, blank pages included. */
  pageCount?: number;
  missingText?: string[];
  pdfSha256?: string;
};

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** pdftotext ends every page with a form feed; split on it and drop the empty tail after the last one. */
export function splitPdfTextPages(text: string): string[] {
  const pages = text.split('\f');
  if (pages.length > 1 && pages.at(-1)!.trim() === '') pages.pop();
  return pages;
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
  if (left && right && left.dev === right.dev && left.ino === right.ino) return true;
  const [realA, realB] = await Promise.all([realpath(a).catch(() => path.resolve(a)), realpath(path.dirname(b)).then((dir) => path.join(dir, path.basename(b))).catch(() => path.resolve(b))]);
  return realA === realB;
}

/**
 * Publish the rendered PDF without ever writing through whatever sits at the
 * destination. The bytes go to a uniquely named file created exclusively in
 * the destination directory, which is then renamed over the destination
 * entry. A rename replaces the directory entry: if the destination is (or
 * became, while rendering) a symlink or a hard link to the input DOCX, the
 * link is replaced and the input's bytes are untouched. Concurrent writers to
 * the same destination race only on which complete file is left there.
 */
async function publishPdf(pdfPath: string, destination: string): Promise<void> {
  const staged = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  try {
    await copyFile(pdfPath, staged, fsConstants.COPYFILE_EXCL);
    await rename(staged, destination);
  } finally {
    await rm(staged, { force: true });
  }
}

/**
 * Render a finished, non-tracked DOCX to PDF with LibreOffice in a disposable
 * profile and check its text layer. Missing tools report `not_run`, never a
 * pass. Independent of how the DOCX was produced.
 */
export async function renderPlainPdf(request: PlainPdfRequest): Promise<PlainPdfVerdict> {
  const tools = request.tools ?? defaultPdfRenderTools();
  const soffice = tools.resolve('soffice');
  const pdftotext = tools.resolve('pdftotext');
  const missing = [...(soffice ? [] : ['soffice']), ...(pdftotext ? [] : ['pdftotext'])];
  if (missing.length > 0) return { status: 'not_run', reason: `missing tools: ${missing.join(', ')}` };
  if (await sameFile(request.docxPath, request.outputPdfPath)) {
    throw new Error('renderPlainPdf: outputPdfPath must not be the input DOCX or an alias of it.');
  }

  const workspace = await mkdtemp(path.join(os.tmpdir(), 'safe-docx-plain-render-'));
  try {
    const input = path.join(workspace, 'input.docx');
    await copyFile(request.docxPath, input);
    const profile = path.join(workspace, 'profile');
    const output = path.join(workspace, 'pdf');
    const rendered = await tools.run(soffice!, [
      '--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', output, input,
    ]);
    const pdfPath = path.join(output, 'input.pdf');
    if (rendered.code !== 0 || !existsSync(pdfPath)) {
      return { status: 'failed', reason: `LibreOffice render failed: ${(rendered.stderr || rendered.stdout).trim() || 'no PDF output'}` };
    }
    const pdf = await readFile(pdfPath);
    if (pdf.length === 0) return { status: 'failed', reason: 'LibreOffice produced an empty PDF' };
    const extracted = await tools.run(pdftotext!, [pdfPath, '-']);
    if (extracted.code !== 0) return { status: 'failed', reason: `pdftotext failed: ${(extracted.stderr || extracted.stdout).trim()}` };
    const pages = splitPdfTextPages(extracted.stdout).map(collapse);
    const pdfSha256 = createHash('sha256').update(pdf).digest('hex');
    if (pages.every((page) => page.length === 0)) return { status: 'failed', reason: 'PDF text layer is empty', pageCount: pages.length, pdfSha256 };
    // A needle must sit inside one page: matching across a page break could join unrelated text.
    const missingText = request.requiredText.map(collapse).filter((needle) => needle.length > 0 && !pages.some((page) => page.includes(needle)));
    if (missingText.length > 0) {
      return { status: 'failed', reason: 'required text missing from the PDF text layer', pageCount: pages.length, pdfSha256, missingText };
    }
    await publishPdf(pdfPath, request.outputPdfPath);
    return { status: 'passed', pageCount: pages.length, pdfSha256 };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
