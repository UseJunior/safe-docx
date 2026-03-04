/**
 * Schema-driven flag parser. Converts tool Zod schemas into CLI flag definitions
 * and parses argv into the Record<string, unknown> that dispatchToolCall expects.
 */
import { z } from 'zod';
import { SAFE_DOCX_TOOL_CATALOG } from '../tool_catalog.js';
import { parseBoolean, toKebabCase, toSnakeCase } from './parse_utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JsonSchemaProperty = {
  type?: string;
  enum?: string[];
  description?: string;
  items?: { type?: string };
  properties?: Record<string, JsonSchemaProperty>;
};

type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

export type ParsedFlags = {
  args: Record<string, unknown>;
  help: boolean;
};

// ---------------------------------------------------------------------------
// Short aliases — keyed by tool name, values map alias → snake_case param
// ---------------------------------------------------------------------------

const FLAG_ALIASES: Record<string, Record<string, string>> = {
  _global: { '--session': 'session_id', '--file': 'file_path' },
  replace_text: { '--para': 'target_paragraph_id', '--old': 'old_string', '--new': 'new_string' },
  save: { '-o': 'save_to_local_path', '--output': 'save_to_local_path' },
  insert_paragraph: { '--anchor': 'positional_anchor_node_id', '--pos': 'position' },
  add_comment: { '--para': 'target_paragraph_id' },
  add_footnote: { '--para': 'target_paragraph_id' },
};

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

function getToolSchema(toolName: string): { schema: JsonSchema; catalogEntry: (typeof SAFE_DOCX_TOOL_CATALOG)[number] } {
  const entry = SAFE_DOCX_TOOL_CATALOG.find((t) => t.name === toolName);
  if (!entry) throw new Error(`Unknown tool: ${toolName}`);
  const schema = z.toJSONSchema(entry.input) as JsonSchema;
  return { schema, catalogEntry: entry };
}

function hasFilePathParam(schema: JsonSchema): boolean {
  return schema.properties !== undefined && 'file_path' in schema.properties;
}

// ---------------------------------------------------------------------------
// Alias resolution
// ---------------------------------------------------------------------------

function resolveAlias(flag: string, toolName: string): string | null {
  const toolAliases = FLAG_ALIASES[toolName];
  if (toolAliases?.[flag]) return toolAliases[flag]!;
  const globalAliases = FLAG_ALIASES._global;
  if (globalAliases?.[flag]) return globalAliases[flag]!;
  return null;
}

// ---------------------------------------------------------------------------
// Type coercion
// ---------------------------------------------------------------------------

function coerceValue(raw: string, propSchema: JsonSchemaProperty, flagName: string): unknown {
  const t = propSchema.type;
  if (t === 'string') {
    if (propSchema.enum && !propSchema.enum.includes(raw)) {
      throw new Error(`Invalid value for ${flagName}: "${raw}". Must be one of: ${propSchema.enum.join(', ')}`);
    }
    return raw;
  }
  if (t === 'number') {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${flagName}: "${raw}"`);
    return n;
  }
  if (t === 'boolean') {
    return parseBoolean(raw, flagName);
  }
  if (t === 'object') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Invalid JSON for ${flagName}: ${raw}`);
    }
  }
  // Fallback: return as string
  return raw;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseToolFlags(argv: string[], toolName: string): ParsedFlags {
  const { schema } = getToolSchema(toolName);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  // Build lookup from kebab-case flag → snake_case property name
  const flagToProperty = new Map<string, string>();
  for (const propName of Object.keys(properties)) {
    flagToProperty.set(`--${toKebabCase(propName)}`, propName);
  }

  const result: Record<string, unknown> = {};
  let help = false;
  let firstPositionalConsumed = false;
  const acceptsFilePath = hasFilePathParam(schema);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    // Help flag
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }

    // Positional arg → file_path (only first positional, only if tool has file_path param)
    if (!token.startsWith('-') && !firstPositionalConsumed && acceptsFilePath) {
      result.file_path = token;
      firstPositionalConsumed = true;
      continue;
    }

    // Must be a flag
    if (!token.startsWith('-')) {
      throw new Error(`Unexpected positional argument: "${token}". Use flags to pass parameters.`);
    }

    // Resolve alias first
    const aliasResolved = resolveAlias(token, toolName);
    let propName: string;

    if (aliasResolved) {
      propName = aliasResolved;
    } else {
      const mapped = flagToProperty.get(token);
      if (!mapped) {
        throw new Error(`Unknown flag: ${token}. Use --help to see available flags for "${toolName}".`);
      }
      propName = mapped;
    }

    const propSchema = properties[propName];
    if (!propSchema) {
      throw new Error(`Unknown parameter: ${propName}`);
    }

    // Array type: collect repeatable flags
    if (propSchema.type === 'array') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      i += 1;
      const existing = result[propName];
      if (Array.isArray(existing)) {
        existing.push(coerceArrayItem(next, propSchema, token));
      } else {
        result[propName] = [coerceArrayItem(next, propSchema, token)];
      }
      continue;
    }

    // Boolean: if next token looks like a boolean value, consume it; otherwise treat as bare flag (true)
    if (propSchema.type === 'boolean') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-') && isBooleanLike(next)) {
        result[propName] = parseBoolean(next, token);
        i += 1;
      } else {
        result[propName] = true;
      }
      continue;
    }

    // All other types: consume next token as value
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('-') && propSchema.type !== 'number')) {
      throw new Error(`Missing value for ${token}`);
    }
    i += 1;
    result[propName] = coerceValue(next!, propSchema, token);
  }

  // Validate required fields (unless help is requested)
  if (!help) {
    for (const req of required) {
      if (result[req] === undefined) {
        throw new Error(`Missing required parameter: --${toKebabCase(req)}`);
      }
    }
  }

  return { args: result, help };
}

function coerceArrayItem(raw: string, propSchema: JsonSchemaProperty, flagName: string): unknown {
  const itemType = propSchema.items?.type;
  if (itemType === 'number') {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${flagName}: "${raw}"`);
    return n;
  }
  return raw;
}

function isBooleanLike(s: string): boolean {
  const lower = s.toLowerCase();
  return ['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'].includes(lower);
}

// ---------------------------------------------------------------------------
// Help generation
// ---------------------------------------------------------------------------

export function generateToolHelp(toolName: string): string {
  const { schema, catalogEntry } = getToolSchema(toolName);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const lines: string[] = [];
  lines.push(`safe-docx ${toKebabCase(toolName)}`);
  lines.push('');
  lines.push(catalogEntry.description);
  lines.push('');

  if (hasFilePathParam(schema)) {
    lines.push('Usage:');
    lines.push(`  safe-docx ${toKebabCase(toolName)} <file> [options]`);
    lines.push('');
  }

  lines.push('Options:');
  for (const [propName, propSchema] of Object.entries(properties)) {
    const flag = `--${toKebabCase(propName)}`;
    const req = required.has(propName) ? ' (required)' : '';
    const typeStr = formatType(propSchema);
    const desc = propSchema.description ?? '';
    lines.push(`  ${flag} ${typeStr}${req}`);
    if (desc) lines.push(`      ${desc}`);
  }

  // Show aliases if any
  const aliases = { ...FLAG_ALIASES._global, ...FLAG_ALIASES[toolName] };
  const aliasEntries = Object.entries(aliases);
  if (aliasEntries.length > 0) {
    lines.push('');
    lines.push('Aliases:');
    for (const [alias, target] of aliasEntries) {
      lines.push(`  ${alias} → --${toKebabCase(target)}`);
    }
  }

  return lines.join('\n');
}

function formatType(prop: JsonSchemaProperty): string {
  if (prop.enum) return `<${prop.enum.join('|')}>`;
  if (prop.type === 'array') return `<${prop.items?.type ?? 'string'}> (repeatable)`;
  if (prop.type === 'object') return '<json>';
  if (prop.type) return `<${prop.type}>`;
  return '<value>';
}
