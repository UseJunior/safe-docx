import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPlainPdf, type PlainPdfVerdict, type RendererTools } from '@usejunior/docx-render-verifier';
import { DocxMarkdocError } from '../errors.js';
import { createDocumentFromMarkdoc, type CreatedDocument } from './create.js';
import { PAGE_FIELD_TOKEN } from './lower.js';

export type CreateCliArgs = {
  markdocPath: string;
  outputDir: string;
  profilePath?: string;
  pdf: boolean;
  requirePdf: boolean;
  replace: boolean;
};

export type CreateCliResult = {
  outputs: { docx: string; text: string; certificate: string; pdf?: string };
  created: CreatedDocument;
  pdf: PlainPdfVerdict | { status: 'skipped' };
  summary: string;
};

export function parseCreateCliArgs(args: string[]): CreateCliArgs {
  const positional: string[] = [];
  let profilePath: string | undefined;
  let pdf = true;
  let requirePdf = false;
  let replace = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--style-profile') {
      if (profilePath !== undefined) throw new Error('--style-profile may be supplied only once.');
      profilePath = args[index + 1];
      if (!profilePath) throw new Error('--style-profile requires a JSON path.');
      index += 1;
    } else if (arg === '--no-pdf') pdf = false;
    else if (arg === '--require-pdf') requirePdf = true;
    else if (arg === '--replace') replace = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else positional.push(arg);
  }
  const [markdocPath, outputDir] = positional;
  if (!markdocPath || !outputDir || positional.length !== 2) throw new Error('create requires a Markdoc file and an output directory.');
  if (!pdf && requirePdf) throw new Error('--no-pdf and --require-pdf are mutually exclusive.');
  return { markdocPath, outputDir, ...(profilePath ? { profilePath } : {}), pdf, requirePdf, replace };
}

async function existingKind(target: string): Promise<'file' | 'symlink' | 'other' | null> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) return 'symlink';
    return stat.isFile() ? 'file' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Text a rendered PDF must contain: the first and last paragraphs and every footer text. */
export function requiredPdfText(created: CreatedDocument): string[] {
  const paragraphs = created.readback.paragraphs.filter((paragraph) => paragraph.trim());
  const title = paragraphs[0];
  const last = paragraphs.at(-1) ?? '';
  const lastNeedle = last.length > 120 ? last.slice(0, 80) : last;
  const footers = created.readback.footers.flatMap((footer) => footer ?? []).filter((line) => line !== PAGE_FIELD_TOKEN);
  return [...new Set([title, lastNeedle, ...footers].filter((value): value is string => Boolean(value?.trim())))];
}

/**
 * `docx-markdoc create <document.mdoc> <output-dir>`: build the DOCX, the
 * read-back text mirror, an optional PDF and the certificate. Every output is
 * written to a temporary sibling and renamed into place only after every check
 * passes, so a failed build leaves the output directory as it was.
 */
export async function runCreateCommand(args: string[], deps: { renderTools?: RendererTools } = {}): Promise<CreateCliResult> {
  const options = parseCreateCliArgs(args);
  const stem = path.basename(options.markdocPath, path.extname(options.markdocPath));
  const outputs = {
    docx: path.resolve(options.outputDir, `${stem}.docx`),
    text: path.resolve(options.outputDir, `${stem}.txt`),
    certificate: path.resolve(options.outputDir, `${stem}.verification.json`),
    ...(options.pdf ? { pdf: path.resolve(options.outputDir, `${stem}.pdf`) } : {}),
  };
  const inputs = [options.markdocPath, ...(options.profilePath ? [options.profilePath] : [])].map((value) => path.resolve(value));
  if (Object.values(outputs).some((output) => inputs.includes(output))) {
    throw new DocxMarkdocError('CREATION_PATH_COLLISION', 'An output path would overwrite an input.');
  }
  await mkdir(options.outputDir, { recursive: true });
  for (const target of Object.values(outputs)) {
    const kind = await existingKind(target);
    if (kind === 'symlink' || kind === 'other') throw new DocxMarkdocError('CREATION_OUTPUT_NOT_FILE', `Refusing to replace non-file output ${target}.`);
    if (kind === 'file' && !options.replace) {
      throw new DocxMarkdocError('CREATION_OUTPUT_EXISTS', `Output already exists: ${target}. Pass --replace to rebuild in place.`);
    }
  }

  const profileSource = options.profilePath ? await readFile(options.profilePath) : undefined;
  let profile: unknown;
  if (profileSource) {
    try {
      profile = JSON.parse(profileSource.toString('utf8'));
    } catch (error) {
      throw new DocxMarkdocError('INVALID_CREATION_PROFILE_JSON', `Style profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const created = await createDocumentFromMarkdoc(await readFile(options.markdocPath, 'utf8'), {
    ...(profile === undefined ? {} : { profile }),
    ...(profileSource === undefined ? {} : { profileSource }),
    mirrorLabel: path.basename(outputs.docx),
  });

  const temporary = (target: string): string => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  const staged = new Map<string, string>();
  try {
    staged.set(outputs.docx, temporary(outputs.docx));
    await writeFile(staged.get(outputs.docx)!, created.docx, { flag: 'wx' });
    let pdf: CreateCliResult['pdf'] = { status: 'skipped' };
    if (outputs.pdf) {
      staged.set(outputs.pdf, temporary(outputs.pdf));
      pdf = await renderPlainPdf({
        docxPath: staged.get(outputs.docx)!,
        outputPdfPath: staged.get(outputs.pdf)!,
        requiredText: requiredPdfText(created),
        ...(deps.renderTools ? { tools: deps.renderTools } : {}),
      });
      if (pdf.status !== 'passed') staged.delete(outputs.pdf);
      if (pdf.status === 'failed' || (pdf.status === 'not_run' && options.requirePdf)) {
        throw new DocxMarkdocError('CREATION_PDF_FAILED', `PDF check ${pdf.status}: ${pdf.reason ?? 'unknown'}${pdf.missingText ? ` (missing: ${pdf.missingText.join(' | ')})` : ''}.`, pdf);
      }
    }
    const certificate = { ...created.certificate, pdf };
    staged.set(outputs.text, temporary(outputs.text));
    await writeFile(staged.get(outputs.text)!, created.text, { flag: 'wx' });
    staged.set(outputs.certificate, temporary(outputs.certificate));
    await writeFile(staged.get(outputs.certificate)!, `${JSON.stringify(certificate, null, 2)}\n`, { flag: 'wx' });
    // The mirror on disk must still equal the read-back it was written from.
    if ((await readFile(staged.get(outputs.text)!, 'utf8')) !== created.text) {
      throw new DocxMarkdocError('CREATION_MIRROR_MISMATCH', 'The written text mirror does not match the read-back.');
    }
    for (const [target, source] of staged) await rename(source, target);
    staged.clear();
    const { checks } = created.certificate;
    const summary = [
      `created ${path.basename(outputs.docx)}: ${checks.readback.paragraphs} paragraphs, ${checks.footers.sections} section(s)`,
      `readback ok (negative control ok)`,
      `footers ok (negative control ok)`,
      'deterministic',
      `brownfield ok (${checks.brownfield.anchoredParagraphs} anchored)`,
      pdf.status === 'skipped' ? 'pdf skipped' : `pdf ${pdf.status}${'pageCount' in pdf && pdf.pageCount ? ` (${pdf.pageCount} pages)` : ''}${pdf.status === 'not_run' ? ` (${pdf.reason})` : ''}`,
    ].join('; ');
    return { outputs, created, pdf, summary };
  } finally {
    await Promise.allSettled([...staged.values()].map((file) => rm(file, { force: true })));
  }
}
