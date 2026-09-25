/**
 * CLI grep command — human-friendly search output for DOCX files.
 *
 * Usage:
 *   safedocx grep "pattern" file.docx
 *   safedocx grep "pattern" *.docx docs/*.docx
 *   safedocx grep "pattern" file.docx --search-xml --case-sensitive
 *   safedocx grep "pattern" file.docx --json
 */
import { SessionManager } from '../../session/manager.js';
import { dispatchToolCall } from '../../server.js';
import { CliCommandFailure, resolveCliAiAuthor } from '../tool_runner.js';

export interface GrepCommandArgs {
  pattern: string;
  files: string[];
  caseSensitive?: boolean;
  wholeWord?: boolean;
  searchXml?: boolean;
  maxResults?: number;
  json?: boolean;
}

export function parseGrepArgs(argv: string[]): GrepCommandArgs {
  const files: string[] = [];
  let pattern: string | undefined;
  let caseSensitive: boolean | undefined;
  let wholeWord: boolean | undefined;
  let searchXml: boolean | undefined;
  let maxResults: number | undefined;
  let json: boolean | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === '--case-sensitive') {
      caseSensitive = true;
      continue;
    }
    if (token === '--whole-word') {
      wholeWord = true;
      continue;
    }
    if (token === '--search-xml') {
      searchXml = true;
      continue;
    }
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--max-results') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --max-results');
      maxResults = parseInt(next, 10);
      if (Number.isNaN(maxResults)) throw new Error(`Invalid number for --max-results: "${next}"`);
      i += 1;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Unknown flag: ${token}. Use safedocx grep --help for usage.`);
    }

    // First non-flag positional is the pattern
    if (!pattern) {
      pattern = token;
      continue;
    }

    // Subsequent positionals are files
    files.push(token);
  }

  if (!pattern) {
    throw new Error('Missing search pattern. Usage: safedocx grep "pattern" file.docx [file2.docx ...]');
  }
  if (files.length === 0) {
    throw new Error('Missing file path(s). Usage: safedocx grep "pattern" file.docx [file2.docx ...]');
  }

  return { pattern, files, caseSensitive, wholeWord, searchXml, maxResults, json };
}

type GrepResult = {
  success: boolean;
  matches?: Array<{
    para_id: string;
    para_index_1based: number;
    match_text: string;
    context: string;
    match_count_in_paragraph: number;
  }>;
  total_matches?: number;
  paragraphs_with_matches?: number;
  files?: Array<{
    file_path: string;
    matches: unknown[];
    total_matches: number;
    /** Set when the file could not be searched (for example a refused WML Strict package). */
    error?: string;
    error_code?: string;
  }>;
  [key: string]: unknown;
};

function formatHumanOutput(result: GrepResult, filePath?: string): string {
  const lines: string[] = [];

  if (result.files) {
    // Multi-file results
    for (const file of result.files) {
      const f = file as { file_path: string; matches: Array<{ para_id: string; context: string }>; total_matches: number; error?: string; error_code?: string };
      if (f.error) {
        // A file that could not be searched is reported, not silently counted as
        // zero matches (#1025).
        lines.push(`${f.file_path}: ${f.error_code ? `${f.error_code}: ` : ''}${f.error}`);
        continue;
      }
      if (f.total_matches === 0) continue;
      for (const match of f.matches) {
        lines.push(`${f.file_path}:${match.para_id}: ${match.context}`);
      }
    }
  } else if (result.matches) {
    // Single-file results
    const prefix = filePath ? `${filePath}:` : '';
    for (const match of result.matches) {
      lines.push(`${prefix}${match.para_id}: ${match.context}`);
    }
  }

  const total = result.total_matches ?? 0;
  const paraCount = result.paragraphs_with_matches ?? 0;
  if (total > 0) {
    lines.push('');
    lines.push(`${total} match${total !== 1 ? 'es' : ''} in ${paraCount} paragraph${paraCount !== 1 ? 's' : ''}`);
  } else {
    lines.push('No matches found.');
  }

  return lines.join('\n');
}

export async function runGrepCommand(
  args: GrepCommandArgs,
  opts: { write: (line: string) => void; writeError: (line: string) => void },
): Promise<void> {
  const mgr = new SessionManager({ defaultAiAuthor: resolveCliAiAuthor() });

  const toolArgs: Record<string, unknown> = {
    pattern: args.pattern,
    case_sensitive: args.caseSensitive ?? false,
    whole_word: args.wholeWord ?? false,
    search_xml: args.searchXml ?? false,
  };
  if (args.maxResults != null) {
    toolArgs.max_results = args.maxResults;
  }

  if (args.files.length === 1) {
    toolArgs.file_path = args.files[0];
  } else {
    toolArgs.file_paths = args.files;
  }

  const result = await dispatchToolCall(mgr, 'grep', toolArgs) as GrepResult;

  if (!result.success) {
    // Same structured error object the generic tool commands print, so a
    // typed refusal (UNSUPPORTED_CONFORMANCE_CLASS) keeps its code and hint.
    opts.writeError(JSON.stringify(result, null, 2));
    throw new CliCommandFailure('grep failed');
  }

  if (args.json) {
    opts.write(JSON.stringify(result, null, 2));
  } else {
    opts.write(formatHumanOutput(result, args.files.length === 1 ? args.files[0] : undefined));
  }
}
