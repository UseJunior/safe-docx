import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCommandArgs } from '../cli-options.js';
import { CliUsageError, DocxMarkdocError } from '../errors.js';
import { writeNewFiles } from '../output.js';
import { pullRecordPath } from './cli-create.js';
import { createDocumentFromMarkdoc } from './create.js';
import { pullCreationEdits, type PullChange, type PullDiagnostic } from './pull.js';

/** `pull` exit codes: nothing changed, changes or diagnostics reported, and (from the CLI's error path) an error. */
export const PULL_EXIT = { unchanged: 0, changed: 2, error: 1 } as const;

/**
 * What `pull --apply` records next to the certificate when the pulled source
 * reproduces the edited DOCX in full: `create --replace` then accepts that
 * exact edited DOCX as the file it replaces, but only when it builds that
 * exact pulled source over the build the certificate records.
 */
export type PullRecord = {
  version: 1;
  kind: 'markdoc-pull';
  /** The edited DOCX the pull reconciled. */
  editedDocxSha256: string;
  /** The build it was edited from (the certificate's `docxSha256`). */
  baseDocxSha256: string;
  baseSourceSha256: string;
  /** The pulled source `create --replace` must build to accept the edited DOCX. */
  pulledSourceSha256: string;
  pulledSource: string;
  complete: true;
};

export type PullReport = {
  edited: string;
  source: string;
  certificate: string;
  changes: PullChange[];
  diagnostics: PullDiagnostic[];
  complete: boolean;
  /** The pulled `.mdoc`, when `--apply` wrote one. */
  output?: string;
  /** The pull record, when `--apply` wrote one. */
  record?: string;
};

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');


type Certificate = { kind?: unknown; passed?: unknown; docxSha256?: unknown; sourceSha256?: unknown; textSha256?: unknown; profileSha256?: unknown; profile?: unknown };

async function readCertificate(certificatePath: string): Promise<Certificate & { docxSha256: string; sourceSha256: string }> {
  let raw: string;
  try {
    raw = await readFile(certificatePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DocxMarkdocError('PULL_CERTIFICATE_MISSING', `No certificate at ${certificatePath}: pull compares the edited DOCX with the build that certificate records. Pass --certificate <stem.verification.json>.`);
    }
    throw error;
  }
  let record: Certificate;
  try {
    record = JSON.parse(raw) as Certificate;
  } catch (error) {
    throw new DocxMarkdocError('PULL_CERTIFICATE_INVALID', `${certificatePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const hex = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
  if (record.kind !== 'markdoc-create' || record.passed !== true || !hex(record.docxSha256) || !hex(record.sourceSha256)) {
    throw new DocxMarkdocError('PULL_CERTIFICATE_INVALID', `${certificatePath} is not a passing create certificate with source and DOCX fingerprints.`);
  }
  return record as Certificate & { docxSha256: string; sourceSha256: string };
}

function show(text: string, limit = 70): string {
  return JSON.stringify(text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
}

/** One line per change, then one per diagnostic. */
export function formatPullReport(report: PullReport, apply: boolean): string {
  const lines: string[] = [];
  const applied = report.changes.filter((change) => change.applied).length;
  const verb = apply ? 'applied' : 'applicable';
  lines.push(`pull ${path.basename(report.edited)} against ${path.basename(report.source)}: ${report.changes.length} change(s) (${applied} ${verb}), ${report.diagnostics.length} diagnostic(s)`);
  // In source order; added paragraphs after the line they follow.
  const at = (change: PullChange) => (change.kind === 'added' ? change.afterLine + 0.5 : change.line);
  for (const change of [...report.changes].sort((x, y) => at(x) - at(y))) {
    const note = change.applied ? '' : ' [not written; see diagnostics]';
    switch (change.kind) {
      case 'changed':
        lines.push(`  line ${change.line}: paragraph ${change.paragraph} changed: ${change.edits.map((edit) => `${show(edit.deleted, 40)} -> ${show(edit.inserted, 40)}${edit.line === change.line ? '' : ` (line ${edit.line})`}`).join('; ')}${note}`);
        break;
      case 'deleted':
        lines.push(`  line${change.endLine > change.line ? `s ${change.line}-${change.endLine}` : ` ${change.line}`}: paragraph ${change.paragraph} deleted: ${show(change.text)}${note}`);
        break;
      case 'added':
        lines.push(`  after line ${change.afterLine}: ${change.paragraphs.length} paragraph(s) added after paragraph ${change.afterParagraph}: ${change.paragraphs.map((text) => show(text, 50)).join(', ')}${note}`);
        break;
      case 'running-text':
        lines.push(`  line ${change.line}: section ${change.section} ${change.slot}: ${change.before.length ? change.before.map((text) => show(text, 40)).join(' / ') : '(none)'} -> ${change.after.length ? change.after.map((text) => show(text, 40)).join(' / ') : '(none)'}${note}`);
        break;
    }
  }
  for (const diagnostic of report.diagnostics) {
    lines.push(`DIAGNOSTIC ${diagnostic.code}: ${diagnostic.message}${diagnostic.line === undefined ? '' : ` (line ${diagnostic.line})`}`);
  }
  if (report.output) lines.push(`wrote ${report.output}`);
  if (report.record) {
    lines.push(`wrote ${report.record}: create --replace accepts the edited ${path.basename(report.edited)} when it builds exactly this pulled source into that output directory`);
  } else if (apply && report.output) {
    lines.push(`the pull is incomplete, so create --replace will still refuse the edited ${path.basename(report.edited)}; review the diagnostics, then use --dangerously-overwrite-edited-docx (which keeps its bytes) once nothing in it is still needed`);
  }
  if (report.changes.length === 0 && report.diagnostics.length === 0) lines.push('no changes');
  return lines.join('\n');
}

/**
 * `docx-markdoc pull <edited.docx> <document.mdoc> [--apply] [--output new.mdoc]
 * [--certificate stem.verification.json] [--style-profile profile.json] [--json]`.
 * Regenerates the build the certificate records from the `.mdoc` (refusing a
 * source or build that no longer matches it), reports each change in the
 * edited DOCX against source lines, and with `--apply` writes the pulled
 * source to a new file and, when it reproduces the edited DOCX in full, the
 * pull record `create --replace` honours.
 */
export async function runPullCommand(args: readonly string[]): Promise<{ exitCode: number; report: PullReport; text: string; json: boolean }> {
  const parsed = parseCommandArgs({
    command: 'pull',
    positionalNames: '<edited.docx> <document.mdoc>',
    minPositional: 2,
    maxPositional: 2,
    booleans: ['--apply', '--json'],
    values: ['--output', '--certificate', '--style-profile'],
  }, args);
  const [editedPath, markdocPath] = parsed.positional as [string, string];
  const apply = parsed.booleans.has('--apply');
  if (parsed.values.has('--output') && !apply) throw new CliUsageError('--output names the pulled .mdoc, so it needs --apply.', 'pull');
  if (!markdocPath.endsWith('.mdoc') && !markdocPath.endsWith('.md')) throw new CliUsageError(`pull takes <edited.docx> <document.mdoc>; '${markdocPath}' is not a .mdoc file.`, 'pull');
  const certificatePath = parsed.values.get('--certificate')
    ?? path.join(path.dirname(editedPath), `${path.basename(editedPath, path.extname(editedPath))}.verification.json`);
  const certificate = await readCertificate(certificatePath);
  const source = await readFile(markdocPath, 'utf8');
  if (sha256(source) !== certificate.sourceSha256) {
    throw new DocxMarkdocError('PULL_SOURCE_CHANGED', `${markdocPath} is not the source ${path.basename(certificatePath)} certifies (its SHA-256 differs), so the edits cannot be placed against it. Pull against the .mdoc the last build was made from.`);
  }
  let profile: unknown = certificate.profile;
  const profilePath = parsed.values.get('--style-profile');
  if (profilePath !== undefined) {
    const bytes = await readFile(profilePath);
    if (typeof certificate.profileSha256 === 'string' && sha256(bytes) !== certificate.profileSha256) {
      throw new DocxMarkdocError('PULL_PROFILE_CHANGED', `${profilePath} is not the style profile ${path.basename(certificatePath)} certifies.`);
    }
    try {
      profile = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new DocxMarkdocError('INVALID_CREATION_PROFILE_JSON', `Style profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const certificateStem = path.basename(certificatePath).replace(/\.verification\.json$/u, '');
  const base = await createDocumentFromMarkdoc(source, { ...(profile === undefined ? {} : { profile }), mirrorLabel: `${certificateStem}.docx` });
  if (sha256(base.docx) !== certificate.docxSha256 && base.certificate.textSha256 !== certificate.textSha256) {
    throw new DocxMarkdocError('PULL_BASE_MISMATCH', `Rebuilding ${markdocPath} does not reproduce the build ${path.basename(certificatePath)} records (neither its DOCX nor its text), so the edits cannot be compared with it. Pass the --style-profile the build used, or pull with the docx-markdoc version that built it.`);
  }
  const editedBytes = await readFile(editedPath);
  const result = await pullCreationEdits({ source, ...(profile === undefined ? {} : { profile }), base, edited: editedBytes });
  const report: PullReport = {
    edited: editedPath,
    source: markdocPath,
    certificate: certificatePath,
    changes: result.changes,
    diagnostics: result.diagnostics,
    complete: result.complete,
  };
  if (apply && result.pulledSource !== undefined) {
    const output = parsed.values.get('--output') ?? path.join(path.dirname(markdocPath), `${path.basename(markdocPath, path.extname(markdocPath))}.pulled.mdoc`);
    await writeNewFiles([[output, result.pulledSource]]);
    report.output = output;
    if (result.complete) {
      const record: PullRecord = {
        version: 1,
        kind: 'markdoc-pull',
        editedDocxSha256: sha256(editedBytes),
        baseDocxSha256: certificate.docxSha256,
        baseSourceSha256: certificate.sourceSha256,
        pulledSourceSha256: sha256(result.pulledSource),
        pulledSource: path.basename(output),
        complete: true,
      };
      // The record is metadata, replaced by each complete pull: stage it, then rename it into place.
      const target = pullRecordPath(certificatePath);
      const staged = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}`);
      try {
        await writeFile(staged, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
        await rename(staged, target);
      } catch (error) {
        await rm(staged, { force: true }).catch(() => undefined);
        throw error;
      }
      report.record = target;
    }
  }
  const exitCode = result.changes.length === 0 && result.diagnostics.length === 0 ? PULL_EXIT.unchanged : PULL_EXIT.changed;
  const json = parsed.booleans.has('--json');
  return { exitCode, report, text: json ? JSON.stringify(report, null, 2) : formatPullReport(report, apply), json };
}
