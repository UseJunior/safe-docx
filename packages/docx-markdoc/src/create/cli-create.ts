import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPlainPdf, type PlainPdfVerdict } from '../pdf/plain-render.js';
import type { PdfRenderTools } from '../pdf/tools.js';
import { DocxMarkdocError } from '../errors.js';
import { createDocumentFromMarkdoc, type CreatedDocument } from './create.js';
import { PAGE_FIELD_TOKEN } from './lower.js';
import { comparePdfWords, projectSourceText, type PdfWordComparison } from './oracle.js';

export type CreateCliArgs = {
  markdocPath: string;
  outputDir: string;
  profilePath?: string;
  pdf: boolean;
  requirePdf: boolean;
  /** Rebuild over existing outputs, but only when the DOCX is the one the last build certified. */
  replace: boolean;
  /** Also rebuild over an edited or uncertified DOCX, keeping its bytes in a named directory. Implies `replace`. */
  overwriteEditedDocx: boolean;
};

/** The PDF verdict as recorded: page texts are dropped, and `words` holds the word-level comparison when the PDF rendered. */
export type RecordedPdfVerdict = Omit<PlainPdfVerdict, 'pageTexts'> & { words?: PdfWordComparison };

export type CreateCliResult = {
  outputs: { docx: string; text: string; certificate: string; pdf?: string };
  /** Set when `--dangerously-overwrite-edited-docx` displaced a DOCX that was not the last certified build. */
  overwritten?: { docx: string; sha256: string; reason: string };
  created: CreatedDocument;
  pdf: RecordedPdfVerdict | { status: 'skipped' };
  summary: string;
};

/** Verification failures that leave a mismatch report next to the outputs. */
const REPORTED_FAILURES = new Set(['CREATION_VERIFICATION_FAILED', 'CREATION_PDF_FAILED', 'CREATION_PDF_WORDS_MISMATCH']);

/**
 * A create run that failed verification. Nothing was published; the mismatch
 * report (when it could be written) is at `reportPath`.
 */
export class CreationFailureReportedError extends DocxMarkdocError {
  constructor(cause: DocxMarkdocError, readonly reportPath: string | null, reportProblem?: string) {
    super(
      cause.code,
      `${cause.message} Nothing was published. ${reportPath ? `Mismatch report: ${reportPath}` : `The mismatch report could not be written (${reportProblem ?? 'unknown error'})`}.`,
      cause.details,
    );
  }
}

export function parseCreateCliArgs(args: string[]): CreateCliArgs {
  const positional: string[] = [];
  let profilePath: string | undefined;
  let pdf = true;
  let requirePdf = false;
  let replace = false;
  let overwriteEditedDocx = false;
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
    else if (arg === '--dangerously-overwrite-edited-docx') overwriteEditedDocx = replace = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else positional.push(arg);
  }
  const [markdocPath, outputDir] = positional;
  if (!markdocPath || !outputDir || positional.length !== 2) throw new Error('create requires a Markdoc file and an output directory.');
  if (!pdf && requirePdf) throw new Error('--no-pdf and --require-pdf are mutually exclusive.');
  return { markdocPath, outputDir, ...(profilePath ? { profilePath } : {}), pdf, requirePdf, replace, overwriteEditedDocx };
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

const sha256File = async (target: string): Promise<string> => createHash('sha256').update(await readFile(target)).digest('hex');

/**
 * What the last successful build certified about the existing DOCX: its
 * SHA-256 from `<stem>.verification.json`, or why there is no usable record.
 */
export type DocxFingerprint = { sha256: string } | { sha256: null; reason: string };

async function certifiedDocxFingerprint(certificatePath: string): Promise<DocxFingerprint> {
  if ((await existingKind(certificatePath)) !== 'file') return { sha256: null, reason: `${path.basename(certificatePath)} is missing` };
  let record: unknown;
  try {
    record = JSON.parse(await readFile(certificatePath, 'utf8'));
  } catch (error) {
    return { sha256: null, reason: `${path.basename(certificatePath)} is unreadable (${error instanceof Error ? error.message : String(error)})` };
  }
  const { kind, passed, docxSha256 } = (record ?? {}) as { kind?: unknown; passed?: unknown; docxSha256?: unknown };
  if (kind !== 'markdoc-create' || passed !== true || typeof docxSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(docxSha256)) {
    return { sha256: null, reason: `${path.basename(certificatePath)} is not a passing create certificate with a DOCX fingerprint` };
  }
  return { sha256: docxSha256 };
}

/**
 * Guard for the existing DOCX. `certified` is the fingerprint the last build
 * recorded (null: none usable). Publication hashes the bytes it actually moves
 * aside: unless `force`, anything but the certified bytes is refused; with
 * `force`, anything but the certified bytes is kept.
 */
type DocxGuard = { target: string; certified: string | null; force: boolean; displacedSha256?: string };

function editedDocxError(target: string, reason: string): DocxMarkdocError {
  return new DocxMarkdocError(
    'CREATION_OUTPUT_EDITED',
    `Refusing to replace ${target}: ${reason}. It may hold edits made after the last build. Move it aside, or pass --dangerously-overwrite-edited-docx to replace it (its bytes are kept in a .<stem>.create-overwritten-… directory).`,
    { target, reason },
  );
}

/** Filesystem operations used to publish outputs; injectable so tests can force a mid-publication failure. */
export type PublishFileOps = {
  /** Opens the stem lock file (exclusive create). */
  open: typeof open;
  link: (from: string, to: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (target: string) => Promise<void>;
};
const DEFAULT_FILE_OPS: PublishFileOps = { open, link, rename, unlink };

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
  guard: DocxGuard,
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
      if (target === guard.target) {
        // Check the bytes actually moved aside, so an edit made after the
        // preflight check is caught too; a failure here restores everything.
        guard.displacedSha256 = await sha256File(backup);
        if (!guard.force && guard.displacedSha256 !== guard.certified) {
          throw editedDocxError(target, 'it changed or appeared during the build and is not the DOCX the last build certified');
        }
      }
    }
    for (const [target, staged] of produced) {
      // Ownership is the private staged file's inode, read before linking: the
      // hard link shares it, and nothing outside this run can change it.
      const owned = await lstat(staged);
      placed.push({ target, dev: owned.dev, ino: owned.ino });
      await ops.link(staged, target);
    }
  } catch (error) {
    const problems: string[] = [];
    // Remove only what this run placed: an entry whose inode is not the staged
    // file's belongs to someone else. (Check and unlink are two steps, so a
    // non-cooperating writer replacing the path in that instant is not covered;
    // cooperating create runs are serialized by the stem lock.)
    for (const { target, dev, ino } of placed) {
      const current = await lstat(target).catch(() => null);
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
async function acquireLock(lockPath: string, openFile: typeof open): Promise<() => Promise<void>> {
  let handle;
  try {
    handle = await openFile(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DocxMarkdocError('CREATION_LOCKED', `Another create run is publishing to this output (lock ${lockPath}). If no run is active, delete the lock file and retry.`);
    }
    throw error;
  }
  // The lock file is ours from here: if initialising it fails, close the handle and remove it.
  try {
    await handle.writeFile(`${process.pid}\n`);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    throw error;
  }
  try {
    await handle.close();
  } catch (error) {
    await rm(lockPath, { force: true });
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
  const failureReport = path.join(outputDir, `${stem}.failed-verification.json`);
  const releaseLock = await acquireLock(path.join(outputDir, `.${stem}.create.lock`), ops.open);
  try {
    const result = await createLocked(options, deps, ops, stem, outputDir, outputs, failureReport);
    // A report from an earlier failed run no longer describes these outputs.
    if ((await existingKind(failureReport)) === 'file') {
      await rm(failureReport, { force: true }).catch((error: Error) => {
        result.summary += `; WARNING: stale ${path.basename(failureReport)} could not be removed (${error.message})`;
      });
    }
    return result;
  } catch (error) {
    // Missing PDF tools under --require-pdf is not a mismatch, so it leaves no report.
    const toolsMissing = error instanceof DocxMarkdocError && (error.details as { status?: string } | undefined)?.status === 'not_run';
    if (!(error instanceof DocxMarkdocError) || !REPORTED_FAILURES.has(error.code) || toolsMissing) throw error;
    const written = await writeFailureReport(failureReport, outputDir, stem, options.markdocPath, error);
    throw new CreationFailureReportedError(error, written.path, written.problem);
  } finally {
    await releaseLock();
  }
}

/** Drop the bulky per-page text from a PDF verdict before recording it. */
function recordedPdf(verdict: PlainPdfVerdict, words?: PdfWordComparison): RecordedPdfVerdict {
  const { pageTexts: _pageTexts, ...rest } = verdict;
  return { ...rest, ...(words ? { words } : {}) };
}

/**
 * Write `<stem>.failed-verification.json` for a run that failed verification:
 * the failure, every check result and the mismatches found. It is staged and
 * renamed into place, so it replaces only an earlier failure report and never
 * writes through a symlink. It is never one of the published outputs and never
 * replaces `<stem>.verification.json`.
 */
async function writeFailureReport(
  target: string,
  outputDir: string,
  stem: string,
  markdocPath: string,
  error: DocxMarkdocError,
): Promise<{ path: string | null; problem?: string }> {
  const report = {
    version: 1,
    kind: 'markdoc-create-failure',
    source: path.basename(markdocPath),
    code: error.code,
    message: error.message,
    published: false,
    note: 'This build failed verification, so nothing was published and existing outputs were left as they were. This file is replaced by the next failed build and removed by the next successful one.',
    details: error.details && typeof error.details === 'object' && 'pageTexts' in error.details ? recordedPdf(error.details as PlainPdfVerdict) : error.details,
  };
  const temporary = path.join(outputDir, `.${stem}.failed-verification-${randomUUID()}.json`);
  try {
    if ((await existingKind(target)) === 'other') throw new Error(`${target} exists and is not a file`);
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, target);
    return { path: target };
  } catch (reportError) {
    await rm(temporary, { force: true }).catch(() => undefined);
    return { path: null, problem: reportError instanceof Error ? reportError.message : String(reportError) };
  }
}

async function createLocked(
  options: CreateCliArgs,
  deps: { renderTools?: PdfRenderTools },
  ops: PublishFileOps,
  stem: string,
  outputDir: string,
  outputs: { docx: string; text: string; certificate: string; pdf: string },
  failureReport: string,
): Promise<CreateCliResult> {
  // Compare canonical paths (and inodes) so a symlinked directory or file cannot alias an input.
  const inputs = await Promise.all([options.markdocPath, ...(options.profilePath ? [options.profilePath] : [])].map((value) => realpath(value)));
  for (const output of [...Object.values(outputs), failureReport]) {
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
  // --replace rebuilds only over the DOCX the last build certified. A DOCX with
  // no usable certificate, or whose bytes differ from it, may hold edits.
  const fingerprint = await certifiedDocxFingerprint(outputs.certificate);
  let docxReason: string | undefined;
  if ((await existingKind(outputs.docx)) === 'file') {
    if (fingerprint.sha256 === null) docxReason = `${fingerprint.reason}, so it cannot be shown to be unedited`;
    else if (fingerprint.sha256 !== (await sha256File(outputs.docx))) docxReason = 'its SHA-256 differs from the one recorded by the last build';
    if (docxReason && !options.overwriteEditedDocx) throw editedDocxError(outputs.docx, docxReason);
  }
  const guard: DocxGuard = { target: outputs.docx, certified: fingerprint.sha256, force: options.overwriteEditedDocx };

  const profileSource = options.profilePath ? await readFile(options.profilePath) : undefined;
  let profile: unknown;
  if (profileSource) {
    try {
      profile = JSON.parse(profileSource.toString('utf8'));
    } catch (error) {
      throw new DocxMarkdocError('INVALID_CREATION_PROFILE_JSON', `Style profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const source = await readFile(options.markdocPath, 'utf8');
  const created = await createDocumentFromMarkdoc(source, {
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
      const verdict = await renderPlainPdf({
        docxPath: staged(outputs.docx),
        outputPdfPath: staged(outputs.pdf),
        requiredText: requiredPdfText(created),
        ...(deps.renderTools ? { tools: deps.renderTools } : {}),
      });
      if (verdict.status === 'failed' || (verdict.status === 'not_run' && options.requirePdf)) {
        throw new DocxMarkdocError('CREATION_PDF_FAILED', `PDF check ${verdict.status}: ${verdict.reason ?? 'unknown'}${verdict.missingText ? ` (missing: ${verdict.missingText.join(' | ')})` : ''}.`, recordedPdf(verdict));
      }
      // Every source word must reach the PDF text layer, and the PDF may add only known generated text.
      const words = verdict.status === 'passed' ? comparePdfWords(projectSourceText(source), verdict.pageTexts ?? []) : undefined;
      pdf = recordedPdf(verdict, words);
      if (words && !words.passed) {
        const first = words.missing[0] ?? words.unexplainedExtra[0];
        throw new DocxMarkdocError(
          'CREATION_PDF_WORDS_MISMATCH',
          `PDF text layer does not match the source word for word: ${words.missing.length} missing span(s), ${words.unexplainedExtra.length} unexplained extra span(s), ${words.footerMismatches.length} page(s) with the wrong footer, ${words.unverifiedTableHeaders.length} unverified table header(s)${words.alignment === 'over-budget' ? ' (too different to align)' : ''}${first ? `; first: "${first.words}" after "${first.before}"` : ''}.`,
          pdf,
        );
      }
      if (verdict.status === 'passed') produced.set(outputs.pdf, staged(outputs.pdf));
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
    await publish(produced, retired, backupDir, path.join(outputDir, `.${stem}.create-recovery-${randomUUID()}`), options.replace, ops, guard);
    // A forced overwrite keeps the displaced DOCX: the exact bytes that were moved aside.
    let overwritten: CreateCliResult['overwritten'];
    if (guard.displacedSha256 !== undefined && guard.displacedSha256 !== guard.certified) {
      const keptDir = path.join(outputDir, `.${stem}.create-overwritten-${randomUUID()}`);
      const kept = path.join(keptDir, path.basename(outputs.docx));
      try {
        await mkdir(keptDir);
        await ops.rename(path.join(backupDir, path.basename(outputs.docx)), kept);
      } catch (error) {
        keepStaging = true;
        throw new DocxMarkdocError(
          'CREATION_OVERWRITE_BACKUP_FAILED',
          `The new outputs were published, but the replaced DOCX could not be moved to ${kept} (${error instanceof Error ? error.message : String(error)}). Its bytes are kept in ${path.join(backupDir, path.basename(outputs.docx))}.`,
          { kept: path.join(backupDir, path.basename(outputs.docx)) },
        );
      }
      overwritten = { docx: kept, sha256: guard.displacedSha256, reason: docxReason ?? 'it changed during the build' };
    }
    const { checks } = created.certificate;
    const summary = [
      `created ${path.basename(outputs.docx)}: ${checks.readback.paragraphs} paragraphs, ${checks.footers.sections} section(s)`,
      `readback ok (negative control ok)`,
      `footers ok (negative control ok)`,
      'deterministic',
      `brownfield ok (${checks.brownfield.anchoredParagraphs} anchored)`,
      `round trip ok (${checks.roundTrip.body.expected} paragraphs; negative controls ok)`,
      pdf.status === 'skipped' ? 'pdf skipped' : `pdf ${pdf.status}${'pageCount' in pdf && pdf.pageCount ? ` (${pdf.pageCount} pages)` : ''}${pdf.status === 'not_run' ? ` (${pdf.reason})` : ''}${'words' in pdf && pdf.words ? `; pdf words ok (${pdf.words.expectedWords} source words)` : ''}`,
      ...(overwritten ? [`WARNING: overwrote an edited ${path.basename(outputs.docx)} (${overwritten.reason}); its previous bytes (sha256 ${overwritten.sha256}) are kept in ${overwritten.docx}`] : []),
    ].join('; ');
    return {
      outputs: { docx: outputs.docx, text: outputs.text, certificate: outputs.certificate, ...(produced.has(outputs.pdf) ? { pdf: outputs.pdf } : {}) },
      ...(overwritten ? { overwritten } : {}),
      created,
      pdf,
      summary,
    };
  } catch (error) {
    // Keep staging when it holds originals that could not be restored or moved out.
    keepStaging ||= error instanceof PublishRecoveryError && error.keepStaging;
    throw error;
  } finally {
    if (!keepStaging) await rm(staging, { recursive: true, force: true });
  }
}
