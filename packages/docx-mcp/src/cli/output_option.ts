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

/** Remove `-o/--output <path>` from a tool subcommand's argv. */
export function extractCliOutputOption(argv: string[]): { argv: string[]; outputPath?: string } {
  const rest: string[] = [];
  let outputPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '-o' || token === '--output') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      if (outputPath !== undefined) {
        throw new Error('-o/--output may be specified only once.');
      }
      outputPath = next;
      i += 1;
      continue;
    }
    rest.push(token);
  }
  return { argv: rest, outputPath };
}

/** Help text for the output-path contract, shared by top-level and per-tool help. */
export const CLI_OUTPUT_HELP_LINES: readonly string[] = [
  'Each command runs in a fresh session and exits, so an edit is kept only if it is written out.',
  'Pass -o, --output <path> to save the edited document. Without it, a command that made an',
  'edit exits 1 with success:false (UNSAVED_EDITS_DISCARDED) and the input file is unchanged.',
];
