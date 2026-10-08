import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPlainPdf, type PlainPdfVerdict } from '../pdf/plain-render.js';
import type { PdfRenderTools } from '../pdf/tools.js';
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

/** Filesystem operations used to publish outputs; injectable so tests can force a mid-publication failure. */
export type PublishFileOps = {
  link: (from: string, to: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (target: string) => Promise<void>;
};
const DEFAULT_FILE_OPS: PublishFileOps = { link, rename, unlink };

async function exists(target: string): Promise<boolean> {
  return (await existingKind(target)) !== null;
}

/**
 * Publish staged files as one unit. Each existing target (including a stale
 * artifact this build does not produce) moves to a backup first; then every
 * new file is placed with an exclusive hard link, which fails instead of
 * overwriting if anything appeared at the target meanwhile. Any failure
 * restores the backups and removes what was placed, so the directory is left
 * as it was.
 */
/**
 * Thrown when publishing failed and some original outputs could not be put
 * back. Nothing is deleted: the originals that were not restored stay in
 * `recoveryDir`, and the message names it and every recovery problem.
 */
class PublishRecoveryError extends DocxMarkdocError {
  constructor(message: string, readonly recoveryDir: string, readonly keepStaging: boolean) {
    super('CREATION_PUBLISH_FAILED', message, { recoveryDir });
  }
}

async function publish(
  produced: Map<string, string>,
  retired: string[],
  backupDir: string,
  recoveryDir: string,
  replace: boolean,
  ops: PublishFileOps,
): Promise<void> {
  const backups: Array<{ target: string; backup: string }> = [];
  const placed: Array<{ target: string; dev: number; ino: number }> = [];
  try {
    for (const target of [...produced.keys(), ...retired]) {
      if (!(await exists(target))) continue;
      if (!replace) throw new DocxMarkdocError('CREATION_OUTPUT_EXISTS', `Output appeared during the build: ${target}. Pass --replace to rebuild in place.`);
      const backup = path.join(backupDir, path.basename(target));
      await ops.rename(target, backup);
      backups.push({ target, backup });
    }
    for (const [target, staged] of produced) {
      await ops.link(staged, target);
      const placedStat = await stat(target);
      placed.push({ target, dev: placedStat.dev, ino: placedStat.ino });
    }
  } catch (error) {
    const problems: string[] = [];
    // Remove only what this run placed: a path whose inode changed belongs to someone else now.
    for (const { target, dev, ino } of placed) {
      const current = await stat(target).catch(() => null);
      if (!current || current.dev !== dev || current.ino !== ino) continue;
      await ops.unlink(target).catch((unlinkError: Error) => problems.push(`could not remove ${target}: ${unlinkError.message}`));
    }
    const unrestored: string[] = [];
    for (const { target, backup } of [...backups].reverse()) {
      if (await exists(target)) {
        unrestored.push(target);
        problems.push(`${target} is occupied, so its original was not put back`);
        continue;
      }
      await ops.rename(backup, target).catch((restoreError: Error) => {
        unrestored.push(target);
        problems.push(`could not restore ${target}: ${restoreError.message}`);
      });
    }
    if (unrestored.length === 0 && problems.length === 0) throw error;
    // Keep every original that was not restored: move the backups out of the staging directory.
    let keepStaging = false;
    let kept = recoveryDir;
    try {
      await rename(backupDir, recoveryDir);
    } catch {
      keepStaging = true;
      kept = backupDir;
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new PublishRecoveryError(
      `Publishing failed (${cause}) and recovery was incomplete: ${problems.join('; ')}. Originals that were not restored are kept in ${kept}.`,
      kept,
      keepStaging,
    );
  }
}

/** One create run per output directory and stem at a time; the lock file is created exclusively. */
async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DocxMarkdocError('CREATION_LOCKED', `Another create run is publishing to this output (lock ${lockPath}). If no run is active, delete the lock file and retry.`);
    }
    throw error;
  }
  return () => rm(lockPath, { force: true });
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([stat(a).catch(() => null), stat(b).catch(() => null)]);
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

/**
 * `docx-markdoc create <document.mdoc> <output-dir>`: build the DOCX, the
 * read-back text mirror, an optional PDF and the certificate. Outputs are
 * staged in a private directory inside the output directory and published as
 * one unit only after every check passes; a failed build leaves the output
 * directory as it was. Without --replace, any existing output (including a
 * PDF from an earlier build) refuses the build. With --replace, an artifact
 * this build does not produce (for example a PDF under --no-pdf) is retired so
 * the directory reflects this build only.
 */
export async function runCreateCommand(
  args: string[],
  deps: { renderTools?: PdfRenderTools; fileOps?: Partial<PublishFileOps> } = {},
): Promise<CreateCliResult> {
  const options = parseCreateCliArgs(args);
  const ops = { ...DEFAULT_FILE_OPS, ...deps.fileOps };
  const stem = path.basename(options.markdocPath, path.extname(options.markdocPath));
  await mkdir(options.outputDir, { recursive: true });
  const outputDir = await realpath(options.outputDir);
  const outputs = {
    docx: path.join(outputDir, `${stem}.docx`),
    text: path.join(outputDir, `${stem}.txt`),
    certificate: path.join(outputDir, `${stem}.verification.json`),
    pdf: path.join(outputDir, `${stem}.pdf`),
  };
  const releaseLock = await acquireLock(path.join(outputDir, `.${stem}.create.lock`));
  try {
    return await createLocked(options, deps, ops, stem, outputDir, outputs);
  } finally {
    await releaseLock();
  }
}

async function createLocked(
  options: CreateCliArgs,
  deps: { renderTools?: PdfRenderTools },
  ops: PublishFileOps,
  stem: string,
  outputDir: string,
  outputs: { docx: string; text: string; certificate: string; pdf: string },
): Promise<CreateCliResult> {
  // Compare canonical paths (and inodes) so a symlinked directory or file cannot alias an input.
  const inputs = await Promise.all([options.markdocPath, ...(options.profilePath ? [options.profilePath] : [])].map((value) => realpath(value)));
  for (const output of Object.values(outputs)) {
    if (inputs.includes(output) || (await Promise.all(inputs.map((input) => sameFile(input, output)))).some(Boolean)) {
      throw new DocxMarkdocError('CREATION_PATH_COLLISION', `Output ${output} would overwrite an input.`);
    }
  }
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

  // The staging directory is created exclusively, so everything inside it is ours to remove.
  const staging = await mkdtemp(path.join(outputDir, `.${stem}.create-`));
  let keepStaging = false;
  try {
    const staged = (target: string): string => path.join(staging, path.basename(target));
    const produced = new Map<string, string>();
    await writeFile(staged(outputs.docx), created.docx, { flag: 'wx' });
    produced.set(outputs.docx, staged(outputs.docx));
    let pdf: CreateCliResult['pdf'] = { status: 'skipped' };
    if (options.pdf) {
      pdf = await renderPlainPdf({
        docxPath: staged(outputs.docx),
        outputPdfPath: staged(outputs.pdf),
        requiredText: requiredPdfText(created),
        ...(deps.renderTools ? { tools: deps.renderTools } : {}),
      });
      if (pdf.status === 'failed' || (pdf.status === 'not_run' && options.requirePdf)) {
        throw new DocxMarkdocError('CREATION_PDF_FAILED', `PDF check ${pdf.status}: ${pdf.reason ?? 'unknown'}${pdf.missingText ? ` (missing: ${pdf.missingText.join(' | ')})` : ''}.`, pdf);
      }
      if (pdf.status === 'passed') produced.set(outputs.pdf, staged(outputs.pdf));
    }
    const certificate = { ...created.certificate, pdf };
    await writeFile(staged(outputs.text), created.text, { flag: 'wx' });
    produced.set(outputs.text, staged(outputs.text));
    await writeFile(staged(outputs.certificate), `${JSON.stringify(certificate, null, 2)}\n`, { flag: 'wx' });
    produced.set(outputs.certificate, staged(outputs.certificate));
    // The mirror on disk must still equal the read-back it was written from.
    if ((await readFile(staged(outputs.text), 'utf8')) !== created.text) {
      throw new DocxMarkdocError('CREATION_MIRROR_MISMATCH', 'The written text mirror does not match the read-back.');
    }
    const backupDir = path.join(staging, 'replaced');
    await mkdir(backupDir);
    const retired = Object.values(outputs).filter((target) => !produced.has(target));
    await publish(produced, retired, backupDir, path.join(outputDir, `.${stem}.create-recovery-${randomUUID()}`), options.replace, ops);
    const { checks } = created.certificate;
    const summary = [
      `created ${path.basename(outputs.docx)}: ${checks.readback.paragraphs} paragraphs, ${checks.footers.sections} section(s)`,
      `readback ok (negative control ok)`,
      `footers ok (negative control ok)`,
      'deterministic',
      `brownfield ok (${checks.brownfield.anchoredParagraphs} anchored)`,
      pdf.status === 'skipped' ? 'pdf skipped' : `pdf ${pdf.status}${'pageCount' in pdf && pdf.pageCount ? ` (${pdf.pageCount} pages)` : ''}${pdf.status === 'not_run' ? ` (${pdf.reason})` : ''}`,
    ].join('; ');
    return {
      outputs: { docx: outputs.docx, text: outputs.text, certificate: outputs.certificate, ...(produced.has(outputs.pdf) ? { pdf: outputs.pdf } : {}) },
      created,
      pdf,
      summary,
    };
  } catch (error) {
    keepStaging = error instanceof PublishRecoveryError && error.keepStaging;
    throw error;
  } finally {
    if (!keepStaging) await rm(staging, { recursive: true, force: true });
  }
}
