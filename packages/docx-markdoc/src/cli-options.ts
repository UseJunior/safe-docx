import path from 'node:path';
import { CliUsageError, DocxMarkdocError } from './errors.js';
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

/** True when a command-line argument is an option (`--name` or `-x`) rather than a value. */
export function isOption(arg: string): boolean {
  return arg.length > 1 && arg.startsWith('-');
}

/** True when the arguments ask for help (`--help` or `-h` anywhere). */
export function wantsHelp(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h');
}

/** The options and positional arguments one subcommand accepts. */
export type CommandArgSpec = {
  /** The subcommand, for messages. */
  command: string;
  /** How the positional arguments read in a message, such as `<document.mdoc> [anchored.docx]`. */
  positionalNames: string;
  minPositional: number;
  /** `Infinity` for a trailing list. */
  maxPositional: number;
  /** Options that take no value. */
  booleans?: readonly string[];
  /** Options that take the next argument as their value; each may be given once. */
  values?: readonly string[];
};

export type ParsedCommandArgs = {
  positional: string[];
  booleans: Set<string>;
  values: Map<string, string>;
};

/**
 * Parse one subcommand's arguments strictly: an unknown option, an option
 * without its value, a repeated value option, or the wrong number of
 * positional arguments is a {@link CliUsageError}. A value option takes the
 * next argument verbatim, so a value may itself start with `-`.
 */
export function parseCommandArgs(spec: CommandArgSpec, args: readonly string[]): ParsedCommandArgs {
  const booleans = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (spec.values?.includes(arg)) {
      if (values.has(arg)) throw new CliUsageError(`${arg} may be supplied only once.`, spec.command);
      const value = args[index + 1];
      if (value === undefined) throw new CliUsageError(`${arg} requires a value.`, spec.command);
      values.set(arg, value);
      index += 1;
    } else if (spec.booleans?.includes(arg)) {
      booleans.add(arg);
    } else if (isOption(arg)) {
      throw new CliUsageError(`Unknown option ${arg}.`, spec.command);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < spec.minPositional || positional.length > spec.maxPositional) {
    const count = `${positional.length} argument${positional.length === 1 ? '' : 's'}`;
    throw new CliUsageError(`${spec.command} takes ${spec.positionalNames}; got ${count}.`, spec.command);
  }
  return { positional, booleans, values };
}

export function parseGreenfieldCliArgs(args: string[]): GreenfieldCliArgs {
  const positional: string[] = [];
  let profilePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--style-profile') {
      if (profilePath !== undefined) throw new CliUsageError('--style-profile may be supplied only once.');
      profilePath = args[index + 1];
      if (!profilePath) throw new CliUsageError('--style-profile requires a JSON path.');
      index += 1;
    } else if (isOption(arg)) {
      throw new CliUsageError(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  const [templatePath, markdocPath, outputDir] = positional;
  if (!templatePath || !markdocPath || !outputDir || positional.length !== 3) {
    throw new CliUsageError('compile-greenfield requires a template, Markdoc file, and output directory.');
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
        throw new CliUsageError('--external-comments and --no-external-comments are mutually exclusive.');
      }
      externalComments = next;
    } else if (arg === '--dangerously-include-internal-comments') {
      includeInternalComments = true;
    } else if (arg === '--internal-output') {
      internalOutput = args[index + 1];
      if (!internalOutput) throw new CliUsageError('--internal-output requires a .docx path.');
      index += 1;
    } else if (arg === '--note-profile') {
      noteProfilePath = args[index + 1];
      if (!noteProfilePath) throw new CliUsageError('--note-profile requires a JSON path.');
      index += 1;
    } else if (arg === '--external-notes' || arg === '--internal-notes' || arg === '--unspecified-notes') {
      const value = args[index + 1] as AnnotationPresentation | undefined;
      if (!value || !['preserve', 'comment', 'footnote', 'omit'].includes(value)) throw new CliUsageError(`${arg} requires preserve, comment, footnote, or omit.`);
      const audience: AnnotationAudience = arg === '--external-notes' ? 'external-facing' : arg === '--internal-notes' ? 'internal' : 'unspecified';
      notePresentation[audience] = value;
      index += 1;
    } else if (isOption(arg)) {
      throw new CliUsageError(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (includeInternalComments !== (internalOutput !== undefined)) {
    throw new CliUsageError('--dangerously-include-internal-comments and --internal-output must be supplied together.');
  }
  if (noteProfilePath && Object.keys(notePresentation).length > 0) throw new CliUsageError('--note-profile cannot be combined with audience note overrides.');
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
    throw new CliUsageError('Internal-comment output must be distinct from the source, clean, and external redline paths.');
  }
}

/**
 * Formats a fatal CLI error for stderr. A {@link CliUsageError} prints one
 * `ERROR CLI_USAGE: <message> Run 'docx-markdoc <command> --help' for usage.`
 * line, and a Node file-system error on a named path (a missing input, an
 * existing output) one `ERROR <errno code>: <message>` line; both append their
 * stack only when `debug` is set. A `DocxMarkdocError` prints one
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
  if (error instanceof CliUsageError) {
    const help = error.command ? `docx-markdoc ${error.command} --help` : 'docx-markdoc --help';
    const line = `ERROR ${error.code}: ${error.message} Run '${help}' for usage.`;
    return debug && error.stack ? `${line}\n${error.stack}` : line;
  }
  if (isFileSystemError(error)) {
    // A path the caller named that cannot be read or written: one line, like a usage error.
    const line = `ERROR ${error.code}: ${error.message}`;
    return debug && error.stack ? `${line}\n${error.stack}` : line;
  }
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

/**
 * A Node file-system error on a named path (`ENOENT`, `EEXIST`, `EACCES`, …):
 * it has a string `code`, `syscall` and `path`. It reports a path the caller
 * supplied, not a defect in this package, so the CLI prints it on one line.
 */
function isFileSystemError(error: unknown): error is NodeJS.ErrnoException & { code: string; path: string } {
  if (!(error instanceof Error)) return false;
  const candidate = error as NodeJS.ErrnoException;
  return typeof candidate.code === 'string' && /^E[A-Z0-9]+$/u.test(candidate.code)
    && typeof candidate.syscall === 'string' && typeof candidate.path === 'string';
}
