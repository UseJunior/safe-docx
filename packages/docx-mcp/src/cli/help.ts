/**
 * CLI help rendering — top-level and per-tool.
 */
import { SAFE_DOCX_TOOL_CATALOG } from '../tool_catalog.js';
import { generateToolHelp } from './flag_parser.js';
import { toKebabCase } from './parse_utils.js';
import { CLI_OUTPUT_HELP_LINES } from './output_option.js';

// ---------------------------------------------------------------------------
// Tool grouping by annotation
// ---------------------------------------------------------------------------

type ToolGroup = { label: string; names: string[] };

function groupTools(): ToolGroup[] {
  const readOnly: string[] = [];
  const mutating: string[] = [];

  for (const tool of SAFE_DOCX_TOOL_CATALOG) {
    if (tool.annotations.readOnlyHint) {
      readOnly.push(tool.name);
    } else {
      mutating.push(tool.name);
    }
  }

  return [
    { label: 'Read-only tools', names: readOnly },
    { label: 'Editing tools', names: mutating },
  ];
}

// ---------------------------------------------------------------------------
// Top-level help
// ---------------------------------------------------------------------------

export function renderTopLevelHelp(): string {
  const lines: string[] = [];
  lines.push('safe-docx CLI');
  lines.push('');
  lines.push('Usage:');
  lines.push('  safe-docx [command] [options]');
  lines.push('  safedocx [command] [options]');
  lines.push('');
  lines.push('Built-in commands:');
  lines.push('  serve                                       Start the MCP server (default)');
  lines.push('  compare <original> <revised> [output]       Compare two DOCX files and write redline output');
  lines.push('    -o, --output <path>                       Write redline output to this path');
  lines.push('    --author <name>                            Track-changes author (default: Comparison)');
  lines.push('                                                Output always uses the revised-based tagged package');
  lines.push('                                                Compare stats count revision ranges; atom totals use *Atoms fields');
  lines.push('  edit <file> [--replace ...] [-o output]     Batch edit a DOCX file (-o required to keep the edit)');
  lines.push('  grep "pattern" <file> [files...]            Search DOCX files for text');
  lines.push('');

  for (const group of groupTools()) {
    lines.push(`${group.label}:`);
    for (const name of group.names) {
      const entry = SAFE_DOCX_TOOL_CATALOG.find((t) => t.name === name)!;
      const kebab = toKebabCase(name);
      const desc = entry.description.split('.')[0]!;
      lines.push(`  ${kebab.padEnd(42)}${desc}`);
    }
    lines.push('');
  }

  lines.push('Saving edits:');
  lines.push('  edit and the editing tools take -o, --output <path>, e.g. safe-docx replace-text <file> ... -o edited.docx');
  lines.push('  (save, export, convert-to-odt and close-file write their own output and do not.)');
  for (const line of CLI_OUTPUT_HELP_LINES) lines.push(`  ${line}`);
  lines.push('');

  lines.push('Global options:');
  lines.push('  -h, --help                                  Show help');
  lines.push('  -v, --version                               Show version');
  lines.push('');
  lines.push('Use safe-docx <command> --help for detailed options on any command.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-tool help (delegates to flag_parser)
// ---------------------------------------------------------------------------

export function renderToolHelp(toolName: string): string {
  return generateToolHelp(toolName);
}

// ---------------------------------------------------------------------------
// edit command help
// ---------------------------------------------------------------------------

export function renderEditHelp(): string {
  return [
    'safe-docx edit',
    '',
    'Apply several replace/insert edits to a DOCX file in one run (a batch_edit wrapper).',
    '',
    'Usage:',
    '  safe-docx edit <file> [--replace <paragraph_id> <old> <new>]... [--insert-after <anchor_id> <text>]...',
    '                        [--insert-before <anchor_id> <text>]... [--instruction <text>] -o <path>',
    '',
    'Options:',
    '  --replace <paragraph_id> <old> <new>   Replace text in a paragraph (repeatable)',
    '  --insert-after <anchor_id> <text>      Insert a paragraph after an anchor (repeatable)',
    '  --insert-before <anchor_id> <text>     Insert a paragraph before an anchor (repeatable)',
    '  --instruction <text>                   Instruction recorded with each step',
    '  -o, --output <path>                    Save the edited document to this path',
    '',
    'Saving:',
    ...CLI_OUTPUT_HELP_LINES.map((line) => `  ${line}`),
  ].join('\n');
}
