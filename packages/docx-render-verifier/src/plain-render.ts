import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultRendererTools } from './render.js';
import type { RendererTools } from './types.js';

export type PlainPdfRequest = {
  /** Finished DOCX to render; never modified. */
  docxPath: string;
  /** Where the rendered PDF is copied on success. */
  outputPdfPath: string;
  /**
   * Text the PDF text layer must contain, compared after collapsing
   * whitespace (for example the title, the last paragraph, each footer).
   */
  requiredText: readonly string[];
  tools?: RendererTools;
};

export type PlainPdfVerdict = {
  status: 'passed' | 'failed' | 'not_run';
  reason?: string;
  pageCount?: number;
  missingText?: string[];
  pdfSha256?: string;
};

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Render a finished, non-tracked DOCX to PDF with LibreOffice in a disposable
 * profile and check its text layer. Missing tools report `not_run`, never a
 * pass. Independent of how the DOCX was produced.
 */
export async function renderPlainPdf(request: PlainPdfRequest): Promise<PlainPdfVerdict> {
  const tools = request.tools ?? defaultRendererTools();
  const soffice = tools.resolve('soffice');
  const pdftotext = tools.resolve('pdftotext');
  const missing = [...(soffice ? [] : ['soffice']), ...(pdftotext ? [] : ['pdftotext'])];
  if (missing.length > 0) return { status: 'not_run', reason: `missing tools: ${missing.join(', ')}` };

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
    const pages = extracted.stdout.split('\f').filter((page) => page.trim().length > 0);
    const haystack = collapse(extracted.stdout);
    const missingText = request.requiredText.map(collapse).filter((needle) => needle.length > 0 && !haystack.includes(needle));
    if (pages.length === 0) return { status: 'failed', reason: 'PDF text layer is empty', pageCount: 0 };
    await copyFile(pdfPath, request.outputPdfPath);
    return {
      status: missingText.length === 0 ? 'passed' : 'failed',
      pageCount: pages.length,
      pdfSha256: createHash('sha256').update(pdf).digest('hex'),
      ...(missingText.length === 0 ? {} : { missingText, reason: 'required text missing from the PDF text layer' }),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
