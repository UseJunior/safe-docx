/**
 * The generic `-o/--output <path>` option for mutating tool subcommands.
 * Kept free of server imports so help rendering can use it (#1048).
 */
import { SAFE_DOCX_TOOL_CATALOG } from '../tool_catalog.js';

/**
 * Non-read-only tools that already write their own output file (`save`,
 * `export`, `convert_to_odt`) or end the session (`close_file`). The generic
 * `-o/--output` option does not apply to them.
 */
const TOOLS_WITH_OWN_OUTPUT = new Set(['save', 'export', 'convert_to_odt', 'close_file']);

/**
 * Whether the generic `-o/--output <path>` option is offered for a tool
 * subcommand: every tool whose catalog entry is not read-only, except those
 * that write their own output.
 */
export function acceptsCliOutputOption(toolName: string): boolean {
  const entry = SAFE_DOCX_TOOL_CATALOG.find((t) => t.name === toolName);
  if (!entry || entry.annotations.readOnlyHint) return false;
  return !TOOLS_WITH_OWN_OUTPUT.has(toolName);
}

const SAVE_FORMATS = ['clean', 'tracked', 'both'] as const;
export type CliSaveFormat = (typeof SAVE_FORMATS)[number];

/**
 * Remove `-o/--output <path>` and `--save-format <clean|tracked|both>` from a
 * tool subcommand's argv. `--save-format` is passed to the save; it is needed,
 * for example, to keep a selective accept/reject as tracked output.
 */
export function extractCliOutputOption(argv: string[]): {
  argv: string[];
  outputPath?: string;
  saveFormat?: CliSaveFormat;
} {
  const rest: string[] = [];
  let outputPath: string | undefined;
  let saveFormat: CliSaveFormat | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '-o' || token === '--output' || token === '--save-format') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      i += 1;
      if (token === '--save-format') {
        if (!(SAVE_FORMATS as readonly string[]).includes(next)) {
          throw new Error(`Invalid value for --save-format: "${next}". Must be one of: ${SAVE_FORMATS.join(', ')}`);
        }
        saveFormat = next as CliSaveFormat;
        continue;
      }
      if (outputPath !== undefined) {
        throw new Error('-o/--output may be specified only once.');
      }
      outputPath = next;
      continue;
    }
    rest.push(token);
  }
  if (saveFormat !== undefined && outputPath === undefined) {
    throw new Error('--save-format requires -o/--output <path>.');
  }
  return { argv: rest, outputPath, saveFormat };
}

/** Help text for the output-path contract, shared by top-level and per-tool help. */
export const CLI_OUTPUT_HELP_LINES: readonly string[] = [
  'Each command runs in a fresh session and exits, so an edit is kept only if it is written out.',
  'Pass -o, --output <path> to save the edited document. Without it, a command that made an',
  'edit exits 1 with success:false (UNSAVED_EDITS_DISCARDED) and the input file is unchanged.',
];
