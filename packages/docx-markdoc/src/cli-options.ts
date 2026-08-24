import path from 'node:path';
import type { AnnotationAudience, AnnotationPresentation } from './types.js';

export type RenderingFlags = {
  positional: string[];
  externalComments?: boolean;
  includeInternalComments: boolean;
  internalOutput?: string;
  noteProfilePath?: string;
  notePresentation: Partial<Record<AnnotationAudience, AnnotationPresentation>>;
};

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
