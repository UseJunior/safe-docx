/**
 * CLI help rendering — top-level and per-tool.
 */
import { SAFE_DOCX_TOOL_CATALOG } from '../tool_catalog.js';
import { generateToolHelp } from './flag_parser.js';
import { toKebabCase } from './parse_utils.js';

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
  lines.push('  edit <file> [--replace ...] [-o output]     Batch edit a DOCX file');
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
