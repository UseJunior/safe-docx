import path from 'node:path';
import { DocxMarkdocError } from './errors.js';
import type { AnnotationAudience, AnnotationPresentation, ValidationIssue } from './types.js';

export type RenderingFlags = {
  positional: string[];
  externalComments?: boolean;
  includeInternalComments: boolean;
  internalOutput?: string;
  noteProfilePath?: string;
  notePresentation: Partial<Record<AnnotationAudience, AnnotationPresentation>>;
};

export type GreenfieldCliArgs = {
  templatePath: string;
  markdocPath: string;
  outputDir: string;
  profilePath?: string;
};

export function parseGreenfieldCliArgs(args: string[]): GreenfieldCliArgs {
  const positional: string[] = [];
  let profilePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--style-profile') {
      if (profilePath !== undefined) throw new Error('--style-profile may be supplied only once.');
      profilePath = args[index + 1];
      if (!profilePath) throw new Error('--style-profile requires a JSON path.');
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  const [templatePath, markdocPath, outputDir] = positional;
  if (!templatePath || !markdocPath || !outputDir || positional.length !== 3) {
    throw new Error('compile-greenfield requires a template, Markdoc file, and output directory.');
  }
  return { templatePath, markdocPath, outputDir, ...(profilePath ? { profilePath } : {}) };
}

export function parseRenderingFlags(args: string[]): RenderingFlags {
  const positional: string[] = [];
  let externalComments: boolean | undefined;
  let includeInternalComments = false;
  let internalOutput: string | undefined;
  let noteProfilePath: string | undefined;
  const notePresentation: RenderingFlags['notePresentation'] = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--external-comments' || arg === '--no-external-comments') {
      const next = arg === '--external-comments';
      if (externalComments !== undefined && externalComments !== next) {
        throw new Error('--external-comments and --no-external-comments are mutually exclusive.');
      }
      externalComments = next;
    } else if (arg === '--dangerously-include-internal-comments') {
      includeInternalComments = true;
    } else if (arg === '--internal-output') {
      internalOutput = args[index + 1];
      if (!internalOutput) throw new Error('--internal-output requires a .docx path.');
      index += 1;
    } else if (arg === '--note-profile') {
      noteProfilePath = args[index + 1];
      if (!noteProfilePath) throw new Error('--note-profile requires a JSON path.');
      index += 1;
    } else if (arg === '--external-notes' || arg === '--internal-notes' || arg === '--unspecified-notes') {
      const value = args[index + 1] as AnnotationPresentation | undefined;
      if (!value || !['preserve', 'comment', 'footnote', 'omit'].includes(value)) throw new Error(`${arg} requires preserve, comment, footnote, or omit.`);
      const audience: AnnotationAudience = arg === '--external-notes' ? 'external-facing' : arg === '--internal-notes' ? 'internal' : 'unspecified';
      notePresentation[audience] = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (includeInternalComments !== (internalOutput !== undefined)) {
    throw new Error('--dangerously-include-internal-comments and --internal-output must be supplied together.');
  }
  if (noteProfilePath && Object.keys(notePresentation).length > 0) throw new Error('--note-profile cannot be combined with audience note overrides.');
  return { positional, externalComments, includeInternalComments, internalOutput, noteProfilePath, notePresentation };
}

export const EXTERNAL_FILENAME = 'redline - EXTERNAL COMMENTS INCLUDED.docx';
export const INTERNAL_SUFFIX = ' - INTERNAL COMMENTS INCLUDED.docx';

export function warnedInternalPath(requested: string): string {
  const directory = path.dirname(requested);
  const extension = path.extname(requested);
  const rawBase = path.basename(requested, extension);
  const suffixBytes = Buffer.byteLength(INTERNAL_SUFFIX);
  let prefix = rawBase;
  while (Buffer.byteLength(prefix) + suffixBytes > 255) prefix = [...prefix].slice(0, -1).join('');
  return path.join(directory, `${prefix}${INTERNAL_SUFFIX}`);
}

export function assertDistinctInternalPath(internalPath: string, paths: string[]): void {
  const resolved = path.resolve(internalPath);
  if (paths.some((candidate) => path.resolve(candidate) === resolved)) {
    throw new Error('Internal-comment output must be distinct from the source, clean, and external redline paths.');
  }
}

/**
 * Formats a fatal CLI error for stderr. A `DocxMarkdocError` prints one
 * `ERROR <code>: <message> (line N)` line per validation issue it carries, or
 * a single `ERROR <code>: <message>` line when it carries none, so an agent
 * reading the output learns why a document was rejected. Its stack is appended
 * only when `debug` is set. Any other error keeps printing its stack.
 *
 * `DocxMarkdocError` exposes any array-valued `details` as `issues`, and not
 * every thrower passes `ValidationIssue`s (story topology failures pass
 * `SectPrAuditIssue`s, which carry `message` but no `code`), so each field is
 * taken from the entry only when it has the expected type and otherwise falls
 * back to the error's own code and message.
 */
export function formatCliError(error: unknown, debug: boolean): string {
  if (!(error instanceof DocxMarkdocError)) {
    return error instanceof Error ? error.stack ?? error.message : String(error);
  }
  const entries: ReadonlyArray<Partial<ValidationIssue> | undefined> = error.issues && error.issues.length > 0
    ? error.issues
    : [undefined];
  const lines = entries.map((entry) => {
    const code = typeof entry?.code === 'string' ? entry.code : error.code;
    const message = typeof entry?.message === 'string' ? entry.message : error.message;
    const line = typeof entry?.line === 'number' ? ` (line ${entry.line})` : '';
    return `ERROR ${code}: ${message}${line}`;
  });
  if (debug && error.stack) lines.push(error.stack);
  return lines.join('\n');
}
